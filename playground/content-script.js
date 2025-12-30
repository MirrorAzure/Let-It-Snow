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
  await startSnowOriginal(config);
  console.log('✓ Snow started with config:', config);
}

/**
 * Stop snow animation
 */
export function stopSnow() {
  stopSnowOriginal();
  console.log('✓ Snow stopped');
}

