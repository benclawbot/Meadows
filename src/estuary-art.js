import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import models from '../art/first-light.glb';
import sky from '../art/blender-sky.jpg';

export async function loadEstuaryArt() {
  const url = URL.createObjectURL(new Blob([sky], { type: 'image/jpeg' }));
  try {
    const [kit, panorama] = await Promise.all([
      new GLTFLoader().parseAsync(models.buffer.slice(models.byteOffset, models.byteOffset + models.byteLength), ''),
      new THREE.TextureLoader().loadAsync(url),
    ]);
    panorama.colorSpace = THREE.SRGBColorSpace;
    panorama.wrapS = THREE.RepeatWrapping;
    kit.scene.updateMatrixWorld(true);
    return {
      panorama,
      ground: kit.scene.getObjectByName('FirstLightTerrain'),
      grass: kit.scene.getObjectByName('FescueTuft').geometry,
      petal: kit.scene.getObjectByName('WildflowerPetal').geometry,
      landmarks: kit.scene.children.filter(node => node.name.startsWith('Estuary')),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function makeEstuaryLandmarks(art, clock, mobile) {
  const groups = new Map();
  let reedNumber = 0;
  for (const source of art.landmarks) {
    if (mobile && source.name.startsWith('EstuaryReeds') && reedNumber++ % 3 === 0) continue;
    const sources = groups.get(source.geometry) ?? [];
    sources.push(source);
    groups.set(source.geometry, sources);
  }
  return Array.from(groups, ([geometry, sources]) => {
    const name = sources[0].name;
    const material = sources[0].material.clone();
    if (name.startsWith('EstuaryReeds') || name.startsWith('EstuaryPine')) {
      const strength = name.startsWith('EstuaryReeds') ? 0.055 : 0.0024;
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
    const mesh = new THREE.InstancedMesh(geometry.clone(), material, sources.length);
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
