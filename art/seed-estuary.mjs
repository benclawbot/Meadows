import { writeFile } from 'node:fs/promises';
import { uneditedTerrain } from '../src/landscape.js';

const axis = ranges => ranges.flatMap(([start, end, steps], segment) =>
  Array.from({ length: steps + (segment === 0 ? 1 : 0) }, (_, i) =>
    Math.round((start + (end - start) * (i + Number(segment > 0)) / steps) * 10000) / 10000));
const x = axis([[-180, -62, 27], [-62, 65, 156], [65, 180, 26]]);
const z = axis([[-244, -146, 23], [-146, 31, 203], [31, 68, 9]]);

await writeFile(process.argv[2], JSON.stringify({
  x, z, elevation: z.flatMap(row => x.map(column => uneditedTerrain(column, row))),
}));
