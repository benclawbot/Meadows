import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const [template, css, font, threeLicense, fontLicense, bundle] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/style.css', 'utf8'),
  readFile('samples/display.woff2'),
  readFile('node_modules/three/LICENSE', 'utf8'),
  readFile('samples/OFL.txt', 'utf8'),
  build({
    entryPoints: ['src/main.js'],
    format: 'iife',
    bundle: true,
    write: false,
    minify: true,
    legalComments: 'none',
    target: ['chrome108', 'safari16', 'firefox115'],
    loader: { '.mp3': 'binary', '.glb': 'binary', '.jpg': 'binary' },
  }),
]);

const notices = [threeLicense, fontLicense, [
  'Audio samples from Versilian Studios VSCO 2 Community Edition (CC0 1.0).',
  'Upright piano sampled by Simon Dalzell of Ivy Audio.',
  'Sample source https://github.com/sgossner/VSCO-2-CE',
  'First Light sky and texture references are CC0 from Poly Haven. See the project README.',
].join('\n')].join('\n\n').replaceAll('-->', '-- >');
const result = template
  .replace('/*__STYLE__*/', () => css.replace('__DISPLAY_FONT__', font.toString('base64')))
  .replace('/*__SCRIPT__*/', () => bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'))
  .replace('</body>', () => `<!--\n${notices}\n-->\n</body>`);

await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', result);
console.log(`dist/index.html (${Math.round(Buffer.byteLength(result) / 1024)} KiB)`);
