import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type FrameCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

const CAMERA_TARGET = new THREE.Vector3(0, 1.55, 0);
// A fixed absolute cap doesn't scale with how close the default framing
// already is (~0.73 units) — expressing it as a small delta from that
// keeps the allowed zoom-out genuinely tight regardless of camera changes.
const MAX_ZOOM_DELTA = 0.15;

/**
 * Owns the renderer, camera, lights, and render loop. Scroll-to-zoom is
 * always available (out from the default cinematic framing, capped at
 * MAX_ZOOM_DELTA past it — never in past it either). Full orbit (drag to
 * rotate/pan) is reserved for window.__THREEVSCODE__.debug — the shipped
 * experience keeps the camera angle fixed, just zoomable.
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly frameCallbacks: FrameCallback[] = [];
  private readonly controls: OrbitControls;
  private readonly handleResize = () => this.onResize();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = new THREE.Fog(0x05070a, 8, 20);

    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(-0.01, 1.61, 0.73);
    this.camera.lookAt(CAMERA_TARGET);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;

    this.setupLights();
    this.setupGround();
    this.setupStarfield();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(CAMERA_TARGET);
    this.controls.enableDamping = true;
    this.controls.minDistance = this.camera.position.distanceTo(CAMERA_TARGET);
    this.controls.maxDistance = this.controls.minDistance + MAX_ZOOM_DELTA;
    // Default zoomSpeed (1) can cover most of that tiny 0.15-unit range in a
    // single scroll tick, making it feel like it jumps straight to the cap
    // rather than zooming gradually.
    this.controls.zoomSpeed = 0.4;

    if (!window.__THREEVSCODE__.debug) {
      this.controls.enableRotate = false;
      this.controls.enablePan = false;
    }

    window.addEventListener("resize", this.handleResize);
  }

  private setupLights(): void {
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    this.scene.add(key);

    const hemi = new THREE.HemisphereLight(0x445566, 0x0a0a0f, 0.9);
    this.scene.add(hemi);

    const rim = new THREE.PointLight(0x3a7bff, 1.2, 6);
    rim.position.set(-1.5, 1.6, -1.5);
    this.scene.add(rim);
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.9, metalness: 0.1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private setupStarfield(): void {
    const starCount = 2200;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const radius = 14 + Math.random() * 18;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      map: this.createStarSprite(),
      size: 0.14,
      sizeAttenuation: true,
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false, // stars read as infinitely distant, so atmospheric fog shouldn't dim them
    });

    this.scene.add(new THREE.Points(geometry, material));
  }

  /** Small radial-gradient dot generated on the fly — no external asset needed. */
  private createStarSprite(): THREE.Texture {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.7)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onFrame(callback: FrameCallback): void {
    this.frameCallbacks.push(callback);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => {
      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();
      this.controls.update();
      for (const cb of this.frameCallbacks) cb(delta, elapsed);
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
