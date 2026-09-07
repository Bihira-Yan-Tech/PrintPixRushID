/**
 * PoseDetection module
 * Lazily loads MediaPipe's Pose Landmarker (`@mediapipe/tasks-vision`,
 * WASM, CDN-loaded on first use — same "needs internet once, then
 * cached" pattern as bgRemoval.js's @imgly/background-removal, and for
 * the same reason: the model file is several MB, too big to self-host
 * in `vendor/` for a feature not every user clicks) and uses it to find
 * a person's shoulder position in a photo.
 *
 * This is NOT clothing generation — it only returns coordinates
 * (normalized 0-1, image-relative) for canvasEditor.js's
 * alignAttireToPhoto() to use when positioning the EXISTING attire
 * graphic more accurately than the old fixed "centered + 60%-down"
 * heuristic. Returns null on any failure (no internet, model load
 * error, no person detected with reasonable confidence) — callers MUST
 * fall back to that heuristic when this happens; a missing detection is
 * an expected, non-error outcome here, never something to surface as a
 * failure to the user.
 */
const PoseDetection = (() => {

  const VISION_BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';
  const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
  // "lite" variant deliberately — only shoulder position is needed, not
  // fine-grained pose, so the smallest/fastest model is the right one.
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

  // MediaPipe's 33-point pose model — indices we care about.
  const LEFT_SHOULDER = 11;
  const RIGHT_SHOULDER = 12;
  const MIN_VISIBILITY = 0.5; // per-landmark confidence threshold

  let landmarkerPromise = null;

  function loadLandmarker() {
    if (landmarkerPromise) return landmarkerPromise;
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import(VISION_BUNDLE_URL);
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
    })();
    // Don't cache a rejected load — the next call (e.g. after the user
    // regains internet) should retry instead of repeating the same
    // failure forever for the lifetime of the page.
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
    return landmarkerPromise;
  }

  /**
   * Detects shoulder position/width in `imageEl` (an already-loaded
   * <img> or <canvas>). Returns `{ centerX, shoulderY, shoulderWidth }`
   * (all normalized 0-1, image-relative) on success, or `null` if
   * detection failed/unavailable/no confident person found — callers
   * must have a non-AI fallback ready and treat null as routine, not
   * an error.
   */
  async function detectShoulders(imageEl) {
    try {
      const landmarker = await loadLandmarker();
      const result = landmarker.detect(imageEl);
      const pose = result.landmarks && result.landmarks[0];
      if (!pose) return null;

      const left = pose[LEFT_SHOULDER];
      const right = pose[RIGHT_SHOULDER];
      if (!left || !right) return null;
      if ((left.visibility != null && left.visibility < MIN_VISIBILITY) ||
          (right.visibility != null && right.visibility < MIN_VISIBILITY)) {
        return null;
      }

      return {
        centerX: (left.x + right.x) / 2,
        shoulderY: (left.y + right.y) / 2,
        shoulderWidth: Math.abs(left.x - right.x),
      };
    } catch (err) {
      console.error('Pose detection unavailable this time — caller falls back to the position heuristic:', err);
      return null;
    }
  }

  return { detectShoulders };
})();
