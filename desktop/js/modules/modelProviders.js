/**
 * ModelProviders module
 * Data layer + real HTTP logic for the "AI Providers" settings (the
 * modal wired by providerSettings.js) and for AiAttireAssistant's
 * provider-fallback chain. Nothing here draws UI.
 *
 * Storage: an array of provider *configs* in
 * localStorage['printpixRushId.providers'] — `{ id, presetId, label,
 * apiKey, enabled, models: [{id,label,free}], lastTestStatus
 * ('ok'|'error'|null), lastTestError, lastTestedAt }`. Kept as plain
 * localStorage, unencrypted — same trust model CLAUDE.md's Security
 * note already documents for saved jobs (a local, single-user
 * print-shop tool, not a hosted multi-user web app).
 *
 * Pollinations needs no API key at all and is pre-registered by
 * default (added on first run if the stored list is empty) so
 * "Add Formal Attire" has something that works with zero setup.
 *
 * Requests never go through a raw browser fetch() directly when a
 * native bridge is available — see callHttp() below — mirroring the
 * existing Electron/Android bridge pattern this app already uses for
 * Save Job (see CLAUDE.md's "Desktop app (Electron)" / "Mobile app
 * (Android)" sections). That sidesteps browser CORS and, on mobile,
 * the WebView dynamic-import() incompatibility documented in the old
 * PROGRESS.md (these are plain HTTP calls, no dynamic import at all).
 *
 * HONESTY NOTE on the presets below: Pollinations, Gemini, OpenRouter,
 * Groq and Hugging Face's *test* (list-models / whoami) endpoints are
 * well-documented, stable APIs and are implemented with real
 * confidence. The *image-edit* request shape for OpenRouter,
 * Hugging Face, and Qwen/DashScope is more best-effort — multimodal
 * image-editing APIs vary per model and move fast; testProvider()
 * still only reports what it can actually verify (a real call, not a
 * format check), and AiAttireAssistant's fallback chain means a wrong
 * guess for one provider just moves on to the next rather than
 * silently failing the whole feature.
 */
const ModelProviders = (() => {

  const STORAGE_KEY = 'printpixRushId.providers';

  // ---- Provider presets ----
  // Each preset knows how to build a "list models" request (for Test)
  // and an "edit this image" request, and how to parse each response.
  // `buildTestRequest`/`buildEditRequest` return a plain HTTP descriptor
  // { method, url, headers, body } — never fetch() directly, see
  // callHttp(). `parseTestResponse`/`parseEditResponse` take the parsed
  // JSON (or, for image bytes, the raw response) and return
  // `{ models }` / a data URL respectively; throw a descriptive Error
  // on anything unexpected so testProvider()/the edit call surface a
  // real reason rather than a generic failure.

  const PROVIDER_PRESETS = {
    pollinations: {
      id: 'pollinations',
      label: 'Pollinations (no key needed)',
      needsKey: false,
      supportsImageEdit: true,
      buildTestRequest() {
        return { method: 'GET', url: 'https://image.pollinations.ai/models' };
      },
      parseTestResponse(json) {
        const names = Array.isArray(json) ? json : (json && json.models) || [];
        if (!names.length) throw new Error('No models returned.');
        return names.map(name => ({ id: String(name), label: String(name), free: true }));
      },
      // Verified against Pollinations' real APIDOCS.md (Sept 2026):
      // image-to-image editing is GET
      // https://image.pollinations.ai/prompt/{prompt}?model=kontext&image={imageUrl}
      // where `image` must be a URL Pollinations' own servers can fetch —
      // NOT inline base64/a data: URI (confirmed by direct testing: a
      // guessed POST /openai/images/edits with an inline `image` field
      // returned 200 but silently ignored the image and misread the URL
      // path itself as the prompt). This app only ever has the photo as
      // a local data: URL (no backend to host it at a public URL), so
      // Pollinations genuinely can't do the edit step for this app —
      // buildEditRequest throws a clear, honest error instead of making
      // a network call that's guaranteed to fail unhelpfully. Still
      // listed/testable as a provider since its "list models" test is
      // real and it may become usable later (e.g. if this app ever adds
      // a way to get a public URL for the photo).
      buildEditRequest() {
        throw new Error('Pollinations needs a public image URL for editing, which this app can\'t provide from a local photo — add Gemini, OpenRouter, or Hugging Face instead.');
      },
      parseEditResponse() {
        throw new Error('Pollinations edit response should never be reached — see buildEditRequest.');
      },
    },

    gemini: {
      id: 'gemini',
      label: 'Google Gemini (AI Studio)',
      needsKey: true,
      supportsImageEdit: true,
      buildTestRequest(apiKey) {
        return { method: 'GET', url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}` };
      },
      parseTestResponse(json) {
        const list = (json && json.models) || [];
        if (!list.length) throw new Error('No models returned — check the API key.');
        const imageModels = list.filter(m => /image/i.test(m.name) || /image/i.test((m.displayName || '')));
        const models = (imageModels.length ? imageModels : list).map(m => ({
          id: m.name.replace(/^models\//, ''),
          label: m.displayName || m.name,
          free: true, // Google AI Studio keys are the free tier by definition
        }));
        return models;
      },
      buildEditRequest(apiKey, modelId, promptText, imageDataUrl) {
        const [, mimeType, base64] = /^data:([^;]+);base64,(.*)$/.exec(imageDataUrl) || [];
        return {
          method: 'POST',
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: promptText },
                { inlineData: { mimeType: mimeType || 'image/png', data: base64 || '' } },
              ],
            }],
          }),
        };
      },
      parseEditResponse(json) {
        const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
        const imgPart = parts && parts.find(p => p.inlineData && p.inlineData.data);
        if (!imgPart) throw new Error('Gemini did not return an image — it may have refused the request.');
        return `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
      },
    },

    openrouter: {
      id: 'openrouter',
      label: 'OpenRouter',
      needsKey: true,
      supportsImageEdit: true,
      buildTestRequest(apiKey) {
        return { method: 'GET', url: 'https://openrouter.ai/api/v1/models', headers: { Authorization: `Bearer ${apiKey}` } };
      },
      parseTestResponse(json) {
        const list = (json && json.data) || [];
        if (!list.length) throw new Error('No models returned.');
        return list
          .filter(m => /image/i.test(m.id) || /image/i.test(m.name || '') || (m.architecture && /image/i.test((m.architecture.output_modalities || []).join(','))))
          .map(m => {
            const promptPrice = m.pricing && parseFloat(m.pricing.prompt);
            return { id: m.id, label: m.name || m.id, free: /:free$/.test(m.id) || promptPrice === 0 };
          });
      },
      buildEditRequest(apiKey, modelId, promptText, imageDataUrl) {
        return {
          method: 'POST',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            }],
            modalities: ['image', 'text'],
          }),
        };
      },
      parseEditResponse(json) {
        const msg = json && json.choices && json.choices[0] && json.choices[0].message;
        const img = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
        if (!img) throw new Error('OpenRouter did not return an image for this model.');
        return img;
      },
    },

    huggingface: {
      id: 'huggingface',
      label: 'Hugging Face Inference API',
      needsKey: true,
      supportsImageEdit: true,
      buildTestRequest(apiKey) {
        return { method: 'GET', url: 'https://huggingface.co/api/whoami-v2', headers: { Authorization: `Bearer ${apiKey}` } };
      },
      parseTestResponse(json) {
        if (!json || (!json.name && !json.email)) throw new Error('Token did not validate — check the API key.');
        // Hugging Face has no single "list image-edit models" endpoint —
        // offer a small known-good default; the user can still type a
        // different model id by editing this provider's config later.
        return [{ id: 'Qwen/Qwen-Image-Edit', label: 'Qwen-Image-Edit', free: true }];
      },
      // KNOWN LIMITATION, found via real testing: `api-inference.huggingface.co`
      // (this preset's original URL) is fully decommissioned — fixed to
      // `router.huggingface.co`, HF's current Inference Providers gateway.
      // BUT: unlike chat completions (a real, working, provider-agnostic
      // `/v1/chat/completions` route), image-to-image has no such unified
      // route. Confirmed via `huggingface.co/api/models/Qwen/Qwen-Image-Edit
      // ?expand[]=inferenceProviderMapping`: this model is only actually
      // served by third-party partners (fal-ai/replicate/wavespeed), NOT
      // HF's own "hf-inference" compute (confirmed empty via
      // `/api/models?pipeline_tag=image-to-image&inference_provider=hf-inference`).
      // Routing through `router.huggingface.co/fal-ai/models/...` still
      // returned "Model not supported by provider fal-ai" — each partner
      // has its own request shape the router expects, not documented for
      // plain HTTP use (only their client SDK's `imageToImage()` handles
      // this correctly today). Left as a real HTTP call (not stubbed out
      // like Pollinations' unfixable case) since the route itself is
      // real and might work for a different model already hosted on
      // hf-inference directly — but don't assume this preset works
      // end-to-end without testing it against the specific model chosen.
      buildEditRequest(apiKey, modelId, promptText, imageDataUrl) {
        const [, , base64] = /^data:([^;]+);base64,(.*)$/.exec(imageDataUrl) || [];
        return {
          method: 'POST',
          url: `https://router.huggingface.co/hf-inference/models/${modelId}`,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: base64 || '', parameters: { prompt: promptText } }),
        };
      },
      parseEditResponse(json, rawBase64) {
        // A successful HF inference call for an image pipeline often
        // returns raw image bytes (not JSON) — callHttp() passes those
        // through as base64 in `rawBase64` when the response wasn't
        // parseable JSON.
        if (rawBase64) return `data:image/png;base64,${rawBase64}`;
        throw new Error('Hugging Face did not return an image.');
      },
    },

    qwen: {
      id: 'qwen',
      label: 'Qwen (DashScope)',
      needsKey: true,
      supportsImageEdit: true,
      buildTestRequest(apiKey) {
        return { method: 'GET', url: 'https://dashscope.aliyuncs.com/api/v1/models', headers: { Authorization: `Bearer ${apiKey}` } };
      },
      parseTestResponse(json) {
        const list = (json && (json.models || json.data)) || [];
        return list.length
          ? list.map(m => ({ id: m.id || m.model, label: m.name || m.id || m.model, free: false }))
          : [{ id: 'qwen-image-edit', label: 'qwen-image-edit', free: false }];
      },
      buildEditRequest(apiKey, modelId, promptText, imageDataUrl) {
        return {
          method: 'POST',
          url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            input: { messages: [{ role: 'user', content: [{ image: imageDataUrl }, { text: promptText }] }] },
          }),
        };
      },
      parseEditResponse(json) {
        const content = json && json.output && json.output.choices && json.output.choices[0] && json.output.choices[0].message && json.output.choices[0].message.content;
        const img = Array.isArray(content) && content.find(c => c.image);
        if (!img) throw new Error('Qwen/DashScope did not return an image for this model.');
        return img.image;
      },
    },

    omniroute: {
      id: 'omniroute',
      label: 'OmniRoute',
      needsKey: true,
      needsBaseUrl: true,
      supportsImageEdit: true,
      // OmniRoute (github.com/diegosouzapw/OmniRoute) is itself an
      // open-source, self-hosted AI gateway/router across ~350
      // providers, OpenAI-compatible. It documents a dedicated
      // `/v1/images/generations` endpoint, but its exact schema for
      // passing a *reference/source* image (for editing, not just
      // text-to-image) isn't confidently verifiable from its docs —
      // rather than guess wrong the way the first Pollinations attempt
      // did, this uses the same well-established "multimodal chat
      // completion with an image_url part" convention as the
      // OpenRouter/custom presets, which OmniRoute's own OpenAI-
      // compatible chat endpoint should support for any vision+image-
      // output-capable model it's routing to. `baseUrl` is the user's
      // own OmniRoute instance (self-hosted — there's no single public
      // URL for it).
      // `baseUrl` is expected to be the API root the same way an
      // OpenAI-SDK `baseURL` config works (e.g.
      // `http://localhost:20128/v1`, already including any `/v1`) —
      // this just appends the endpoint path directly, same convention
      // as the "custom" preset just below. An earlier version hardcoded
      // its own `/v1/` prefix here, which doubled up into `/v1/v1/...`
      // for exactly this kind of base URL — a real bug found via
      // testing against a real local OmniRoute instance.
      buildTestRequest(apiKey, baseUrl) {
        return { method: 'GET', url: `${(baseUrl || '').replace(/\/+$/, '')}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
      },
      parseTestResponse(json) {
        const list = (json && json.data) || (Array.isArray(json) ? json : []);
        if (!list.length) throw new Error('No models returned — check the base URL and API key.');
        return list.map(m => ({ id: m.id || m, label: m.id || m, free: false }));
      },
      buildEditRequest(apiKey, modelId, promptText, imageDataUrl, baseUrl) {
        return {
          method: 'POST',
          url: `${(baseUrl || '').replace(/\/+$/, '')}/chat/completions`,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: imageDataUrl } }] }],
            modalities: ['image', 'text'],
          }),
        };
      },
      parseEditResponse(json) {
        const msg = json && json.choices && json.choices[0] && json.choices[0].message;
        const img = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
        if (!img) throw new Error('OmniRoute did not return an image for this model — it may need a different image-capable model selected.');
        return img;
      },
    },

    groq: {
      id: 'groq',
      label: 'Groq',
      needsKey: true,
      supportsImageEdit: false, // Groq is LLM/audio inference only — no image generation/editing, see CLAUDE.md
      buildTestRequest(apiKey) {
        return { method: 'GET', url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: `Bearer ${apiKey}` } };
      },
      parseTestResponse(json) {
        const list = (json && json.data) || [];
        if (!list.length) throw new Error('No models returned — check the API key.');
        return list.map(m => ({ id: m.id, label: m.id, free: false }));
      },
    },

    custom: {
      id: 'custom',
      label: 'Custom / OpenAI-compatible endpoint',
      needsKey: true,
      needsBaseUrl: true,
      supportsImageEdit: true,
      buildTestRequest(apiKey, baseUrl) {
        return { method: 'GET', url: `${(baseUrl || '').replace(/\/+$/, '')}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
      },
      parseTestResponse(json) {
        const list = (json && json.data) || (Array.isArray(json) ? json : []);
        if (!list.length) throw new Error('No models returned.');
        return list.map(m => ({ id: m.id || m, label: m.id || m, free: false }));
      },
      buildEditRequest(apiKey, modelId, promptText, imageDataUrl, baseUrl) {
        return {
          method: 'POST',
          url: `${(baseUrl || '').replace(/\/+$/, '')}/chat/completions`,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: imageDataUrl } }] }],
            modalities: ['image', 'text'],
          }),
        };
      },
      parseEditResponse(json) {
        const msg = json && json.choices && json.choices[0] && json.choices[0].message;
        const img = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
        if (!img) throw new Error('This endpoint did not return an image in the expected OpenAI-compatible shape.');
        return img;
      },
    },
  };

  // ---- Storage ----

  function loadConfigs() {
    let list;
    try {
      list = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (err) {
      list = null;
    }
    if (!Array.isArray(list)) {
      // First run: pre-register Pollinations so there's a zero-setup default.
      list = [{
        id: 'pollinations-default',
        presetId: 'pollinations',
        label: 'Pollinations',
        apiKey: '',
        baseUrl: '',
        enabled: true,
        models: [],
        lastTestStatus: null,
        lastTestError: null,
        lastTestedAt: null,
      }];
      saveConfigs(list);
    }
    return list;
  }

  function saveConfigs(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function addProvider({ presetId, label, apiKey, baseUrl }) {
    const list = loadConfigs();
    const config = {
      id: `${presetId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      presetId,
      label: label || (PROVIDER_PRESETS[presetId] || {}).label || presetId,
      apiKey: apiKey || '',
      baseUrl: baseUrl || '',
      enabled: true,
      models: [],
      lastTestStatus: null,
      lastTestError: null,
      lastTestedAt: null,
    };
    list.push(config);
    saveConfigs(list);
    return config;
  }

  function removeProvider(id) {
    saveConfigs(loadConfigs().filter(c => c.id !== id));
  }

  function updateProvider(id, patch) {
    const list = loadConfigs();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    saveConfigs(list);
    return list[idx];
  }

  // ---- HTTP, routed through a native bridge when available ----
  // See CLAUDE.md's "Desktop app (Electron)" / "Mobile app (Android)"
  // for why: browser fetch() is subject to CORS (and, on the old
  // WebView compatibility issue documented in the old PROGRESS.md,
  // dynamic-import restrictions that don't even apply here since this
  // is plain fetch — but the CORS problem is real and separate).
  // Electron's main process and Android's own HTTP client aren't
  // subject to either.

  function androidCallProvider(request) {
    return new Promise((resolve, reject) => {
      window.__androidProviderCallbacks = window.__androidProviderCallbacks || {};
      window.__androidProviderRequestSeq = (window.__androidProviderRequestSeq || 0) + 1;
      const requestId = String(window.__androidProviderRequestSeq);
      window.__androidProviderCallbacks[requestId] = { resolve, reject };
      if (!window.__androidProviderCallback) {
        window.__androidProviderCallback = function (id, ok, status, bodyOrError) {
          const cb = window.__androidProviderCallbacks[id];
          if (!cb) return;
          delete window.__androidProviderCallbacks[id];
          if (ok) cb.resolve({ status: Number(status), body: bodyOrError });
          else cb.reject(new Error(bodyOrError));
        };
      }
      window.AndroidBridge.callProvider(requestId, request.method, request.url, JSON.stringify(request.headers || {}), request.body || '');
    });
  }

  /** Returns { status, bodyText, bodyJson|null, base64|null }. */
  async function callHttp(request) {
    let status, bodyText;

    if (window.electronAPI && window.electronAPI.callProvider) {
      const result = await window.electronAPI.callProvider(request);
      if (result.error) throw new Error(result.error);
      status = result.status;
      bodyText = result.body;
    } else if (window.AndroidBridge && window.AndroidBridge.callProvider) {
      const result = await androidCallProvider(request);
      status = result.status;
      bodyText = result.body;
    } else {
      const res = await fetch(request.url, { method: request.method || 'GET', headers: request.headers, body: request.body });
      status = res.status;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        const buf = await res.arrayBuffer();
        return { status, bodyText: null, bodyJson: null, base64: arrayBufferToBase64(buf) };
      }
      bodyText = await res.text();
    }

    let bodyJson = null;
    try { bodyJson = JSON.parse(bodyText); } catch (err) { /* not JSON — fine, some providers return raw image bytes/base64 as text */ }
    return { status, bodyText, bodyJson, base64: bodyJson ? null : (looksLikeBase64(bodyText) ? bodyText : null) };
  }

  function arrayBufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function looksLikeBase64(str) {
    return typeof str === 'string' && str.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(str.slice(0, 200));
  }

  // ---- Test + auto-selection ----

  async function testProvider(config) {
    const preset = PROVIDER_PRESETS[config.presetId] || PROVIDER_PRESETS.custom;
    try {
      const request = preset.buildTestRequest(config.apiKey, config.baseUrl);
      const { status, bodyJson, bodyText } = await callHttp(request);
      if (status < 200 || status >= 300) {
        throw new Error(`HTTP ${status}${bodyText ? ' — ' + bodyText.slice(0, 200) : ''}`);
      }
      const models = preset.parseTestResponse(bodyJson);
      updateProvider(config.id, { models, lastTestStatus: 'ok', lastTestError: null, lastTestedAt: new Date().toISOString() });
      return { ok: true, models };
    } catch (err) {
      const message = (err && err.message) || String(err);
      updateProvider(config.id, { lastTestStatus: 'error', lastTestError: message, lastTestedAt: new Date().toISOString() });
      return { ok: false, error: message };
    }
  }

  /**
   * "Fill First" auto-selection: tested-working, image-edit-capable
   * providers, free models sorted before paid ones. Returns a flat,
   * ordered list of `{ config, preset, model }` candidates —
   * AiAttireAssistant tries them one at a time until one succeeds.
   */
  function pickCandidates() {
    const candidates = [];
    loadConfigs().forEach((config) => {
      const preset = PROVIDER_PRESETS[config.presetId] || PROVIDER_PRESETS.custom;
      if (!config.enabled || config.lastTestStatus !== 'ok' || preset.supportsImageEdit === false) return;
      (config.models || []).forEach((model) => candidates.push({ config, preset, model }));
    });
    candidates.sort((a, b) => (b.model.free ? 1 : 0) - (a.model.free ? 1 : 0));
    return candidates;
  }

  async function callEdit(candidate, promptText, imageDataUrl) {
    const { config, preset, model } = candidate;
    const request = preset.buildEditRequest(config.apiKey, model.id, promptText, imageDataUrl, config.baseUrl);
    const { status, bodyJson, bodyText, base64 } = await callHttp(request);
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status}${bodyText ? ' — ' + bodyText.slice(0, 200) : ''}`);
    }
    return preset.parseEditResponse(bodyJson, base64);
  }

  // ---- Key-format auto-detection ----
  // Best-effort, not authoritative — providers change key formats over
  // time (e.g. Google has shipped more than one shape), so this only
  // ever *pre-selects* a suggestion in providerSettings.js's dropdown;
  // the user can always override it manually. Deliberately does NOT
  // match a bare "sk-" prefix to a specific preset — that prefix is
  // shared by OpenAI-style keys across many different unrelated
  // gateways/providers, so guessing there would be wrong more often
  // than it's right.
  const KEY_PATTERNS = [
    { presetId: 'gemini', test: (k) => /^AIza[0-9A-Za-z_-]{35}$/.test(k) || /^AQ\.[0-9A-Za-z_-]+$/.test(k) },
    { presetId: 'openrouter', test: (k) => /^sk-or-/.test(k) },
    { presetId: 'huggingface', test: (k) => /^hf_/.test(k) },
    { presetId: 'groq', test: (k) => /^gsk_/.test(k) },
  ];

  function detectPresetFromKey(apiKey) {
    const k = (apiKey || '').trim();
    if (!k) return null;
    const match = KEY_PATTERNS.find((p) => p.test(k));
    return match ? match.presetId : null;
  }

  /**
   * Auto-tests any saved provider that's never been tested yet
   * (`lastTestStatus === null`) and has what it needs to try (a key,
   * or none required) — runs once per app load, fire-and-forget, so a
   * key added in a previous session shows real "Working"/model-list
   * status the moment Provider Settings is opened, without the user
   * having to remember to click Test themselves. Deliberately does
   * NOT re-test already-tested providers on every boot (would mean a
   * real network call per provider on every single app launch even
   * when nothing changed) — the manual Test button still exists for a
   * fresh re-check any time.
   */
  async function autoTestUntested() {
    const configs = loadConfigs();
    const candidates = configs.filter((c) => {
      const preset = PROVIDER_PRESETS[c.presetId] || PROVIDER_PRESETS.custom;
      return c.enabled && c.lastTestStatus == null && (preset.needsKey ? !!c.apiKey : true) && (preset.needsBaseUrl ? !!c.baseUrl : true);
    });
    for (const config of candidates) {
      try { await testProvider(config); } catch (err) { /* testProvider already records the failure on the config itself */ }
    }
  }

  function init() {
    loadConfigs(); // ensures Pollinations is pre-registered on first run
    autoTestUntested(); // fire-and-forget — see its own doc comment
  }

  return {
    init, PROVIDER_PRESETS,
    loadConfigs, addProvider, removeProvider, updateProvider,
    testProvider, pickCandidates, callEdit, detectPresetFromKey,
  };
})();
