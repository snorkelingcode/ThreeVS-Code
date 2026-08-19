import type { CharacterController } from "./scene/CharacterController";

/**
 * Small bridge so the hamburger menu (in App.tsx) can list and recolor the
 * character's materials without holding a reference to the CharacterController
 * itself — that instance lives inside SceneCanvas, loaded asynchronously,
 * and the menu is a sibling component with no natural way to reach it.
 */
let controller: CharacterController | null = null;
const listeners = new Set<() => void>();

/** Called by SceneCanvas once the character has loaded (or on unmount, with null). */
export function registerCharacter(next: CharacterController | null): void {
  controller = next;
  for (const listener of listeners) listener();
}

/** Notified whenever the character becomes available (or unavailable). */
export function onCharacterReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMaterialNames(): string[] {
  return controller?.getMaterialNames() ?? [];
}

export function getMaterialColor(name: string): string {
  return controller?.getMaterialColor(name) ?? "#ffffff";
}

export function setMaterialColor(name: string, hex: string): void {
  controller?.setMaterialColor(name, hex);
}

export function setVisorColor(hex: string): void {
  controller?.setVisorColor(hex);
}

export function getVisorColor(): string | null {
  return controller?.getVisorColor() ?? null;
}
