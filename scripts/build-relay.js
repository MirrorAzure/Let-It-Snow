/**
 * Builds the standalone Let It Snow relay for the current platform:
 *   1. builds the OBS overlay (dist/obs) if needed;
 *   2. bundles scripts/relay-standalone.js into one CommonJS file;
 *   3. produces a Node.js single executable application with the overlay embedded;
 *   4. packs the executable, the OBS script and a README into
 *      builds/let-it-snow-relay-<os>-<arch>.zip.
 *
 * Usage: node scripts/build-relay.js [--skip-overlay] [--no-zip]
 * Requires Node.js >= 25.5 (`node --build-sea`). Cross-compilation is not supported:
 * run it on each target OS (see .github/workflows/build.yml).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const overlayDir = path.join(rootDir, 'dist', 'obs');
const outDir = path.join(rootDir, 'dist', 'relay');
const workDir = path.join(outDir, '.work');
const buildsDir = path.join(rootDir, 'builds');
const args = new Set(process.argv.slice(2));

const PLATFORM_NAMES = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const platformName = PLATFORM_NAMES[process.platform] || process.platform;
const exeName = process.platform === 'win32' ? 'let-it-snow-relay.exe' : 'let-it-snow-relay';
const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;

const listFiles = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return listFiles(full, base);
  return [path.relative(base, full).split(path.sep).join('/')];
});

const zip = (outputPath, entries) => new Promise((resolve, reject) => {
  const output = fs.createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on('close', resolve);
  archive.on('error', reject);
  archive.pipe(output);
  for (const { source, name, mode } of entries) archive.file(source, { name, mode });
  archive.finalize();
});

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 25 || (major === 25 && minor < 5)) {
    throw new Error(`Node.js >= 25.5 is required for --build-sea (current ${process.version})`);
  }

  if (!args.has('--skip-overlay') || !fs.existsSync(path.join(overlayDir, 'index.html'))) {
    console.log('• Building OBS overlay…');
    await build({ configFile: path.join(rootDir, 'vite.obs.config.js'), root: rootDir, logLevel: 'warn' });
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  console.log('• Bundling relay…');
  await build({
    configFile: false,
    root: rootDir,
    logLevel: 'warn',
    publicDir: false,
    define: { __RELAY_VERSION__: JSON.stringify(version), __RELAY_EMBEDDED__: 'true' },
    ssr: { target: 'node', noExternal: true },
    build: {
      ssr: path.join(rootDir, 'scripts', 'relay-standalone.js'),
      outDir: workDir,
      emptyOutDir: false,
      minify: false,
      target: 'node22',
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: 'relay.cjs', codeSplitting: false }
      }
    }
  });

  const overlayFiles = listFiles(overlayDir);
  const manifestPath = path.join(workDir, 'obs-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ version, files: overlayFiles }));
  const assets = { 'obs-manifest.json': manifestPath };
  for (const file of overlayFiles) assets[`obs/${file}`] = path.join(overlayDir, file);

  const exePath = path.join(outDir, exeName);
  const seaConfigPath = path.join(workDir, 'sea-config.json');
  fs.writeFileSync(seaConfigPath, JSON.stringify({
    main: path.join(workDir, 'relay.cjs'),
    output: exePath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets
  }, null, 2));

  console.log(`• Building single executable (${platformName}-${process.arch})…`);
  execFileSync(process.execPath, ['--build-sea', seaConfigPath], { cwd: rootDir, stdio: 'inherit' });
  if (process.platform === 'darwin') {
    // Injection invalidates the Node.js signature; macOS refuses to run unsigned arm64 binaries.
    execFileSync('codesign', ['--sign', '-', '--force', exePath], { stdio: 'inherit' });
  }
  if (process.platform !== 'win32') fs.chmodSync(exePath, 0o755);

  const versionOutput = execFileSync(exePath, ['--version'], { encoding: 'utf8' }).trim();
  if (versionOutput !== version) {
    throw new Error(`Smoke test failed: expected version ${version}, got "${versionOutput}"`);
  }

  fs.copyFileSync(path.join(rootDir, 'obs', 'let-it-snow-relay.lua'), path.join(outDir, 'let-it-snow-relay.lua'));
  fs.copyFileSync(path.join(rootDir, 'obs', 'README.txt'), path.join(outDir, 'README.txt'));
  fs.rmSync(workDir, { recursive: true, force: true });

  if (!args.has('--no-zip')) {
    fs.mkdirSync(buildsDir, { recursive: true });
    const zipPath = path.join(buildsDir, `let-it-snow-relay-${platformName}-${process.arch}.zip`);
    await zip(zipPath, [
      { source: exePath, name: `let-it-snow-relay/${exeName}`, mode: 0o755 },
      { source: path.join(outDir, 'let-it-snow-relay.lua'), name: 'let-it-snow-relay/let-it-snow-relay.lua', mode: 0o644 },
      { source: path.join(outDir, 'README.txt'), name: 'let-it-snow-relay/README.txt', mode: 0o644 }
    ]);
    console.log(`✓ ${path.relative(rootDir, zipPath)}`);
  }
  console.log(`✓ ${path.relative(rootDir, exePath)} (v${version})`);
}

main().catch((err) => {
  console.error(`✗ Relay build failed: ${err.message}`);
  process.exit(1);
});
