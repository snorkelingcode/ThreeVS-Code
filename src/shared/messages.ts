/** Messages the extension host posts into the Companion webview. */
export interface SpeakMessage {
  type: "speak";
  id: number;
  text: string;
}

export interface VoiceStateMessage {
  type: "voiceState";
  enabled: boolean;
}

/** Whether *this* window currently holds the cross-window music lock (see musicLock.ts) — the webview should only actually play audio when both this is true and the user has music enabled. Deliberately not based on OS window focus: switching to another application should leave music playing, just like voice; only another VS Code window taking over playback should stop it. */
export interface MusicOwnershipMessage {
  type: "musicOwnership";
  owned: boolean;
}

/** The character's persisted silicone rubber color (see extension.ts's use of globalState) — sent on "ready" if the user has previously picked one, so it survives panel reloads, VS Code restarts, and new windows. */
export interface MaterialColorMessage {
  type: "materialColor";
  hex: string;
}

/** The character's persisted visor glow color, independent of the silicone rubber material color — sent on "ready" if the user has previously picked one. */
export interface VisorColorMessage {
  type: "visorColor";
  hex: string;
}

export type HostToWebviewMessage =
  | SpeakMessage
  | VoiceStateMessage
  | MusicOwnershipMessage
  | MaterialColorMessage
  | VisorColorMessage;

/** Messages the Companion webview posts back to the extension host. */
export interface ReadyMessage {
  type: "ready";
}

export interface ToggleVoiceMessage {
  type: "toggleVoice";
}

/** Acknowledges that the `speak` message with this id finished playing (or failed), so the host can release the cross-window speech lock. */
export interface SpeakFinishedMessage {
  type: "speakFinished";
  id: number;
}

/** The user's desired music on/off state — the host owns deciding whether this window actually gets to play (see musicLock.ts) and replies with MusicOwnershipMessage. */
export interface MusicToggleMessage {
  type: "musicToggle";
  enabled: boolean;
}

/** The user picked a new color for the (currently sole editable) silicone rubber material — the host persists it in globalState so it survives restarts and other windows. */
export interface MaterialColorChangedMessage {
  type: "materialColorChanged";
  hex: string;
}

/** The user picked a new visor glow color — persisted separately from the material color. */
export interface VisorColorChangedMessage {
  type: "visorColorChanged";
  hex: string;
}

export type WebviewToHostMessage =
  | ReadyMessage
  | ToggleVoiceMessage
  | SpeakFinishedMessage
  | MusicToggleMessage
  | MaterialColorChangedMessage
  | VisorColorChangedMessage;
