/**
 * AiAttireAssistant module
 * The actual "Add Formal Attire" pipeline: sends the current photo to
 * whichever configured AI provider ModelProviders.pickCandidates()
 * says is tested-working (free models first), asking it to generate
 * the same person wearing formal attire, fitted to them. Returns an
 * HTMLImageElement — same "gives back a usable image" contract as
 * BgRemoval.removeBackgroundFromFile() / the old AttireEnhance.enhance()
 * — so formalAttireCommand.js can hand it straight to
 * CanvasEditor.setEnhancedPhoto().
 *
 * This supersedes the old "Align to photo" heuristic: instead of
 * separately positioning a static illustration/upload, the AI directly
 * generates the person actually wearing the attire, which is why the
 * result replaces the photo's own pixels rather than adding a second
 * draggable layer — see CLAUDE.md and canvasEditor.js's module doc.
 */
const AiAttireAssistant = (() => {

  const MAX_INPUT_EDGE = 1024; // keeps the base64 payload reasonable across providers

  const PROMPTS = {
    male: 'Edit this photo so the person is wearing a professional formal men\'s business suit with a dress shirt and tie, properly fitted to their body and shoulders, suitable for an official ID photo. Keep the person\'s face, expression, pose, hair, and the background exactly unchanged — only add/replace their clothing. Photorealistic, natural lighting matching the original photo.',
    female: 'Edit this photo so the person is wearing professional formal women\'s business attire (a blazer/suit or blouse), properly fitted to their body and shoulders, suitable for an official ID photo. Keep the person\'s face, expression, pose, hair, and the background exactly unchanged — only add/replace their clothing. Photorealistic, natural lighting matching the original photo.',
  };

  function imageElementToDataUrl(el) {
    const srcW = el.naturalWidth || el.width;
    const srcH = el.naturalHeight || el.height;
    const scale = Math.min(1, MAX_INPUT_EDGE / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(el, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the generated image.'));
      img.src = dataUrl;
    });
  }

  /**
   * `onProgress(status, providerLabel)` fires before each attempt (e.g.
   * "Trying Gemini…") so the UI never sits on a silent black-box wait.
   * Throws if every candidate fails or none are configured — the
   * caller (formalAttireCommand.js) shows that as a real error, it
   * does not fall back to anything else (the old manual attire system
   * this replaces was removed entirely per the approved plan).
   */
  async function generateFormalAttire(photoImageEl, gender, onProgress) {
    const candidates = ModelProviders.pickCandidates();
    if (!candidates.length) {
      throw new Error('No working AI provider is configured yet. Add and test one under "AI Providers" (top-right).');
    }

    const promptText = PROMPTS[gender === 'female' ? 'female' : 'male'];
    const imageDataUrl = imageElementToDataUrl(photoImageEl);

    const errors = [];
    for (const candidate of candidates) {
      const providerLabel = candidate.config.label;
      if (onProgress) onProgress('trying', providerLabel);
      try {
        const resultDataUrl = await ModelProviders.callEdit(candidate, promptText, imageDataUrl);
        return await loadImage(resultDataUrl);
      } catch (err) {
        const message = (err && err.message) || String(err);
        console.error(`AiAttireAssistant: ${providerLabel} failed:`, message);
        errors.push(`${providerLabel}: ${message}`);
        if (onProgress) onProgress('failed', providerLabel);
      }
    }

    throw new Error(`Every configured provider failed. ${errors.join(' | ')}`);
  }

  return { generateFormalAttire };
})();
