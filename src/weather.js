import * as THREE from 'three';
import { randomFrom } from './flight.js';
import { terrain, waterHeight } from './landscape.js';

export const weatherByLandscape = {
  heath: { color: 0xdce5ee, count: 530, speed: 13, drift: 3.3, streak: 0.34, opacity: 0.29 },
  alpine: { color: 0xffffff, count: 580, speed: 1.65, drift: 0.91, size: 0.17, opacity: 0.79 },
  dunes: { color: 0xebc48a, count: 310, speed: 0.21, drift: 4.6, size: 0.10, opacity: 0.45 },
  coast: { color: 0xe0f4f4, count: 250, speed: 0.64, drift: 4.9, size: 0.12, opacity: 0.50 },
};

export function makeWeather(profile, landscape, dot, mobile, reduced) {
  if (!profile || reduced) return;
  const rng = randomFrom(48701);
  const count = Math.floor(profile.count * (mobile ? 0.67 : 1));
  const particles = Array.from({ length: count }, () => [rng() * 46, rng() * 21, rng() * 46, rng()]);
  const stride = profile.streak ? 6 : 3;
  const geometry = new THREE.BufferGeometry();
  const points = new THREE.BufferAttribute(new Float32Array(count * stride), 3);
  points.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', points);
  const options = { color: profile.color, transparent: true, opacity: profile.opacity, depthWrite: false };
  const mesh = profile.streak
    ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial(options))
    : new THREE.Points(geometry, new THREE.PointsMaterial({ ...options, map: dot, size: profile.size }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const wrap = (value, range) => ((value % range) + range) % range;
  return {
    mesh,
    draw(camera, time) {
      const { x: cx, y: cy, z: cz } = camera.position;
      for (let i = 0; i < count; i++) {
        const [ox, oy, oz, phase] = particles[i];
        const x = cx + wrap(ox + time * profile.drift - cx, 46) - 23;
        const z = cz + wrap(oz + time * profile.drift * 0.32 - cz, 46) - 32;
        const y = cy + wrap(oy - time * profile.speed * (0.72 + phase * 0.46) - cy, 21) - 7;
        const ground = terrain(x, z, landscape);
        const floor = landscape.water ? Math.max(waterHeight, ground) : ground;
        const height = y > floor + 0.08 ? y : -100;
        points.setXYZ(i * stride / 3, x, height, z);
        if (profile.streak) points.setXYZ(i * 2 + 1, x - 0.11, height + profile.streak, z - 0.04);
      }
      points.needsUpdate = true;
    },
  };
}
