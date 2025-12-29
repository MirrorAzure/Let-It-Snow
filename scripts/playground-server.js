import { createServer } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const playgroundDir = resolve(__dirname, '..', 'playground');
const port = Number(process.env.PORT || 4177);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const safePath = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const filePath = resolve(playgroundDir, '.' + safePath);

    if (!filePath.startsWith(playgroundDir)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let stats;
    try {
      stats = await stat(filePath);
    } catch (err) {
      res.writeHead(404).end('Not Found');
      return;
    }

    const finalPath = stats.isDirectory() ? join(filePath, 'index.html') : filePath;
    const type = mimeTypes[extname(finalPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(finalPath).pipe(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Internal Server Error');
  }
});

server.listen(port, () => {
  console.log(`Playground running at http://localhost:${port}`);
});
