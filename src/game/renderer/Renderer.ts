import * as THREE from 'three';
import type { LayerGeometry, LayerName, MeshOutput } from '../chunks/mesher';
import { meshItem } from '../chunks/mesher';
import { CHUNK_SIZE } from '../world/constants';
import { createChunkMaterials, type ChunkMaterials } from './materials';
import { Selection } from './Selection';
import { Sky } from './Sky';
import { Weather } from './Weather';

export type ShadowQuality = 'off' | 'low' | 'high';
export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface RendererSettings {
  fov: number;
  renderDistance: number;
  shadows: ShadowQuality;
  quality: GraphicsQuality;
  particles: boolean;
}

export interface ChunkMeshes {
  opaque?: THREE.Mesh;
  cutout?: THREE.Mesh;
  translucent?: THREE.Mesh;
}

const LAYERS: LayerName[] = ['opaque', 'cutout', 'translucent'];

export function buildGeometry(layer: LayerGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(layer.normals, 3, true));
  geometry.setAttribute('uv', new THREE.BufferAttribute(layer.uvs, 2));
  geometry.setAttribute('aData', new THREE.BufferAttribute(layer.data, 4, false));
  geometry.setIndex(new THREE.BufferAttribute(layer.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Owns the Three.js scene: camera, lights, sky, weather, chunk meshes and the
 * first-person held item. Contains no game logic.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly materials: ChunkMaterials;
  readonly sky = new Sky();
  readonly selection = new Selection();
  weather: Weather;
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly chunkGroup = new THREE.Group();
  private readonly handGroup = new THREE.Group();
  private handMesh: THREE.Group | null = null;
  private handItem = -1;
  private handSwing = 0;
  private settings: RendererSettings;
  private time = 0;

  constructor(
    private readonly container: HTMLElement,
    settings: RendererSettings,
  ) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x87b5ff);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'block h-full w-full';
    this.renderer.domElement.setAttribute('data-testid', 'game-canvas');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.materials = createChunkMaterials();

    this.ambient = new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 0.65);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 0.55);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.ambient, this.sun, this.sun.target, this.chunkGroup, this.sky.group, this.selection.group);
    this.scene.fog = new THREE.Fog(0xbcd9ff, 50, 100);

    this.weather = new Weather(settings.quality);
    this.scene.add(this.weather.group);

    this.camera.add(this.handGroup);
    this.handGroup.position.set(0.42, -0.38, -0.62);

    this.applySettings(settings);
    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  applySettings(settings: RendererSettings): void {
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = settings;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const ratio = settings.quality === 'low' ? Math.min(dpr, 1) * 0.75 : settings.quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    const shadows = settings.shadows !== 'off';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      const size = settings.shadows === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      const extent = settings.shadows === 'high' ? 64 : 40;
      const cam = this.sun.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
    }
    for (const mesh of this.chunkGroup.children) {
      mesh.castShadow = shadows && mesh.userData.layer !== 'translucent';
      mesh.receiveShadow = shadows;
    }
    // Materials need recompiling when shadow support toggles.
    this.materials.opaque.needsUpdate = true;
    this.materials.cutout.needsUpdate = true;
    this.materials.translucent.needsUpdate = true;
    this.sky.setCloudsVisible(settings.quality !== 'low');
    if (qualityChanged) {
      this.scene.remove(this.weather.group);
      this.weather.dispose();
      this.weather = new Weather(settings.quality);
      this.scene.add(this.weather.group);
    }
    this.resize();
  }

  resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // --- Chunk meshes ------------------------------------------------------------

  setChunkMeshes(cx: number, cz: number, previous: ChunkMeshes | undefined, output: MeshOutput): ChunkMeshes {
    if (previous) this.disposeChunkMeshes(previous);
    const result: ChunkMeshes = {};
    const shadows = this.settings.shadows !== 'off';
    for (const layer of LAYERS) {
      const data = output[layer];
      if (!data) continue;
      const mesh = new THREE.Mesh(buildGeometry(data), this.materials[layer]);
      mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.layer = layer;
      mesh.castShadow = shadows && layer !== 'translucent';
      mesh.receiveShadow = shadows;
      if (layer === 'translucent') mesh.renderOrder = 1;
      this.chunkGroup.add(mesh);
      result[layer] = mesh;
    }
    return result;
  }

  disposeChunkMeshes(meshes: ChunkMeshes): void {
    for (const layer of LAYERS) {
      const mesh = meshes[layer];
      if (!mesh) continue;
      this.chunkGroup.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  get chunkMeshCount(): number {
    return this.chunkGroup.children.length;
  }

  // --- Held item -----------------------------------------------------------------

  setHeldItem(id: number, visible: boolean): void {
    this.handGroup.visible = visible;
    if (id === this.handItem) return;
    this.handItem = id;
    if (this.handMesh) {
      this.handGroup.remove(this.handMesh);
      this.handMesh.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      this.handMesh = null;
    }
    if (id <= 0 || id >= 256) return;
    const output = meshItem(id);
    const group = new THREE.Group();
    for (const layer of LAYERS) {
      const data = output[layer];
      if (!data) continue;
      const mesh = new THREE.Mesh(buildGeometry(data), this.materials[layer]);
      mesh.position.set(-0.5, -0.5, -0.5);
      mesh.renderOrder = 10;
      group.add(mesh);
    }
    group.scale.setScalar(0.32);
    group.rotation.set(0.15, Math.PI / 4 + 0.2, 0);
    this.handMesh = group;
    this.handGroup.add(group);
  }

  swingHand(): void {
    this.handSwing = 1;
  }

  // --- Frame -------------------------------------------------------------------------

  /** Update atmosphere for the current time and render one frame. */
  render(dt: number, timeOfDay: number, weather: 'clear' | 'rain' | 'snow', sheltered: boolean, underwater: boolean): void {
    this.time += dt;
    this.materials.uniforms.uTime.value = this.time;
    const sky = this.sky.update(this.camera, timeOfDay, weather, dt);
    this.materials.uniforms.uDaylight.value = sky.daylight;

    const fog = this.scene.fog as THREE.Fog;
    const far = this.settings.renderDistance * CHUNK_SIZE;
    if (underwater) {
      fog.color.set(0x1d3f7a);
      fog.near = 1;
      fog.far = 18;
    } else {
      fog.color.copy(sky.fogColor);
      const storm = weather === 'clear' ? 1 : 0.65;
      fog.near = far * 0.45 * storm;
      fog.far = far * 0.95 * storm;
    }
    this.renderer.setClearColor(fog.color);

    // Sun light follows the camera so shadows stay crisp near the player.
    const cam = this.camera.position;
    const snap = 4;
    const tx = Math.round(cam.x / snap) * snap;
    const tz = Math.round(cam.z / snap) * snap;
    const sunDir = sky.sunDirection.y > 0 ? sky.sunDirection : sky.sunDirection.clone().negate();
    this.sun.target.position.set(tx, cam.y, tz);
    this.sun.position.set(tx + sunDir.x * 120, cam.y + Math.abs(sunDir.y) * 120 + 10, tz + sunDir.z * 120);
    const dayStrength = THREE.MathUtils.clamp((sky.daylight - 0.14) / 0.86, 0, 1);
    this.sun.intensity = 0.55 * dayStrength + 0.08;
    this.sun.color.set(sky.sunDirection.y > 0 ? 0xfff4e0 : 0x9fb4ff);
    this.ambient.intensity = 0.62 + 0.15 * (1 - dayStrength);

    this.weather.update(this.camera, dt, sheltered || !this.settings.particles, sky.daylight);

    if (this.handSwing > 0) this.handSwing = Math.max(0, this.handSwing - dt * 5);
    const s = Math.sin(this.handSwing * Math.PI);
    this.handGroup.position.set(0.42 - s * 0.12, -0.38 - s * 0.1, -0.62 - s * 0.08);
    this.handGroup.rotation.x = -s * 0.6;

    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  dispose(): void {
    for (const mesh of [...this.chunkGroup.children] as THREE.Mesh[]) {
      mesh.geometry.dispose();
      this.chunkGroup.remove(mesh);
    }
    this.setHeldItem(0, false);
    this.sky.dispose();
    this.weather.dispose();
    this.selection.dispose();
    this.materials.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
