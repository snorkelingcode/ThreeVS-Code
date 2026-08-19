import * as http from "http";
import type { AddressInfo } from "net";
import { sanitizeForSpeech } from "./speechSanitizer";
import { readCurrentTurnText } from "./transcript";
import { watchTranscript, flushTranscript, isWatching } from "./transcriptWatcher";

interface HookPayload {
  transcript_path?: string;
  last_assistant_message?: string;
}

type Speak = (text: string) => void;

let server: http.Server | undefined;

/**
 * Local HTTP server that Claude Code's hooks POST to. Binds an OS-assigned
 * port (not a fixed one) — with multiple VS Code windows open, each project
 * gets its own bridge server and its own project-scoped hooks (see
 * hookInstaller.ts) pointing at that exact port, so a session only ever
 * notifies the window actually working on that project. Non-blocking on
 * Claude Code's side by design — if this server isn't running, a hook just
 * fails silently and Claude Code is unaffected.
 *
 * Two routes:
 * - POST /turn-started (UserPromptSubmit): starts watching this session's
 *   transcript file so new assistant text is spoken as it's written, not
 *   after the whole turn finishes (see transcriptWatcher.ts).
 * - POST /claude-finished (Stop): a safety net, not the primary path — if
 *   the transcript is already being watched, just flushes anything the
 *   debounced watcher hasn't caught up on yet. If it *isn't* being watched
 *   (e.g. this is the first turn this window has seen, before any
 *   UserPromptSubmit fired), falls back to reading the whole current turn
 *   at once — the old, pre-streaming behavior — and starts watching from
 *   here so subsequent turns in the same session stream normally.
 *
 * Resolves with the bound port once listening.
 */
export function startBridgeServer(onSpeak: Speak): Promise<number> {
  const speak: Speak = (text) => {
    const clean = sanitizeForSpeech(text);
    if (clean) onSpeak(clean);
  };

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      if (req.method !== "POST" || (req.url !== "/turn-started" && req.url !== "/claude-finished")) {
        res.writeHead(404).end();
        return;
      }

      const url = req.url;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const payload: HookPayload = JSON.parse(body);
          if (url === "/turn-started") {
            handleTurnStarted(payload, speak);
          } else {
            handleStop(payload, speak);
          }
          res.writeHead(200).end();
        } catch (err) {
          console.error(`[ThreeVSCode] Failed to handle ${url} payload:`, err);
          res.writeHead(400).end();
        }
      });
    });

    server.on("error", (err) => {
      console.error("[ThreeVSCode] Bridge server error:", err);
      reject(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server!.address() as AddressInfo).port;
      console.log(`[ThreeVSCode] Bridge server listening on http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

export function stopBridgeServer(): void {
  server?.close();
  server = undefined;
}

function handleTurnStarted(payload: HookPayload, speak: Speak): void {
  if (!payload.transcript_path) return;
  console.log(`[ThreeVSCode] Turn started, watching ${payload.transcript_path}`);
  watchTranscript(payload.transcript_path, speak);
}

function handleStop(payload: HookPayload, speak: Speak): void {
  const path = payload.transcript_path;
  if (!path) {
    if (payload.last_assistant_message) speak(payload.last_assistant_message);
    return;
  }

  if (isWatching(path)) {
    console.log("[ThreeVSCode] Stop: flushing any unwatched tail.");
    flushTranscript(path, speak);
    return;
  }

  // First time seeing this transcript in this window (no UserPromptSubmit
  // hook fired yet, or it's not installed) — fall back to the old
  // whole-turn read, then start watching so future turns stream live.
  console.log("[ThreeVSCode] Stop: not yet watching this transcript, falling back to whole-turn read.");
  try {
    const text = readCurrentTurnText(path);
    if (text) speak(text);
  } catch (err) {
    console.error("[ThreeVSCode] Failed to read transcript:", err);
  }
  watchTranscript(path, speak);
}
