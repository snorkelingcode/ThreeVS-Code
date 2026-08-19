import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Cross-process mutex so that if two different VS Code windows (two
 * different Claude Code sessions in two different projects) finish around
 * the same moment, their characters don't talk over each other. Each window
 * is a separate OS process with no shared memory, so this uses a directory
 * as an atomic lock (mkdir fails if it already exists, portable across
 * platforms) rather than anything in-process.
 */
const LOCK_DIR = path.join(os.homedir(), ".claude", "threevscode-speaking.lock");
const STALE_MS = 60_000; // longer than any realistic utterance; a lock older than this means its owner likely crashed
const POLL_MS = 150;

function tryAcquire(): boolean {
  try {
    fs.mkdirSync(LOCK_DIR);
    fs.writeFileSync(path.join(LOCK_DIR, "acquired-at"), String(Date.now()));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
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

export function releaseSpeechLock(): void {
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch (err) {
    console.warn("[ThreeVSCode] Failed to release speech lock:", err);
  }
}

/** Resolves true once the lock is held, or false if maxWaitMs elapsed first (caller proceeds anyway rather than dropping the response). */
export async function acquireSpeechLock(maxWaitMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (tryAcquire()) return true;
    if (isStale()) {
      releaseSpeechLock();
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}
