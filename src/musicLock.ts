import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Cross-process mutex deciding which open VS Code window's background music
 * is actually audible — unlike speech (see speechLock.ts), this isn't
 * released after one turn; a window holds it for as long as it's the one
 * playing music, refreshing it with a heartbeat so it doesn't go stale while
 * legitimately still owned. Deliberately NOT tied to OS window focus: the
 * point is that switching to a different application (browser, etc.) should
 * leave the music playing, exactly like voice — only another VS Code window
 * taking over playback should stop it.
 */
const LOCK_DIR = path.join(os.homedir(), ".claude", "threevscode-music.lock");
const STALE_MS = 15_000; // no single heartbeat gap should ever come close to this
const HEARTBEAT_MS = 5_000;

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let owned = false;

function touch(): void {
  try {
    fs.writeFileSync(path.join(LOCK_DIR, "acquired-at"), String(Date.now()));
  } catch (err) {
    console.warn("[ThreeVSCode] Failed to refresh music lock heartbeat:", err);
  }
}

function isStale(): boolean {
  try {
    const acquiredAt = Number(fs.readFileSync(path.join(LOCK_DIR, "acquired-at"), "utf-8"));
    return Date.now() - acquiredAt > STALE_MS;
  } catch {
    return true; // unreadable/corrupt — safest to treat as abandoned
  }
}

export function releaseMusicLock(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  owned = false;
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch (err) {
    console.warn("[ThreeVSCode] Failed to release music lock:", err);
  }
}

/**
 * Non-blocking: music has no turn-taking concept to queue behind like
 * speech does, so this either claims ownership right now or reports that
 * someone else already has it — callers that still want to play should poll
 * this periodically rather than await a queue.
 */
export function tryAcquireMusicLock(): boolean {
  if (owned) return true;
  try {
    fs.mkdirSync(LOCK_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    if (!isStale()) return false;
    releaseMusicLock(); // reclaim an abandoned lock (owner crashed without cleaning up)
    return tryAcquireMusicLock();
  }
  owned = true;
  touch();
  heartbeatTimer = setInterval(touch, HEARTBEAT_MS);
  return true;
}

export function ownsMusicLock(): boolean {
  return owned;
}
