const QUIET_VOLUME = 0.15;

let audio: HTMLAudioElement | null = null;

// Actual playback is enabled && focused — tracked separately so toggling
// music doesn't fight with window-focus changes (see setWindowFocused).
let enabled = false;
let focused = true;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(window.__THREEVSCODE__.musicUri);
    audio.loop = true;
    audio.volume = QUIET_VOLUME;
  }
  return audio;
}

function sync(): void {
  const el = getAudio();
  if (enabled && focused) {
    el.play().catch((err) => console.error("[musicPlayer] Failed to play:", err));
  } else {
    el.pause();
  }
}

/** Off by default — only ever plays once a user explicitly turns it on. */
export function setMusicEnabled(next: boolean): void {
  enabled = next;
  sync();
}

/**
 * Music has no natural per-utterance lock the way speech does (see
 * speechLock.ts) — it's continuous, so without this, every open VS Code
 * window with music enabled plays its own loop simultaneously. Muting
 * whichever window(s) aren't focused means at most one is ever audible.
 */
export function setWindowFocused(next: boolean): void {
  focused = next;
  sync();
}
