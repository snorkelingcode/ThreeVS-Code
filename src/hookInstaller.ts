import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** Tags our hook entries so we can find/update/remove exactly ours without touching anything else the user configured. */
const MARKER = "threeVSCode";

/** The events we install hooks for, and which bridge-server route each one's URL should point at. */
const HOOK_EVENTS = {
  UserPromptSubmit: "/turn-started",
  Stop: "/claude-finished",
} as const;
type HookEventName = keyof typeof HOOK_EVENTS;

interface HookEntry {
  type: string;
  url?: string;
  timeout?: number;
  async?: boolean;
  _source?: string;
  [key: string]: unknown;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    [event in HookEventName]?: HookMatcher[];
  } & { [event: string]: unknown };
  [key: string]: unknown;
}

function readSettings(filePath: string): ClaudeSettings {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeSettings(filePath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function findOurEntry(matchers: HookMatcher[] | undefined): HookEntry | undefined {
  for (const matcher of matchers ?? []) {
    const found = matcher.hooks.find((h) => h._source === MARKER);
    if (found) return found;
  }
  return undefined;
}

function withHookUpserted(settings: ClaudeSettings, event: HookEventName, port: number): ClaudeSettings {
  const url = `http://localhost:${port}${HOOK_EVENTS[event]}`;
  const existing = findOurEntry(settings.hooks?.[event]);

  if (existing) {
    existing.url = url;
    return settings;
  }

  const next: ClaudeSettings = { ...settings, hooks: { ...settings.hooks } };
  const list = [...(next.hooks?.[event] ?? [])];
  list.push({
    matcher: "*",
    hooks: [{ type: "http", url, timeout: 3, async: true, _source: MARKER }],
  });
  next.hooks = { ...next.hooks, [event]: list };
  return next;
}

/** Path for this workspace's project-scoped, git-ignored Claude Code settings. */
function projectSettingsPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, ".claude", "settings.local.json");
}

/**
 * Installs/updates the UserPromptSubmit and Stop hooks scoped to the current
 * project (not ~/.claude/settings.json), both pointing at this window's
 * bridge server port. UserPromptSubmit lets the bridge start watching the
 * transcript at the start of a turn (see transcriptWatcher.ts), so responses
 * are spoken as they're written rather than all at once at Stop; Stop
 * remains as a safety net (see bridgeServer.ts). Project-scoped, not global,
 * because each VS Code window/project gets its own dynamically-assigned
 * port — a global hook would only ever reach whichever window last grabbed
 * a fixed port, regardless of which project the Claude Code session was
 * actually running in. Runs every activation (not just once) since the port
 * changes on every restart. Also removes any stale global hook from an
 * earlier version of this extension.
 */
export function ensureVoiceHookInstalled(port: number): void {
  removeStaleGlobalHook();

  const filePath = projectSettingsPath();
  if (!filePath) {
    // Was just a console.warn — invisible unless you happened to be looking
    // at the Extension Host output channel, so "voice silently never works"
    // had no diagnosable symptom. Hooks are project-scoped (see the doc
    // comment above), so there's genuinely nowhere to install one without a
    // folder open; at minimum, say so where it'll actually be seen.
    vscode.window.showWarningMessage(
      "ThreeVSCode: no folder/workspace is open, so there's nowhere to install the Claude Code hooks — voice won't work until you open a project folder.",
    );
    return;
  }

  let settings: ClaudeSettings;
  try {
    settings = readSettings(filePath);
  } catch (err) {
    console.error(`[ThreeVSCode] Couldn't parse ${filePath}, leaving it untouched:`, err);
    return;
  }

  const alreadyPresent = findOurEntry(settings.hooks?.Stop) !== undefined;

  let updated = settings;
  for (const event of Object.keys(HOOK_EVENTS) as HookEventName[]) {
    updated = withHookUpserted(updated, event, port);
  }
  writeSettings(filePath, updated);

  if (!alreadyPresent) {
    vscode.window.showInformationMessage(
      `ThreeVSCode: added Claude Code hooks to ${filePath} so responses in this project are spoken as they happen.`,
    );
  }
}

/** Was our entry — either the current marked form, or a pre-marker version this same extension used to write (identified by its unique URL path). */
function isOurGlobalEntry(h: HookEntry): boolean {
  return (
    h._source === MARKER ||
    (h.type === "http" &&
      typeof h.url === "string" &&
      Object.values(HOOK_EVENTS).some((route) => h.url!.includes(route)))
  );
}

/** Removes the old-style global hook (all projects, fixed port) an earlier version of this extension installed into ~/.claude/settings.json. */
function removeStaleGlobalHook(): void {
  const filePath = path.join(os.homedir(), ".claude", "settings.json");
  let settings: ClaudeSettings;
  try {
    settings = readSettings(filePath);
  } catch {
    return;
  }

  let changed = false;
  const nextHooks: ClaudeSettings["hooks"] = { ...settings.hooks };

  for (const event of Object.keys(HOOK_EVENTS) as HookEventName[]) {
    const matchers = settings.hooks?.[event];
    if (!matchers) continue;

    let removedAny = false;
    const filtered = matchers
      .map((matcher) => {
        const keep = matcher.hooks.filter((h) => !isOurGlobalEntry(h));
        if (keep.length !== matcher.hooks.length) removedAny = true;
        return { ...matcher, hooks: keep };
      })
      .filter((matcher) => matcher.hooks.length > 0);

    if (removedAny) {
      changed = true;
      nextHooks[event] = filtered;
    }
  }

  if (!changed) return;
  writeSettings(filePath, { ...settings, hooks: nextHooks });
}

/** "ThreeVSCode: Enable Voice for Claude Code" — manual re-run/troubleshooting; ensureVoiceHookInstalled() covers normal use. */
export function registerHookInstaller(context: vscode.ExtensionContext, getPort: () => number | undefined): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("threeVSCode.enableVoice", async () => {
      const port = getPort();
      if (!port) {
        vscode.window.showErrorMessage("ThreeVSCode's bridge server isn't running yet — try again in a moment.");
        return;
      }
      const filePath = projectSettingsPath();
      if (!filePath) {
        vscode.window.showErrorMessage("Open a folder/workspace first — the hook is scoped per-project.");
        return;
      }
      ensureVoiceHookInstalled(port);
      vscode.window.showInformationMessage("Voice enabled for this project.");
    }),
  );
}
