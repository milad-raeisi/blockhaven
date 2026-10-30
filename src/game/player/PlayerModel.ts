import * as THREE from 'three';
import { buildGeometry } from '../renderer/Renderer';
import { meshItem } from '../chunks/mesher';
import type { ChunkMaterials } from '../renderer/materials';
import type { Appearance } from '../../network/protocol/messages';

function faceTexture(skin: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 3, 2, 1);
  ctx.fillRect(5, 3, 2, 1);
  ctx.fillStyle = '#2b2b4a';
  ctx.fillRect(2, 3, 1, 1);
  ctx.fillRect(5, 3, 1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(3, 5, 2, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function nameTexture(name: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px sans-serif';
  const width = Math.ceil(ctx.measureText(name).width) + 24;
  canvas.width = width;
  canvas.height = 40;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, width, 40);
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 12, 21);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / 40 };
}

/** Blocky humanoid with walk / swing / crouch animation and a name tag. */
export class PlayerModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly label: THREE.Sprite;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private heldGroup = new THREE.Group();
  private heldId = -1;
  private walkPhase = 0;
  private swing = 0;

  constructor(
    name: string,
    appearance: Appearance,
    private readonly chunkMaterials: ChunkMaterials,
  ) {
    const skin = new THREE.MeshLambertMaterial({ color: appearance.skin });
    const shirt = new THREE.MeshLambertMaterial({ color: appearance.shirt });
    const pants = new THREE.MeshLambertMaterial({ color: appearance.pants });
    const face = new THREE.MeshLambertMaterial({ map: faceTexture(appearance.skin) });
    this.materials.push(skin, shirt, pants, face);

    const box = (w: number, h: number, d: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geometries.push(g);
      return g;
    };
    // Head: the face texture goes on the front (-Z) side.
    this.head = new THREE.Mesh(box(0.5, 0.5, 0.5), [skin, skin, skin, skin, skin, face]);
    this.head.position.y = 1.5 + 0.25;
    const torso = new THREE.Mesh(box(0.5, 0.75, 0.25), shirt);
    torso.position.y = 0.75 + 0.375;

    const limb = (group: THREE.Group, material: THREE.Material, x: number, pivotY: number, sleeve?: THREE.Material) => {
      const mesh = new THREE.Mesh(box(0.25, 0.75, 0.25), sleeve ?? material);
      mesh.position.y = -0.375;
      group.add(mesh);
      group.position.set(x, pivotY, 0);
    };
    limb(this.leftArm, skin, -0.375, 1.5, shirt);
    limb(this.rightArm, skin, 0.375, 1.5, shirt);
    limb(this.leftLeg, pants, -0.125, 0.75);
    limb(this.rightLeg, pants, 0.125, 0.75);
    // Hands in skin colour.
    for (const arm of [this.leftArm, this.rightArm]) {
      const hand = new THREE.Mesh(box(0.26, 0.2, 0.26), skin);
      hand.position.y = -0.66;
      arm.add(hand);
    }
    this.heldGroup.position.set(0, -0.7, -0.2);
    this.heldGroup.scale.setScalar(0.3);
    this.rightArm.add(this.heldGroup);

    this.body.add(torso, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg, this.head);
    for (const child of this.body.children) child.traverse((o) => (o.castShadow = true));
    this.root.add(this.body);

    const { texture, aspect } = nameTexture(name);
    const labelMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    this.materials.push(labelMaterial);
    this.label = new THREE.Sprite(labelMaterial);
    this.label.scale.set(0.3 * aspect, 0.3, 1);
    this.label.position.y = 2.3;
    this.label.renderOrder = 20;
    this.root.add(this.label);
  }

  setLabelVisible(visible: boolean): void {
    this.label.visible = visible;
  }

  setHeldItem(id: number): void {
    if (id === this.heldId) return;
    this.heldId = id;
    for (const child of [...this.heldGroup.children]) {
      this.heldGroup.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    if (id <= 0 || id >= 256) return;
    const output = meshItem(id);
    for (const layer of ['opaque', 'cutout', 'translucent'] as const) {
      const data = output[layer];
      if (!data) continue;
      const mesh = new THREE.Mesh(buildGeometry(data), this.chunkMaterials[layer]);
      mesh.position.set(-0.5, -0.5, -0.5);
      this.heldGroup.add(mesh);
    }
  }

  triggerSwing(): void {
    if (this.swing <= 0) this.swing = 1;
  }

  /**
   * @param speed horizontal speed in blocks per second
   * @param pitch head pitch in radians
   */
  animate(dt: number, speed: number, pitch: number, crouching: boolean, flying: boolean): void {
    this.walkPhase += dt * Math.min(speed, 8) * 2.2;
    const amount = flying ? 0.1 : Math.min(1, speed / 4) * 0.8;
    const s = Math.sin(this.walkPhase) * amount;
    this.leftLeg.rotation.x = s;
    this.rightLeg.rotation.x = -s;
    this.leftArm.rotation.x = -s * 0.8;
    let rightArm = s * 0.8;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 4);
      rightArm = -Math.sin(this.swing * Math.PI) * 1.4;
    }
    this.rightArm.rotation.x = rightArm;
    this.head.rotation.x = -pitch;
    this.body.rotation.x = crouching ? 0.35 : 0;
    this.body.position.y = crouching ? -0.15 : 0;
    this.label.position.y = crouching ? 2.0 : 2.3;
  }

  dispose(): void {
    this.setHeldItem(0);
    for (const m of this.materials) {
      const map = (m as THREE.MeshLambertMaterial).map;
      map?.dispose();
      m.dispose();
    }
    for (const g of this.geometries) g.dispose();
  }
}
