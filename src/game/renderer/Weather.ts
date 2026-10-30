import * as THREE from 'three';

const RANGE_XZ = 24;
const RANGE_Y = 18;

/** Rain streaks and snowflakes simulated in a box around the camera. */
export class Weather {
  readonly group = new THREE.Group();
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly rainOffsets: Float32Array;
  private readonly snowOffsets: Float32Array;
  private readonly rainCount: number;
  private readonly snowCount: number;
  private mode: 'clear' | 'rain' | 'snow' = 'clear';
  private time = 0;

  constructor(quality: 'low' | 'medium' | 'high') {
    const scale = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
    this.rainCount = Math.floor(1600 * scale);
    this.snowCount = Math.floor(1400 * scale);

    this.rainOffsets = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) this.randomize(this.rainOffsets, i);
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.rainCount * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0x9bb6e8, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.frustumCulled = false;

    this.snowOffsets = new Float32Array(this.snowCount * 3);
    for (let i = 0; i < this.snowCount; i++) this.randomize(this.snowOffsets, i);
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.snowCount * 3), 3));
    this.snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false;

    this.group.add(this.rain, this.snow);
    this.setMode('clear');
  }

  private randomize(arr: Float32Array, i: number): void {
    arr[i * 3] = (Math.random() * 2 - 1) * RANGE_XZ;
    arr[i * 3 + 1] = (Math.random() * 2 - 1) * RANGE_Y;
    arr[i * 3 + 2] = (Math.random() * 2 - 1) * RANGE_XZ;
  }

  setMode(mode: 'clear' | 'rain' | 'snow'): void {
    this.mode = mode;
    this.rain.visible = mode === 'rain';
    this.snow.visible = mode === 'snow';
  }

  /** @param sheltered hide precipitation when the camera is under a roof */
  update(camera: THREE.Camera, dt: number, sheltered: boolean, daylight: number): void {
    this.time += dt;
    const cam = camera.position;
    this.group.visible = this.mode !== 'clear' && !sheltered;
    if (!this.group.visible) return;
    this.group.position.set(cam.x, cam.y, cam.z);
    if (this.mode === 'rain') {
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const fall = 22 * dt;
      for (let i = 0; i < this.rainCount; i++) {
        let y = this.rainOffsets[i * 3 + 1] - fall;
        if (y < -RANGE_Y) y += RANGE_Y * 2;
        this.rainOffsets[i * 3 + 1] = y;
        const x = this.rainOffsets[i * 3];
        const z = this.rainOffsets[i * 3 + 2];
        arr.set([x, y, z, x - 0.05, y + 0.7, z], i * 6);
      }
      pos.needsUpdate = true;
      this.rain.material.opacity = 0.25 + 0.35 * daylight;
    } else {
      const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const fall = 2 * dt;
      for (let i = 0; i < this.snowCount; i++) {
        let y = this.snowOffsets[i * 3 + 1] - fall * (0.7 + (i % 5) * 0.1);
        if (y < -RANGE_Y) y += RANGE_Y * 2;
        this.snowOffsets[i * 3 + 1] = y;
        arr[i * 3] = this.snowOffsets[i * 3] + Math.sin(this.time * 0.8 + i) * 0.4;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = this.snowOffsets[i * 3 + 2] + Math.cos(this.time * 0.6 + i * 1.3) * 0.4;
      }
      pos.needsUpdate = true;
      this.snow.material.color.setScalar(0.4 + 0.6 * daylight);
    }
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.snow.geometry.dispose();
    this.snow.material.dispose();
  }
}
