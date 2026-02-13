/**
 * Playground bridge - loads content script from source
 * Enables hot reload testing without extension installation
 */

import { startSnow as startSnowOriginal, stopSnow as stopSnowOriginal } from '../src/content/index.js';

/**
 * Start snow animation with given config
 * @param {Object} config - Snow configuration
 */
export async function startSnow(config = {}) {
  console.log('🎿 Playground: Starting snow with config:', config);
  if (config.windEnabled) {
    console.log('  🌬️ Wind is ENABLED - direction:', config.windDirection, 'strength:', config.windStrength);
  } else {
    console.log('  🌬️ Wind is DISABLED');
  }
  await startSnowOriginal(config);
  console.log('✓ Snow started');
}

/**
 * Stop snow animation
 */
export function stopSnow() {
  stopSnowOriginal();
  console.log('✓ Snow stopped');
}

