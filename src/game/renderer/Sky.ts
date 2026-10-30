import * as THREE from 'three';
import { mulberry32 } from '../terrain/random';

const DAY_TOP = new THREE.Color('#5d9bf5');
const DAY_HORIZON = new THREE.Color('#bcd9ff');
const SUNSET_HORIZON = new THREE.Color('#ff9b5c');
const NIGHT_TOP = new THREE.Color('#050914');
const NIGHT_HORIZON = new THREE.Color('#151d38');
const RAIN_TOP = new THREE.Color('#6d7580');
const RAIN_HORIZON = new THREE.Color('#9aa1aa');

export interface SkyState {
  daylight: number;
  sunDirection: THREE.Vector3;
  fogColor: THREE.Color;
}

function squareTexture(draw: (ctx: CanvasRenderingContext2D) => void, size = 32): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sky dome gradient, sun, moon, stars and drifting voxel clouds. */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly cloudTexture: THREE.CanvasTexture;
  readonly state: SkyState = { daylight: 1, sunDirection: new THREE.Vector3(0, 1, 0), fogColor: new THREE.Color() };
  private cloudDrift = 0;

  constructor() {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { topColor: { value: DAY_TOP.clone() }, horizonColor: { value: DAY_HORIZON.clone() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.2, 1.0);
            float t = pow(max(h, 0.0), 0.55);
            gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    const sunTex = squareTexture((ctx) => {
      ctx.fillStyle = 'rgba(255,240,170,0.25)';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = '#fff6c9';
      ctx.fillRect(6, 6, 20, 20);
      ctx.fillStyle = '#ffe680';
      ctx.fillRect(9, 9, 14, 14);
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }));
    const moonTex = squareTexture((ctx) => {
      ctx.fillStyle = '#e6ebf5';
      ctx.fillRect(8, 8, 16, 16);
      ctx.fillStyle = '#b9c0cf';
      ctx.fillRect(11, 12, 4, 4);
      ctx.fillRect(18, 17, 3, 3);
      ctx.fillRect(14, 20, 2, 2);
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false }));

    const rand = mulberry32(42);
    const starPositions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 2 - 1);
      starPositions[i * 3] = 380 * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = Math.abs(380 * Math.cos(phi));
      starPositions[i * 3 + 2] = 380 * Math.sin(phi) * Math.sin(theta);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));

    this.cloudTexture = squareTexture((ctx) => {
      const r = mulberry32(7);
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (let y = 0; y < 64; y += 4) {
        for (let x = 0; x < 64; x += 4) {
          const n = Math.sin(x * 0.21 + r() * 0.5) + Math.cos(y * 0.17 + r() * 0.5) + r() * 0.9;
          if (n > 1.2) ctx.fillRect(x, y, 4, 4);
        }
      }
    }, 64);
    this.cloudTexture.wrapS = THREE.RepeatWrapping;
    this.cloudTexture.wrapT = THREE.RepeatWrapping;
    this.cloudTexture.repeat.set(6, 6);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshBasicMaterial({ map: this.cloudTexture, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.clouds.rotation.x = -Math.PI / 2;

    this.group.add(this.dome, this.sun, this.moon, this.stars, this.clouds);
  }

  setCloudsVisible(visible: boolean): void {
    this.clouds.visible = visible;
  }

  /**
   * @param timeOfDay ticks in [0, 24000): 0 sunrise, 6000 noon, 12000 sunset, 18000 midnight
   * @param weather current weather
   */
  update(camera: THREE.Camera, timeOfDay: number, weather: 'clear' | 'rain' | 'snow', dt: number): SkyState {
    const angle = (timeOfDay / 24000) * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    const sunDir = this.state.sunDirection.set(Math.cos(angle), sunHeight, 0.35).normalize();
    const storm = weather === 'clear' ? 0 : 0.6;
    const day = THREE.MathUtils.smoothstep(sunHeight, -0.18, 0.28);
    this.state.daylight = THREE.MathUtils.lerp(0.14, 1, day) * (1 - storm * 0.35);

    const sunset = Math.max(0, 1 - Math.abs(sunHeight) * 4) * (1 - storm);
    const uniforms = this.dome.material.uniforms;
    const top = (uniforms.topColor.value as THREE.Color).copy(NIGHT_TOP).lerp(DAY_TOP, day);
    const horizon = (uniforms.horizonColor.value as THREE.Color).copy(NIGHT_HORIZON).lerp(DAY_HORIZON, day).lerp(SUNSET_HORIZON, sunset * 0.7);
    if (storm > 0) {
      top.lerp(RAIN_TOP.clone().multiplyScalar(0.3 + 0.7 * day), storm);
      horizon.lerp(RAIN_HORIZON.clone().multiplyScalar(0.3 + 0.7 * day), storm);
    }
    this.state.fogColor.copy(horizon);

    const cam = camera.position;
    this.group.position.set(cam.x, cam.y, cam.z);
    this.sun.position.copy(sunDir).multiplyScalar(350);
    this.sun.lookAt(cam);
    this.moon.position.copy(sunDir).multiplyScalar(-350);
    this.moon.lookAt(cam);
    this.sun.visible = sunHeight > -0.2 && storm === 0;
    this.moon.visible = sunHeight < 0.2 && storm === 0;
    this.stars.material.opacity = Math.max(0, 1 - day * 1.6) * (1 - storm);
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.stars.rotation.y = angle * 0.2;

    // Clouds live at a fixed world height and scroll with the wind.
    this.cloudDrift += dt * 1.2;
    this.clouds.position.set(0, 118 - cam.y, 0);
    this.cloudTexture.offset.set(((cam.x + this.cloudDrift) / 1200) * 6, (-cam.z / 1200) * 6);
    const cloudMaterial = this.clouds.material;
    cloudMaterial.color.setScalar(0.35 + 0.65 * this.state.daylight);
    cloudMaterial.opacity = storm > 0 ? 0.95 : 0.8;
    return this.state;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mat = obj.material as THREE.Material & { map?: THREE.Texture };
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }
}
