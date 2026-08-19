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

/** Whether *this* VS Code window currently has focus — used to mute background music in unfocused windows, since (unlike speech) it's continuous and has no natural per-utterance lock to coordinate across windows. */
export interface WindowFocusMessage {
  type: "windowFocus";
  focused: boolean;
}

export type HostToWebviewMessage = SpeakMessage | VoiceStateMessage | WindowFocusMessage;

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

export type WebviewToHostMessage = ReadyMessage | ToggleVoiceMessage | SpeakFinishedMessage;
