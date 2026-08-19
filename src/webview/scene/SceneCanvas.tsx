import { useEffect, useRef, useState } from "react";
import { SceneManager } from "./SceneManager";
import { CharacterController } from "./CharacterController";
import { BoneDebugPanel } from "./BoneDebugPanel";
import { getAmplitude } from "../ai/audioPlayback";
import { registerCharacter } from "../materialEditor";

function normalizedMouse(e: MouseEvent): [number, number] {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = -((e.clientY / window.innerHeight) * 2 - 1);
  return [nx, ny];
}

export function SceneCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const characterRef = useRef<CharacterController | null>(null);
  const [debugMode] = useState(() => window.__THREEVSCODE__.debug);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const sceneManager = new SceneManager(canvas);

    CharacterController.load(window.__THREEVSCODE__.characterUri).then((loaded) => {
      if (cancelled) return;
      characterRef.current = loaded;
      registerCharacter(loaded);
      sceneManager.scene.add(loaded.group);
    });

    // mousemove alone isn't enough to detect "no cursor to track": if the
    // mouse was already sitting over the page when it loaded, mousemove just
    // never fires until the user first moves it, so activity here also
    // starts out in the "no cursor yet" state. mouseenter/mouseleave on
    // <html> (not mousemove/mouseout) reliably catches the cursor actually
    // leaving/re-entering the browser window itself.
    const handleMouseMove = (e: MouseEvent) => {
      characterRef.current?.setMouseActive(true);
      const [nx, ny] = normalizedMouse(e);
      characterRef.current?.setLookTarget(nx, ny);
    };
    const handleMouseEnter = (e: MouseEvent) => {
      characterRef.current?.setMouseActive(true);
      const [nx, ny] = normalizedMouse(e);
      characterRef.current?.setLookTarget(nx, ny);
    };
    const handleMouseLeave = () => characterRef.current?.setMouseActive(false);

    window.addEventListener("mousemove", handleMouseMove);
    document.documentElement.addEventListener("mouseenter", handleMouseEnter);
    document.documentElement.addEventListener("mouseleave", handleMouseLeave);

    sceneManager.onFrame((delta, elapsed) => {
      const character = characterRef.current;
      if (!character) return;
      character.updateVisorPulse(getAmplitude(), delta);
      if (character.isManualPoseMode()) {
        character.applyManualPose();
      } else {
        character.updateHeadLook(delta);
        character.updateIdleBreathing(elapsed);
        character.updateArmSway(elapsed);
      }
    });

    sceneManager.start();

    return () => {
      cancelled = true;
      characterRef.current = null;
      registerCharacter(null);
      window.removeEventListener("mousemove", handleMouseMove);
      document.documentElement.removeEventListener("mouseenter", handleMouseEnter);
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave);
      sceneManager.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="scene-canvas" />
      {debugMode && <BoneDebugPanel characterRef={characterRef} />}
    </>
  );
}
