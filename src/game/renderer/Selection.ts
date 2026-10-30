import * as THREE from 'three';
import { getSelectionBoxes } from '../blocks/shapes';
import { createCrackCanvas } from './textures';

/** Outline around the targeted block plus the crack overlay while mining. */
export class Selection {
  readonly group = new THREE.Group();
  private readonly outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly crack: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly crackTexture: THREE.CanvasTexture;
  private lastKey = '';

  constructor() {
    this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85 }));
    this.crackTexture = new THREE.CanvasTexture(createCrackCanvas());
    this.crackTexture.magFilter = THREE.NearestFilter;
    this.crackTexture.minFilter = THREE.NearestFilter;
    this.crackTexture.repeat.set(0.1, 1);
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.004, 1.004, 1.004),
      new THREE.MeshBasicMaterial({ map: this.crackTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    this.crack.visible = false;
    this.group.add(this.outline, this.crack);
    this.group.visible = false;
  }

  setTarget(target: { x: number; y: number; z: number; id: number; meta: number } | null): void {
    if (!target) {
      this.group.visible = false;
      this.lastKey = '';
      return;
    }
    this.group.visible = true;
    const key = `${target.x},${target.y},${target.z},${target.id},${target.meta}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const positions: number[] = [];
    const e = 0.002;
    for (const [x0, y0, z0, x1, y1, z1] of getSelectionBoxes(target.id, target.meta)) {
      const a = [x0 - e, y0 - e, z0 - e];
      const b = [x1 + e, y1 + e, z1 + e];
      const corners = [
        [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]],
        [a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]],
      ];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [i, j] of edges) positions.push(...corners[i], ...corners[j]);
    }
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry();
    this.outline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.group.position.set(target.x, target.y, target.z);
  }

  /** @param progress 0..1 mining progress, or null to hide cracks */
  setProgress(progress: number | null): void {
    if (progress === null || progress <= 0) {
      this.crack.visible = false;
      return;
    }
    this.crack.visible = true;
    this.crack.position.set(0.5, 0.5, 0.5);
    this.crackTexture.offset.x = Math.min(9, Math.floor(progress * 10)) / 10;
  }

  dispose(): void {
    this.outline.geometry.dispose();
    this.outline.material.dispose();
    this.crack.geometry.dispose();
    this.crack.material.dispose();
    this.crackTexture.dispose();
  }
}
