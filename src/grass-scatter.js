import { clamp, randomFrom } from './flight.js';
import { channel, groundCover, terrain, waterHeight } from './landscape.js';

export const grassTileSize = 16;

export function sampleGrassTile(landscape, column, row, near, mobile) {
  const [, , density, stature, spread] = landscape.plants;
  const rng = randomFrom((Math.imul(column, 73856093) ^ Math.imul(row, 19349663) ^ (near ? 83039 : 41009)) >>> 0);
  const count = Math.ceil(grassTileSize * Math.sqrt(density * (near ? (mobile ? 2.15 : 3.9) : (mobile ? 1.26 : 2.28))));
  const step = grassTileSize / count;
  const tuft = [], style = [];
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = column * grassTileSize + (i + rng()) * step;
      const z = row * grassTileSize + (j + rng()) * step;
      const y = terrain(x, z, landscape);
      if (landscape.water && y < waterHeight + .12) continue;
      const cover = groundCover(x, z);
      const slope = Math.hypot(terrain(x + .65, z, landscape) - y, terrain(x, z + .65, landscape) - y) / .65;
      const ledge = clamp((slope - .45) / 1.45, 0, .94);
      if (rng() > (.80 + cover*.20) * (1 - ledge)) continue;
      const reed = landscape.name === 'marsh' ? y < .54 && rng() < .61
        : landscape.name === 'meadow' && Math.abs(channel(x, z)) < 1.43 && rng() < .33;
      const height = reed ? .82 + rng()*.66 : .24 + rng()*.61 + cover*.13;
      const seed = reed || (cover > .59 && rng() < .27);
      tuft.push(x, y - .045, z, height * stature);
      style.push(rng() * 6.283, (.56 + rng() * .94) * spread, rng(), reed ? 2 : seed ? 1 : 0);
    }
  }
  return { tuft, style };
}
