/**
 * A static file server for local development.
 *
 * There is no build step, so this only needs to hand the files over with the
 * right content types. `/api/fetch-schema` is answered by the same function
 * Netlify deploys, so the relay behaves the same locally as in production.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const { default: fetchSchema } = await import('../netlify/functions/fetch-schema.mjs');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/fetch-schema') {
    const response = await fetchSchema(new Request(url, { method: req.method }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  let filePath = path.join(root, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.isDirectory()) filePath = path.join(root, 'index.html');
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(port, () => {
  console.log(`allyway on http://localhost:${port}`);
});
