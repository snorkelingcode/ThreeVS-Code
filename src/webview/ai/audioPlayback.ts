import type { RawAudio } from "@huggingface/transformers";

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeDomainData: Uint8Array<ArrayBuffer> | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function getAnalyser(ctx: AudioContext): AnalyserNode {
  if (!analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    timeDomainData = new Uint8Array(analyser.frequencyBinCount);
  }
  return analyser;
}

/**
 * Chrome's autoplay policy suspends AudioContext until a real user gesture
 * resumes it — calling .resume() from anywhere else (e.g. right before
 * playback, with no click behind it) does not unblock it. Call this from an
 * actual click handler once per panel; playback works normally after.
 */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();
}

/** Plays a Kokoro RawAudio buffer and resolves once playback finishes. Routed through a shared AnalyserNode (see getAmplitude) so the visor can pulse with actual speech volume. */
export function playRawAudio(raw: RawAudio): Promise<void> {
  const ctx = getAudioContext();
  const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
  buffer.copyToChannel(raw.audio as Float32Array<ArrayBuffer>, 0);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const node = getAnalyser(ctx);
  source.connect(node);
  node.connect(ctx.destination);

  currentSource = source;
  return new Promise((resolve) => {
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      resolve();
    };
    source.start();
  });
}

/** Immediately silences whatever's currently playing (e.g. voice was disabled mid-speech). `source.stop()` fires `onended`, so the pending `playRawAudio` promise still resolves normally rather than hanging the queue. */
export function stopPlayback(): void {
  if (!currentSource) return;
  try {
    currentSource.stop();
  } catch {
    // Already stopped/ended — nothing to do.
  }
  currentSource = null;
}

/** Current speech volume as a 0..1 RMS level, for driving the visor pulse each frame. 0 when nothing's playing. */
export function getAmplitude(): number {
  if (!analyser || !timeDomainData) return 0;
  analyser.getByteTimeDomainData(timeDomainData);

  let sumSquares = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const v = (timeDomainData[i] - 128) / 128;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / timeDomainData.length);
}
