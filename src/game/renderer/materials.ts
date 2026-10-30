import * as THREE from 'three';
import { getAtlasCanvas } from './textures';

export interface ChunkUniforms {
  uDaylight: { value: number };
  uTime: { value: number };
}

export interface ChunkMaterials {
  opaque: THREE.MeshLambertMaterial;
  cutout: THREE.MeshLambertMaterial;
  translucent: THREE.MeshLambertMaterial;
  uniforms: ChunkUniforms;
  atlas: THREE.CanvasTexture;
  dispose(): void;
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aData;
varying vec3 vLight;
varying vec2 vTileOrigin;
varying vec2 vTileUv;
`;

const VERTEX_MAIN = /* glsl */ `
vTileUv = uv;
vTileOrigin = vec2(mod(aData.x, 16.0), floor(aData.x / 16.0)) / 16.0;
vLight = vec3(aData.y / 15.0, aData.z / 15.0, aData.w / 3.0);
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uDaylight;
uniform float uTime;
varying vec3 vLight;
varying vec2 vTileOrigin;
varying vec2 vTileUv;
`;

/** Repeat the tile across greedy-merged quads, with a half-texel inset to avoid bleeding. */
const FRAGMENT_MAP = /* glsl */ `
#ifdef WATER_SCROLL
  vec2 tileUv = fract(vTileUv + vec2(uTime * 0.04, uTime * 0.025));
#else
  vec2 tileUv = fract(vTileUv);
#endif
tileUv = clamp(tileUv, 0.5 / 16.0, 15.5 / 16.0);
vec4 sampledDiffuseColor = texture2D(map, vTileOrigin + tileUv / 16.0);
diffuseColor *= sampledDiffuseColor;
`;

/** Voxel light: sky light scaled by daylight, warm block light, ambient occlusion. */
const FRAGMENT_LIGHT = /* glsl */ `
float skyL = vLight.x * uDaylight;
float blkL = vLight.y;
float lvl = max(skyL, blkL);
float bright = max(pow(0.82, (1.0 - lvl) * 15.0), 0.035);
float occlusion = 0.45 + 0.55 * vLight.z;
vec3 tint = vec3(1.0);
if (blkL > skyL) tint = mix(vec3(1.0), vec3(1.0, 0.86, 0.66), clamp((blkL - skyL) * 1.5, 0.0, 1.0));
outgoingLight *= bright * occlusion * tint;
#include <opaque_fragment>
`;

function patch(material: THREE.MeshLambertMaterial, uniforms: ChunkUniforms, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDaylight = uniforms.uDaylight;
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', FRAGMENT_MAP)
      .replace('#include <opaque_fragment>', FRAGMENT_LIGHT);
  };
  material.customProgramCacheKey = () => `voxel-${key}`;
}

/** Materials shared by every chunk mesh and held-item mesh. */
export function createChunkMaterials(): ChunkMaterials {
  const atlas = new THREE.CanvasTexture(getAtlasCanvas());
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.flipY = false;
  atlas.colorSpace = THREE.SRGBColorSpace;

  const uniforms: ChunkUniforms = { uDaylight: { value: 1 }, uTime: { value: 0 } };

  const opaque = new THREE.MeshLambertMaterial({ map: atlas });
  patch(opaque, uniforms, 'opaque');

  const cutout = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  patch(cutout, uniforms, 'cutout');

  const translucent = new THREE.MeshLambertMaterial({ map: atlas, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide });
  translucent.defines = { WATER_SCROLL: '' };
  patch(translucent, uniforms, 'translucent');

  return {
    opaque,
    cutout,
    translucent,
    uniforms,
    atlas,
    dispose() {
      opaque.dispose();
      cutout.dispose();
      translucent.dispose();
      atlas.dispose();
    },
  };
}
