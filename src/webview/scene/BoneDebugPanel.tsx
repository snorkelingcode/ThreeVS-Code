import { useState, type RefObject } from "react";
import { BONE_KEYS, type BoneKey, type CharacterController } from "./CharacterController";
import "./BoneDebugPanel.css";

const BONE_LABELS: Record<BoneKey, string> = {
  head: "Head",
  spine: "Spine",
  hip: "Hip",
  upperArmL: "Upper Arm L",
  upperArmR: "Upper Arm R",
  lowerArmL: "Lower Arm L",
  lowerArmR: "Lower Arm R",
};

type Pose = Record<BoneKey, { pitch: number; yaw: number; roll: number }>;

function emptyPose(): Pose {
  return Object.fromEntries(BONE_KEYS.map((k) => [k, { pitch: 0, yaw: 0, roll: 0 }])) as Pose;
}

interface BoneDebugPanelProps {
  characterRef: RefObject<CharacterController | null>;
}

/**
 * ?debug=1 tool: sliders to manually pose each tracked bone in degrees, so
 * good "in-between" rest/extreme poses can be found by eye and read off,
 * instead of guessing procedural-animation constants blind.
 */
export function BoneDebugPanel({ characterRef }: BoneDebugPanelProps) {
  const [manual, setManual] = useState(false);
  const [pose, setPose] = useState<Pose>(emptyPose);

  const toggleManual = () => {
    const next = !manual;
    setManual(next);
    characterRef.current?.setManualPoseMode(next);
  };

  const updateAxis = (bone: BoneKey, axis: "pitch" | "yaw" | "roll", value: number) => {
    const next = { ...pose, [bone]: { ...pose[bone], [axis]: value } };
    setPose(next);
    const p = next[bone];
    characterRef.current?.setBoneOverride(bone, p.pitch, p.yaw, p.roll);
  };

  const reset = () => {
    const next = emptyPose();
    setPose(next);
    for (const key of BONE_KEYS) characterRef.current?.setBoneOverride(key, 0, 0, 0);
  };

  return (
    <div className="bone-debug-panel">
      <label className="bone-debug-panel__toggle">
        <input type="checkbox" checked={manual} onChange={toggleManual} />
        Manual pose mode
      </label>

      {manual && (
        <>
          <button className="bone-debug-panel__reset" onClick={reset} type="button">
            Reset all
          </button>
          {BONE_KEYS.map((key) => (
            <div className="bone-debug-panel__bone" key={key}>
              <div className="bone-debug-panel__bone-name">{BONE_LABELS[key]}</div>
              {(["pitch", "yaw", "roll"] as const).map((axis) => (
                <div className="bone-debug-panel__row" key={axis}>
                  <span className="bone-debug-panel__axis">{axis}</span>
                  <input
                    type="range"
                    min={-60}
                    max={60}
                    step={1}
                    value={pose[key][axis]}
                    onChange={(e) => updateAxis(key, axis, Number(e.target.value))}
                  />
                  <span className="bone-debug-panel__value">{pose[key][axis]}°</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
