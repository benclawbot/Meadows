import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port = Number(process.env.SALT_MEADOW_PORT || 8765);
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (request.url?.split('?')[0] !== '/' && request.url?.split('?')[0] !== '/index.html') {
    response.writeHead(404).end();
    return;
  }
  try {
    const page = await readFile(new URL('dist/index.html', import.meta.url));
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': page.length,
      'Cache-Control': 'no-store',
    }).end(request.method === 'HEAD' ? undefined : page);
  } catch {
    response.writeHead(503).end('Run npm run build before starting the preview.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local http://127.0.0.1:${server.address().port}/`));
