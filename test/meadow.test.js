import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBlooms, driftFromBloom, FlightPath, makeMeadow, nearbyBloomTurn, newFlight, stepFlight, tiltControl } from '../src/flight.js';
import { MeadowWake } from '../src/meadow-wake.js';
import { BAR, bloomPitch, MeadowScore, score } from '../src/score.js';

test('phone tilt centres on the holding angle and rotates with the screen', () => {
  const neutral = [37, 11];
  assert.deepEqual(tiltControl(neutral, neutral, 0), [0, 0]);
  assert.ok(tiltControl(neutral, [37, 22], 0)[0] > 0.25);
  assert.ok(tiltControl(neutral, [51, 11], 0)[1] > 0.25);
  assert.ok(tiltControl([0, 0], [-17, 0], 90)[0] > 0.6);
  assert.ok(tiltControl([0, 0], [17, 0], 270)[0] > 0.6);
  assert.ok(tiltControl(neutral, [37.35, 11.35], 0).every(axis => Math.abs(axis) < 1e-6));
});

test('you drift without a gust and can reach the first bloom in a straight pass', () => {
  const flight = newFlight(), meadow = makeMeadow();
  let count = 0;
  for (let i = 0; i < 240; i++) {
    const { x, z } = flight;
    stepFlight(flight, { x: 0, y: 0, gust: false }, 1 / 60);
    count += collectBlooms(meadow, flight, x, z).length;
  }
  assert.ok(count >= 1);
  const cruise = flight.speed;
  stepFlight(flight, { x: 0, y: 0, gust: true }, 1 / 60);
  assert.ok(flight.speed > cruise && flight.speed < cruise + 1);
  assert.ok(flight.acceleration > 0);
  for (let i = 1; i < 120; i++) stepFlight(flight, { x: 0, y: 0, gust: true }, 1 / 60);
  assert.ok(flight.speed > cruise * 3);
  stepFlight(flight, { x: 0, y: 0, gust: false }, 1 / 60);
  assert.ok(flight.speed > cruise * 2);
  assert.ok(flight.acceleration < 0);
  for (let i = 0; i < 120; i++) stepFlight(flight, { x: 0, y: 0, gust: false }, 1 / 60);
  assert.ok(flight.speed < cruise + 0.5);
});

test('a gust parts grass on both sides, follows a turn and fades after climbing', () => {
  const flight = newFlight();
  const wake = new MeadowWake();
  const cruise = new MeadowWake();
  const cell = wake.span / wake.size;
  const sample = (field, x, z) => {
    const col = Math.floor((x - field.x) / cell), row = Math.floor((z - field.z) / cell);
    const i = (row * field.size + col) * 4;
    return { x: field.pixels[i] - 128, z: field.pixels[i + 1] - 128, pressure: field.pixels[i + 2] };
  };
  const boost = { x: 0, y: 0, gust: true };
  const glide = { ...flight, z: 0, heading: 0 };
  Object.assign(flight, { z: 0, heading: 0 });
  for (let i = 0; i <= 90; i++) {
    stepFlight(flight, boost, 1 / 60);
    stepFlight(glide, { ...boost, gust: false }, 1 / 60);
    wake.update(flight, 1.45, i / 60);
    cruise.update(glide, 1.45, i / 60);
  }
  const left = sample(wake, -1.8, flight.z + 0.8);
  const right = sample(wake, 1.8, flight.z + 0.8);
  assert.ok(left.x < -40 && right.x > 40);
  assert.ok(left.pressure > sample(cruise, -1.8, glide.z + 0.8).pressure);
  assert.ok(sample(wake, 8, flight.z).pressure === 0);
  for (let i = 91; i <= 174; i++) {
    stepFlight(flight, { ...boost, x: 1 }, 1 / 60);
    wake.update(flight, 1.45, i / 60);
  }
  assert.ok(Math.sin(flight.heading) > 0.9);
  assert.ok(sample(wake, flight.x - 1, flight.z - 1.3).z < 0);
  assert.ok(sample(wake, flight.x - 1, flight.z + 1.3).z > 0);
  wake.update(flight, 8, 3.5);
  assert.ok(sample(wake, flight.x, flight.z).pressure > 0);
  wake.update(flight, 8, 6);
  assert.equal(sample(wake, flight.x, flight.z).pressure, 0);
  wake.reset();
  wake.update(flight, 8, 0);
  assert.equal(sample(wake, flight.x, flight.z).pressure, 0);
});

test('you can climb high, coast at altitude, and return to the blooms', () => {
  const flight = newFlight();
  for (let i = 0; i < 600; i++) stepFlight(flight, { x: 0, y: 1, gust: false }, 1 / 60);
  assert.ok(flight.height > 37 && flight.height < 42);
  const altitude = flight.height;
  for (let i = 0; i < 180; i++) stepFlight(flight, { x: 0, y: 0, gust: false }, 1 / 60);
  assert.ok(Math.abs(flight.height - altitude) < 1);
  for (let i = 0; i < 480; i++) stepFlight(flight, { x: 0, y: -1, gust: false }, 1 / 60);
  assert.ok(flight.height < 2.85);
});

test('the breeze gently helps near blooms and stays neutral for blooms behind you', () => {
  const flight = newFlight();
  const meadow = { flowers: [{ x: 1.2, z: flight.z - 5, bloomed: false }] };
  assert.ok(nearbyBloomTurn(meadow, flight) > 0 && nearbyBloomTurn(meadow, flight) <= 0.26);
  meadow.flowers[0].z = flight.z + 5;
  assert.equal(nearbyBloomTurn(meadow, flight), 0);
});

test('the petal trail samples by distance and follows the heading of earlier turns', () => {
  const path = new FlightPath(), pose = {};
  for (let i = 0; i < 20; i++) path.add(0, 1, -i * 0.17);
  for (let i = 1; i < 20; i++) path.add(i * 0.17, 1, -19 * 0.17, 1);
  assert.equal(path.sample(40, pose), false);
  assert.ok(path.sample(0.58, pose));
  assert.ok(Math.abs(pose.x - 2.65) < 0.00001);
  assert.ok(Math.abs(pose.heading - Math.PI / 2) < 0.00001);
  assert.equal(pose.gust, 1);
  assert.ok(path.sample(3.23, pose) && pose.turn > 1);
  assert.ok(path.sample(4.12, pose));
  assert.ok(Math.abs(pose.z + 2.34) < 0.00001);
  assert.ok(Math.abs(pose.heading) < 0.00001);
  assert.equal(pose.gust, 0);
});

test('a collected petal starts at the bloom, lifts, and joins the ribbon', () => {
  const flower = { x: 3, y: 1, z: -4 };
  const ribbon = { x: 5, y: 1.5, z: -7 };
  const petal = {};
  driftFromBloom(flower, ribbon, 0, 1, petal);
  assert.deepEqual(petal, flower);
  driftFromBloom(flower, ribbon, 0.5, 1, petal);
  assert.deepEqual(petal, { x: 4, y: 2.25, z: -5.5 });
  driftFromBloom(flower, ribbon, 1, 1, petal);
  assert.deepEqual(petal, ribbon);
});

test('the first glade mixes multiple visible colours and instrument voices', () => {
  const flowers = makeMeadow().flowers.filter(flower => flower.glade === 0);
  assert.equal(new Set(flowers.map(flower => flower.color)).size, 4);
  assert.equal(new Set(flowers.map(flower => flower.voice)).size, 3);
});

test('swept bloom collection lights each glade once and leaves an open flight after completion', () => {
  const meadow = makeMeadow();
  const flight = newFlight();
  let completions = 0;
  for (const flower of meadow.flowers) {
    flight.x = flower.x;
    flight.z = flower.z - 2;
    collectBlooms(meadow, flight, flower.x, flower.z + 2).forEach(hit => {
      if (hit.completed) completions++;
    });
  }
  assert.equal(completions, 3);
  assert.ok(meadow.glades.every(glade => glade.lit));
  assert.ok(meadow.flowers.every(flower => flower.bloomed));
  assert.deepEqual(collectBlooms(meadow, flight, flight.x, flight.z), []);
  const z = flight.z;
  stepFlight(flight, { x: 0, y: 0, gust: false }, 0.05);
  assert.ok(flight.z < z);
});

test('bloom notes follow the harmony and the progression brings in new instruments', () => {
  let previous = null;
  for (let bar = 0; bar < score.length * 2; bar++) {
    for (let tone = 0; tone < 13; tone++) {
      const pitch = bloomPitch(bar, tone, previous);
      assert.ok(score[bar % score.length][1].some(chordTone => chordTone % 12 === pitch % 12));
      previous = pitch;
    }
  }
  const music = new MeadowScore({});
  const events = [];
  music.note = (...event) => events.push(event);
  music.playBar(0, 0);
  assert.ok(events.every(([instrument]) => instrument === 'piano'));
  music.stage = 3;
  music.playBar(0, BAR);
  assert.deepEqual(new Set(events.map(([instrument]) => instrument)), new Set(['piano', 'cello', 'flute', 'harp']));
});

test('each flight starts its own arrangement and its bloom notes follow the new harmony', () => {
  const music = new MeadowScore({});
  const arrangements = new Set();
  for (let level = 0; level < 7; level++) {
    music.stage = 3;
    music.barNumber = 4;
    music.lastNote = 72;
    music.setLevel(level);
    assert.equal(music.stage, 0);
    assert.equal(music.barNumber, 0);
    assert.equal(music.lastNote, null);

    const events = [];
    music.note = (...event) => events.push(event);
    music.playBar(0, 0);
    assert.ok(events.length >= 4);
    assert.ok(events.every(([, pitch, at, duration]) => Number.isFinite(pitch)
      && at >= 0 && at < music.bar && duration > 0));
    arrangements.add(JSON.stringify(events));

    for (const [bar, [, harmony]] of music.phrases.entries()) {
      const pitch = bloomPitch(bar, 6, null, music.phrases);
      assert.ok(harmony.some(note => note % 12 === pitch % 12));
    }
  }
  assert.equal(arrangements.size, 7);
});
