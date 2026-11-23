export const waterHeight = -0.57;

export function channel(x, z) {
  const center = 23 + 16 * Math.sin((z + 11) * 0.041) - 0.108 * z;
  const width = 2.6 + 2.4 * (1 + Math.sin(z * 0.042 + 0.8)) + 9 * Math.max(0, (-z - 66) / 130);
  return (x - center) / width;
}

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

// Soil colors run from shadow to exposed ground, with a separate shoreline color.
// Plants specify base and tip colors, density, height and width.
// Stone specifies color, size, height and length.
// Atmosphere specifies fog, cloud cover, sunlight, wind and warmth gained through play.
export const landscapes = {
  meadow: {
    name: 'meadow',
    height(x, z) {
      const rolling = 0.73 + 0.28 * Math.sin(x * 0.125 + z * 0.052)
        + 0.31 * Math.cos(z * 0.17 - x * 0.06) + 0.17 * Math.sin(x * 0.29 - z * 0.14);
      return rolling + mound(x, z, -35, -38, 19, 27, 3.2)
        + mound(x, z, 57, -85, 25, 38, 2.6) - 2.7 * inlet(channel(x, z)) - shore(x, z);
    },
    soil: [0x3d5a42, 0x597747, 0x9c9b60, 0xb4a47d],
    plants: [0x42663b, 0xb3c56d, 1, 0.86, 0.69],
    stone: [0x8a9890, 0.8, 0.6, 1.0],
    water: [0x408a90, 0x8db3ac],
    atmosphere: [0.009, 0.25, 1, 0.6, 0.3],
  },
  marsh: {
    name: 'marsh',
    height(x, z) {
      const bend = 17 * Math.min(1, Math.max(0, (-z - 75) / 23));
      const creek = (x - (3 + 11 * Math.sin(z * 0.078) + bend)) / 4.1;
      const pools = mound(x, z, -40, -65, 7, 11, 1.25) + mound(x, z, 23, -96, 13, 13, 2.5);
      return 0.43 + 0.18 * Math.sin(z * 0.21) - 1.65 * inlet(creek) - pools - shore(x, z);
    },
    soil: [0x45483c, 0x6a7254, 0x8b805b, 0x655c50],
    plants: [0x535e3c, 0xb5ab69, 0.94, 1.65, 0.25],
    stone: [0x62655c, 0.28, 0.42, 1.1],
    water: [0x445f59, 0x899e91],
    atmosphere: [0.018, 0.74, 0.08, 0.34, 0],
  },
  coast: {
    name: 'coast',
    height(x, z) {
      const banks = 0.94 + 0.22 * Math.sin(z * 0.62 + x * 0.19)
        + mound(x, z, 50, -60, 17, 36, 2.8);
      return banks - 2.5 * inlet(channel(x, z) * 0.90) - shore(x, z);
    },
    soil: [0x71776f, 0xaaa28b, 0xc7b48d, 0xcabe9e],
    plants: [0x697854, 0xa6a376, 0.16, 0.36, 1.25],
    stone: [0x7a8587, 1.45, 0.32, 1.58],
    water: [0x286d83, 0x88b7bf],
    atmosphere: [0.011, 0.58, 0.26, 1.75, 0.2],
  },
  heath: {
    name: 'heath',
    height(x, z) {
      const crest = (x + 21 + 6 * Math.sin(z * 0.079)) / 8.4;
      return 0.92 + 5.5 * Math.exp(-(crest ** 2)) * Math.exp(-(((z + 65) / 54) ** 2))
        + 0.6 * Math.sin(x * 0.19 + z * 0.13) + 0.22 * Math.sin(x * 0.59 - z * 0.37);
    },
    soil: [0x463941, 0x75536e, 0xa17786, 0x64504b],
    plants: [0x644960, 0xce98b4, 0.53, 0.5, 0.6],
    stone: [0x807582, 0.85, 0.72, 1.08],
    water: null,
    atmosphere: [0.014, 0.96, 0, 1.45, 0],
  },
  alpine: {
    name: 'alpine',
    height(x, z) {
      const ridge = 1 - Math.abs(Math.sin((x + z * 0.29) * 0.13));
      return 1.4 + ridge ** 2.4 * 4.2
        + mound(x, z, -39, -47, 12, 30, 7) + mound(x, z, 38, -92, 17, 27, 5);
    },
    soil: [0x7d8d9b, 0xc1cbd3, 0xf1f2ee, 0x99adbb],
    plants: [0x717f80, 0xb9ccd5, 0.075, 0.3, 1.35],
    stone: [0x7d8a9b, 1.75, 0.92, 1.24],
    water: null,
    atmosphere: [0.013, 0.68, 0.18, 0.83, 0],
  },
  dunes: {
    name: 'dunes',
    height(x, z) {
      const ripple = Math.sin(x * 0.29 + z * 0.115 + 0.8 * Math.sin(z * 0.083));
      const ridge = Math.sin(x * 0.13 - z * 0.081);
      return 1.5 + 4.6 * (0.5 + 0.5 * ridge) ** 2.25 + ripple * 0.46 - shore(x, z);
    },
    soil: [0x9f6d4d, 0xc79a65, 0xe3bd7d, 0xc99866],
    plants: [0x8b7847, 0xcab47c, 0.11, 0.75, 0.92],
    stone: [0xab8569, 0.42, 0.48, 1.3],
    water: [0x556c83, 0xb49188],
    atmosphere: [0.012, 0.37, 0.83, 1.32, 0.45],
  },
  lagoon: {
    name: 'lagoon',
    height(x, z) {
      const pool = mound(x, z, -7.5, -66, 10, 14, 3.4) + mound(x, z, 30, -96, 9, 17, 2.9)
        + mound(x, z, -34, -42, 10, 13, 2.8);
      return 1.1 + 0.29 * Math.sin(x * 0.33 + z * 0.19) - pool - shore(x, z);
    },
    soil: [0x223345, 0x374a58, 0x536370, 0x495d72],
    plants: [0x3b5a68, 0x81a8ba, 0.45, 0.63, 0.23],
    stone: [0x53677c, 1.28, 0.56, 1.25],
    water: [0x17305b, 0x42608e],
    atmosphere: [0.009, 0.13, 1, 0.37, 0],
  },
};

export function terrain(x, z, landscape = landscapes.meadow) {
  return landscape.height(x, z);
}

export function flightSurface(x, z, landscape = landscapes.meadow) {
  const height = terrain(x, z, landscape);
  return landscape.water ? Math.max(waterHeight + 0.3, height) : height;
}
