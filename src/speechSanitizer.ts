/**
 * Claude's raw response text is markdown — reading "asterisk asterisk" or
 * literal backticks aloud sounds broken. Strips/flattens the formatting down
 * to plain prose for TTS. Fenced code blocks are dropped entirely (the
 * surrounding prose is what's meant to be listened to, not read-aloud code).
 */
export function sanitizeForSpeech(text: string): string {
  let out = text;

  out = out.replace(/```[\s\S]*?```/g, " ");
  out = out.replace(/`([^`]+)`/g, "$1");
  // "~2000" (approximation) reads better as "about 2000"; any other tilde
  // (e.g. "~/path" home-dir shorthand) has no useful spoken form at all.
  out = out.replace(/~(\d)/g, "about $1");
  out = out.replace(/~/g, "");
  // Kokoro/its phonemizer has no pronunciation for these symbols and falls
  // back to reading out their Unicode name ("right arrow") instead of a
  // sensible spoken word — replace before anything else touches the text.
  out = out.replace(/\s*(?:->|→)\s*/g, " to ");
  out = out.replace(/\s*(?:<-|←)\s*/g, " from ");
  out = out.replace(/\s*↔\s*/g, " and ");
  out = out.replace(/≈/g, "about ");
  out = out.replace(/≥/g, "at least ");
  out = out.replace(/≤/g, "at most ");
  out = out.replace(/×/g, " by ");
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/^\s*[-*+]\s+/gm, "");
  out = out.replace(/^\s*\d+\.\s+/gm, "");
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/_([^_]+)_/g, "$1");
  // Any whitespace run containing 2+ newlines (a blank line — including ones
  // left as whitespace-only by code-block removal above) becomes a sentence
  // break; a single newline just becomes a space. Then collapse anything
  // that still left repeated periods/spaces behind.
  out = out.replace(/\s*\n\s*\n\s*/g, ". ");
  out = out.replace(/\n/g, " ");
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\.(\s*\.)+/g, ".");
  return out.trim();
}
