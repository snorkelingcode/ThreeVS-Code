# Changelog

## 0.2.16

- Fixed the color picker popup not closing when clicking outside the webview entirely (the
  integrated terminal, another editor tab, the sidebar). The webview is a sandboxed frame, so
  clicks landing outside it never reach its document and can't be caught by a click listener —
  added a `window` "blur" listener as well, since focus leaving the webview fires that
  regardless of where the click landed.

## 0.2.15

- Color picker popup now closes on any click outside it instead of needing a close button —
  removed the close (×) control.
- Swapped the "Color" row's layout: the color swatch is now on the left, vertically aligned
  with the Voice/Music checkboxes above it, with the "Color" label following it — instead of
  the swatch sitting on the right.

## 0.2.14

- Moved the close (×) button off the Materials section header and onto the color-picker popup
  itself: clicking the "Color" row now opens a small popup (with its own close button) rather
  than immediately opening the browser's native color dialog inline in the menu.
- Dropped the ".001" silicone rubber duplicate from the editable list — only the primary
  "Silicone Rubber (Procedural)" slot is editable now.
- Renamed the row label from the full material name to just "Color".

## 0.2.13

- Restricted the Materials color pickers to just Silicone Rubber (both mesh slots) — the
  other 6 named materials are no longer editable from the menu.
- Added a close (×) button to the Materials section header so it can be dismissed without
  closing the whole hamburger menu; it reappears the next time the menu is reopened.
- Changed the hamburger toggle button and checkbox accent color from cyan to grey.

## 0.2.12

- Fixed disabling Voice not muting speech already in progress — the toggle only stopped
  *future* utterances from being sent, so anything already queued/playing talked itself out.
  `audioPlayback.ts` now tracks the currently-playing buffer source so it can be stopped
  immediately, and `speechBridge.ts` drops everything still queued and skips any
  not-yet-started sentences for the message that was mid-flight when the toggle fired.

## 0.2.11

- Added per-material color pickers to the hamburger menu. Every named material on the
  character (all 8 slots baked into `character.glb`, e.g. "Silicone Rubber (Procedural)",
  "Woodland Camo Tactical Woven Fiber", "Foot Clip Metal", plus the visor) now gets its own
  swatch that edits that material's base color live. Colors are session-only for now — they
  reset the next time the panel loads.

## 0.2.10

- Visor now lights up red while the character talks, instead of staying black. Changed
  `visorBaseIntensity` from 0.9 to 0 so it's fully dark at rest (rather than always dimly
  lit), and the existing TTS-amplitude-driven pulse (`updateVisorPulse`) now drives it up to
  red as speech plays.

## 0.2.9

- Changed the visor from a glowing cyan emissive to plain black. Note: since the visor's
  speaking-pulse effect works by animating `emissiveIntensity`, and any intensity times a black
  emissive color is still black, the pulse is no longer visually noticeable — the visor is just
  a flat black plate now.

## 0.2.8

- Fixed real TTS never speaking during actual Claude Code turns, even though the panel/audio
  pipeline itself was fine (a direct test POST to the bridge server spoke correctly). Root
  cause: `transcript.ts` read `entry.role`/`entry.content` directly off each JSONL line, but
  Claude Code's real transcript entries nest the role/content inside a `message` object
  (`{type: "assistant", message: {role, content}, ...}`) alongside session/timestamp
  bookkeeping — there's no top-level `role`/`content` to read. Every real entry was silently
  treated as empty, so both the streaming transcript watcher and the Stop-hook whole-turn
  fallback always extracted `""`. Fixed by reading through `entry.message`.

## 0.2.7

- Fixed background music playing in every open VS Code window at once. Unlike speech, which
  has a cross-process lock plus a speak/ack protocol (see `speechLock.ts`) so only one window
  ever talks at a time, music is continuous and has no natural per-utterance moment to lock
  around. Instead, each window now mutes its own music whenever it loses OS focus (via
  `vscode.window.onDidChangeWindowState`) — no cross-process coordination needed, since each
  window already knows its own focus state directly. At most one window's music is ever
  audible now.

## 0.2.6

- Fixed TTS never playing: the 0.2.2 hamburger-menu redesign dropped the guaranteed
  audio-unlock gesture. Voice defaults to on (checkbox already checked, nothing to click) and
  Claude can respond before the menu's ever opened, so there was no guarantee any click ever
  happened before the first TTS playback attempt — only enabling Music (off by default, so it
  requires a click) happened to unlock audio as a side effect, which is why music worked but
  voice didn't. Restored an explicit, unmissable "🔊 Click to enable audio" gate in front of
  the menu.

## 0.2.5

- Added a real extension icon (Marketplace/Extensions view).

## 0.2.4

- Re-encoded background music as MP3 instead of Opus — `.opus` risked being served with a
  generic/missing MIME type by the webview's resource server, which some browsers refuse to
  play through a plain `<audio>` element; `.mp3` is unambiguous everywhere.

## 0.2.3

- Reverted the 0.2.1 iridescent/clearcoat visor material and its procedural environment map —
  back to the plain emissive visor.

## 0.2.2

- Diagnostic fix: if no folder/workspace is open, there's nowhere to install the project-scoped
  hooks and voice silently never works — this used to be a console.warn nobody would see; it's
  now a visible warning notification.
- Added quiet, off-by-default background music (loop, togglable), and consolidated Voice/Music
  into a hamburger menu (bottom right) instead of a single voice button.

## 0.2.1

- Visor is now a glossy, iridescent `MeshPhysicalMaterial` (clearcoat + iridescence) reflecting
  a procedural environment map, instead of a flat emissive plate — carries over the authored
  color/map/emissive from `character.glb` rather than replacing them outright.

## 0.2.0

- Real-time speech: a new `UserPromptSubmit` hook starts watching the session's transcript file
  as soon as a turn begins, so each new chunk of Claude's response is spoken as it's written
  instead of all at once after the whole turn finishes. `Stop` is now just a safety net that
  flushes anything the watcher hasn't caught up on yet, with a whole-turn-read fallback for a
  window's very first turn (before any `UserPromptSubmit` has fired).
- Fixed long responses getting cut off partway through: each message is now split into
  sentences (via `kokoro-js`'s own splitter) and synthesized/played one at a time, instead of
  feeding Kokoro one large blob that exceeds its usable synthesis length.
- Fixed some symbols (`→`, `←`, `↔`, `≈`, `≥`, `≤`, `×`) being read aloud as their literal
  Unicode name (e.g. "right arrow") instead of a sensible spoken word.
- Hooks are now project-scoped (`.claude/settings.local.json`, git-ignored) instead of global,
  each window's bridge server binds a dynamically-assigned port instead of a fixed one, and a
  cross-window speech lock keeps two open windows from talking over each other. Any stale
  global hook from 0.1.0 is automatically removed.
- Files now always open in a split group next to the Companion panel instead of covering it.
- Persistent in-panel voice on/off button (previously a one-time "click to enable" prompt that
  had no way to mute afterward), kept in sync with the status bar toggle.
- Scroll-to-zoom range tightened — was still zooming out noticeably farther than intended.

## 0.1.0

Initial version.

- Companion panel: a 3D character (three.js) opens by default in the main editor area.
- Fully local, client-side text-to-speech (Kokoro, via WebGPU/WASM) — no cloud calls.
- Claude Code integration: a `Stop` hook (installed automatically into `~/.claude/settings.json`
  on first activation) notifies a local bridge server after every response, which speaks a
  sanitized summary through the character.
- Auto-launches an integrated terminal running `claude` so you don't have to type it.
- Procedural character animation: mouse-tracking head look, idle breathing, arm sway, and a
  visor glow that pulses with live speech volume.
- `ThreeVSCode: Toggle Voice` command / status bar item to mute without uninstalling the hook.
- `ThreeVSCode: Restart Claude Terminal` command if the `claude` process dies independently of
  the terminal pane.
- Debug tooling (bone-rotation sliders for manual posing) available for development builds.
