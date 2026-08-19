import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const HEAD_BONE_NAMES = ["head", "mixamorighead", "bip01_head"];
const HIP_BONE_NAMES = ["hips", "hip", "pelvis", "mixamorighips", "bip01_pelvis", "spine"];
const VISOR_MATERIAL_NAMES = ["visor", "visor_emissive"];

// Exact matches (not substring) since e.g. "upperarm_l" and "lowerarm_l" both
// contain "arm_l" — substring matching would confuse the two.
const UPPERARM_L_NAMES = new Set(["upperarm_l", "leftarm", "mixamorigleftarm", "left_arm"]);
const UPPERARM_R_NAMES = new Set(["upperarm_r", "rightarm", "mixamorigrightarm", "right_arm"]);
const LOWERARM_L_NAMES = new Set(["lowerarm_l", "leftforearm", "mixamorigleftforearm", "left_forearm"]);
const LOWERARM_R_NAMES = new Set(["lowerarm_r", "rightforearm", "mixamorigrightforearm", "right_forearm"]);

export const BONE_KEYS = ["head", "spine", "hip", "upperArmL", "upperArmR", "lowerArmL", "lowerArmR"] as const;
export type BoneKey = (typeof BONE_KEYS)[number];

/**
 * Loads the character GLB and drives it every frame. The source FBX has no
 * facial blendshapes (helmeted character, no mouth) and no authored talk/idle
 * clips, so all motion here is procedural: small rotational offsets applied
 * on top of the bones' captured rest pose, never accumulated frame-to-frame.
 *
 * Falls back to a simple placeholder rig (capsule body + glowing "visor"
 * plane) if assets/character.glb isn't present yet, so scene/animation work
 * isn't blocked on the Blender conversion step.
 */
export class CharacterController {
  readonly group = new THREE.Group();

  private headBone: THREE.Object3D | null = null;
  private hipBone: THREE.Object3D | null = null;
  private spineBone: THREE.Object3D | null = null;
  private upperArmLBone: THREE.Object3D | null = null;
  private upperArmRBone: THREE.Object3D | null = null;
  private lowerArmLBone: THREE.Object3D | null = null;
  private lowerArmRBone: THREE.Object3D | null = null;
  private visorMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly materialsByName = new Map<string, THREE.MeshStandardMaterial>();

  private smoothedLevel = 0;
  private readonly visorBaseIntensity = 0;
  private readonly visorGain = 3.5;
  usingPlaceholder = false;

  private lookCurrentX = 0;
  private lookCurrentY = 0;
  private readonly maxYaw = THREE.MathUtils.degToRad(32);
  private readonly maxPitch = THREE.MathUtils.degToRad(18);
  private readonly headRestWorld = new THREE.Quaternion();

  // The head "looks around" on its own: a continuous drift made of two
  // summed sine waves per axis (different frequencies so it doesn't look
  // like a metronome), rather than discrete "pick a point, tween to it, hold
  // still" steps. Occasionally the drift itself pauses for a beat before
  // continuing, so it reads as a deliberate glance-and-hold rather than a
  // machine that never stops moving.
  private autonomousClock = 0;
  private autonomousSeedX = Math.random() * Math.PI * 2;
  private autonomousSeedY = Math.random() * Math.PI * 2;
  private autonomousPauseRemaining = 0;
  private autonomousPauseCheckIn = 3 + Math.random() * 3;
  private static readonly AUTONOMOUS_BLEND_IN = 1.2; // seconds to ease in from rest at startup
  private static readonly AUTONOMOUS_PAUSE_CHANCE = 0.25;

  // Breathing idle animation (subtle spine sine-wave tilt).
  private readonly spineRestWorld = new THREE.Quaternion();
  private readonly hipRestWorld = new THREE.Quaternion();
  private readonly breathAmplitude = THREE.MathUtils.degToRad(1.8);
  private readonly breathSpeed = 1.3; // ~4.8s per full breath cycle

  // Idle arm sway, so the A-pose doesn't read as frozen. Left/right and
  // upper/lower each get their own phase and speed so nothing moves in
  // lockstep — same "layer a couple of mismatched sine waves" idea as the
  // autonomous head drift, just applied to the arms.
  private readonly upperArmLRestWorld = new THREE.Quaternion();
  private readonly upperArmRRestWorld = new THREE.Quaternion();
  private readonly lowerArmLRestWorld = new THREE.Quaternion();
  private readonly lowerArmRRestWorld = new THREE.Quaternion();
  private readonly armSwayAmplitude = THREE.MathUtils.degToRad(3);
  private readonly armSwaySpeed = 0.45;
  private readonly forearmSwayAmplitude = THREE.MathUtils.degToRad(2);
  private readonly forearmSwaySpeed = 0.65;

  // Relaxed-down resting angles found via the bone debug panel — the raw
  // rig rest pose is an A-pose, so this is a fixed correction the sway
  // above oscillates around, not the sway itself.
  private static readonly ARM_BASE_POSE = {
    upperArmL: { pitch: 0, yaw: 0, roll: THREE.MathUtils.degToRad(-19) },
    upperArmR: { pitch: 0, yaw: 0, roll: THREE.MathUtils.degToRad(19) },
    lowerArmL: { pitch: 0, yaw: THREE.MathUtils.degToRad(-20), roll: THREE.MathUtils.degToRad(-28) },
    lowerArmR: { pitch: 0, yaw: THREE.MathUtils.degToRad(20), roll: THREE.MathUtils.degToRad(28) },
  };

  // Debug-only manual posing (see BoneDebugPanel, ?debug=1): sliders drive
  // these overrides directly, bypassing procedural animation entirely while
  // active, so a pose can be found and read off cleanly without motion.
  private manualPoseMode = false;
  private readonly manualOverrides: Record<BoneKey, { pitch: number; yaw: number; roll: number }> = {
    head: { pitch: 0, yaw: 0, roll: 0 },
    spine: { pitch: 0, yaw: 0, roll: 0 },
    hip: { pitch: 0, yaw: 0, roll: 0 },
    upperArmL: { pitch: 0, yaw: 0, roll: 0 },
    upperArmR: { pitch: 0, yaw: 0, roll: 0 },
    lowerArmL: { pitch: 0, yaw: 0, roll: 0 },
    lowerArmR: { pitch: 0, yaw: 0, roll: 0 },
  };

  private readonly scratchWorldOffset = new THREE.Quaternion();
  private readonly scratchParentWorld = new THREE.Quaternion();
  private readonly scratchTargetWorld = new THREE.Quaternion();

  private constructor() {}

  static async load(url: string): Promise<CharacterController> {
    const controller = new CharacterController();
    try {
      const gltf = await controller.loadGLTF(url);
      controller.setupFromGLTF(gltf);
    } catch (err) {
      console.warn(`[CharacterController] Could not load "${url}", using placeholder mesh.`, err);
      controller.setupPlaceholder();
    }
    controller.captureRestPose();
    controller.logDiagnostics();
    return controller;
  }

  private loadGLTF(url: string): Promise<GLTF> {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }

  private setupFromGLTF(gltf: GLTF): void {
    const root = gltf.scene;
    const spineCandidates: THREE.Object3D[] = [];

    root.traverse((node) => {
      const lowerName = node.name.toLowerCase();
      if (!this.headBone && HEAD_BONE_NAMES.some((n) => lowerName.includes(n))) {
        this.headBone = node;
      }
      if (!this.hipBone && HIP_BONE_NAMES.some((n) => lowerName.includes(n))) {
        this.hipBone = node;
      }
      if (lowerName.startsWith("spine")) {
        spineCandidates.push(node);
      }
      if (!this.upperArmLBone && UPPERARM_L_NAMES.has(lowerName)) this.upperArmLBone = node;
      if (!this.upperArmRBone && UPPERARM_R_NAMES.has(lowerName)) this.upperArmRBone = node;
      if (!this.lowerArmLBone && LOWERARM_L_NAMES.has(lowerName)) this.lowerArmLBone = node;
      if (!this.lowerArmRBone && LOWERARM_R_NAMES.has(lowerName)) this.lowerArmRBone = node;

      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
          if (mat.name) this.materialsByName.set(mat.name, mat);
          if (VISOR_MATERIAL_NAMES.some((n) => mat.name.toLowerCase().includes(n))) {
            this.visorMaterial = mat;
            mat.emissive = new THREE.Color(0xff0000);
          }
        }
      }
    });

    // Prefer the middle of the spine chain (e.g. spine_03 of spine_01..05) —
    // a better breathing pivot than the base (near the pelvis) or tip (near
    // the neck), and traversal order already follows the chain root-to-tip.
    if (spineCandidates.length > 0) {
      this.spineBone = spineCandidates[Math.floor(spineCandidates.length / 2)];
    }

    this.group.add(root);
  }

  /** Simple capsule + glowing plate stand-in, used until character.glb exists. */
  private setupPlaceholder(): void {
    this.usingPlaceholder = true;

    const hip = new THREE.Object3D();
    hip.name = "Hips";
    hip.position.set(0, 0.9, 0);
    this.group.add(hip);

    const bodyMaterial = new THREE.MeshStandardMaterial({
      name: "Body",
      color: 0x394656,
      roughness: 0.55,
      metalness: 0.4,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 12), bodyMaterial);
    body.position.set(0, 0.28, 0);
    body.castShadow = true;
    hip.add(body);
    this.materialsByName.set(bodyMaterial.name, bodyMaterial);

    const head = new THREE.Object3D();
    head.name = "Head";
    head.position.set(0, 0.72, 0);
    hip.add(head);

    const helmetMaterial = new THREE.MeshStandardMaterial({
      name: "Helmet",
      color: 0x2a323d,
      roughness: 0.4,
      metalness: 0.6,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), helmetMaterial);
    helmet.castShadow = true;
    head.add(helmet);
    this.materialsByName.set(helmetMaterial.name, helmetMaterial);

    const visor = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.1),
      new THREE.MeshStandardMaterial({
        name: "Visor_Emissive",
        color: 0x050505,
        emissive: new THREE.Color(0xff0000),
        emissiveIntensity: this.visorBaseIntensity,
        roughness: 0.3,
      }),
    );
    visor.position.set(0, 0.02, 0.2);
    head.add(visor);
    this.visorMaterial = visor.material as THREE.MeshStandardMaterial;
    this.materialsByName.set(this.visorMaterial.name, this.visorMaterial);

    this.headBone = head;
    this.hipBone = hip;
  }

  private captureRestPose(): void {
    this.group.updateMatrixWorld(true);
    if (this.headBone) this.headBone.getWorldQuaternion(this.headRestWorld);
    if (this.hipBone) this.hipBone.getWorldQuaternion(this.hipRestWorld);
    if (this.spineBone) this.spineBone.getWorldQuaternion(this.spineRestWorld);
    if (this.upperArmLBone) this.upperArmLBone.getWorldQuaternion(this.upperArmLRestWorld);
    if (this.upperArmRBone) this.upperArmRBone.getWorldQuaternion(this.upperArmRRestWorld);
    if (this.lowerArmLBone) this.lowerArmLBone.getWorldQuaternion(this.lowerArmLRestWorld);
    if (this.lowerArmRBone) this.lowerArmRBone.getWorldQuaternion(this.lowerArmRRestWorld);
  }

  private logDiagnostics(): void {
    console.info(
      "[CharacterController] head bone:",
      this.headBone?.name ?? "NOT FOUND",
      "| hip bone:",
      this.hipBone?.name ?? "NOT FOUND",
      "| spine bone:",
      this.spineBone?.name ?? "NOT FOUND",
      "| arms:",
      this.upperArmLBone?.name ?? "NOT FOUND",
      this.upperArmRBone?.name ?? "NOT FOUND",
      this.lowerArmLBone?.name ?? "NOT FOUND",
      this.lowerArmRBone?.name ?? "NOT FOUND",
      "| visor material:",
      this.visorMaterial?.name ?? "NOT FOUND",
      this.usingPlaceholder ? "(placeholder mesh)" : "(character.glb)",
    );
  }

  /** Debug-only (see BoneDebugPanel): when on, procedural animation is skipped in favor of slider-driven poses. */
  setManualPoseMode(active: boolean): void {
    this.manualPoseMode = active;
  }

  isManualPoseMode(): boolean {
    return this.manualPoseMode;
  }

  /** Debug-only: set one bone's manual pose in degrees. Only visible while manual pose mode is on. */
  setBoneOverride(key: BoneKey, pitchDeg: number, yawDeg: number, rollDeg: number): void {
    this.manualOverrides[key] = {
      pitch: THREE.MathUtils.degToRad(pitchDeg),
      yaw: THREE.MathUtils.degToRad(yawDeg),
      roll: THREE.MathUtils.degToRad(rollDeg),
    };
  }

  private getBoneAndRest(key: BoneKey): [THREE.Object3D | null, THREE.Quaternion] {
    switch (key) {
      case "head":
        return [this.headBone, this.headRestWorld];
      case "spine":
        return [this.spineBone, this.spineRestWorld];
      case "hip":
        return [this.hipBone, this.hipRestWorld];
      case "upperArmL":
        return [this.upperArmLBone, this.upperArmLRestWorld];
      case "upperArmR":
        return [this.upperArmRBone, this.upperArmRRestWorld];
      case "lowerArmL":
        return [this.lowerArmLBone, this.lowerArmLRestWorld];
      case "lowerArmR":
        return [this.lowerArmRBone, this.lowerArmRRestWorld];
    }
  }

  /** Debug-only: applies the current slider positions. Call instead of the procedural update methods. */
  applyManualPose(): void {
    for (const key of BONE_KEYS) {
      const [bone, restWorld] = this.getBoneAndRest(key);
      if (!bone) continue;
      const o = this.manualOverrides[key];
      this.applyWorldSpaceOffset(bone, restWorld, o.pitch, o.yaw, o.roll);
    }
  }

  /**
   * Rotates `bone` toward `restWorld` plus a (pitch, yaw, roll) offset
   * expressed in WORLD axes (camera-aligned: +Y up, +X right), converting the
   * result back to a local quaternion via the parent's current world
   * orientation. This matters because rigs like this one (UE mannequin-style)
   * commonly have local bone axes that don't line up with world/camera axes —
   * applying an offset directly in local space looks skewed/broken, while
   * composing in world space and converting down is correct regardless of
   * the rig's own convention.
   */
  private applyWorldSpaceOffset(
    bone: THREE.Object3D,
    restWorld: THREE.Quaternion,
    pitch: number,
    yaw: number,
    roll = 0,
  ): void {
    if (!bone.parent) return;

    this.scratchWorldOffset.setFromEuler(new THREE.Euler(pitch, yaw, roll));
    this.scratchTargetWorld.copy(this.scratchWorldOffset).multiply(restWorld);

    bone.parent.getWorldQuaternion(this.scratchParentWorld);
    bone.quaternion.copy(this.scratchParentWorld).invert().multiply(this.scratchTargetWorld);
  }

  /**
   * Eases the head bone through a slow autonomous drift — two sine waves of
   * different frequency summed per axis, so it wanders without repeating
   * like a metronome — which occasionally pauses for a beat (25% chance
   * every few seconds) before continuing, so it reads as alive rather than
   * mechanical. Blends in from the neutral rest pose over the first
   * AUTONOMOUS_BLEND_IN seconds after load, rather than snapping straight to
   * a mid-drift position at startup.
   */
  updateHeadLook(delta: number): void {
    if (!this.headBone) return;

    if (this.autonomousPauseRemaining > 0) {
      this.autonomousPauseRemaining -= delta;
    } else {
      this.autonomousClock += delta;
      this.autonomousPauseCheckIn -= delta;
      if (this.autonomousPauseCheckIn <= 0) {
        this.autonomousPauseCheckIn = 4 + Math.random() * 3;
        if (Math.random() < CharacterController.AUTONOMOUS_PAUSE_CHANCE) {
          this.autonomousPauseRemaining = 1 + Math.random();
        }
      }
    }

    // Frozen while paused since these are a pure function of the clock,
    // which naturally resumes from the same phase with no snap afterward.
    const driftX =
      Math.sin(this.autonomousClock * 0.3 + this.autonomousSeedX) * 0.45 +
      Math.sin(this.autonomousClock * 0.78 + this.autonomousSeedX * 1.7) * 0.2;
    const driftY =
      Math.sin(this.autonomousClock * 0.24 + this.autonomousSeedY) * 0.35 +
      Math.sin(this.autonomousClock * 0.52 + this.autonomousSeedY * 1.3) * 0.18;

    const blend = Math.min(1, this.autonomousClock / CharacterController.AUTONOMOUS_BLEND_IN);
    const blendEased = 0.5 - 0.5 * Math.cos(blend * Math.PI);
    this.lookCurrentX = THREE.MathUtils.lerp(0, driftX, blendEased);
    this.lookCurrentY = THREE.MathUtils.lerp(0, driftY, blendEased);

    const yaw = this.lookCurrentX * this.maxYaw;
    const pitch = -this.lookCurrentY * this.maxPitch;
    this.applyWorldSpaceOffset(this.headBone, this.headRestWorld, pitch, yaw);
  }

  /** Slight sine-wave chest tilt so the character doesn't look frozen when idle. */
  updateIdleBreathing(elapsed: number): void {
    const bone = this.spineBone ?? this.hipBone;
    const restWorld = this.spineBone ? this.spineRestWorld : this.hipRestWorld;
    if (!bone) return;

    const pitch = Math.sin(elapsed * this.breathSpeed) * this.breathAmplitude;
    this.applyWorldSpaceOffset(bone, restWorld, pitch, 0);
  }

  /** Relaxed-down resting pose (ARM_BASE_POSE) plus gentle idle sway, so the arms neither stay in the A-pose nor look frozen. */
  updateArmSway(elapsed: number): void {
    const base = CharacterController.ARM_BASE_POSE;

    if (this.upperArmLBone) {
      const pitch = base.upperArmL.pitch + Math.sin(elapsed * this.armSwaySpeed) * this.armSwayAmplitude;
      const roll =
        base.upperArmL.roll + Math.sin(elapsed * this.armSwaySpeed * 0.6 + 1.2) * this.armSwayAmplitude * 0.5;
      this.applyWorldSpaceOffset(this.upperArmLBone, this.upperArmLRestWorld, pitch, base.upperArmL.yaw, roll);
    }
    if (this.upperArmRBone) {
      const pitch = base.upperArmR.pitch + Math.sin(elapsed * this.armSwaySpeed + Math.PI) * this.armSwayAmplitude;
      const roll =
        base.upperArmR.roll +
        Math.sin(elapsed * this.armSwaySpeed * 0.6 + 1.2 + Math.PI) * this.armSwayAmplitude * 0.5;
      this.applyWorldSpaceOffset(this.upperArmRBone, this.upperArmRRestWorld, pitch, base.upperArmR.yaw, roll);
    }
    if (this.lowerArmLBone) {
      const pitch =
        base.lowerArmL.pitch + Math.sin(elapsed * this.forearmSwaySpeed + 0.8) * this.forearmSwayAmplitude;
      this.applyWorldSpaceOffset(
        this.lowerArmLBone,
        this.lowerArmLRestWorld,
        pitch,
        base.lowerArmL.yaw,
        base.lowerArmL.roll,
      );
    }
    if (this.lowerArmRBone) {
      const pitch =
        base.lowerArmR.pitch +
        Math.sin(elapsed * this.forearmSwaySpeed + 0.8 + Math.PI) * this.forearmSwayAmplitude;
      this.applyWorldSpaceOffset(
        this.lowerArmRBone,
        this.lowerArmRRestWorld,
        pitch,
        base.lowerArmR.yaw,
        base.lowerArmR.roll,
      );
    }
  }

  /** Pulses the visor's emissive glow with live TTS audio level (0..1). Not wired up yet. */
  updateVisorPulse(amplitude: number, delta: number): void {
    if (!this.visorMaterial) return;
    const smoothing = Math.min(1, delta * 8);
    this.smoothedLevel += (amplitude - this.smoothedLevel) * smoothing;
    const target = this.visorBaseIntensity + this.smoothedLevel * this.visorGain;
    this.visorMaterial.emissiveIntensity += (target - this.visorMaterial.emissiveIntensity) * smoothing;
  }

  /** Every editable material's name, in mesh-traversal order. */
  getMaterialNames(): string[] {
    return [...this.materialsByName.keys()];
  }

  /** The material's base color as a `#rrggbb` string, for populating a color input. */
  getMaterialColor(name: string): string | null {
    const mat = this.materialsByName.get(name);
    return mat ? `#${mat.color.getHexString()}` : null;
  }

  /** Sets a material's base color from a `#rrggbb` string (e.g. from a color input). */
  setMaterialColor(name: string, hex: string): void {
    this.materialsByName.get(name)?.color.set(hex);
  }

  /** Recolors the visor's glow (see updateVisorPulse) — the base color, not the intensity, which stays driven by live speech amplitude. */
  setVisorColor(hex: string): void {
    this.visorMaterial?.emissive.set(hex);
  }

  /** The visor's current glow color as a `#rrggbb` string, for populating a color input. */
  getVisorColor(): string | null {
    return this.visorMaterial ? `#${this.visorMaterial.emissive.getHexString()}` : null;
  }
}
