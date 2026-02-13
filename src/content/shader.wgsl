/**
 * WebGPU шейдер для рендеринга снежинок
 * 
 * Uniform буфер с параметрами рендеринга
 * viewport: размеры viewport (ширина, высота)
 * glyphCount: количество глифов в атласе
 * glyphSize: размер одного глифа в пикселях
 * isMonotone: флаг монотонности (0 или 1)
 * glowStrength: сила свечения (0-1)
 * sentenceCount: количество предложений в атласе
 * sentenceSize: размер ячейки предложения в пикселях
 */
struct Uniforms {
  viewport: vec2<f32>,
  glyphCount: f32,
  glyphSize: f32,
  isMonotone: f32,
  glowStrength: f32,
  sentenceCount: f32,
  sentenceSize: f32,
};

// Bind group 0: uniform буфер и текстура глифов
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var glyphSampler: sampler;
@group(0) @binding(2) var glyphTexture: texture_2d<f32>;
@group(0) @binding(3) var sentenceSampler: sampler;
@group(0) @binding(4) var sentenceTexture: texture_2d<f32>;
/**
 * Выходные данные вершинного шейдера
 */
struct VSOut {
  @builtin(position) position: vec4<f32>,  // Позиция в clip space
  @location(0) uv: vec2<f32>,               // UV координаты для текстуры
  @location(1) color: vec3<f32>,            // Цвет снежинки
  @location(2) glyph: f32,                  // Индекс глифа
  @location(3) monotone: f32,               // Флаг монотонности
  @location(4) phase: f32,                  // Фаза анимации
};

/**
 * Вершинный шейдер
 * Принимает данные квада (position, uvIn) и данные инстанса (i*)
 */
@vertex
fn vs(
  // Vertex attributes (квад)
  @location(0) position: vec2<f32>,   // Локальная позиция вершины квада
  @location(1) uvIn: vec2<f32>,       // UV координаты вершины
  
  // Instance attributes (данные снежинки)
  @location(2) iPos: vec2<f32>,       // Позиция снежинки на экране
  @location(3) iSize: f32,            // Размер снежинки
  @location(4) iFall: f32,            // Скорость падения (не используется в VS)
  @location(5) iPhase: f32,           // Фаза колебания
  @location(6) iFreq: f32,            // Частота колебания (не используется в VS)
  @location(7) iSway: f32,            // Амплитуда качания (информация, используется в логике коллизий)
  @location(8) iRot: f32,             // Текущий угол вращения (включает качание маятника)
  @location(9) iRotSpeed: f32,        // Скорость вращения (не используется в VS)
  @location(10) iColor: vec3<f32>,   // Цвет снежинки
  @location(11) iGlyph: f32,          // Индекс глифа в атласе
  @location(12) iMonotone: f32        // Флаг монотонности глифа
) -> VSOut {
  var out: VSOut;
  
  // Масштабируем квад до нужного размера
  let local = position * iSize;
  
  // Вращение вокруг центра
  let c = cos(iRot);
  let s = sin(iRot);
  let rotated = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);
  
  // Качание маятника теперь реализуется через ротацию (iRot содержит свингAngle)
  // Горизонтальное смещение больше не применяется - только визуальный наклон
  let world = vec2<f32>(iPos.x + rotated.x, iPos.y + rotated.y);
  
  // Конвертация в clip space координаты [-1, 1]
  let clip = vec2<f32>(
    (world.x / uniforms.viewport.x) * 2.0 - 1.0,
    1.0 - (world.y / uniforms.viewport.y) * 2.0
  );

  // Возвращаем вершинные данные
  var output: VSOut;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.uv = uvIn;
  output.color = iColor;
  output.glyph = iGlyph;
  output.monotone = iMonotone;
  output.phase = iPhase;
  return output;
}

/**
 * Фрагментный шейдер
 * Отвечает за рендеринг текстуры глифа с эффектами свечения
 */
@fragment
fn fs(
  @location(0) uv: vec2<f32>,       // UV координаты на квад
  @location(1) color: vec3<f32>,    // Цвет снежинки
  @location(2) glyph: f32,          // Индекс глифа
  @location(3) monotone: f32,       // Флаг монотонности
  @location(4) phase: f32           // Фаза для мерцания
) -> @location(0) vec4<f32> {
  // Определяем индекс глифа в атласе
  let totalCount = max(1, i32(uniforms.glyphCount + uniforms.sentenceCount));
  let glyphIdx = clamp(i32(round(glyph)), 0, totalCount - 1);
  let isGlyph = glyphIdx < i32(uniforms.glyphCount);

  // Семплируем оба атласа (uniform control flow), затем выбираем нужный
  let glyphAtlasWidth = max(1.0, uniforms.glyphSize * uniforms.glyphCount);
  let glyphUV = vec2<f32>(
    (uv.x * uniforms.glyphSize + uniforms.glyphSize * f32(glyphIdx)) / glyphAtlasWidth,
    uv.y
  );
  let glyphSample = textureSample(glyphTexture, glyphSampler, glyphUV);

  let localIdx = max(0, glyphIdx - i32(uniforms.glyphCount));
  let sentenceAtlasHeight = max(1.0, uniforms.sentenceSize * uniforms.sentenceCount);
  let sentenceUV = vec2<f32>(
    uv.x,
    (uv.y * uniforms.sentenceSize + uniforms.sentenceSize * f32(localIdx)) / sentenceAtlasHeight
  );
  let sentenceSample = textureSample(sentenceTexture, sentenceSampler, sentenceUV);

  let glyphSampleFinal = select(sentenceSample, glyphSample, isGlyph);
  
  // Вычисляем halo эффект (свечение вокруг снежинки)
  let p = uv * 2.0 - 1.0;  // Центрируем UV [-1, 1]
  let dist = length(p);
  let halo = select(0.0, exp(-3.5 * dot(p, p)), dist <= 1.0);
  
  // Определяем базовый цвет в зависимости от типа глифа
  var baseColor = vec3<f32>(1.0, 1.0, 1.0);
  if (monotone > 0.5) {
    // Монотонный глиф - применяем наш цвет
    baseColor = color;
  } else {
    // Цветной глиф - смешиваем с текстурой
    baseColor = mix(color, glyphSampleFinal.rgb, glyphSampleFinal.a);
  }
  
  // Добавляем эффект мерцающего свечения с плавным наростанием и затуханием
  // Свечение видно там, где нет символа (позади)
  let cycle = (sin(phase * 2.0) + 1.0) * 0.5;  // Нормализуем в [0, 1]
  let smoothFlicker = smoothstep(0.0, 1.0, cycle);  // Встроенная функция сглаживания
  let flicker = 0.3 + 0.7 * smoothFlicker;  // Мерцание от 0.3 до 1.0
  let glowContribution = halo * uniforms.glowStrength * (1.0 - glyphSampleFinal.a) * flicker;
  let finalColor = baseColor + color * glowContribution;
  
  // Итоговая прозрачность с учетом мерцающего halo
  let alpha = clamp(glyphSampleFinal.a + halo * 0.35 * flicker, 0.0, 1.0);
  
  return vec4<f32>(finalColor, alpha);
}