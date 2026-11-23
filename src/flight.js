export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const smooth = (from, to, dt, rate) => from + (to - from) * (1 - Math.exp(-rate * dt));
const radians = Math.PI / 180;
const upperAir = 42;

export function randomFrom(seed) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function channel(x, z) {
  const center = 23 + 16 * Math.sin((z + 11) * 0.041) - 0.108 * z;
  const width = 2.6 + 2.4 * (1 + Math.sin(z * 0.042 + 0.8)) + 9 * Math.max(0, (-z - 66) / 130);
  return (x - center) / width;
}

function mound(x, z, cx, cz, width, length, height) {
  return height * Math.exp(-(((x - cx) / width) ** 2 + ((z - cz) / length) ** 2));
}

export function terrain(x, z) {
  const hills = 0.73 + 0.28 * Math.sin(x * 0.125 + z * 0.052)
    + 0.31 * Math.cos(z * 0.17 - x * 0.06)
    + 0.17 * Math.sin(x * 0.29 - z * 0.14);
  const dunes = mound(x, z, -35, -38, 19, 27, 4.2)
    + mound(x, z, -68, -140, 40, 38, 10.5)
    + mound(x, z, 57, -85, 25, 38, 3.8)
    + mound(x, z, -16, -125, 23, 25, 3.0)
    + mound(x, z, 99, -183, 87, 40, 11.0);
  const inlet = 2.7 * Math.exp(-(channel(x, z) ** 4) * 0.43);
  const sea = 4.7 * clamp((-z - 126) / 53, 0, 1);
  const outerShore = 7.0 * Math.max(clamp((Math.abs(x) - 102) / 52, 0, 1), clamp((z - 34) / 35, 0, 1));
  return hills + dunes - inlet - sea - outerShore;
}

const gold = { color: 0xf7b437, voice: 'harp' };
const coral = { color: 0xf67365, voice: 'piano' };
const cream = { color: 0xffedd4, voice: 'piano' };
const lavender = { color: 0xc5afea, voice: 'flute' };
const blue = { color: 0xa7c4ef, voice: 'flute' };
const rose = { color: 0xde5089, voice: 'piano' };
const patches = [
  { x: -3, z: -13, name: 'The shallows', palette: [gold, coral, cream, lavender], start: [1, 2], end: [-8, -27] },
  { x: -24, z: -45, name: 'The reed banks', palette: [coral, cream, blue, gold, rose], start: [-12, -29], end: [-20, -61] },
  { x: 3, z: -83, name: 'The tidal flats', palette: [lavender, gold, blue, rose, cream], start: [-14, -64], end: [12, -102] },
];

export function makeMeadow() {
  const rng = randomFrom(8129);
  const flowers = [];
  const glades = patches.map((patch, id) => {
    const [sx, sz] = patch.start;
    const [ex, ez] = patch.end;
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const x = sx + (ex - sx) * t + Math.sin(t * Math.PI * 2) * (id === 1 ? -8 : 3.4);
      const z = sz + (ez - sz) * t;
      const offset = i === 0 ? 0 : (rng() - 0.5) * 1.7;
      const kind = patch.palette[i % patch.palette.length];
      flowers.push({ x: x + offset, z, glade: id, tone: i, growth: 0, bloomed: false, ...kind });
      if (i > 1) {
        const side = i % 2 === 0 ? -1 : 1;
        flowers.push({
          x: x + side * (2.2 + rng() * 3), z: z + (rng() - 0.5) * 2.1,
          glade: id, tone: i + 1, growth: 0, bloomed: false,
          ...patch.palette[(i + 2) % patch.palette.length],
        });
      }
    }
    return { ...patch, count: 0, lit: false, glow: 0 };
  });
  return { flowers, glades };
}

export function newFlight() {
  return { x: 0, z: 10, height: 1.37, heading: -0.05, steer: 0, rise: 0, speed: 3.65 };
}

export function curve(value, dead = 0.09) {
  const amount = clamp((Math.abs(value) - dead) / (1 - dead), 0, 1);
  return Math.sign(value) * (amount * 0.67 + amount * amount * 0.33);
}

export function tiltControl(reference, reading, angle) {
  // Gravity projected into screen axes gives stable tilt even if the player changes compass heading.
  const gravity = ([beta, gamma]) => [
    Math.sin(gamma * radians) * Math.cos(beta * radians), -Math.sin(beta * radians),
  ];
  const [x0, y0] = gravity(reference);
  const [x, y] = gravity(reading);
  const cos = Math.cos(angle * radians);
  const sin = Math.sin(angle * radians);
  const dx = x - x0;
  const dy = y - y0;
  return [curve((dx * cos + dy * sin) / 0.24, 0.085), curve((dx * sin - dy * cos) / 0.22, 0.085)];
}

export function stepFlight(flight, controls, dt) {
  flight.steer = smooth(flight.steer, controls.x, dt, 5);
  flight.rise = smooth(flight.rise, controls.y, dt, 4.5);
  flight.speed = smooth(flight.speed, controls.gust ? 7.3 : 3.65, dt, 1.95);
  flight.heading += flight.steer * dt * 1.18;
  const vertical = Math.sign(flight.rise) * Math.abs(flight.rise) ** 1.4;
  const climbRate = 5.9 * clamp((upperAir - flight.height) / 9, 0, 1);
  const verticalSpeed = vertical * (vertical > 0 ? climbRate : 6.4);
  flight.height = clamp(flight.height + verticalSpeed * dt, 1.02, upperAir);
  if (Math.abs(flight.rise) < 0.05 && flight.height < 2.9) flight.height = smooth(flight.height, 1.46, dt, 0.34);

  const outside = Math.max(Math.abs(flight.x) - 38, flight.z - 15, -118 - flight.z);
  if (outside > 0) {
    const inward = Math.atan2(-flight.x * 0.65, flight.z + 52);
    const difference = Math.atan2(Math.sin(inward - flight.heading), Math.cos(inward - flight.heading));
    flight.heading += difference * dt * clamp(outside * 0.18, 0.18, 1.8);
  }
  flight.x += Math.sin(flight.heading) * flight.speed * dt;
  flight.z -= Math.cos(flight.heading) * flight.speed * dt;
}

export function nearbyBloomTurn(meadow, flight) {
  let best = 1.8;
  let turn = 0;
  for (const flower of meadow.flowers) {
    if (flower.bloomed) continue;
    const dx = flower.x - flight.x, dz = flower.z - flight.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1.5 || distance > 9.5) continue;
    const angle = Math.atan2(dx, -dz) - flight.heading;
    const offset = Math.atan2(Math.sin(angle), Math.cos(angle));
    if (Math.abs(offset) > 0.49) continue;
    const effort = Math.abs(offset) * 1.4 + distance / 9.5;
    if (effort < best) {
      best = effort;
      turn = clamp(offset * 1.08, -0.26, 0.26);
    }
  }
  return turn;
}

export class FlightPath {
  points = [];
  tip = null;

  add(x, y, z) {
    const previous = this.tip;
    const distance = previous
      ? previous.distance + Math.hypot(x - previous.x, y - previous.y, z - previous.z)
      : 0;
    this.tip = { x, y, z, distance };
    if (!this.points.length || distance - this.points[0].distance >= 0.13) {
      this.points.unshift(this.tip);
      if (this.points.length > 228) this.points.pop();
    }
  }

  sample(behind, out) {
    if (!this.tip) return false;
    const wanted = this.tip.distance - behind;
    if (wanted < this.points.at(-1).distance) return false;
    let low = 0, high = this.points.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.points[mid].distance > wanted) low = mid + 1;
      else high = mid;
    }
    const past = this.points[low];
    const newer = low > 0 ? this.points[low - 1] : this.tip;
    const t = (wanted - past.distance) / Math.max(0.0001, newer.distance - past.distance);
    out.x = past.x + (newer.x - past.x) * t;
    out.y = past.y + (newer.y - past.y) * t;
    out.z = past.z + (newer.z - past.z) * t;
    const ahead = low > 2 ? this.points[low - 3] : this.tip;
    const behindPoint = this.points[Math.min(this.points.length - 1, low + 3)];
    const dx = ahead.x - behindPoint.x, dz = ahead.z - behindPoint.z;
    out.heading = Math.atan2(dx, -dz);
    out.pitch = Math.atan2(ahead.y - behindPoint.y, Math.hypot(dx, dz));
    return true;
  }
}

export function collectBlooms(meadow, flight, previousX, previousZ) {
  if (flight.height > 2.85) return [];
  const dx = flight.x - previousX;
  const dz = flight.z - previousZ;
  const lengthSquared = dx * dx + dz * dz;
  const hits = [];
  for (const flower of meadow.flowers) {
    if (flower.bloomed) continue;
    const offsetX = flower.x - previousX;
    const offsetZ = flower.z - previousZ;
    const along = lengthSquared
      ? clamp((offsetX * dx + offsetZ * dz) / lengthSquared, 0, 1)
      : 0;
    const distance = Math.hypot(offsetX - dx * along, offsetZ - dz * along);
    if (distance <= 1.76) hits.push({ flower, along });
  }
  return hits.sort((a, b) => a.along - b.along).map(({ flower }) => {
    flower.bloomed = true;
    const glade = meadow.glades[flower.glade];
    glade.count++;
    const completed = glade.count === 7;
    glade.lit ||= completed;
    return { flower, completed };
  });
}
