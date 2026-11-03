import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const buildsDir = path.join(rootDir, 'builds');
const srcDir = path.join(rootDir, 'src');

// Функция для создания zip-архива
function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// Убедимся, что папка builds существует
if (!fs.existsSync(buildsDir)) {
  fs.mkdirSync(buildsDir, { recursive: true });
}

const browsers = ['chrome', 'firefox', 'edge'];

console.log('🏗️  Начинаем сборку расширения для всех браузеров...\n');

(async () => {
try {
  // Очищаем папку dist
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  // Собираем каждый браузер с соответствующим manifest из vite.config.js.
  for (const browser of browsers) {
    console.log(`📦 Собираем для ${browser.toUpperCase()}...`);

    // Запускаем vite build для конкретного браузера
    try {
      execSync(`pnpm build:${browser}`, {
        cwd: rootDir,
        stdio: 'pipe'
      });
      console.log(`   ✓ Сборка завершена для ${browser}`);

      // Копируем локализации (_locales) в итоговую сборку, чтобы default_locale не ломал установку
      const localesSrc = path.join(srcDir, '_locales');
      const localesDest = path.join(distDir, browser, '_locales');
      if (fs.existsSync(localesSrc)) {
        fs.cpSync(localesSrc, localesDest, { recursive: true });
        console.log('   ✓ Локализации скопированы');
      } else {
        console.warn('   ⚠ Папка _locales не найдена и не была скопирована');
      }
    } catch (error) {
      console.error(`   ✗ Ошибка сборки для ${browser}:`, error.message);
      throw error;
    }
  }

  // OBS-оверлей (раздаётся локальным relay: pnpm relay → /obs/)
  console.log('📦 Собираем OBS-оверлей...');
  execSync('pnpm build:obs', { cwd: rootDir, stdio: 'pipe' });
  console.log('   ✓ dist/obs');

  // Упаковываем для Chrome и Edge
  console.log('📦 Упаковываем сборки...');

  // Chrome - создаем zip для Chrome Web Store
  const chromeDistDir = path.join(distDir, 'chrome');
  if (fs.existsSync(chromeDistDir)) {
    try {
      const chromeZipPath = path.join(buildsDir, 'let-it-snow-chrome.zip');
      await createZip(chromeDistDir, chromeZipPath);
      console.log('   ✓ Chrome: let-it-snow-chrome.zip (для Chrome Web Store)');
    } catch (error) {
      console.warn('   ⚠ Chrome ZIP:', error.message);
    }
  }

  // Firefox упаковывается в ZIP
  const firefoxDistDir = path.join(distDir, 'firefox');
  if (fs.existsSync(firefoxDistDir)) {
    try {
      const firefoxZipPath = path.join(buildsDir, 'let-it-snow-firefox.zip');
      await createZip(firefoxDistDir, firefoxZipPath);
      console.log('   ✓ Firefox: let-it-snow-firefox.zip');
    } catch (error) {
      console.warn('   ⚠ Firefox ZIP:', error.message);
    }
  }

  try {
    execSync('pnpm pack:edge', { cwd: rootDir, stdio: 'pipe' });
    console.log('   ✓ Edge: let-it-snow-edge.crx');
  } catch (error) {
    console.warn('   ⚠ Edge CRX:', error.message);
  }

  console.log('\n✨ Сборка завершена успешно!');
  console.log(`📁 Готовые файлы находятся в папке: ${buildsDir}`);
  console.log(`📂 Распакованные сборки в: ${distDir}`);

  // Материалы Chrome Web Store (скриншоты, промо, описания en/ru) — только локально, не в CI
  const skipStoreAssets = process.env.CI || process.env.SKIP_STORE_ASSETS === '1' || process.argv.includes('--no-store-assets');
  if (!skipStoreAssets) {
    console.log('');
    try {
      const { generateStoreAssets } = await import('./build-store-assets.js');
      const { screenshots } = await generateStoreAssets();
      console.log(`   ✓ store-assets/ (${screenshots} изображений, описания en/ru)`);
    } catch (error) {
      console.warn('   ⚠ Материалы Chrome Web Store не созданы:', error.message);
    }
  }

} catch (error) {
  console.error('\n❌ Ошибка при сборке:', error.message);
  process.exit(1);
}
})();
