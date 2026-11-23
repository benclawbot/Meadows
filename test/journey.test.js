import assert from 'node:assert/strict';
import test from 'node:test';
import { clamp, collectBlooms, flightSurface, stepFlight } from '../src/flight.js';
import { beginLevel, bloomObjective, crossRing, journeyProgress, journeyTarget, levels, nextRing } from '../src/journey.js';

function position(flight) {
  return { x: flight.x, y: flightSurface(flight.x, flight.z) + flight.height, z: flight.z };
}

test('the final flight activates its rings after all three glades reach the goal', () => {
  const journey = beginLevel(5);
  assert.equal(nextRing(journey), undefined);
  for (const group of journey.groups) {
    const blooms = journey.meadow.flowers.filter(flower => flower.glade === group.glade);
    for (const bloom of blooms.slice(0, group.count)) assert.equal(bloomObjective(journey, bloom), true);
    assert.equal(bloomObjective(journey, blooms[group.count]), false);
  }
  const [first, second] = journey.rings;
  assert.equal(crossRing(journey, second, second), undefined);
  assert.equal(crossRing(journey, { ...first, y: first.y + 8 }, { ...first, y: first.y + 8 }), undefined);
  assert.equal(crossRing(journey, { ...first, z: first.z + 5 }, { ...first, z: first.z - 5 }), first);
  assert.equal(nextRing(journey), second);
});

test('all six routes can be completed at cruising speed using the objective guidance', () => {
  assert.equal(levels.length, 6);
  for (const [index, level] of levels.entries()) {
    const journey = beginLevel(index);
    const { flight, meadow } = journey;
    assert.equal(journeyProgress(journey), 0);
    for (let frame = 0; frame < 60 * 120 && journeyProgress(journey) < 1; frame++) {
      const target = journeyTarget(journey);
      assert.ok(target, `${level.title} has an outstanding objective without a target`);
      const heading = Math.atan2(target.x - flight.x, flight.z - target.z) - flight.heading;
      const turn = Math.atan2(Math.sin(heading), Math.cos(heading));
      const from = position(flight);
      const height = target.y === undefined ? 1.4 : target.y - flightSurface(flight.x, flight.z);
      stepFlight(flight, {
        x: clamp(turn * 1.7, -1, 1),
        y: clamp((height - flight.height) * 0.55, -1, 1),
        gust: false,
      }, 1 / 60);
      for (const { flower } of collectBlooms(meadow, flight, from.x, from.z)) bloomObjective(journey, flower);
      crossRing(journey, from, position(flight));
    }
    assert.equal(journeyProgress(journey), 1, level.title);
    assert.equal(journeyTarget(journey), undefined);
    assert.equal(journeyProgress(beginLevel(index)), 0);
  }
});
