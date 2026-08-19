import * as vscode from "vscode";
import { startBridgeServer, stopBridgeServer } from "./bridgeServer";
import { registerHookInstaller, ensureVoiceHookInstalled } from "./hookInstaller";
import { acquireSpeechLock, releaseSpeechLock } from "./speechLock";
import { tryAcquireMusicLock, releaseMusicLock, ownsMusicLock } from "./musicLock";
import { stopWatchingAll } from "./transcriptWatcher";
import type { WebviewToHostMessage } from "./shared/messages";

let activePanel: vscode.WebviewPanel | undefined;
let claudeTerminal: vscode.Terminal | undefined;
let voiceStatusItem: vscode.StatusBarItem;
let bridgePort: number | undefined;

const VOICE_ENABLED_KEY = "voiceEnabled";
const SPEAK_ACK_TIMEOUT_MS = 30_000;
const MUSIC_POLL_MS = 2_000;
// globalState (not workspace state) so a color picked in one project's window
// still shows up in another — it's the character's appearance, not something
// project-specific — and it survives VS Code restarts, unlike webview state.
const MATERIAL_COLOR_KEY = "siliconeRubberColor";
const VISOR_COLOR_KEY = "visorColor";

let nextSpeakId = 1;
const pendingSpeakAcks = new Map<number, () => void>();

// The user's desired on/off state, independent of whether this window
// currently owns the cross-window music lock — toggling on doesn't
// guarantee immediate playback if another window already owns it, so this
// drives a poll that keeps trying until either it wins the lock or the user
// turns music back off.
let musicWanted = false;
let musicPollTimer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("threeVSCode.open", () => openCompanionPanel(context)),
    vscode.commands.registerCommand("threeVSCode.toggleVoice", toggleVoice),
    vscode.commands.registerCommand("threeVSCode.restartClaudeTerminal", restartClaudeTerminal),
  );
  registerHookInstaller(context, () => bridgePort);

  // Files always open in a split group instead of covering the Companion
  // panel: whenever a real editor becomes active in the same column as the
  // panel, immediately move it into a group to the right. Webviews don't
  // produce TextEditor events, so switching back to Companion never
  // re-triggers this.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && activePanel && editor.viewColumn === activePanel.viewColumn) {
        vscode.commands.executeCommand("workbench.action.moveEditorToRightGroup");
      }
    }),
  );

  voiceStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  voiceStatusItem.command = "threeVSCode.toggleVoice";
  context.subscriptions.push(voiceStatusItem);
  updateVoiceStatusItem();
  voiceStatusItem.show();

  // The hook needs this window's actual bound port before it can be written
  // into the project's settings, so this must complete before installing it.
  bridgePort = await startBridgeServer((text) => speakInCompanionPanel(text));
  ensureVoiceHookInstalled(bridgePort);

  // Shown by default when VS Code starts, per the product intent — the
  // character is what you see until you open a real file.
  openCompanionPanel(context);

  // Maximize space for the Companion panel + split editor by closing the
  // secondary side bar, if it happened to be open.
  vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
}

export function deactivate(): void {
  stopBridgeServer();
  stopWatchingAll();
  stopMusicPolling();
  if (ownsMusicLock()) releaseMusicLock();
}

function stopMusicPolling(): void {
  if (musicPollTimer) {
    clearInterval(musicPollTimer);
    musicPollTimer = undefined;
  }
}

/**
 * Handles the webview reporting its desired music on/off state. Ownership is
 * a cross-window lock (see musicLock.ts) rather than anything focus-based —
 * switching to a different application should leave music playing, exactly
 * like voice, so turning music on here doesn't guarantee this window gets to
 * play it immediately; it may have to keep polling until another window
 * gives the lock up.
 */
function handleMusicToggle(panel: vscode.WebviewPanel, enabled: boolean): void {
  musicWanted = enabled;
  stopMusicPolling();

  if (!enabled) {
    if (ownsMusicLock()) releaseMusicLock();
    panel.webview.postMessage({ type: "musicOwnership", owned: false });
    return;
  }

  if (tryAcquireMusicLock()) {
    panel.webview.postMessage({ type: "musicOwnership", owned: true });
    return;
  }

  panel.webview.postMessage({ type: "musicOwnership", owned: false });
  musicPollTimer = setInterval(() => {
    if (!musicWanted) {
      stopMusicPolling();
      return;
    }
    if (tryAcquireMusicLock()) {
      stopMusicPolling();
      panel.webview.postMessage({ type: "musicOwnership", owned: true });
    }
  }, MUSIC_POLL_MS);
}

function openCompanionPanel(context: vscode.ExtensionContext): void {
  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.One);
  } else {
    const panel = vscode.window.createWebviewPanel(
      "threeVSCodeCompanion",
      "Companion",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist"), vscode.Uri.joinPath(context.extensionUri, "assets")],
      },
    );

    panel.webview.html = getWebviewHtml(panel.webview, context);
    panel.onDidDispose(() => {
      activePanel = undefined;
      // Don't leave anything waiting forever on a panel that's gone.
      for (const resolveAck of pendingSpeakAcks.values()) resolveAck();
      pendingSpeakAcks.clear();
      stopMusicPolling();
      musicWanted = false;
      if (ownsMusicLock()) releaseMusicLock();
    });
    panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      if (message.type === "ready") {
        panel.webview.postMessage({ type: "voiceState", enabled: isVoiceEnabled() });
        const savedColor = context.globalState.get<string>(MATERIAL_COLOR_KEY);
        if (savedColor) panel.webview.postMessage({ type: "materialColor", hex: savedColor });
        const savedVisorColor = context.globalState.get<string>(VISOR_COLOR_KEY);
        if (savedVisorColor) panel.webview.postMessage({ type: "visorColor", hex: savedVisorColor });
      } else if (message.type === "toggleVoice") {
        toggleVoice();
      } else if (message.type === "speakFinished") {
        pendingSpeakAcks.get(message.id)?.();
        pendingSpeakAcks.delete(message.id);
      } else if (message.type === "musicToggle") {
        handleMusicToggle(panel, message.enabled);
      } else if (message.type === "materialColorChanged") {
        context.globalState.update(MATERIAL_COLOR_KEY, message.hex);
      } else if (message.type === "visorColorChanged") {
        context.globalState.update(VISOR_COLOR_KEY, message.hex);
      }
    });

    activePanel = panel;
  }

  // Also covers the case where the Claude terminal was closed independently
  // of the panel — re-invoking open (including on startup) re-checks it.
  ensureClaudeTerminal();
}

/**
 * Speaks `text` in the Companion panel, holding a cross-process lock for the
 * duration so that if two different VS Code windows finish a response
 * around the same moment, only one character talks at a time — each window
 * is a separate process with no shared memory, so this can't be done
 * in-process (see speechLock.ts). Respects the voiceEnabled setting.
 */
export async function speakInCompanionPanel(text: string): Promise<void> {
  if (!isVoiceEnabled()) return;
  if (!activePanel) {
    console.warn("[ThreeVSCode] Got a Stop hook but no Companion panel is open to speak in.");
    return;
  }

  await acquireSpeechLock();
  try {
    const id = nextSpeakId++;
    const acked = new Promise<void>((resolve) => {
      pendingSpeakAcks.set(id, resolve);
      setTimeout(() => {
        if (pendingSpeakAcks.delete(id)) resolve();
      }, SPEAK_ACK_TIMEOUT_MS);
    });
    activePanel.webview.postMessage({ type: "speak", id, text });
    await acked;
  } finally {
    releaseSpeechLock();
  }
}

function isVoiceEnabled(): boolean {
  return vscode.workspace.getConfiguration("threeVSCode").get<boolean>(VOICE_ENABLED_KEY, true);
}

async function toggleVoice(): Promise<void> {
  const config = vscode.workspace.getConfiguration("threeVSCode");
  const enabled = !isVoiceEnabled();
  await config.update(VOICE_ENABLED_KEY, enabled, vscode.ConfigurationTarget.Global);
  updateVoiceStatusItem();
  activePanel?.webview.postMessage({ type: "voiceState", enabled });
}

function updateVoiceStatusItem(): void {
  const enabled = isVoiceEnabled();
  voiceStatusItem.text = enabled ? "$(unmute) Voice" : "$(mute) Voice";
  voiceStatusItem.tooltip = enabled
    ? "ThreeVSCode voice is on — click to mute"
    : "ThreeVSCode voice is muted — click to unmute";
}

/** Auto-launches an integrated terminal running `claude`, so the user never has to type it. No-op if one's already running. */
function ensureClaudeTerminal(): void {
  if (claudeTerminal) return;

  const terminal = vscode.window.createTerminal("Claude");
  terminal.show();
  terminal.sendText("claude");

  const disposable = vscode.window.onDidCloseTerminal((closed) => {
    if (closed === terminal) {
      claudeTerminal = undefined;
      disposable.dispose();
    }
  });

  claudeTerminal = terminal;
}

/** Force-recreates the Claude terminal even if one's already open — for when `claude` itself has died without the terminal closing. */
function restartClaudeTerminal(): void {
  claudeTerminal?.dispose();
  claudeTerminal = undefined;
  ensureClaudeTerminal();
}

function getWebviewHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const characterUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "assets", "character.glb"));
  const musicUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "assets", "music.mp3"));

  // Kokoro's WebGPU backend (onnxruntime-web) dynamically loads its WASM glue
  // script from cdn.jsdelivr.net at runtime rather than bundling it, and
  // GLTFLoader reads embedded glTF textures via blob: URLs — both need to be
  // allowed explicitly, not just VS Code's own webview resource origin.
  // media-src is for the <audio> background-music element.
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline' 'wasm-unsafe-eval' blob: https:`,
    `worker-src ${webview.cspSource} blob: https:`,
    `connect-src https: blob: ${webview.cspSource}`,
    `media-src ${webview.cspSource}`,
  ].join("; ");

  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Companion</title>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__THREEVSCODE__ = {
        characterUri: ${JSON.stringify(characterUri.toString())},
        musicUri: ${JSON.stringify(musicUri.toString())},
        debug: false,
      };
    </script>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
}
