import { sanitizeStartConfig } from '../api/command-protocol.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const splitList = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined);

export function parseOverlaySnowConfig(query) {
  const config = sanitizeStartConfig({
    snowmax: query.get('snowmax') ?? undefined,
    sinkspeed: query.get('speed') ?? query.get('sinkspeed') ?? undefined,
    gravity: query.get('gravity') ?? undefined,
    snowminsize: query.get('minsize') ?? undefined,
    snowmaxsize: query.get('maxsize') ?? undefined,
    colors: splitList(query.get('colors')),
    symbols: splitList(query.get('symbols')),
    snowglyphmodes: splitList(query.get('symbolModes')),
    glyphMode: query.get('glyphMode') ?? undefined,
    rendererMode: query.get('renderer') ?? undefined,
    windEnabled: query.has('wind') ? query.get('wind') === '1' : undefined,
    windDirection: query.get('windDirection') ?? undefined,
    windStrength: query.get('windStrength') ?? undefined
  });
  const spawnSpanRatio = Number(query.get('initialSpawnSpanRatio'));
  if (Number.isFinite(spawnSpanRatio) && spawnSpanRatio > 0) {
    config.initialSpawnSpanRatio = clamp(spawnSpanRatio, 0.05, 3);
  }
  if (query.get('initialDistribution') === 'viewport') {
    config.initialDistribution = 'viewport';
  }
  return config;
}
