import { useEffect, useRef, useState } from "react";
import { SceneCanvas } from "./scene/SceneCanvas";
import { startSpeechBridge, type SpeechStatus } from "./speechBridge";
import { unlockAudioContext } from "./ai/audioPlayback";
import { setMusicEnabled, setWindowFocused } from "./musicPlayer";
import { onCharacterReady, getMaterialNames, getMaterialColor, setMaterialColor } from "./materialEditor";
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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    startSpeechBridge((kind, detail) => setStatus({ kind, detail }));

    const vscode = getVsCodeApi();
    window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
      if (event.data?.type === "voiceState") setVoiceEnabled(event.data.enabled);
      if (event.data?.type === "windowFocus") setWindowFocused(event.data.focused);
    });
    vscode.postMessage({ type: "ready" });
  }, []);

  // The character loads asynchronously and can reload independently of this
  // component, so its material list isn't known up front — refresh it
  // whenever materialEditor reports the character is (un)available. Only the
  // primary silicone rubber slot is exposed for editing here — the ".001"
  // duplicate and the other named materials stay fixed.
  useEffect(() => {
    const refresh = () => {
      const names = getMaterialNames().filter((name) => name.toLowerCase() === "silicone rubber (procedural)");
      setMaterialColors(Object.fromEntries(names.map((name) => [name, getMaterialColor(name)])));
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
    if (!colorPickerOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (!colorPickerRef.current?.contains(e.target as Node)) {
        setColorPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [colorPickerOpen]);

  useEffect(() => {
    if (!colorPickerOpen) return;
    const handleBlur = () => setColorPickerOpen(false);
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [colorPickerOpen]);

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
  };

  const handleMaterialColorChange = (name: string, hex: string) => {
    setMaterialColor(name, hex);
    setMaterialColors((prev) => ({ ...prev, [name]: hex }));
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
          🔊 Click to enable audio
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
              {Object.keys(materialColors).length > 0 && (
                <div className="menu-materials">
                  <div className="menu-materials-title">Materials</div>
                  {Object.entries(materialColors).map(([name, hex]) => (
                    <div key={name} className="menu-material-item" ref={colorPickerRef}>
                      <button
                        type="button"
                        className="menu-row menu-material-row"
                        onClick={() => setColorPickerOpen((open) => !open)}
                        aria-expanded={colorPickerOpen}
                      >
                        <span className="menu-material-swatch" style={{ background: hex }} />
                        Color
                      </button>
                      {colorPickerOpen && (
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
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
