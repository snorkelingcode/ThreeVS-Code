const QUIET_VOLUME = 0.15;

let audio: HTMLAudioElement | null = null;

// Actual playback is enabled && owned — tracked separately so toggling
// music doesn't fight with ownership changes (see setMusicOwned). "owned"
// comes from the extension host's cross-window lock (see musicLock.ts), NOT
// from OS window focus — switching to a different application should leave
// music playing, exactly like voice; only another VS Code window taking
// over playback should stop it.
let enabled = false;
let owned = false;

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
  if (enabled && owned) {
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

/** Whether the extension host has granted this window the cross-window music lock. */
export function setMusicOwned(next: boolean): void {
  owned = next;
  sync();
}
