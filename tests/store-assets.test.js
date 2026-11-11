import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { buildListing, extractChangelog } from '../scripts/store-assets/listing.js';
import { PROMOS, SCENES, SNOW_WARMUP_MS, promoOverlayOptions, selectStoreScenes, stripPngAlpha, writeCaptureFile } from '../scripts/build-store-assets.js';

const rootDir = path.join(import.meta.dirname, '..');

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function rgbaPng(width, height, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    // Alternate filters so unfiltering (Sub/Up/Paeth) is exercised.
    const filter = y % 5;
    const raw = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), x * 4);
    const prev = y > 0 ? rows[y - 1].raw : Buffer.alloc(width * 4);
    const out = Buffer.alloc(width * 4);
    for (let i = 0; i < raw.length; i += 1) {
      const a = i >= 4 ? raw[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
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
      out[i] = (raw[i] - predictor) & 0xff;
    }
    rows.push({ raw, line: Buffer.concat([Buffer.from([filter]), out]) });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows.map((row) => row.line)))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

describe('store assets', () => {
  it('uses the normal snowfall spawn path and lets it run before capturing every scene', () => {
    expect(SNOW_WARMUP_MS).toBeGreaterThanOrEqual(100000);
    for (const options of [...SCENES.map((scene) => scene.overlay), ...PROMOS.map(promoOverlayOptions)]) {
      expect(options.initialDistribution).toBeUndefined();
      expect(options.initialSpawnSpanRatio).toBeUndefined();
      expect(options.initialTimeOffsetSeconds).toBeUndefined();
    }
  });

  it('can regenerate selected scenes without overwriting the others', () => {
    const result = selectStoreScenes(['--scene=screenshot-2.png', '--scene=promo-small-440x280.png']);
    expect(result.scenes.map(({ file }) => file)).toEqual(['screenshot-2.png']);
    expect(result.promos.map(({ file }) => file)).toEqual(['promo-small-440x280.png']);
    expect(() => selectStoreScenes(['--scene=missing.png'])).toThrow('Unknown store scene');
  });

  it('surfaces permanent write errors and retries transient Windows failures', async () => {
    const write = vi.spyOn(fs, 'writeFileSync');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const error = Object.assign(new Error('access denied'), { code: 'EACCES' });
      write.mockImplementation(() => { throw error; });
      await expect(writeCaptureFile('test.png', Buffer.alloc(0))).rejects.toBe(error);
      expect(write).toHaveBeenCalledTimes(1);
      if (process.platform === 'win32') {
        write.mockReset();
        write.mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { code: 'UNKNOWN' }); });
        write.mockImplementation(() => {});
        await writeCaptureFile('test.png', Buffer.alloc(0));
        expect(write).toHaveBeenCalledTimes(2);
        expect(warning).toHaveBeenCalledOnce();
      }
    } finally {
      write.mockRestore();
      warning.mockRestore();
    }
  });

  it('strips the PNG alpha channel without changing colors', () => {
    const pixel = (x, y) => [(x * 37 + y) & 0xff, (y * 53) & 0xff, (x * y) & 0xff, 255];
    const result = stripPngAlpha(rgbaPng(9, 7, pixel));
    expect(result[25]).toBe(2);
    let offset = 8;
    const idat = [];
    while (offset < result.length) {
      const length = result.readUInt32BE(offset);
      if (result.toString('latin1', offset + 4, offset + 8) === 'IDAT') idat.push(result.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    for (let y = 0; y < 7; y += 1) {
      expect(raw[y * (9 * 3 + 1)]).toBe(0);
      for (let x = 0; x < 9; x += 1) {
        const at = y * (9 * 3 + 1) + 1 + x * 3;
        expect([raw[at], raw[at + 1], raw[at + 2]]).toEqual(pixel(x, y).slice(0, 3));
      }
    }
  });

  it('builds store texts within Chrome Web Store limits for the current version', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
    const changelogRu = fs.readFileSync(path.join(rootDir, 'CHANGELOG_RU.md'), 'utf8');
    const warnings = [];
    const listing = buildListing({ version, changelog, changelogRu, warn: (msg) => warnings.push(msg) });
    expect(warnings).toEqual([]);
    for (const lang of ['en', 'ru']) {
      expect(listing[lang].summary.length).toBeLessThanOrEqual(132);
      expect(listing[lang].description.length).toBeLessThanOrEqual(16000);
      expect(listing[lang].description).toContain(`v${version}`);
      expect(listing[lang].description).not.toContain('{{');
    }
    expect(listing.en.description).toContain(`WHAT'S NEW IN ${version}`);
    expect(listing.ru.description).toContain(`ЧТО НОВОГО В ${version}`);
  });

  it('extracts user-facing changelog entries without markdown or developer notes', () => {
    const items = extractChangelog([
      '## [9.9.9] - 2030-01-01',
      '### Added',
      '- New [glow](./docs/x.md) for `GIF` flakes (see [docs/X.md](./docs/X.md)).',
      '- Build helper (`pnpm store:assets`).',
      '### Security',
      '- Hidden item.',
      '## [9.9.8]',
      '- Old item.'
    ].join('\n'), '9.9.9');
    expect(items).toEqual(['New glow for GIF flakes.']);
  });

  it('extracts the Russian changelog and skips its security and compatibility sections', () => {
    const items = extractChangelog([
      '## [9.9.9] - 2030-01-01',
      '### Добавлено',
      '- Новое **свечение** (см. [docs/X_RU.md](./docs/X_RU.md)).',
      '### Безопасность',
      '- Скрыто.',
      '### Совместимость',
      '- Тоже скрыто.'
    ].join('\n'), '9.9.9');
    expect(items).toEqual(['Новое свечение.']);
  });
});
