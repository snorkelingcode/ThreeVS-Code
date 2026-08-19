# ThreeVSCode

A 3D character that lives in your editor and speaks summaries of what Claude
Code just did. Claude Code itself is the brain — there's no separate local
LLM. Text-to-speech (Kokoro) runs fully client-side in the webview via
WebGPU/WASM; nothing leaves your machine.

## What it does

- Opens a **Companion** panel by default, in the main editor area, showing the
  character. Opening a real file works normally alongside it.
- Auto-launches an integrated terminal running `claude` on first open.
- Installs a Claude Code `Stop` hook into `~/.claude/settings.json`
  automatically the first time the extension activates (applies to Claude
  Code sessions in any project, not just this one) — no manual setup step.
  A one-time notification confirms it happened.
- After every Claude Code response, the hook notifies a local bridge server
  in the extension, which sanitizes the markdown down to plain prose and
  speaks it through the character.
- The character isn't static: mouse-tracking head look, idle breathing, arm
  sway, and a visor glow that pulses with live speech volume.

## Commands

- **ThreeVSCode: Open Character** — reopen the Companion panel if you've
  closed it.
- **ThreeVSCode: Toggle Voice** — mute/unmute without uninstalling the hook.
  Also available as a status bar item (bottom right).
- **ThreeVSCode: Restart Claude Terminal** — force-recreate the terminal if
  `claude` died without the terminal pane itself closing.
- **ThreeVSCode: Enable Voice for Claude Code** — manual re-run of the hook
  install, for troubleshooting; normal use doesn't need this.

## Voice input

If you'd rather speak your prompts than type them, [Sotto](https://github.com/millZach/Sotto)
is a free, local-first dictation app (Windows/macOS) with a global hotkey that
pastes the transcript at your cursor in any app — including the auto-launched
Claude terminal. It's a separate, standalone tool (no API to integrate
against), but works with this extension out of the box since its hotkey
works everywhere.

## Try it

```
npm install
npm run build
```

Then open this folder in VS Code and press **F5** (or Run → Start Debugging).
That launches an Extension Development Host window with the Companion panel
open and a "Click to enable voice" prompt (a one-time click to satisfy the
browser's audio-autoplay restriction).

`npm run watch` rebuilds on save if you're iterating.

## Packaging

```
npx @vscode/vsce package
```

Produces an installable `.vsix`. Actually publishing to the Marketplace needs
a publisher account (Azure DevOps + a Personal Access Token) set up
separately — this only prepares the package.
