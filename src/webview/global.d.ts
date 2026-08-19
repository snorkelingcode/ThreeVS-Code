export {};

declare global {
  interface Window {
    __THREEVSCODE__: {
      /** webview-safe URI for assets/character.glb, injected by the extension host. */
      characterUri: string;
      /** webview-safe URI for assets/music.mp3, injected by the extension host. */
      musicUri: string;
      debug: boolean;
    };
  }
}
