import { clamp, gustStrength } from './flight.js';

const sampleInterval = 0.105;
const lifetime = 2.65;
const cellSize = 0.46;
const ease = t => t * t * (3 - 2 * t);
const interpolate = (a, b, t) => a + (b - a) * t;

// A small field centered on the player stores world-space bend in RG and
// flattening in B. Grass roots read it on the GPU, regardless of tuft density.
export class MeadowWake {
  constructor() {
    this.size = 156;
    this.span = this.size * cellSize;
    this.pixels = new Uint8Array(this.size * this.size * 4);
    this.clearPixels = new Uint8Array(this.pixels.length);
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.clearPixels[i] = this.clearPixels[i + 1] = 128;
    }
    this.reset();
  }

  reset() {
    this.samples = [];
    this.time = -Infinity;
    this.x = this.z = 0;
    this.pixels.set(this.clearPixels);
  }

  update(flight, clearance, time) {
    if (time <= this.time) return false;
    this.time = time;
    this.x = Math.floor((flight.x - this.span / 2) / cellSize) * cellSize;
    this.z = Math.floor((flight.z - this.span / 2) / cellSize) * cellSize;
    const point = {
      x: flight.x, z: flight.z, time, heading: flight.heading,
      speed: gustStrength(flight.speed),
      contact: ease(clamp((4.25 - clearance) / 2.75, 0, 1)),
    };
    const previous = this.samples.at(-1);
    this.pixels.set(this.clearPixels);
    for (let i = 1; i < this.samples.length; i++) {
      this.paintSegment(this.samples[i - 1], this.samples[i]);
    }
    this.paintSegment(previous ?? point, point);
    if (!previous || time - previous.time >= sampleInterval) this.samples.push(point);
    // Keep one sample before the cutoff so a fading segment is never dropped mid-stroke.
    while (this.samples.length > 1 && this.samples[1].time < time - lifetime) this.samples.shift();
    return true;
  }

  paintSegment(start, end) {
    if (!Math.max(start.contact, end.contact) || this.time - end.time > lifetime) return;
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const forwardX = length > 0.001 ? dx / length : Math.sin(end.heading);
    const forwardZ = length > 0.001 ? dz / length : -Math.cos(end.heading);
    const radius = 1.45 + Math.max(start.speed, end.speed) * 1.36
      + Math.min(lifetime, this.time - start.time) * 1.57 + 0.8;
    const minX = Math.max(0, Math.floor((Math.min(start.x, end.x) - radius - this.x) / cellSize));
    const maxX = Math.min(this.size - 1, Math.floor((Math.max(start.x, end.x) + radius - this.x) / cellSize));
    const minZ = Math.max(0, Math.floor((Math.min(start.z, end.z) - radius - this.z) / cellSize));
    const maxZ = Math.min(this.size - 1, Math.floor((Math.max(start.z, end.z) + radius - this.z) / cellSize));
    for (let row = minZ; row <= maxZ; row++) {
      const offsetZ = this.z + (row + 0.5) * cellSize - start.z;
      for (let col = minX; col <= maxX; col++) {
        const offsetX = this.x + (col + 0.5) * cellSize - start.x;
        const along = length > 0.001 ? clamp((offsetX * forwardX + offsetZ * forwardZ) / length, 0, 1) : 0;
        const lateral = -offsetX * forwardZ + offsetZ * forwardX;
        const distance = Math.hypot(offsetX - dx * along, offsetZ - dz * along);
        const age = this.time - interpolate(start.time, end.time, along);
        const speed = interpolate(start.speed, end.speed, along);
        const contact = interpolate(start.contact, end.contact, along);
        const recovery = 1 - ease(clamp((age - 0.18) / (lifetime - 0.18), 0, 1));
        const coreWidth = 1.45 + speed * 1.36;
        const core = 1 - ease(clamp((distance - coreWidth * 0.29) / coreWidth, 0, 1));
        const waveFront = coreWidth * 0.85 + age * (1.14 + speed * 0.43);
        const wave = 1 - ease(clamp(Math.abs(distance - waveFront) / (0.64 + age * 0.20), 0, 1));
        const force = Math.max(core, wave * (0.56 + speed * 0.16)) * recovery * contact * (0.75 + 0.25 * speed);
        const index = (row * this.size + col) * 4;
        const pressure = Math.round(force * 255);
        if (pressure <= this.pixels[index + 2]) continue;
        const side = clamp(lateral / 0.59, -1, 1);
        const drag = (1 - 0.70 * Math.abs(side)) * (0.32 + speed * 0.29);
        this.pixels[index] = 128 + Math.round((-forwardZ * side - forwardX * drag) * force * 121);
        this.pixels[index + 1] = 128 + Math.round((forwardX * side - forwardZ * drag) * force * 121);
        this.pixels[index + 2] = pressure;
      }
    }
  }
}

export const readWake = `
  uniform sampler2D wakeMap;
  uniform vec3 wakeBounds;
  vec3 wakeAt(vec2 worldXZ) {
    vec2 uv = (worldXZ - wakeBounds.xy) / wakeBounds.z;
    if (any(lessThanEqual(uv, vec2(0.))) || any(greaterThanEqual(uv, vec2(1.)))) return vec3(0.);
    vec3 track = texture2D(wakeMap, uv).rgb;
    vec2 edge = min(uv, 1. - uv);
    return vec3((track.rg * 255. - 128.) / 121., track.b)
      * smoothstep(0., .028, min(edge.x, edge.y));
  }
`;
