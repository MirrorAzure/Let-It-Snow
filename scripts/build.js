import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const buildsDir = path.join(rootDir, 'builds');
const srcDir = path.join(rootDir, 'src');

// Убедимся, что папка builds существует
if (!fs.existsSync(buildsDir)) {
  fs.mkdirSync(buildsDir, { recursive: true });
}

const browsers = ['chrome', 'firefox', 'edge'];

console.log('🏗️  Начинаем сборку расширения для всех браузеров...\n');

try {
  // Очищаем папку dist
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  // Создаем manifest для каждого браузера и собираем
  for (const browser of browsers) {
    console.log(`📦 Собираем для ${browser.toUpperCase()}...`);

    // Копируем нужный манифест
    const manifestPath = path.join(srcDir, 'manifest.json');
    const browserManifestPath = path.join(srcDir, 'manifests', `manifest.${browser}.json`);

    if (fs.existsSync(browserManifestPath)) {
      const manifest = fs.readFileSync(browserManifestPath, 'utf-8');
      fs.writeFileSync(manifestPath, manifest);
      console.log(`   ✓ Использован manifest для ${browser}`);
    }

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

  // Восстанавливаем оригинальный manifest (для Chrome по умолчанию)
  const originalManifestPath = path.join(srcDir, 'manifests', 'manifest.chrome.json');
  const originalManifest = fs.readFileSync(originalManifestPath, 'utf-8');
  fs.writeFileSync(path.join(srcDir, 'manifest.json'), originalManifest);
  console.log('\n✓ Оригинальный manifest восстановлен\n');

  // Упаковываем для Chrome и Edge (CRX)
  console.log('📦 Упаковываем сборки...');

  try {
    execSync('pnpm pack:chrome', { cwd: rootDir, stdio: 'pipe' });
    console.log('   ✓ Chrome: let-it-snow-chrome.crx');
  } catch (error) {
    console.warn('   ⚠ Chrome CRX:', error.message);
  }

  // Firefox упаковывается в ZIP (создаем вручную)
  const firefoxDistDir = path.join(distDir, 'firefox');
  if (fs.existsSync(firefoxDistDir)) {
    try {
      execSync(`cd "${firefoxDistDir}" && zip -r "${path.join(buildsDir, 'let-it-snow-firefox.zip')}" .`, {
        stdio: 'pipe'
      });
      console.log('   ✓ Firefox: let-it-snow-firefox.zip');
    } catch (error) {
      console.warn('   ⚠ Firefox ZIP (требуется zip утилита)');
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

} catch (error) {
  console.error('\n❌ Ошибка при сборке:', error.message);
  process.exit(1);
}
