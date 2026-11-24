import { clamp, makeMeadow, newFlight } from './flight.js';
import { flightSurface, landscapes } from './landscape.js';

const bed = (label, glade, count, kind) => ({ label, glade, count, kind });
const blooms = (title, goal, ...groups) => ({ title, goal, groups });
const wind = (title, goal, ...rings) => ({ title, goal, rings });

export const levels = [
  {
    title: 'First Light',
    landscape: landscapes.meadow,
    goal: 'Wake the shallows, cross the western meadow, and bring color back to the coast.',
    finish: 'Morning has reached both sides of the meadow.',
    haze: 0x83a6b8, sky: 0x468aba, light: 0xffd299, ringColor: 0xffebba,
    legs: [
      blooms('The shallows', 'Wake nine flowers close to the grass.', bed('Blooms', 0, 9)),
      wind('Over the low hills', 'Follow the wind west, then turn back toward the tidal flats.',
        [-12, -29, 3.5], [-24, -38, 5], [-34, -52, 6], [-32, -69, 5], [-22, -86, 4], [-8, -98, 3]),
      blooms('The tidal flats', 'Wake ten flowers across the flats.', bed('Blooms', 2, 10)),
      wind('Back toward the light', 'Follow the long bend back toward your starting shore.',
        [6, -96, 4], [16, -79, 6], [19, -61, 5], [12, -43, 5], [10, -24, 4], [4, -4, 3]),
    ],
  },
  {
    title: 'Reedbank Waltz',
    landscape: landscapes.marsh,
    goal: 'Bring three reed beds into song, with sweeping turns between them.',
    finish: 'The reed beds are singing together.',
    start: [-13, -12, 1.4, -0.18],
    haze: 0xa8b3a7, sky: 0x829a98, light: 0xffe5bb, ringColor: 0xf1d799,
    routes: [
      ['Low reeds', [-15, -19], [-31, -46], 4],
      ['Long reeds', [-24, -56], [-30, -81], -5],
      ['Silver reeds', [-20, -90], [0, -112], 4],
    ],
    legs: [
      blooms('Low reeds', 'Open eight flowers along the lower bank.', bed('Blooms', 0, 8)),
      wind('The first turn', 'Sweep around the ridge and double back to the long reeds.',
        [-12, -50, 4], [2, -63, 6], [-2, -77, 6], [-16, -82, 4], [-28, -71, 3]),
      blooms('Long reeds', 'Follow the winding bank and open nine flowers.', bed('Blooms', 1, 9)),
      wind('Crosswind', 'Rise across the meadow and bend south to the silver reeds.',
        [-33, -87, 5], [-27, -103, 8], [-12, -111, 6], [4, -105, 4], [7, -91, 3]),
      blooms('Silver reeds', 'Open nine flowers to finish the waltz.', bed('Blooms', 2, 9)),
    ],
  },
  {
    title: 'Tideglass',
    landscape: landscapes.coast,
    goal: 'Follow the tidal channel downstream, wake the salt-bank flowers, and circle back upstream.',
    finish: 'The tide has carried you home.',
    start: [17, -15, 2.5, -0.22],
    haze: 0x9dbac0, sky: 0x548ca9, light: 0xe2f6ff, ringColor: 0xc5f3f7,
    routes: [
      ['High bank', [26, -26], [25, -51], 1],
      ['Creek edge', [3, -55], [10, -76], -2],
      ['Salt bank', [17, -81], [24, -111], 3],
    ],
    legs: [
      wind('Through the tidal gorge', 'Follow the channel between the cliffs toward open water.',
        [16, -24, 2.8], [13, -39, 2.8], [12, -53, 2.7], [17, -66, 3], [25, -78, 3], [34, -90, 3.4], [34, -102, 4]),
      blooms('Salt bank', 'Leave the water and wake ten flowers on the bank.', bed('Blooms', 2, 10)),
      wind('The upper current', 'Climb over the bends, then come down on the other side.',
        [13, -109, 5], [-2, -104, 7], [-12, -89, 9], [-14, -70, 9], [-7, -52, 7], [6, -39, 5], [18, -31, 3]),
      blooms('Home bank', 'Wake eight more flowers on the upper bank.', bed('Blooms', 0, 8)),
    ],
  },
  {
    title: 'A Basket of Color',
    landscape: landscapes.heath,
    goal: 'Find gold, lavender, and blue in different corners of the meadow.',
    finish: 'Gold, lavender, and blue share the ribbon.',
    start: [-8, -21, 1.45, -0.22],
    haze: 0x9d939d, sky: 0x65647a, light: 0xf0e8ff, ringColor: 0xf7d9ed,
    routes: [
      ['Gold rise', [-10, -30], [-31, -55], -3],
      ['Blue hollow', [10, -76], [25, -106], 2],
      ['Heather bend', [-12, -61], [-21, -90], 4],
    ],
    legs: [
      blooms('Gold rise', 'Collect five gold blooms. The glow marks the next one.', bed('Gold', 0, 5, 'gold')),
      wind('Over the heather', 'Take the crosswind from the gold rise to the heather.',
        [-36, -58, 5], [-28, -74, 9], [-11, -84, 8], [2, -76, 5], [-7, -64, 3]),
      blooms('Heather bend', 'Gather four lavender blooms along the bend.', bed('Lavender', 2, 4, 'lavender')),
      wind('Blue hollow', 'Follow the wide arc down to the far hollow.',
        [-26, -91, 4], [-17, -107, 7], [0, -114, 8], [16, -110, 5], [25, -99, 4]),
      blooms('Cool colors', 'Gather four blue blooms and three coral blooms in the hollow.',
        bed('Blue', 1, 4, 'blue'), bed('Coral', 1, 3, 'coral')),
    ],
  },
  {
    title: 'The Long Exhale',
    landscape: landscapes.alpine,
    goal: 'Climb to the high wind, descend into shelter, then ride a second rise.',
    finish: 'The high wind has carried you back to the foothills.',
    start: [-21, -20, 3.4, -0.35],
    haze: 0xbdcbdb, sky: 0x7894b8, light: 0xe9eeff, ringColor: 0xe1e9ff,
    routes: [
      ['Snow line', [-20, -30], [-31, -47], 2],
      ['Western ridge', [-32, -52], [-22, -67], 3],
      ['Shelter', [-14, -80], [3, -107], -3],
    ],
    legs: [
      wind('The first rise', 'Climb one ring at a time above the snowy ridge.',
        [-25, -31, 7], [-31, -44, 12], [-33, -57, 18], [-26, -71, 24], [-13, -79, 28]),
      wind('Down into shelter', 'Glide along the ridge, then descend to the sheltered glade.',
        [3, -80, 26], [16, -85, 20], [21, -100, 14], [9, -111, 8], [-5, -106, 4]),
      blooms('In the lee', 'Wake eight sheltered blooms close to the grass.', bed('Blooms', 2, 8)),
      wind('The second rise', 'Climb above the snowfields and gradually return to the sheltered basin.',
        [4, -89, 7], [16, -77, 13], [22, -62, 20], [15, -48, 22], [2, -39, 16], [-10, -27, 9], [-17, -13, 4]),
    ],
  },
  {
    title: 'Last Light',
    landscape: landscapes.dunes,
    goal: 'Carry the evening light across three glades and ride the final wind toward the sea.',
    finish: 'The coast is quiet. Blue After Dark waits beyond the last light.',
    start: [6, -19, 1.45, -0.22],
    haze: 0xd3ab83, sky: 0xa88778, light: 0xffcea3, ringColor: 0xffdaa0,
    routes: [
      ['Evening grass', [4, -29], [-11, -53], 3],
      ['Amber hollow', [-20, -59], [-34, -91], -4],
      ['Salt edge', [4, -85], [17, -112], 3],
    ],
    legs: [
      blooms('Evening grass', 'Wake eight flowers in the fading light.', bed('Blooms', 0, 8)),
      wind('The amber arc', 'Cross the ridge and turn back into the amber hollow.',
        [4, -53, 7], [15, -65, 12], [10, -81, 15], [-5, -91, 11], [-18, -84, 5]),
      blooms('Amber hollow', 'Wake nine low flowers in the sheltered hollow.', bed('Blooms', 1, 9)),
      wind('The sandstone passage', 'Descend into the slot canyon and follow it toward the shore.',
        [-34, -98, 5], [-27, -106, 4], [-16, -113, 4.3], [-3, -112, 4.5], [11, -100, 3.5]),
      blooms('Salt edge', 'Wake ten flowers above the tide line.', bed('Blooms', 2, 10)),
      wind('Toward the sea', 'Follow the last rings out along the headland.',
        [18, -98, 6], [25, -106, 9], [32, -115, 13], [35, -125, 16]),
    ],
  },
  {
    title: 'Blue After Dark',
    landscape: landscapes.lagoon,
    goal: 'Follow luminous blue flowers and moonlit wind rings across the meadow at night.',
    finish: 'Every night glade is glowing. You can stay beneath the moon.',
    start: [3, -12, 1.45, -0.18], night: true,
    haze: 0x1b2d45, sky: 0x101d38, light: 0xa7c6ff, ringColor: 0x87d8ff,
    routes: [
      ['Blue shallows', [2, -24], [-17, -47], 4],
      ['Moonbank', [6, -55], [12, -83], -3],
      ['Night garden', [-19, -87], [-4, -113], 4],
    ],
    legs: [
      blooms('Blue shallows', 'Follow the glow and wake nine blue flowers.', bed('Blue blooms', 0, 9)),
      wind('Moon over water', 'Glide low across the silver water and turn toward Moonbank.',
        [-20, -51, 4], [-13, -66, 7], [1, -74, 8], [16, -66, 5], [20, -53, 4], [12, -47, 3]),
      blooms('Moonbank', 'Wake ten luminous flowers along the creek.', bed('Blue blooms', 1, 10)),
      wind('Across the dark', 'Rise over the creek, then follow the blue rings down to the night garden.',
        [17, -85, 6], [18, -100, 10], [8, -113, 15], [-7, -116, 11], [-21, -108, 7], [-25, -94, 3]),
      blooms('Night garden', 'Wake twelve blue flowers to light the final glade.', bed('Blue blooms', 2, 12)),
      wind('Under the stars', 'Make one long sweep above the three glowing glades.',
        [-26, -95, 5], [-34, -82, 9], [-30, -65, 13], [-19, -50, 15], [-3, -40, 12], [10, -27, 7], [11, -12, 4]),
    ],
  },
];

export function beginLevel(index) {
  const level = levels[index];
  const flight = newFlight();
  if (level.start) [flight.x, flight.z, flight.height, flight.heading] = level.start;
  const legs = level.legs.map(leg => ({
    ...leg,
    groups: (leg.groups ?? []).map(group => ({ ...group, progress: 0 })),
    rings: (leg.rings ?? []).map(([x, z, height], i, route) => {
      const [fromX, fromZ] = i ? route[i - 1] : [flight.x, flight.z];
      return {
        x, y: flightSurface(x, z, level.landscape) + height, z,
        heading: Math.atan2(x - fromX, z - fromZ),
        radius: height >= 6 ? 3.6 : 3.1,
      };
    }),
    passed: 0,
  }));
  const total = legs.reduce((sum, leg) => sum + leg.rings.length
    + leg.groups.reduce((counts, group) => counts + group.count, 0), 0);
  return { level, flight, meadow: makeMeadow(level.routes, level.night), legs, legIndex: 0, earned: 0, total };
}

function matches(group, flower) {
  return group.glade === flower.glade && (!group.kind || group.kind === flower.kind);
}

export function currentLeg(journey) {
  return journey.legs[journey.legIndex];
}

export function canBloom(journey, flower) {
  for (let i = journey.legIndex + 1; i < journey.legs.length; i++) {
    if (journey.legs[i].groups.some(group => matches(group, flower))) return false;
  }
  return true;
}

export function bloomObjective(journey, flower) {
  const group = currentLeg(journey)?.groups.find(item => item.progress < item.count && matches(item, flower));
  if (!group) return false;
  group.progress++;
  journey.earned++;
  if (group.progress === group.count) journey.meadow.glades[group.glade].lit = true;
  return true;
}

export function nextRing(journey) {
  const leg = currentLeg(journey);
  return leg?.rings[leg.passed];
}

export function crossRing(journey, from, to) {
  const ring = nextRing(journey);
  if (!ring) return;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const rx = ring.x - from.x, ry = ring.y - from.y, rz = ring.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const along = lengthSquared ? clamp((dx * rx + dy * ry + dz * rz) / lengthSquared, 0, 1) : 0;
  if (Math.hypot(rx - dx * along, ry - dy * along, rz - dz * along) > ring.radius) return;
  currentLeg(journey).passed++;
  journey.earned++;
  return ring;
}

export function advanceLeg(journey) {
  const leg = currentLeg(journey);
  if (!leg || leg.passed !== leg.rings.length || leg.groups.some(group => group.progress < group.count)) return false;
  journey.legIndex++;
  return true;
}

export function journeyProgress(journey) {
  return journey.earned / journey.total;
}

export function journeyTarget(journey) {
  const ring = nextRing(journey);
  if (ring) return ring;
  const group = currentLeg(journey)?.groups.find(item => item.progress < item.count);
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
