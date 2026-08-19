import { TextSplitterStream, type KokoroTTS } from "kokoro-js";
import { loadTTSEngine, DEFAULT_VOICE } from "./ai/ttsEngine";
import { playRawAudio, stopPlayback } from "./ai/audioPlayback";
import { getVsCodeApi } from "./vscodeApi";
import type { HostToWebviewMessage } from "../shared/messages";

export type SpeechStatus = "loading" | "ready" | "error";

/** Kokoro truncates rather than erroring on text past its max sequence length, so a long, multi-paragraph message fed in as one generate() call comes out cut off partway through. Splitting into sentences first (kokoro-js's own splitter, tuned for this) keeps every call well under that limit. */
function splitIntoSentences(text: string): string[] {
  const splitter = new TextSplitterStream();
  splitter.push(text);
  return [...splitter];
}

/**
 * Loads Kokoro once, then speaks any "speak" message posted in from the
 * extension host (see bridgeServer.ts), queued so overlapping messages play
 * in order rather than talking over each other. Each message is split into
 * sentences and synthesized/played one at a time rather than as a single
 * generate() call (see splitIntoSentences). Messages that arrive before the
 * model finishes loading (quite possible — the terminal auto-launches
 * `claude` immediately when the panel opens) are buffered, not dropped.
 * Acks each message with "speakFinished" once all of its sentences finish
 * (success or failure) so the host can release the cross-window speech lock.
 */
export function startSpeechBridge(onStatus: (status: SpeechStatus, detail?: string) => void): void {
  let tts: KokoroTTS | null = null;
  let queue: Promise<void> = Promise.resolve();
  const pending: { id: number; text: string }[] = [];

  // Set while voice is being turned off mid-speech: the queue chain checks
  // this before starting each new sentence so already-scheduled-but-not-yet-
  // played sentences don't keep talking after the toggle. Cleared once the
  // queue actually drains, so a later "voice re-enabled" doesn't inherit it.
  let stopRequested = false;

  function speak(id: number, text: string): void {
    for (const sentence of splitIntoSentences(text)) {
      queue = queue.then(() => {
        if (stopRequested) return;
        return tts!.generate(sentence, { voice: DEFAULT_VOICE }).then((raw) => {
          if (stopRequested) return;
          return playRawAudio(raw);
        });
      });
    }
    queue = queue
      .catch((err) => console.error("[speechBridge] Speech playback failed:", err))
      .finally(() => getVsCodeApi().postMessage({ type: "speakFinished", id }));
  }

  /** Silences whatever's playing right now and drops everything still queued. */
  function stopAllSpeech(): void {
    stopRequested = true;
    pending.length = 0;
    stopPlayback();
    queue = queue.finally(() => {
      stopRequested = false;
    });
  }

  loadTTSEngine((p) => {
    if (p.status === "progress") onStatus("loading", `Voice model: ${Math.round(p.progress)}%`);
  })
    .then((loaded) => {
      tts = loaded;
      onStatus("ready");
      console.log(`[speechBridge] TTS ready, flushing ${pending.length} queued message(s).`);
      for (const { id, text } of pending.splice(0)) speak(id, text);
    })
    .catch((err) => {
      console.error("[speechBridge] Failed to load TTS engine:", err);
      onStatus("error", String(err));
    });

  window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
    const message = event.data;
    if (message?.type === "voiceState") {
      if (!message.enabled) stopAllSpeech();
      return;
    }
    if (message?.type !== "speak") return;

    const text = message.text.trim();
    if (!text) {
      getVsCodeApi().postMessage({ type: "speakFinished", id: message.id });
      return;
    }

    console.log(`[speechBridge] Received speak message (${text.length} chars).`);
    if (tts) {
      speak(message.id, text);
    } else {
      pending.push({ id: message.id, text });
    }
  });
}
