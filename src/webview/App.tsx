import { useEffect, useRef, useState } from "react";
import { SceneCanvas } from "./scene/SceneCanvas";
import { startSpeechBridge, type SpeechStatus } from "./speechBridge";
import { unlockAudioContext } from "./ai/audioPlayback";
import { setMusicEnabled, setMusicOwned } from "./musicPlayer";
import {
  onCharacterReady,
  getMaterialNames,
  getMaterialColor,
  setMaterialColor,
  getVisorColor,
  setVisorColor,
} from "./materialEditor";
import { getVsCodeApi } from "./vscodeApi";
import type { HostToWebviewMessage } from "../shared/messages";
import "./App.css";

export function App() {
  const [status, setStatus] = useState<{ kind: SpeechStatus; detail?: string }>({ kind: "loading" });
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [musicEnabled, setMusicEnabledState] = useState(false); // off by default
  const [menuOpen, setMenuOpen] = useState(false);
  // Chrome only allows audio to start from a real user gesture. Voice
  // defaults to *on* (checked, nothing to click) and Claude can respond
  // before the menu is ever opened, so there's no guarantee a toggle click
  // happens before the first TTS playback attempt — an explicit, unmissable
  // gate in front of the menu is what actually guarantees the gesture,
  // rather than hoping a checkbox gets clicked first.
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [materialColors, setMaterialColors] = useState<Record<string, string>>({});
  const [visorColor, setVisorColorState] = useState<string | null>(null);
  // Which color picker popup (if any) is open — a single flag can't
  // distinguish the two now that both the material and the visor have their
  // own, so this also decides which item's ref the outside-click handler
  // checks against below.
  const [openPicker, setOpenPicker] = useState<"material" | "visor" | null>(null);
  const materialItemRef = useRef<HTMLDivElement | null>(null);
  const visorItemRef = useRef<HTMLDivElement | null>(null);
  // The host may report previously-saved colors (see extension.ts's use of
  // globalState) before the character mesh has finished loading — these hold
  // onto them so the character-ready effect below can apply them once the
  // real materials exist, instead of it being lost to a race.
  const savedColorRef = useRef<string | null>(null);
  const savedVisorColorRef = useRef<string | null>(null);

  const applyColorToCharacter = (hex: string): boolean => {
    const names = getMaterialNames().filter((name) => name.toLowerCase() === "silicone rubber (procedural)");
    if (names.length === 0) return false;
    for (const name of names) setMaterialColor(name, hex);
    setMaterialColors(Object.fromEntries(names.map((name) => [name, hex])));
    return true;
  };

  const applyVisorColorToCharacter = (hex: string): void => {
    setVisorColor(hex);
    setVisorColorState(hex);
  };

  useEffect(() => {
    startSpeechBridge((kind, detail) => setStatus({ kind, detail }));

    const vscode = getVsCodeApi();
    window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
      if (event.data?.type === "voiceState") setVoiceEnabled(event.data.enabled);
      if (event.data?.type === "musicOwnership") setMusicOwned(event.data.owned);
      if (event.data?.type === "materialColor") {
        savedColorRef.current = event.data.hex;
        applyColorToCharacter(event.data.hex);
      }
      if (event.data?.type === "visorColor") {
        savedVisorColorRef.current = event.data.hex;
        applyVisorColorToCharacter(event.data.hex);
      }
    });
    vscode.postMessage({ type: "ready" });
  }, []);

  // The character loads asynchronously and can reload independently of this
  // component, so neither its material list nor its visor exist up front —
  // refresh both whenever materialEditor reports the character is
  // (un)available. Only the primary silicone rubber slot is exposed for
  // editing here — the ".001" duplicate and the other named materials stay
  // fixed. If the host already told us about a saved color, that wins over
  // the mesh's baked-in default; the visor color is independent of the
  // material color and has its own saved value.
  useEffect(() => {
    const refresh = () => {
      if (!(savedColorRef.current && applyColorToCharacter(savedColorRef.current))) {
        const names = getMaterialNames().filter((name) => name.toLowerCase() === "silicone rubber (procedural)");
        setMaterialColors(Object.fromEntries(names.map((name) => [name, getMaterialColor(name)])));
      }

      if (savedVisorColorRef.current) {
        applyVisorColorToCharacter(savedVisorColorRef.current);
      } else {
        const current = getVisorColor();
        if (current) setVisorColorState(current);
      }
    };
    refresh();
    return onCharacterReady(refresh);
  }, []);

  // Closes the color picker popup on any click outside it (or its toggle
  // button), instead of requiring an explicit close control. A click
  // elsewhere in VS Code entirely (the terminal, another tab, the sidebar)
  // never reaches this document at all — the webview is a separate
  // sandboxed frame — so it can't be caught by a click listener. What it
  // *does* do is move focus out of the webview, firing a window "blur"
  // here, which is what the second listener below catches.
  useEffect(() => {
    if (!openPicker) return;
    const activeRef = openPicker === "material" ? materialItemRef : visorItemRef;
    const handleOutsideClick = (e: MouseEvent) => {
      if (!activeRef.current?.contains(e.target as Node)) {
        setOpenPicker(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [openPicker]);

  useEffect(() => {
    if (!openPicker) return;
    const handleBlur = () => setOpenPicker(null);
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [openPicker]);

  const handleUnlock = () => {
    unlockAudioContext();
    setAudioUnlocked(true);
  };

  const handleVoiceToggle = () => {
    getVsCodeApi().postMessage({ type: "toggleVoice" });
  };

  const handleMusicToggle = () => {
    const next = !musicEnabled;
    setMusicEnabledState(next);
    setMusicEnabled(next);
    // The host owns deciding whether this window actually gets to play (see
    // musicLock.ts) — it replies with a musicOwnership message.
    getVsCodeApi().postMessage({ type: "musicToggle", enabled: next });
  };

  const handleMaterialColorChange = (name: string, hex: string) => {
    setMaterialColor(name, hex);
    setMaterialColors((prev) => ({ ...prev, [name]: hex }));
    savedColorRef.current = hex;
    getVsCodeApi().postMessage({ type: "materialColorChanged", hex });
  };

  const handleVisorColorChange = (hex: string) => {
    applyVisorColorToCharacter(hex);
    savedVisorColorRef.current = hex;
    getVsCodeApi().postMessage({ type: "visorColorChanged", hex });
  };

  return (
    <div className="app">
      <SceneCanvas />
      {status.kind !== "ready" && (
        <div className="status-banner">
          {status.kind === "loading" ? (status.detail ?? "Loading voice...") : `Voice failed to load: ${status.detail}`}
        </div>
      )}

      {!audioUnlocked ? (
        <button className="unlock-audio" onClick={handleUnlock}>
          Click to enable audio
        </button>
      ) : (
        <div className="menu">
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Settings"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
          {menuOpen && (
            <div className="menu-panel">
              <label className="menu-row">
                <input type="checkbox" checked={voiceEnabled} onChange={handleVoiceToggle} />
                Voice
              </label>
              <label className="menu-row">
                <input type="checkbox" checked={musicEnabled} onChange={handleMusicToggle} />
                Music
              </label>
              {(Object.keys(materialColors).length > 0 || visorColor) && (
                <div className="menu-materials">
                  <div className="menu-materials-title">Materials</div>
                  {Object.entries(materialColors).map(([name, hex]) => (
                    <div key={name} className="menu-material-item" ref={materialItemRef}>
                      <button
                        type="button"
                        className="menu-row menu-material-row"
                        onClick={() => setOpenPicker((open) => (open === "material" ? null : "material"))}
                        aria-expanded={openPicker === "material"}
                      >
                        <span className="menu-material-swatch" style={{ background: hex }} />
                        Color
                      </button>
                      {openPicker === "material" && (
                        <div className="color-picker-popup">
                          <input
                            type="color"
                            value={hex}
                            onChange={(e) => handleMaterialColorChange(name, e.target.value)}
                            autoFocus
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  {visorColor && (
                    <div className="menu-material-item" ref={visorItemRef}>
                      <button
                        type="button"
                        className="menu-row menu-material-row"
                        onClick={() => setOpenPicker((open) => (open === "visor" ? null : "visor"))}
                        aria-expanded={openPicker === "visor"}
                      >
                        <span className="menu-material-swatch" style={{ background: visorColor }} />
                        Visor
                      </button>
                      {openPicker === "visor" && (
                        <div className="color-picker-popup">
                          <input
                            type="color"
                            value={visorColor}
                            onChange={(e) => handleVisorColorChange(e.target.value)}
                            autoFocus
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
