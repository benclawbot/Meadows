import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import models from '../art/first-light.glb';
import sky from '../art/blender-sky.jpg';
import tide from '../art/tidal-normals.png';
import riverbed from '../art/riverbed.jpg';
import shore from '../art/shore-sand.jpg';
import bark from '../art/pine-bark.jpg';
import barkNormals from '../art/pine-normal.jpg';
import blade from '../art/blade.jpg';

async function loadTexture(bytes, type = 'image/jpeg', colorSpace = THREE.SRGBColorSpace) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const map = await new THREE.TextureLoader().loadAsync(url);
    map.colorSpace = colorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
    return map;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadEstuaryArt() {
  const [kit, panorama, ripples, pebbles, sand, branches, branchNormals, leaf] = await Promise.all([
    new GLTFLoader().parseAsync(models.buffer.slice(models.byteOffset, models.byteOffset + models.byteLength), ''),
    loadTexture(sky), loadTexture(tide, 'image/png', THREE.NoColorSpace),
    loadTexture(riverbed), loadTexture(shore), loadTexture(bark),
    loadTexture(barkNormals, 'image/jpeg', THREE.NoColorSpace), loadTexture(blade),
  ]);
  panorama.wrapT = THREE.ClampToEdgeWrapping;
  branches.flipY = branchNormals.flipY = leaf.flipY = false;
  kit.scene.updateMatrixWorld(true);
  return {
    panorama, ripples, pebbles, sand, branches, branchNormals, leaf,
    ground: kit.scene.getObjectByName('FirstLightTerrain'),
    grass: kit.scene.getObjectByName('FescueTuft').geometry,
    petal: kit.scene.getObjectByName('WildflowerPetal').geometry,
    boulder: kit.scene.getObjectByName('RoundedShoreRock'),
    shelf: kit.scene.getObjectByName('LayeredShoreRock'),
    landmarks: kit.scene.children.filter(node => node.name.startsWith('Estuary')),
  };
}

export function makeEstuaryLandmarks(art, clock, mobile) {
  const groups = new Map();
  let reedNumber = 0;
  for (const source of art.landmarks) {
    if (mobile && source.name.startsWith('EstuaryReeds') && reedNumber++ % 3 === 0) continue;
    const tile = `${source.geometry.id}:${Math.floor(source.position.x / 42)}:${Math.floor(source.position.z / 42)}`;
    const sources = groups.get(tile) ?? [];
    sources.push(source);
    groups.set(tile, sources);
  }
  return Array.from(groups.values(), sources => {
    const name = sources[0].name;
    const material = sources[0].material.clone();
    const reed = name.startsWith('EstuaryReeds');
    const pine = name.startsWith('EstuaryPine');
    if (pine) {
      material.map = art.branches;
      material.normalMap = art.branchNormals;
      material.normalScale.set(.56, .56);
    }
    if (reed || pine) {
      const strength = reed ? 0.055 : 0.0024;
      material.customProgramCacheKey = () => `coastal vegetation ${strength}`;
      material.onBeforeCompile = shader => {
        shader.uniforms.breezeTime = clock;
        shader.vertexShader = 'uniform float breezeTime;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec3 root = instanceMatrix[3].xyz;
          float sway = sin(root.x*.16+root.z*.12-breezeTime*.98)
            + .32*sin(root.x*.24-root.z*.16-breezeTime*1.31);
          transformed.xz += vec2(.82,.57)*sway*position.y*position.y*${strength};
        `);
      };
    }
    const mesh = new THREE.InstancedMesh(sources[0].geometry.clone(), material, sources.length);
    sources.forEach((source, i) => mesh.setMatrixAt(i, source.matrixWorld));
    mesh.computeBoundingSphere();
    return mesh;
  });
}

export const estuarySkyGLSL = `
  uniform sampler2D estuaryPanorama;
  uniform float authoredSky;
  vec3 estuarySkyAt(vec3 ray) {
    vec2 uv = vec2(atan(ray.z,ray.x)*.159155+.5+.520,
                   asin(clamp(ray.y,-1.,1.))*.318310+.5-.032);
    vec3 color = texture2D(estuaryPanorama,uv).rgb;
    float grey = dot(color,vec3(.2126,.7152,.0722));
    return max(vec3(0.), mix(vec3(grey),color,1.37));
  }
`;
