#!/usr/bin/env node
/**
 * Generates Chrome Web Store materials into ./store-assets:
 *   store-assets/{en,ru}/screenshot-1..5.png (1280×800), promo-small-440x280.png,
 *   promo-marquee-1400x560.png, title.txt, summary.txt, description.txt, listing.md
 *   store-assets/icon-128.png, store-assets/README.md
 *
 * Uses the built extension (dist/chrome) and OBS overlay (dist/obs), an in-process relay and
 * a locally installed Chrome/Chromium/Edge driven over the DevTools protocol (no dependencies).
 * Run: pnpm store:assets   (pnpm build runs it automatically outside CI)
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRelayServer } from './snow-relay.js';
import { buildListing } from './store-assets/listing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const stageDir = path.join(__dirname, 'store-assets');
const chromeDist = path.join(rootDir, 'dist', 'chrome');
const obsDist = path.join(rootDir, 'dist', 'obs');
const iconsDir = path.join(rootDir, 'src', 'icons');
const outDir = path.join(rootDir, 'store-assets');
const LANGS = ['en', 'ru'];

const log = (msg) => console.log(`   ${msg}`);
const warn = (msg) => console.warn(`   ⚠ ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const SNOW_WARMUP_MS = 100000;

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const PALETTE = ['#ffffff', '#4fc3f7', '#bbdefb', '#e1f5fe'];

export const SCENES = [
  {
    file: 'screenshot-1.png',
    theme: 'market',
    overlay: { renderer: 'auto', snowmax: 170, gravity: 20, minsize: 3, maxsize: 6, colors: PALETTE },
    popupTab: 'subtab:snow',
    texts: {
      en: { title: 'Let it snow on any website', text: 'Beautiful glowing snowfall on top of every page — click-through and lightweight.' },
      ru: { title: 'Снегопад на любом сайте', text: 'Красивый светящийся снег поверх любой страницы — не мешает кликам и не грузит систему.' }
    }
  },
  {
    file: 'screenshot-2.png',
    theme: 'aurora',
    overlay: {
      renderer: '3d', snowmax: 110, gravity: 20, minsize: 4, maxsize: 8,
      colors: PALETTE, symbols: ['❄', '❅', '❆', '🎄', '⭐', '🎁'],
      symbolModes: ['text', 'text', 'text', 'emoji', 'emoji', 'emoji']
    },
    seed: { rendererMode: '3d', symbols: ['❄', '❅', '❆', '🎄', '⭐', '🎁'], symbolModes: ['text', 'text', 'text', 'emoji', 'emoji', 'emoji'] },
    popupTab: 'subtab:symbols',
    texts: {
      en: { title: '3D snowflakes with glow', text: 'Volumetric tumbling flakes and full-color emoji with a soft twinkling glow.' },
      ru: { title: 'Объёмные 3D-снежинки со свечением', text: 'Вращающиеся объёмные снежинки и цветные эмодзи с мягким мерцающим свечением.' }
    }
  },
  {
    file: 'screenshot-3.png',
    theme: 'sale',
    overlay: { renderer: 'auto', snowmax: 120, gravity: 20, minsize: 3, maxsize: 6, colors: PALETTE },
    seed: { windEnabled: true, windDirection: 'right', windStrength: 0.8 },
    images: true,
    commands: [{ command: 'wind', params: { enabled: true, direction: 'right', strength: 1.2, gustFrequency: 4, durationMs: 0 } }],
    popupTab: 'subtab:wind',
    texts: {
      en: { title: 'GIFs, wind and live effects', text: 'Your own GIF images with edge-colored glow, gusty wind and instant effects.' },
      ru: { title: 'GIF, ветер и живые эффекты', text: 'Свои GIF-картинки со свечением по краям, порывистый ветер и мгновенные эффекты.' }
    }
  },
  {
    file: 'screenshot-4.png',
    theme: 'blog',
    overlay: { renderer: 'auto', snowmax: 150, gravity: 20, minsize: 3, maxsize: 6, colors: ['#4fc3f7', '#7c4dff', '#90caf9', '#b39ddb'] },
    popupTab: 'tab:help',
    popupHelpSection: 'start',
    texts: {
      en: { title: 'Smart glow and built-in help', text: 'The glow adapts to light and dark pages; the Help tab explains every feature.' },
      ru: { title: 'Умное свечение и встроенная справка', text: 'Свечение подстраивается под светлые и тёмные страницы, а вкладка «Помощь» объясняет все функции.' }
    }
  },
  {
    file: 'screenshot-5.png',
    theme: 'stream',
    overlay: { renderer: 'auto', snowmax: 120, gravity: 20, minsize: 3, maxsize: 6, colors: PALETTE },
    popupTab: 'subtab:api',
    texts: {
      en: { title: 'External API, sync & OBS', text: 'Trigger effects from bots and scripts, sync windows and browsers, stream with OBS.' },
      ru: { title: 'Внешний API, синхронизация и OBS', text: 'Эффекты из ботов и скриптов, синхронизация окон и браузеров, стримы в OBS.' }
    }
  }
];

export const PROMOS = [
  { file: 'promo-small-440x280.png', width: 440, height: 280, snowmax: 70, minsize: 3, maxsize: 6 },
  { file: 'promo-marquee-1400x560.png', width: 1400, height: 560, snowmax: 160, minsize: 3, maxsize: 6 }
];

export function promoOverlayOptions(promo) {
  return {
    renderer: 'auto',
    snowmax: promo.snowmax,
    gravity: 20,
    minsize: promo.minsize,
    maxsize: promo.maxsize,
    colors: PALETTE
  };
}

export function selectStoreScenes(args = []) {
  const requested = args.filter((arg) => arg.startsWith('--scene=')).map((arg) => arg.slice(8));
  const names = new Set([...SCENES, ...PROMOS].map(({ file }) => file));
  for (const name of requested) {
    if (!names.has(name)) throw new Error(`Unknown store scene: ${name}`);
  }
  const includes = ({ file }) => requested.length === 0 || requested.includes(file);
  return { scenes: SCENES.filter(includes), promos: PROMOS.filter(includes) };
}

export async function writeCaptureFile(file, png) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, png);
      return;
    } catch (error) {
      if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'UNKNOWN'].includes(error.code)
        || attempt >= 4) throw error;
      warn(`Could not write ${file} (${error.code}); retrying`);
      await sleep(250 * (attempt + 1));
    }
  }
}

const PROMO_TEXTS = {
  en: { name: 'Let it snow', tagline: 'Glowing snowfall on any website' },
  ru: { name: 'Let it snow', tagline: 'Светящийся снегопад на любом сайте' }
};

// ---------------------------------------------------------------------------
// Browser discovery
// ---------------------------------------------------------------------------

function findBrowser() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Chromium', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'
    );
  }
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

// ---------------------------------------------------------------------------
// Static server (/stage, /ext, /obs, /icons)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createStubSource() {
  const messages = {};
  for (const lang of LANGS) {
    const file = path.join(chromeDist, '_locales', lang, 'messages.json');
    messages[lang] = fs.existsSync(file) ? readJson(file) : {};
  }
  const manifest = readJson(path.join(chromeDist, 'manifest.json'));
  return `const __STORE_MESSAGES = ${JSON.stringify(messages)};\nconst __STORE_MANIFEST = ${JSON.stringify(manifest)};\n`
    + fs.readFileSync(path.join(stageDir, 'chrome-stub.js'), 'utf8');
}

function startStaticServer() {
  const mounts = { stage: stageDir, ext: chromeDist, obs: obsDist, icons: iconsDir };
  const stub = createStubSource();

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/__stub.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      return res.end(stub);
    }
    let [, mount, ...rest] = decodeURIComponent(pathname).split('/');
    // The popup build references its chunks with root-absolute URLs (/popup.css, /popup.html.js).
    if (!mounts[mount]) {
      rest = [mount, ...rest];
      mount = 'ext';
    }
    const base = mounts[mount];
    const root = path.resolve(base);
    let file = path.resolve(root, rest.join('/'));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, mount === 'stage' ? 'stage.html' : 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    let body = fs.readFileSync(file);
    if (mount === 'ext' && file.endsWith('.html')) {
      body = Buffer.from(String(body).replace(/<head([^>]*)>/i, '<head$1><script src="/__stub.js"></script>'));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Minimal DevTools protocol client
// ---------------------------------------------------------------------------

function launchBrowser(executable, profileDir) {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--force-color-profile=srgb',
    '--window-size=1400,900',
    'about:blank'
  ];
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('browser did not expose DevTools in 30 s')), 30000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`browser exited (${code}): ${stderr.slice(-400)}`));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ child, wsUrl: match[1] });
      }
    });
  });
}

class Cdp {
  constructor(wsUrl) {
    this.seq = 0;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`.trim()));
      else resolve(msg.result);
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('DevTools connection failed')), { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => cdp.send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };

  return {
    async load(url, width, height) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 });
      await call('Page.navigate', { url });
      for (let i = 0; i < 100; i += 1) {
        if (await evaluate('document.readyState === "complete" && Boolean(window.__stage)').catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`stage did not load: ${url}`);
    },
    evaluate,
    async screenshot() {
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      return Buffer.from(data, 'base64');
    }
  };
}

// ---------------------------------------------------------------------------
// PNG: drop the alpha channel (store requires 24-bit PNG without alpha)
// ---------------------------------------------------------------------------

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export function stripPngAlpha(png) {
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (colorType !== 6 || bitDepth !== 8 || ihdr[12] !== 0) return png;

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const out = Buffer.alloc(height * (width * 3 + 1));
  let src = 0;
  let dst = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src++];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[src++];
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      }
      line[x] = (value + predictor) & 0xff;
    }
    out[dst++] = 0;
    for (let x = 0; x < width; x += 1) {
      out[dst++] = line[x * 4];
      out[dst++] = line[x * 4 + 1];
      out[dst++] = line[x * 4 + 2];
    }
    line.copy(prev);
  }

  const header = Buffer.from(ihdr);
  header[9] = 2;
  return Buffer.concat([
    png.subarray(0, 8),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(out, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pngInfo(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] };
}

// ---------------------------------------------------------------------------
// Relay helpers
// ---------------------------------------------------------------------------

async function sendCommand(relayPort, token, body) {
  const res = await fetch(`http://127.0.0.1:${relayPort}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`relay ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function waitForOverlay(relayPort, token) {
  for (let i = 0; i < 60; i += 1) {
    const { delivered } = await sendCommand(relayPort, token, { command: 'ping' }).catch(() => ({ delivered: 0 }));
    if (delivered >= 1) return true;
    await sleep(500);
  }
  throw new Error('OBS overlay did not connect to the relay');
}

function overlayUrl(options, relayPort, token) {
  const query = new URLSearchParams({ relay: `ws://127.0.0.1:${relayPort}/ws`, status: '0', name: 'store' });
  const { colors, ...rest } = options;
  Object.entries(rest).forEach(([key, value]) => query.set(key, String(value)));
  if (colors) query.set('colors', colors.join(','));
  return `/obs/index.html?${query}#token=${token}`;
}

// Data URL images in chunks that fit into the relay payload limit (32 KB).
function chunkImages(images, maxBytes = 28000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const image of images) {
    if (current.length && (size + image.length > maxBytes || current.length >= 5)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    if (image.length > maxBytes) continue;
    current.push(image);
    size += image.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateStoreAssets(args = []) {
  const { scenes, promos } = selectStoreScenes(args);
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const version = pkg.version;

  for (const dir of [chromeDist, obsDist]) {
    if (!fs.existsSync(dir)) throw new Error(`${path.relative(rootDir, dir)} is missing — run pnpm build first`);
  }

  const readText = (name) => (fs.existsSync(path.join(rootDir, name)) ? fs.readFileSync(path.join(rootDir, name), 'utf8') : '');
  const listing = buildListing({
    version,
    changelog: readText('CHANGELOG.md'),
    changelogRu: readText('CHANGELOG_RU.md'),
    warn
  });
  const imageFiles = [...SCENES, ...PROMOS].map(({ file }) => file).sort();

  const executable = findBrowser();
  for (const lang of LANGS) fs.mkdirSync(path.join(outDir, lang), { recursive: true });

  const writeTexts = () => {
    for (const lang of LANGS) {
      const { title, summary, description } = listing[lang];
      const dir = path.join(outDir, lang);
      fs.writeFileSync(path.join(dir, 'title.txt'), `${title}\n`);
      fs.writeFileSync(path.join(dir, 'summary.txt'), `${summary}\n`);
      fs.writeFileSync(path.join(dir, 'description.txt'), `${description}\n`);
      const shots = imageFiles.filter((name) => fs.existsSync(path.join(dir, name)));
      fs.writeFileSync(path.join(dir, 'listing.md'), [
        `# ${title} — v${version} (${lang})`,
        '',
        `**Summary** (${summary.length}/132):`,
        '',
        summary,
        '',
        `**Description** (${description.length}/16000):`,
        '',
        '```text',
        description,
        '```',
        '',
        '**Images:**',
        '',
        ...shots.map((name) => `![${name}](./${name})`),
        ''
      ].join('\n'));
    }
  };

  fs.copyFileSync(path.join(iconsDir, 'icon-128.png'), path.join(outDir, 'icon-128.png'));

  if (!executable) {
    writeTexts();
    warn('Chrome/Chromium/Edge not found (set CHROME_PATH) — only texts were generated');
    return { screenshots: 0 };
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const { server, port: staticPort } = await startStaticServer();
  const origin = `http://127.0.0.1:${staticPort}`;
  const relay = createRelayServer({ token, port: 0, allowOrigins: [origin], log: () => {} });
  const relayPort = await relay.listen();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lis-store-'));
  let browser = null;
  let cdp = null;
  let count = 0;

  try {
    browser = await launchBrowser(executable, profileDir);
    cdp = new Cdp(browser.wsUrl);
    await cdp.opened;
    const page = await openPage(cdp);
    log(`browser: ${path.basename(executable)}`);

    const capture = async (lang, file) => {
      const png = stripPngAlpha(await page.screenshot());
      await writeCaptureFile(path.join(outDir, lang, file), png);
      count += 1;
    };

    for (const scene of scenes) {
      await page.load(`${origin}/stage/`, 1280, 800);
      await page.evaluate(`__stage.setup(${JSON.stringify({
        version,
        theme: scene.theme,
        overlayUrl: overlayUrl(scene.overlay, relayPort, token),
        seed: scene.seed || {},
        popupTab: scene.popupTab,
        popupHelpSection: scene.popupHelpSection,
        texts: scene.texts
      })})`);
      await waitForOverlay(relayPort, token);
      for (const command of scene.commands || []) {
        await sendCommand(relayPort, token, command);
      }
      await sleep(SNOW_WARMUP_MS);
      if (scene.images) {
        const images = await page.evaluate('__stage.makeImages()');
        for (const urls of chunkImages(images)) {
          await sendCommand(relayPort, token, { command: 'gif', params: { urls, count: 8 * urls.length > 24 ? 24 : 8 * urls.length, durationMs: 60000, speed: 2.4, entry: 'top' } });
        }
        await sleep(6000);
      }
      for (const lang of LANGS) {
        await page.evaluate(`__stage.setLanguage(${JSON.stringify(lang)})`);
        await capture(lang, scene.file);
      }
      log(`✓ ${scene.file}`);
    }

    for (const promo of promos) {
      await page.load(`${origin}/stage/`, promo.width, promo.height);
      await page.evaluate(`__stage.setup(${JSON.stringify({
        version,
        promo: true,
        theme: 'promo',
        overlayUrl: overlayUrl(promoOverlayOptions(promo), relayPort, token),
        texts: PROMO_TEXTS
      })})`);
      await waitForOverlay(relayPort, token);
      await sleep(SNOW_WARMUP_MS);
      for (const lang of LANGS) {
        await page.evaluate(`__stage.setLanguage(${JSON.stringify(lang)})`);
        await capture(lang, promo.file);
      }
      log(`✓ ${promo.file}`);
    }
  } finally {
    cdp?.close();
    if (browser) {
      browser.child.kill();
      await new Promise((resolve) => {
        if (browser.child.exitCode !== null) return resolve();
        browser.child.once('exit', resolve);
        setTimeout(resolve, 5000);
      });
    }
    await relay.close();
    await new Promise((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // profile may still be locked on Windows; it lives in the temp dir
    }
  }

  writeTexts();

  const rows = [];
  for (const lang of LANGS) {
    for (const name of imageFiles.filter((file) => fs.existsSync(path.join(outDir, lang, file)))) {
      const info = pngInfo(fs.readFileSync(path.join(outDir, lang, name)));
      if (info.colorType !== 2) warn(`${lang}/${name}: PNG color type ${info.colorType} (expected 2 — RGB without alpha)`);
      rows.push(`| ${lang}/${name} | ${info.width}×${info.height} |`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'README.md'), [
    `# Let it snow — Chrome Web Store assets v${version}`,
    '',
    `Generated ${new Date().toISOString()} by \`pnpm store:assets\` (also runs during \`pnpm build\` outside CI).`,
    'Generated filenames are overwritten on each build; other files are preserved.',
    '',
    '- `en/`, `ru/` — localized screenshots (1280×800, 24-bit PNG), promo tiles and texts.',
    '- `title.txt`, `summary.txt` (≤ 132 chars), `description.txt` (≤ 16 000 chars), `listing.md` (preview).',
    '- `icon-128.png` — store icon.',
    '',
    '| File | Size |',
    '| --- | --- |',
    ...rows,
    ''
  ].join('\n'));

  return { screenshots: count };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  console.log('🖼️  Chrome Web Store assets...');
  generateStoreAssets(process.argv.slice(2))
    .then(({ screenshots }) => {
      console.log(`   ✓ store-assets/ (${screenshots} images)`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`   ✗ ${error.stack || error.message}`);
      process.exit(1);
    });
}
