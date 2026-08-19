import * as fs from "fs";

interface ContentBlock {
  type: string;
  text?: string;
}

interface InnerMessage {
  role?: string;
  content?: string | ContentBlock[];
}

/**
 * Claude Code's real JSONL transcript entries nest the actual role/content
 * inside a `message` object (`{type: "assistant", message: {role, content},
 * ...}`) alongside a lot of other bookkeeping (uuid, timestamp, cwd, ...) —
 * there's no top-level role/content to read directly.
 */
export interface TranscriptEntry {
  message?: InnerMessage;
}

/** Claude message content can be a plain string or an array of content blocks (text/tool_use/tool_result). */
function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join(" ");
}

/** Exported for transcriptWatcher.ts — the text of one assistant entry, or "" if it has none (e.g. a tool-use-only entry). */
export function extractAssistantText(entry: TranscriptEntry): string {
  if (entry.message?.role !== "assistant") return "";
  return extractText(entry.message.content).trim();
}

/**
 * A real user prompt, as opposed to a tool result being fed back to Claude —
 * both are logged with role "user" in the transcript, but only the former
 * marks the start of a new turn. Tool-result-only entries have no text/other
 * content block type.
 */
function isGenuineUserTurn(entry: TranscriptEntry): boolean {
  if (entry.message?.role !== "user") return false;
  const content = entry.message.content;
  if (typeof content === "string") return true;
  return (content ?? []).some((block) => block.type !== "tool_result");
}

/**
 * Collects all of the assistant's text for the current turn — not just the
 * final message. A single turn is often logged as several separate
 * assistant entries (text before a tool call, more text after, etc.), so
 * grabbing only the last one silently drops everything said earlier in the
 * same turn. Walks backward from the end of the transcript, gathering
 * assistant text, until it hits the most recent genuine user prompt.
 */
export function readCurrentTurnText(transcriptPath: string): string {
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  const segments: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (isGenuineUserTurn(entry)) break;

    const text = extractAssistantText(entry);
    if (text) segments.push(text);
  }

  return segments.reverse().join(" ");
}
