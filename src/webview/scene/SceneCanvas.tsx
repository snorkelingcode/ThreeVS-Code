import { useEffect, useRef, useState } from "react";
import { SceneManager } from "./SceneManager";
import { CharacterController } from "./CharacterController";
import { BoneDebugPanel } from "./BoneDebugPanel";
import { getAmplitude } from "../ai/audioPlayback";
import { registerCharacter } from "../materialEditor";

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
