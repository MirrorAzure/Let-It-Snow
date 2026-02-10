import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const port = Number(process.env.PORT || 5173);

async function startServer() {
  const server = await createServer({
    root,
    server: {
      middlewareMode: false,
      port,
      open: '/playground/index.html',
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port
      }
    },
    define: {
      'process.env.IS_PLAYGROUND': 'true'
    }
  });

  await server.listen();
  console.log(`\n✓ Playground running at http://localhost:${port}`);
  console.log('✓ Hot Module Replacement (HMR) enabled');
  console.log('✓ Snow Animation: http://localhost:' + port + '/playground/');
  console.log('✓ Popup UI: http://localhost:' + port + '/playground/popup-playground.html');
  console.log('✓ Changes to src/content/ and src/popup/ will hot reload\n');
}

startServer().catch(console.error);

