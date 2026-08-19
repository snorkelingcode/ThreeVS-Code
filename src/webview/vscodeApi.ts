import type { WebviewToHostMessage } from "../shared/messages";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi() throws if called more than once per webview, so cache it.
let api: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (!api) api = acquireVsCodeApi();
  return api;
}
