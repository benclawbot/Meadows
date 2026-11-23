import { clamp, flightSurface, makeMeadow, newFlight } from './flight.js';

export const levels = [
  {
    title: 'First Light',
    goal: 'Wake seven flowers in the shallows.',
    finish: 'The shallows are awake.',
    haze: 0xa4b2ab, sky: 0x6396a1, light: 0xffe4ab, ringColor: 0xffebba,
    groups: [{ label: 'Shallows blooms', glade: 0, count: 7 }],
  },
  {
    title: 'Reedbank Waltz',
    goal: 'Open four flowers in each of the three reed beds.',
    finish: 'The reed beds are singing together.',
    start: [-13, -12, 1.4, -0.18],
    haze: 0xadb39b, sky: 0x86a78b, light: 0xffe5bb, ringColor: 0xf1d799,
    routes: [
      ['Low reeds', [-15, -19], [-27, -40], 3],
      ['Long reeds', [-29, -44], [-25, -67], -4],
      ['Silver reeds', [-23, -73], [-12, -93], 4],
    ],
    groups: [
      { label: 'Low reeds', glade: 0, count: 4 },
      { label: 'Long reeds', glade: 1, count: 4 },
      { label: 'Silver reeds', glade: 2, count: 4 },
    ],
  },
  {
    title: 'Tideglass',
    goal: 'Follow five low wind rings along the tidal channel.',
    finish: 'You followed the tide to open water.',
    start: [17, -19, 2.5, -0.22],
    haze: 0x9dbac0, sky: 0x548ca9, light: 0xe2f6ff, ringColor: 0xc5f3f7,
    routes: [
      ['High bank', [24, -29], [21, -54], 1],
      ['Creek edge', [6, -56], [14, -74], -2],
      ['River mouth', [17, -81], [24, -104], 2],
    ],
    rings: [[15, -30, 2.6], [12, -47, 3], [15, -62, 2.7], [23, -74, 2.8], [33, -88, 3.3]],
  },
  {
    title: 'A Basket of Color',
    goal: 'Gather two gold, two lavender, and two blue blooms.',
    finish: 'Gold, lavender, and blue share the ribbon.',
    start: [-8, -26, 1.45, -0.22],
    haze: 0xc5b5bc, sky: 0x8d92ba, light: 0xffe4e2, ringColor: 0xf7d9ed,
    routes: [
      ['Gold rise', [-10, -33], [-23, -50], -2],
      ['Heather bend', [-23, -54], [-15, -74], 5],
      ['Blue hollow', [-12, -77], [7, -96], -4],
    ],
    groups: [
      { label: 'Gold', kind: 'gold', count: 2 },
      { label: 'Lavender', kind: 'lavender', count: 2 },
      { label: 'Blue', kind: 'blue', count: 2 },
    ],
  },
  {
    title: 'The Long Exhale',
    goal: 'Climb through three wind rings, then glide down through two.',
    finish: 'The wind has carried you back down to the meadow.',
    start: [-21, -27, 3.4, -0.35],
    haze: 0xb0bcd0, sky: 0x678bbf, light: 0xe9eeff, ringColor: 0xe1e9ff,
    routes: [
      ['Dune foot', [-20, -34], [-31, -44], 2],
      ['Western slope', [-32, -52], [-22, -67], 3],
      ['Shelter', [-15, -76], [-4, -92], -2],
    ],
    rings: [[-24, -36, 7], [-30, -48, 13], [-26, -60, 19], [-17, -73, 13], [-10, -87, 6]],
  },
  {
    title: 'Last Light',
    goal: 'Wake three flowers in each glade, then follow three rings toward the sea.',
    finish: 'All six flights are complete. The coast is yours to drift.',
    start: [6, -30, 1.45, -0.22],
    haze: 0xd0afa1, sky: 0x8c899f, light: 0xffcea3, ringColor: 0xffdaa0,
    routes: [
      ['Evening grass', [4, -37], [-5, -55], 2],
      ['Amber hollow', [-5, -58], [4, -76], -3],
      ['Salt edge', [5, -78], [12, -95], 2],
    ],
    groups: [
      { label: 'Evening grass', glade: 0, count: 3 },
      { label: 'Amber hollow', glade: 1, count: 3 },
      { label: 'Salt edge', glade: 2, count: 3 },
    ],
    rings: [[13, -98, 4.2], [21, -107, 5.7], [30, -115, 7]],
  },
];

export function beginLevel(index) {
  const level = levels[index];
  const flight = newFlight();
  if (level.start) {
    [flight.x, flight.z, flight.height, flight.heading] = level.start;
  }
  const rings = (level.rings ?? []).map(([x, z, height], i, route) => {
    const [fromX, fromZ] = i ? route[i - 1] : [flight.x, flight.z];
    return {
      x, y: flightSurface(x, z) + height, z,
      heading: Math.atan2(x - fromX, z - fromZ),
      radius: height >= 6 ? 3.1 : 2.65,
    };
  });
  return {
    level, flight, meadow: makeMeadow(level.routes), rings,
    groups: (level.groups ?? []).map(group => ({ ...group, progress: 0 })),
    passed: 0,
  };
}

function matches(group, flower) {
  return group.kind ? group.kind === flower.kind : group.glade === flower.glade;
}

export function bloomObjective(journey, flower) {
  const group = journey.groups.find(item => item.progress < item.count && matches(item, flower));
  if (group) {
    group.progress++;
    if (group.glade !== undefined && group.progress === group.count) {
      journey.meadow.glades[group.glade].lit = true;
    }
  }
  return Boolean(group);
}

export function nextRing(journey) {
  if (journey.groups.every(group => group.progress === group.count)) return journey.rings[journey.passed];
}

export function crossRing(journey, from, to) {
  const ring = nextRing(journey);
  if (!ring) return;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const rx = ring.x - from.x, ry = ring.y - from.y, rz = ring.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const along = lengthSquared ? clamp((dx * rx + dy * ry + dz * rz) / lengthSquared, 0, 1) : 0;
  if (Math.hypot(rx - dx * along, ry - dy * along, rz - dz * along) > ring.radius) return;
  journey.passed++;
  return ring;
}

export function journeyProgress(journey) {
  const done = journey.groups.reduce((sum, group) => sum + group.progress, journey.passed);
  const total = journey.groups.reduce((sum, group) => sum + group.count, journey.rings.length);
  return done / total;
}

export function journeyTarget(journey) {
  const ring = nextRing(journey);
  if (ring) return ring;
  const group = journey.groups.find(item => item.progress < item.count);
  if (!group) return;
  const { x, z } = journey.flight;
  let target, distance = Infinity;
  for (const flower of journey.meadow.flowers) {
    if (flower.bloomed || !matches(group, flower)) continue;
    const nearby = (flower.x - x) ** 2 + (flower.z - z) ** 2;
    if (nearby >= distance) continue;
    distance = nearby;
    target = flower;
  }
  return target;
}
