/**
 * Встроенные шаблоны пресетов для popup.
 * Храним отдельно от UI-логики для удобного расширения.
 */

export const BUILT_IN_PRESET_TEMPLATES = [
  {
    id: 'winter',
    nameKey: 'presetTemplateWinter',
    legacyNames: ['Winter', 'Зимний'],
    settings: {
      snowmax: 120,
      snowminsize: 2.1,
      snowmaxsize: 4.5,
      snowFluffiness: 0.3,
      snowShape: 'auto',
      gravity: 9.81,
      airDensity: 1.2,
      colors: ['#ffffff', '#dff4ff', '#bfe8ff', '#9bd7ff'],
      symbols: ['❄', '❅', '❆', '✦', '⋆'],
      symbolModes: ['text', 'text', 'text', 'text', 'text'],
      windEnabled: true,
      windDirection: 'random',
      windStrength: 0.6,
      windGustFrequency: 3.5,
      windGustStrength: 0.35,
      turbulenceStrength: 0.2,
      updraftStrength: 0
    }
  },
  {
    id: 'spring',
    nameKey: 'presetTemplateSpring',
    legacyNames: ['Spring', 'Весенний'],
    settings: {
      snowmax: 95,
      snowminsize: 2.0,
      snowmaxsize: 4.0,
      snowFluffiness: 0.55,
      snowShape: 'auto',
      gravity: 9.81,
      airDensity: 1.2,
      colors: ['#ffe3f1', '#ffd6e7', '#d8f3dc', '#cdb4db'],
      symbols: ['🌸', '✿', '❀', '✽'],
      symbolModes: ['emoji', 'text', 'text', 'text'],
      windEnabled: true,
      windDirection: 'random',
      windStrength: 0.8,
      windGustFrequency: 2.8,
      windGustStrength: 0.35,
      turbulenceStrength: 0.2,
      updraftStrength: 0
    }
  },
  {
    id: 'summer',
    nameKey: 'presetTemplateSummer',
    legacyNames: ['Summer', 'Летний'],
    settings: {
      snowmax: 80,
      snowminsize: 2.3,
      snowmaxsize: 5.2,
      snowFluffiness: 0.2,
      snowShape: 'auto',
      gravity: 9.81,
      airDensity: 1.2,
      colors: ['#fff4b8', '#ffd166', '#ffe29a', '#fff8d6'],
      symbols: ['☀', '✶', '✷', '✸'],
      symbolModes: ['text', 'text', 'text', 'text'],
      windEnabled: true,
      windDirection: 'right',
      windStrength: 0.7,
      windGustFrequency: 4,
      windGustStrength: 0.35,
      turbulenceStrength: 0.2,
      updraftStrength: 0
    }
  },
  {
    id: 'autumn',
    nameKey: 'presetTemplateAutumn',
    legacyNames: ['Autumn', 'Осенний'],
    settings: {
      snowmax: 90,
      snowminsize: 2.2,
      snowmaxsize: 4.8,
      snowFluffiness: 0.45,
      snowShape: 'auto',
      gravity: 9.81,
      airDensity: 1.2,
      colors: ['#f4a261', '#e76f51', '#d97706', '#ffb703'],
      symbols: ['🍁', '🍂', '✶', '✦'],
      symbolModes: ['emoji', 'emoji', 'text', 'text'],
      windEnabled: true,
      windDirection: 'left',
      windStrength: 1.0,
      windGustFrequency: 2.4,
      windGustStrength: 0.35,
      turbulenceStrength: 0.2,
      updraftStrength: 0
    }
  },
  {
    id: 'chess',
    nameKey: 'presetTemplateChess',
    legacyNames: ['Chess', 'Шахматный'],
    settings: {
      snowmax: 42,
      snowminsize: 15,
      snowmaxsize: 40,
      snowFluffiness: 0.1,
      snowShape: 'auto',
      gravity: 9.81,
      airDensity: 1.2,
      colors: ['#fffac7','#454545'],
      symbols: ['♚','♛','♜','♝','♞','♟'],
      symbolModes: ['text','text','text','text','text','text'],
      windEnabled: false,
      windDirection: 'left',
      windStrength: 0.5,
      windGustFrequency: 3,
      windGustStrength: 0.35,
      turbulenceStrength: 0.2,
      updraftStrength: 0
    }
  }
];

export function createBuiltInPresets(baseSettings, { createPresetObject, t }) {
  const defaultPreset = createPresetObject(t('presetDefaultName'), baseSettings);
  defaultPreset.id = 'builtin:default';
  defaultPreset.builtInKey = 'default';
  const seasonalPresets = BUILT_IN_PRESET_TEMPLATES.map((template) => {
    const preset = createPresetObject(t(template.nameKey), template.settings);
    preset.id = `builtin:${template.id}`;
    preset.builtInKey = template.id;
    return preset;
  });

  return [defaultPreset, ...seasonalPresets];
}
