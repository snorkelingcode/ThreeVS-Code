import { KokoroTTS } from "kokoro-js";
import type { ProgressCallback } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Masculine voice to suit the tactical/military character model.
export const DEFAULT_VOICE = "am_michael";

let ttsPromise: Promise<KokoroTTS> | null = null;

/** Singleton so React StrictMode's double-invoked effects don't load the model twice. */
export function loadTTSEngine(onProgress: ProgressCallback): Promise<KokoroTTS> {
  if (!ttsPromise) {
    const useWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: useWebGPU ? "fp32" : "q8",
      device: useWebGPU ? "webgpu" : "wasm",
      progress_callback: onProgress,
    });
  }
  return ttsPromise;
}
