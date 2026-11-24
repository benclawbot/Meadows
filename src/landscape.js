import firstLight from '../art/first-light.json' with { type: 'json' };

export const waterHeight = -0.57;
export const groundBounds = { width: 360, depth: 312, centerZ: -88 };
export const outerGroundHeight = -1;

const channelCenter = z => 23 + 16 * Math.sin((z + 11) * 0.041) - 0.108 * z;
const channelWidth = z => 2.6 + 2.4 * (1 + Math.sin(z * 0.042 + 0.8)) + 9 * Math.max(0, (-z - 66) / 130);

export const channel = (x, z) => (x - channelCenter(z)) / channelWidth(z);

function mound(x, z, cx, cz, width, length, height) {
  return height * Math.exp(-(((x - cx) / width) ** 2 + ((z - cz) / length) ** 2));
}

function shore(x, z) {
  return 4.7 * Math.min(1, Math.max(0, (-z - 126) / 53))
    + 7 * Math.min(1, Math.max(0, (Math.abs(x) - 102) / 52, (z - 34) / 35));
}

function inlet(distance) {
  return Math.exp(-(distance ** 4) * 0.43);
}

function band(value, start, end, edge) {
  const t = Math.max(0, Math.min(1, Math.min(value - start, end - value) / edge));
  return t * t * (3 - 2 * t);
}

function canyonWalls(across, along, width, height) {
  const side = Math.sign(across);
  const bend = Math.sin(along * 0.23 + side) + Math.sin(along * 0.47 - side) * 0.42
    + Math.sin(along * 0.093 + side * 1.7) * 0.77;
  const edge = Math.abs(across) - width - bend * 1.5;
  const face = band(edge, -4.4, 22, 7.3);
  const rib = 0.055 * Math.sin(edge * 0.81 + along * 0.11 + side) + 0.069 * Math.sin(along * 0.35 - edge * 0.52);
  const crest = 0.85 + Math.sin(along * 0.154 - side) * 0.17 + Math.sin(along * 0.56) * 0.10 + rib;
  return height * crest * face;
}

const dunePhase = (x, z) => x * 0.13 - z * 0.081 + 0.56 * Math.sin(z * 0.059 + x * 0.025);

export function sandRipples(x, z) {
  return Math.sin(dunePhase(x, z) * 10.8 + 1.3 * Math.sin(x * 0.21 + z * 0.29));
}

export function groundCover(x, z) {
  const bend = Math.sin(z * 0.09) * 3.6 + Math.cos(x * 0.1) * 2.9;
  return Math.min(1, Math.max(0, 0.49 + 0.28 * Math.sin((x + bend) * 0.23 - z * 0.12)
    + 0.20 * Math.sin(x * 0.09 + z * 0.245) + 0.11 * Math.cos(x * 0.61 + z * 0.46)));
}

// Far ridges and islands have overlapping saddles and narrow, uneven crests.
function upland([x, z, width, length, height, angle = 0]) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return (px, pz) => {
    const dx = px - x, dz = pz - z;
    if (Math.abs(dx) > width + length || Math.abs(dz) > width + length) return 0;
    const v = (-dx * sin + dz * cos) / length;
    const u = (dx * cos + dz * sin) / width + Math.sin(v * 10 + angle) * 0.11;
    const footprint = Math.max(0, 1 - Math.abs(u) ** 1.57 - Math.abs(v) ** 1.85);
    if (!footprint) return 0;
    const folds = Math.sin(u * 19 + v * 8) * 0.13 + Math.sin(v * 24 - u * 16) * 0.064;
    return height * footprint ** 1.18 * (0.84 + folds + 0.18 * Math.cos(v * 6 - u * 5));
  };
}

// Soil colors run from shadow to exposed ground, with a separate shoreline color.
// Plants specify base and tip colors, density, height and width.
// Stone specifies color, size, height and length.
// Atmosphere specifies fog, cloud cover, sunlight, wind and warmth gained through play.
// Cloud profiles specify lower scale, stretch, opacity and high cloud coverage.
export const landscapes = {
  meadow: {
    name: 'meadow',
    height(x, z) {
      const rolling = 0.73 + 0.28 * Math.sin(x * 0.125 + z * 0.052)
        + 0.31 * Math.cos(z * 0.17 - x * 0.06) + 0.17 * Math.sin(x * 0.29 - z * 0.14);
      return rolling + mound(x, z, -33, -38, 17, 26, 3.9) + mound(x, z, -47, -95, 19, 29, 4.7)
        + mound(x, z, 48, -66, 16, 31, 3.4) - 2.7 * inlet(channel(x, z)) - shore(x, z);
    },
    soil: [0x2c4930, 0x668d3e, 0xa68b45, 0x9e835d],
    plants: [0x335e2f, 0xadc052, 1, 1.08, 0.82],
    seedColor: 0xc6a052,
    stone: [0x8b8c76, 0.63, 0.60, 1.15],
    water: [0x1c4a65, 0x4ba6a0],
    atmosphere: [0.0052, 0.35, 1, 0.54, 0.22],
    clouds: [1.25, 1.45, 0.69, 0.24],
    hills: [[-91, -121, 49, 37, 20, -0.36], [-68, -149, 54, 28, 21, 0.14],
      [83, -135, 40, 54, 21, -0.35], [4, -168, 32, 17, 12, 0.13], [60, -193, 41, 21, 25, -0.12]],
    outcrops: [[-27, -29, 2.7, 1.6, 1.05, 0.4], [-40, -76, 4.7, 2.8, 1.36, 0.6],
      [36, -42, 2.95, 2.1, 1.4, -0.7], [38, -46, 2.8, 1.25, 1.6, -0.5], [8, -124, 3.1, 1.8, 2.1, 0.2]],
  },
  marsh: {
    name: 'marsh',
    height(x, z) {
      const bend = 17 * Math.min(1, Math.max(0, (-z - 75) / 23));
      const creek = (x - (3 + 11 * Math.sin(z * 0.078) + bend)) / 4.1;
      const feeders = (x - (21 - 4 * Math.sin(z * 0.17) + z * 0.21)) / 1.52;
      const pools = mound(x, z, -40, -65, 7, 11, 1.25) + mound(x, z, 23, -96, 13, 13, 2.5)
        + mound(x, z, 13, -24, 6, 18, 1.4);
      return 0.43 + 0.18 * Math.sin(z * 0.21) - 1.65 * inlet(creek)
        - 1.45 * inlet(feeders) * band(z, -107, -8, 18) - pools - shore(x, z);
    },
    soil: [0x45483c, 0x6a7254, 0x8b805b, 0x655c50],
    plants: [0x535e3c, 0xb5ab69, 0.94, 1.65, 0.25],
    seedColor: 0x9d7a51,
    stone: [0x62655c, 0.28, 0.42, 1.1],
    water: [0x445f59, 0x899e91],
    atmosphere: [0.013, 0.81, 0.15, 0.34, 0],
    clouds: [1.3, 3.8, 0.82, 0.48],
    hills: [[-83, -82, 33, 34, 10, 0.13], [-60, -124, 47, 27, 12, -0.42],
      [69, -151, 68, 26, 15, -0.25]],
    outcrops: [[-35, -31, 2.1, 0.63, 1.72, 0.6], [8, -68, 1.35, 0.65, 1.8, -0.2],
      [-39, -95, 2.73, 0.71, 1.45, -0.1]],
  },
  coast: {
    name: 'coast',
    height(x, z) {
      const banks = 0.94 + 0.22 * Math.sin(z * 0.62 + x * 0.19)
        + mound(x, z, 50, -60, 17, 36, 2.8);
      const across = x - channelCenter(z);
      const cliffs = canyonWalls(across, z, 9.2, 13.6) * band(z, -91, -26, 19);
      return banks - 2.5 * inlet(across / channelWidth(z) * 0.90) - shore(x, z) + cliffs;
    },
    soil: [0x71776f, 0xaaa28b, 0xc7b48d, 0xcabe9e],
    plants: [0x697854, 0xbab284, 0.25, 0.64, 0.96],
    seedColor: 0xc5a58d,
    stone: [0x7a8587, 1.45, 0.32, 1.58],
    water: [0x286d83, 0x88b7bf],
    atmosphere: [0.0081, 0.45, 0.64, 1.75, 0.2],
    clouds: [1.45, 1.95, 0.73, 0.63],
    hills: [[-70, -88, 39, 35, 20, 0.56], [68, -113, 26, 40, 34, 0.32],
      [40, -150, 46, 18, 21, -0.35]],
    outcrops: [[-38, -54, 4.2, 6.7, 2.3, 0.3], [58, -78, 4.8, 12.5, 3.56, -0.45],
      [2, -128, 4.4, 7.3, 5.2, 0.56], [-15, -152, 5.6, 18, 4.8, -0.3],
      [-26, -143, 3.7, 12.3, 3.9, -0.6], [-36, -157, 2.8, 8.8, 3.2, -0.2]],
  },
  heath: {
    name: 'heath',
    height(x, z) {
      const crest = (x + 21 + 6 * Math.sin(z * 0.079)) / 8.4;
      return 0.92 + 5.5 * Math.exp(-(crest ** 2)) * Math.exp(-(((z + 65) / 54) ** 2))
        + mound(x, z, 27, -74, 17, 30, 4.85) + mound(x, z, -40, -118, 19, 21, 5.7)
        + 0.6 * Math.sin(x * 0.19 + z * 0.13) + 0.22 * Math.sin(x * 0.59 - z * 0.37);
    },
    soil: [0x463941, 0x75536e, 0xa17786, 0x64504b],
    plants: [0x634762, 0xc887af, 0.73, 0.73, 1.02],
    seedColor: 0xb6759b,
    stone: [0x807582, 0.85, 0.72, 1.08],
    water: null,
    atmosphere: [0.012, 0.96, 0.10, 1.45, 0],
    clouds: [1.6, 2.6, 0.94, 0.76],
    hills: [[-64, -132, 36, 41, 23, -0.58], [-12, -159, 53, 25, 15, 0.14],
      [92, -141, 54, 54, 24, -0.34]],
    outcrops: [[-37, -48, 3.5, 3.6, 1.75, 0.5], [-34, -54, 2.5, 2.35, 2.5, 0.3],
      [-40, -60, 3.9, 4.45, 2.2, 0.3], [24, -84, 4.12, 4.2, 2.5, -0.7],
      [20, -110, 5.1, 2.15, 2.75, 0.5]],
  },
  alpine: {
    name: 'alpine',
    height(x, z) {
      const ridge = 1 - Math.abs(Math.sin((x + z * 0.18 + 4 * Math.sin(z * 0.068)) * 0.13));
      return 1.05 + ridge ** 2.4 * 3.9
        + mound(x, z, -39, -47, 12, 30, 8) + mound(x, z, 38, -92, 17, 27, 8)
        + canyonWalls(x + 6 + 5 * Math.sin(z * 0.067), z, 17, 15) * band(z, -131, -67, 19);
    },
    soil: [0x7d8d9b, 0xc1cbd3, 0xf1f2ee, 0x99adbb],
    plants: [0x65777c, 0xb9ccd5, 0.12, 0.48, 0.95],
    seedColor: 0xc2c4bf,
    stone: [0x7d8a9b, 1.75, 0.92, 1.24],
    water: null,
    atmosphere: [0.0075, 0.61, 0.50, 0.83, 0],
    clouds: [1.65, 2.35, 0.71, 0.60],
    hills: [[-56, -83, 26, 36, 35, 0.4], [-101, -125, 46, 44, 53, 0.19],
      [-64, -156, 41, 44, 64, -0.38], [18, -174, 47, 31, 59, -0.27],
      [54, -166, 38, 32, 51, 0.64], [84, -115, 42, 48, 51, 0.21]],
    outcrops: [[-35, -68, 4.4, 5.5, 2.5, 0.21], [14, -82, 3.45, 4.75, 2.7, -0.6],
      [-33, -107, 5, 7.52, 4.2, 0.5], [13, -111, 3.5, 3.36, 1.8, -0.4]],
  },
  dunes: {
    name: 'dunes',
    height(x, z) {
      const ripple = Math.sin(x * 0.29 + z * 0.115 + 0.8 * Math.sin(z * 0.083));
      const ridge = Math.sin(dunePhase(x, z));
      const cut = z + 103 + 11 * Math.sin((x + 30) * 0.087);
      const slot = canyonWalls(cut, x, 7.1, 10.4) * band(x, -41, 14, 15);
      return 0.95 + 4.9 * (0.5 + 0.5 * ridge) ** 2.5 + ripple * 0.52 - shore(x, z) + slot;
    },
    soil: [0x9f6d4d, 0xc79a65, 0xe3bd7d, 0xc99866],
    plants: [0x8d754b, 0xd6bb89, 0.22, 0.91, 0.92],
    seedColor: 0xc49d68,
    stone: [0xab8569, 0.42, 0.48, 1.3],
    water: [0x556c83, 0xb49188],
    atmosphere: [0.0089, 0.4, 0.83, 1.32, 0.45],
    clouds: [1.3, 3.65, 0.51, 0.82],
    hills: [[-64, -97, 30, 62, 25, -0.30], [-49, -149, 46, 35, 26, -0.37],
      [27, -146, 24, 22, 19, 0.19], [84, -156, 48, 32, 21, -0.18]],
    outcrops: [[-39, -79, 4.75, 3.9, 1.7, 0.54], [-35, -119, 4.0, 4.4, 2.5, 0.34],
      [-4, -128, 3.6, 5.4, 2.55, -0.6], [28, -125, 3.5, 3.92, 2.7, 0.24]],
  },
  lagoon: {
    name: 'lagoon',
    height(x, z) {
      const pool = mound(x, z, -7.5, -66, 10, 14, 3.4) + mound(x, z, 30, -96, 9, 17, 2.9)
        + mound(x, z, -34, -42, 10, 13, 2.8);
      const inletBend = (x - (22 - 4.1 * Math.sin(z * 0.094))) / 4;
      return 1.1 + 0.29 * Math.sin(x * 0.33 + z * 0.19) - pool - shore(x, z)
        - 3.1 * inlet(inletBend) * band(z, -124, -12, 21);
    },
    soil: [0x223345, 0x374a58, 0x536370, 0x495d72],
    plants: [0x42657d, 0x8fb2cc, 0.61, 0.89, 0.46],
    seedColor: 0x8c9cad,
    stone: [0x53677c, 1.28, 0.56, 1.25],
    water: [0x17305b, 0x42608e],
    atmosphere: [0.0084, 0.25, 1, 0.37, 0],
    clouds: [1.22, 2.85, 0.55, 0.36],
    hills: [[-55, -115, 27, 37, 15, 0.26], [-13, -150, 52, 22, 16, -0.15],
      [60, -141, 41, 31, 24, 0.51], [36, -194, 39, 28, 24, -0.52]],
    outcrops: [[-25, -26, 4.1, 1.28, 2.9, 0.57], [23, -59, 2.8, 2.9, 1.95, -0.35],
      [-37, -102, 6.1, 3.3, 2.1, -0.7], [15, -120, 3.6, 1.75, 1.7, 0.4]],
  },
};

for (const landscape of Object.values(landscapes)) landscape.hills = landscape.hills.map(upland);

export function terrainDetail(x, z) {
  const { width, depth, centerZ } = groundBounds;
  const edge = Math.min(width / 2 - Math.abs(x), depth / 2 - Math.abs(z - centerZ));
  const t = Math.max(0, Math.min(1, edge / 20));
  return t * t * (3 - 2 * t);
}

export function uneditedTerrain(x, z, landscape = landscapes.meadow) {
  const detail = terrainDetail(x, z);
  if (detail === 0) return outerGroundHeight;
  let hills = 0;
  for (const height of landscape.hills ?? []) hills = Math.max(hills, height(x, z));
  const height = landscape.height(x, z) + hills;
  return outerGroundHeight + (height - outerGroundHeight) * detail;
}

function containingSpan(axis, value) {
  let low = 0, high = axis.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (axis[mid] <= value) low = mid;
    else high = mid;
  }
  return low;
}

export function terrain(x, z, landscape = landscapes.meadow) {
  if (landscape !== landscapes.meadow) return uneditedTerrain(x, z, landscape);
  const { x: columns, z: rows, mm } = firstLight;
  if (x < columns[0] || x > columns.at(-1) || z < rows[0] || z > rows.at(-1)) return outerGroundHeight;
  const column = containingSpan(columns, x), row = containingSpan(rows, z);
  const u = (x - columns[column]) / (columns[column + 1] - columns[column]);
  const v = (z - rows[row]) / (rows[row + 1] - rows[row]);
  const i = row * columns.length + column;
  const a = mm[i], b = mm[i + 1], c = mm[i + columns.length], d = mm[i + columns.length + 1];
  // The collision surface uses the same diagonal as Blender's two triangles.
  const height = u + v <= 1
    ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  return height / 1000;
}

export function flightSurface(x, z, landscape = landscapes.meadow) {
  const height = terrain(x, z, landscape);
  return landscape.water ? Math.max(waterHeight + 0.3, height) : height;
}
