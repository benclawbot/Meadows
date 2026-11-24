import assert from 'node:assert/strict';
import test from 'node:test';
import { clamp, collectBlooms, flightSurface, stepFlight, terrain } from '../src/flight.js';
import { advanceLeg, beginLevel, bloomObjective, canBloom, crossRing, currentLeg, journeyProgress, journeyTarget, levels, nextRing } from '../src/journey.js';
import { groundBounds, outerGroundHeight } from '../src/landscape.js';
import firstLight from '../art/first-light.json' with { type: 'json' };

function position(flight, level) {
  return { x: flight.x, y: flightSurface(flight.x, flight.z, level.landscape) + flight.height, z: flight.z };
}

test('First Light follows the exported Blender triangles under the player', () => {
  const { x, z, mm } = firstLight;
  const row = 117, col = 83;
  const i = row * x.length + col;
  assert.equal(terrain(x[col], z[row]), mm[i] / 1000);
  const midpoint = terrain((x[col] + x[col + 1]) / 2, (z[row] + z[row + 1]) / 2);
  assert.ok(Math.abs(midpoint - (mm[i + 1] + mm[i + x.length]) / 2000) < 1e-10);
});

test('a flight protects future blooms and advances only after the active stage is complete', () => {
  const journey = beginLevel(5);
  const [first, second] = journey.legs[1].rings;
  assert.equal(crossRing(journey, first, first), undefined);
  assert.equal(advanceLeg(journey), false);
  const group = currentLeg(journey).groups[0];
  const blooms = journey.meadow.flowers.filter(flower => flower.glade === group.glade);
  const futureBloom = journey.meadow.flowers.find(flower => flower.glade === 1);
  assert.equal(canBloom(journey, futureBloom), false);
  assert.equal(bloomObjective(journey, futureBloom), false);
  for (const bloom of blooms.slice(0, group.count)) assert.equal(bloomObjective(journey, bloom), true);
  assert.equal(bloomObjective(journey, blooms[group.count]), false);
  assert.equal(advanceLeg(journey), true);
  assert.equal(advanceLeg(journey), false);
  assert.equal(crossRing(journey, second, second), undefined);
  assert.equal(crossRing(journey, { ...first, y: first.y + 8 }, { ...first, y: first.y + 8 }), undefined);
  assert.equal(crossRing(journey, { ...first, z: first.z + 5 }, { ...first, z: first.z - 5 }), first);
  assert.equal(nextRing(journey), second);
});

test('Blue After Dark has blue flowers throughout its night glades', () => {
  const { level, meadow } = beginLevel(6);
  assert.equal(level.title, 'Blue After Dark');
  assert.equal(level.night, true);
  assert.ok(meadow.flowers.every(flower => flower.kind === 'blue'));
  assert.ok(new Set(meadow.flowers.map(flower => flower.color)).size >= 3);
  assert.ok(meadow.flowers.every(({ color }) => {
    const red = color >> 16, green = (color >> 8) & 0xff, blue = color & 0xff;
    return blue > green && green > red;
  }));
});

test('the tidal gorge and sandstone passage carry rings between taller walls', () => {
  for (const [levelIndex, legIndex, ringIndex, offsetX, offsetZ] of [[2, 0, 2, 12, 0], [5, 3, 2, 0, 11]]) {
    const { level, legs } = beginLevel(levelIndex);
    const ring = legs[legIndex].rings[ringIndex];
    const { landscape } = level;
    assert.ok(ring.y - flightSurface(ring.x, ring.z, landscape) < 5);
    for (const side of [-1, 1]) {
      assert.ok(terrain(ring.x + offsetX * side, ring.z + offsetZ * side, landscape) > ring.y + 2);
    }
  }
});

test('free flight keeps its heading over the alpine peaks and past the detailed terrain', () => {
  const { flight, level } = beginLevel(4);
  Object.assign(flight, { x: -63, z: -106, heading: 0 });
  const gust = { x: 0, y: 0, gust: true };
  let highestGround = -Infinity;
  for (let i = 0; i < 840; i++) {
    stepFlight(flight, gust, 1 / 60);
    assert.equal(flight.heading, 0);
    highestGround = Math.max(highestGround, flightSurface(flight.x, flight.z, level.landscape));
  }
  assert.ok(highestGround > 65);
  assert.ok(flight.z < groundBounds.centerZ - groundBounds.depth / 2);
  assert.equal(flightSurface(flight.x, flight.z, level.landscape), outerGroundHeight);

  const x = flight.x;
  for (let i = 0; i < 60; i++) stepFlight(flight, { ...gust, x: 1 }, 1 / 60);
  assert.ok(flight.heading > 1 && flight.x > x + 4);
});

test('all seven extended routes can be completed at cruising speed using the objective guidance', () => {
  assert.equal(levels.length, 7);
  for (const [index, level] of levels.entries()) {
    const journey = beginLevel(index);
    const { flight, meadow } = journey;
    assert.equal(journeyProgress(journey), 0);
    assert.ok(journey.legs.length >= 4);
    let frame = 0;
    for (; frame < 60 * 180 && journeyProgress(journey) < 1; frame++) {
      const target = journeyTarget(journey);
      assert.ok(target, `${level.title} has an outstanding objective without a target`);
      const heading = Math.atan2(target.x - flight.x, flight.z - target.z) - flight.heading;
      const turn = Math.atan2(Math.sin(heading), Math.cos(heading));
      const from = position(flight, level);
      const height = target.y === undefined ? 1.4 : target.y - flightSurface(flight.x, flight.z, level.landscape);
      stepFlight(flight, {
        x: clamp(turn * 1.7, -1, 1),
        y: clamp((height - flight.height) * 0.55, -1, 1),
        gust: false,
      }, 1 / 60);
      const hits = collectBlooms(meadow, flight, from.x, from.z, flower => canBloom(journey, flower));
      for (const { flower } of hits) bloomObjective(journey, flower);
      crossRing(journey, from, position(flight, level));
      advanceLeg(journey);
    }
    assert.equal(journeyProgress(journey), 1, level.title);
    assert.ok(frame >= 60 * 65, `${level.title} ended too quickly`);
    assert.equal(currentLeg(journey), undefined);
    assert.equal(journeyTarget(journey), undefined);
    assert.equal(journeyProgress(beginLevel(index)), 0);
  }
});
