/**
 * Встроенные шаблоны пресетов для popup.
 * Храним отдельно от UI-логики для удобного расширения.
 */

export const BUILT_IN_PRESET_TEMPLATES = [
  {
    nameKey: 'presetTemplateWinter',
    settings: {
      snowmax: 120,
      sinkspeed: 0.5,
      snowminsize: 2.1,
      snowmaxsize: 4.5,
      colors: ['#ffffff', '#dff4ff', '#bfe8ff', '#9bd7ff'],
      symbols: ['❄', '❅', '❆', '✦', '⋆'],
      symbolModes: ['text', 'text', 'text', 'text', 'text'],
      windEnabled: true,
      windDirection: 'random',
      windStrength: 0.6,
      windGustFrequency: 3.5
    }
  },
  {
    nameKey: 'presetTemplateSpring',
    settings: {
      snowmax: 95,
      sinkspeed: 0.6,
      snowminsize: 2.0,
      snowmaxsize: 4.0,
      colors: ['#ffe3f1', '#ffd6e7', '#d8f3dc', '#cdb4db'],
      symbols: ['🌸', '✿', '❀', '✽'],
      symbolModes: ['emoji', 'text', 'text', 'text'],
      windEnabled: true,
      windDirection: 'random',
      windStrength: 0.8,
      windGustFrequency: 2.8
    }
  },
  {
    nameKey: 'presetTemplateSummer',
    settings: {
      snowmax: 80,
      sinkspeed: 0.8,
      snowminsize: 2.3,
      snowmaxsize: 5.2,
      colors: ['#fff4b8', '#ffd166', '#ffe29a', '#fff8d6'],
      symbols: ['☀', '✶', '✷', '✸'],
      symbolModes: ['text', 'text', 'text', 'text'],
      windEnabled: true,
      windDirection: 'right',
      windStrength: 0.7,
      windGustFrequency: 4
    }
  },
  {
    nameKey: 'presetTemplateAutumn',
    settings: {
      snowmax: 90,
      sinkspeed: 0.55,
      snowminsize: 2.2,
      snowmaxsize: 4.8,
      colors: ['#f4a261', '#e76f51', '#d97706', '#ffb703'],
      symbols: ['🍁', '🍂', '✶', '✦'],
      symbolModes: ['emoji', 'emoji', 'text', 'text'],
      windEnabled: true,
      windDirection: 'left',
      windStrength: 1.0,
      windGustFrequency: 2.4
    }
  },
  {
    nameKey: 'presetTemplateChess',
    settings: {
      snowmax: 42,
      sinkspeed: 1,
      snowminsize: 15,
      snowmaxsize: 40,
      colors: ['#fffac7','#454545'],
      symbols: ['♚','♛','♜','♝','♞','♟'],
      symbolModes: ['text','text','text','text','text','text'],
      windEnabled: false,
      windDirection: 'left',
      windStrength: 0.5,
      windGustFrequency: 3
    }
  }
];

export function createBuiltInPresets(baseSettings, { createPresetObject, t }) {
  const defaultPreset = createPresetObject(t('presetDefaultName'), baseSettings);
  const seasonalPresets = BUILT_IN_PRESET_TEMPLATES.map((template) => {
    return createPresetObject(t(template.nameKey), template.settings);
  });

  return [defaultPreset, ...seasonalPresets];
}
