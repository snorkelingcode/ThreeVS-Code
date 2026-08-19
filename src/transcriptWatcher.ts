import * as fs from "fs";
import type { TranscriptEntry } from "./transcript";
import { extractAssistantText } from "./transcript";

interface WatchState {
  watcher: fs.FSWatcher;
  processedLines: number;
  debounceTimer?: NodeJS.Timeout;
}

const watched = new Map<string, WatchState>();

function countLines(path: string): number {
  try {
    return fs.readFileSync(path, "utf-8").split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function flush(transcriptPath: string, state: WatchState, onSegment: (text: string) => void): void {
  let lines: string[];
  try {
    lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").filter((l) => l.trim());
  } catch {
    return;
  }

  const newLines = lines.slice(state.processedLines);
  state.processedLines = lines.length;

  for (const line of newLines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const text = extractAssistantText(entry);
    if (text) onSegment(text);
  }
}

/**
 * Watches a Claude Code transcript (JSONL) for new assistant entries and
 * reports each one's text as soon as it's appended, instead of waiting for
 * the whole turn to finish — this is what makes speech happen "as it shows
 * up" rather than as one lump read at Stop. No-ops if already watching this
 * exact path (idempotent — safe to call on every UserPromptSubmit).
 * fs.watch fires in bursts for a single logical write, so changes are
 * debounced briefly before re-reading.
 */
export function watchTranscript(transcriptPath: string, onSegment: (text: string) => void): void {
  if (watched.has(transcriptPath)) return;

  // Baseline is the current end of file, not 0 — watching should only ever
  // speak text that arrives from here forward, never replay prior turns.
  const state: WatchState = {
    watcher: undefined as unknown as fs.FSWatcher,
    processedLines: countLines(transcriptPath),
  };

  const scheduleFlush = () => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => flush(transcriptPath, state, onSegment), 200);
  };

  try {
    state.watcher = fs.watch(transcriptPath, scheduleFlush);
    watched.set(transcriptPath, state);
  } catch (err) {
    console.error(`[ThreeVSCode] Failed to watch transcript ${transcriptPath}:`, err);
  }
}

export function isWatching(transcriptPath: string): boolean {
  return watched.has(transcriptPath);
}

/**
 * Immediate, synchronous catch-up on a transcript already being watched —
 * used as a safety net at Stop in case the debounced watcher hasn't caught
 * up yet (e.g. the process could exit right after the final write). Shares
 * the same cursor as the live watcher, so this can never double-speak
 * something the watcher already reported.
 */
export function flushTranscript(transcriptPath: string, onSegment: (text: string) => void): void {
  const state = watched.get(transcriptPath);
  if (!state) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  flush(transcriptPath, state, onSegment);
}

export function stopWatchingAll(): void {
  for (const state of watched.values()) {
    state.watcher.close();
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
  }
  watched.clear();
}
