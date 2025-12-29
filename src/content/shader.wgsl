struct Uniforms {
  viewport: vec2<f32>,
  glyphCount: f32,
  glyphSize: f32,
  isMonotone: f32,
  glowStrength: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var glyphSampler: sampler;
@group(0) @binding(2) var glyphTexture: texture_2d<f32>;
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) glyph: f32,
  @location(3) size: f32,
  @location(4) phase: f32,
};
@vertex
fn vs(
  @location(0) position: vec2<f32>,
  @location(1) uvIn: vec2<f32>,
  @location(2) iPos: vec2<f32>,
  @location(3) iSize: f32,
  @location(4) iFall: f32,
  @location(5) iPhase: f32,
  @location(6) iFreq: f32,
  @location(7) iSway: f32,
  @location(8) iRot: f32,
  @location(9) iRotSpeed: f32,
  @location(10) iColor: vec3<f32>,
  @location(11) iGlyph: f32
) -> VSOut {
  var out: VSOut;
  let local = position * iSize;
  let c = cos(iRot);
  let s = sin(iRot);
  let rotated = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);
  let sway = sin(iPhase) * iSway;
  let world = vec2<f32>(iPos.x + rotated.x + sway, iPos.y + rotated.y);
  let clip = vec2<f32>(
    (world.x / uniforms.viewport.x) * 2.0 - 1.0,
    1.0 - (world.y / uniforms.viewport.y) * 2.0
  );
  out.position = vec4<f32>(clip, 0.0, 1.0);
  out.uv = uvIn;
  out.color = iColor;
  out.glyph = iGlyph;
  out.size = iSize;
  out.phase = iPhase;
  return out;
}
@fragment
fn fs(
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) glyph: f32,
  @location(3) size: f32,
  @location(4) phase: f32
) -> @location(0) vec4<f32> {
  let glyphIdx = clamp(i32(round(glyph)), 0, i32(uniforms.glyphCount) - 1);
  let atlasWidth = uniforms.glyphSize * uniforms.glyphCount;
  let atlasUV = vec2<f32>(
    (uv.x * uniforms.glyphSize + uniforms.glyphSize * f32(glyphIdx)) / atlasWidth,
    uv.y
  );
  let glyphSample = textureSample(glyphTexture, glyphSampler, atlasUV);
  
  let p = uv * 2.0 - 1.0;
  let r = length(p);
  let sizeFactor = clamp(size / uniforms.glyphSize, 0.5, 6.0);
  let flickerWave = sin(phase * 1.35 + size * 0.05) * 0.5 + 0.5;
  let flicker = 0.65 + flickerWave * 0.45;
  
  // 1. Вычисляем форму свечения (только альфа)
  let gaussian = exp(-pow(r * sizeFactor * 0.95, 1.35));
  let rimFade = 1.0 - smoothstep(0.42, 0.98, r);
  let coreBoost = 1.15 + smoothstep(0.0, 0.55, 1.0 - r) * 0.35;
  let halo = gaussian * rimFade * coreBoost;
  
  // 2. Альфа свечения - делаем его независимым от цвета объекта
  let haloAlpha = halo * (1.0 - smoothstep(0.7, 0.98, r)) * 0.22;
  
  // 3. Цвет объекта только для глифа
  var finalColor: vec3<f32>;
  if (uniforms.isMonotone > 0.5) {
    finalColor = color;
  } else {
    finalColor = glyphSample.rgb * color;
  }
  
  // 4. Глиф должен перекрывать свечение в центре
  let glyphAlpha = glyphSample.a;
  let glowAlpha = haloAlpha * flicker * (1.0 - glyphAlpha) * uniforms.glowStrength;
  let combinedAlpha = glyphAlpha + glowAlpha;

  // 5. Ключевое изменение: свечение всегда белое (или светлое)
  // На белом фоне это создаст эффект светящегося ореола
  let glowColor = vec3<f32>(1.0, 1.0, 1.0); // Всегда белый
  
  // 6. Смешиваем: глиф с исходным цветом, свечение с оттенком цвета объекта
  let tintedGlow = mix(glowColor, finalColor, 0.4);
  
  let colorSum = tintedGlow * glowAlpha + finalColor * glyphAlpha;
  
  // Премультиплицированный вывод
  return vec4<f32>(colorSum, combinedAlpha);
}