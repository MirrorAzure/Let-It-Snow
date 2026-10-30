/**
 * WebGPU шейдер для рендеринга снежинок.
 * Свечение и поверхность глифа рисуются разными проходами:
 * 1. glow-pass строит внешний halo от контура
 * 2. surface-pass рисует сам глиф поверх halo
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

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var glyphSampler: sampler;
@group(0) @binding(2) var glyphTexture: texture_2d<f32>;
@group(0) @binding(3) var sentenceSampler: sampler;
@group(0) @binding(4) var sentenceTexture: texture_2d<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) glyph: f32,
  @location(3) monotone: f32,
  @location(4) phase: f32,
  @location(5) glowPadding: f32,
};

struct AtlasSelection {
  glyphIdx: i32,
  localIdx: i32,
  isGlyph: bool,
};

fn resolveAtlasSelection(glyph: f32) -> AtlasSelection {
  let totalCount = max(1, i32(uniforms.glyphCount + uniforms.sentenceCount));
  let glyphIdx = clamp(i32(round(glyph)), 0, totalCount - 1);
  let isGlyph = glyphIdx < i32(uniforms.glyphCount);

  var selection: AtlasSelection;
  selection.glyphIdx = glyphIdx;
  selection.localIdx = max(0, glyphIdx - i32(uniforms.glyphCount));
  selection.isGlyph = isGlyph;
  return selection;
}

fn sampleSelectedAtlas(selection: AtlasSelection, uv: vec2<f32>) -> vec4<f32> {
  let safeUv = clamp(uv, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));

  let glyphAtlasWidth = max(1.0, uniforms.glyphSize * uniforms.glyphCount);
  let glyphInset = vec2<f32>(
    0.5 / glyphAtlasWidth,
    0.5 / max(1.0, uniforms.glyphSize)
  );
  let safeGlyphUV = mix(glyphInset, vec2<f32>(1.0, 1.0) - glyphInset, safeUv);
  let glyphUV = vec2<f32>(
    (safeGlyphUV.x * uniforms.glyphSize + uniforms.glyphSize * f32(selection.glyphIdx)) / glyphAtlasWidth,
    safeGlyphUV.y
  );
  let glyphSample = textureSample(glyphTexture, glyphSampler, glyphUV);

  let sentenceAtlasHeight = max(1.0, uniforms.sentenceSize * uniforms.sentenceCount);
  let sentenceInset = vec2<f32>(
    0.5 / max(1.0, uniforms.sentenceSize * 2.0),
    0.5 / sentenceAtlasHeight
  );
  let safeSentenceUV = mix(sentenceInset, vec2<f32>(1.0, 1.0) - sentenceInset, safeUv);
  let sentenceUV = vec2<f32>(
    safeSentenceUV.x,
    (safeSentenceUV.y * uniforms.sentenceSize + uniforms.sentenceSize * f32(selection.localIdx)) / sentenceAtlasHeight
  );
  let sentenceSample = textureSample(sentenceTexture, sentenceSampler, sentenceUV);

  return select(sentenceSample, glyphSample, selection.isGlyph);
}

fn resolveSurfaceAlpha(sample: vec4<f32>, uv: vec2<f32>, isGlyph: bool, monotone: f32) -> f32 {
  let rawAlpha = sample.a;
  let isSdfGlyph = isGlyph && monotone > 0.5 && uniforms.isMonotone > 0.5;
  let encodedCoverage = clamp((sample.r + sample.g + sample.b) / 3.0, 0.0, 1.0);
  let atlasCellWidth = select(uniforms.sentenceSize * 2.0, uniforms.glyphSize, isGlyph);
  let atlasCellHeight = select(uniforms.sentenceSize, uniforms.glyphSize, isGlyph);
  let glyphTexelFootprint = max(
    length(vec2<f32>(fwidth(uv.x * atlasCellWidth), fwidth(uv.y * atlasCellHeight))),
    1.0
  );
  let sdfSpread = clamp(uniforms.glyphSize * 0.16, 7.0, 28.0);
  let sdfWidth = clamp((0.5 * glyphTexelFootprint) / max(1.0, sdfSpread), 0.02, 0.25);
  let sdfAlpha = smoothstep(0.5 - sdfWidth, 0.5 + sdfWidth, rawAlpha);
  let preservedCoverage = max(sdfAlpha, encodedCoverage);
  let minifiedCoverageBlend = smoothstep(1.0, 1.9, glyphTexelFootprint);
  let resolvedSdfAlpha = mix(sdfAlpha, preservedCoverage, minifiedCoverageBlend);
  let edgeBoost = 0.18;
  let boostedAlpha = clamp(rawAlpha + rawAlpha * (1.0 - rawAlpha) * edgeBoost, 0.0, 1.0);
  return select(boostedAlpha, resolvedSdfAlpha, isSdfGlyph);
}

fn sampleGlowCoverage(selection: AtlasSelection, uv: vec2<f32>, monotone: f32) -> f32 {
  let inBounds = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  let sample = sampleSelectedAtlas(selection, uv);
  return select(0.0, resolveSurfaceAlpha(sample, uv, selection.isGlyph, monotone), inBounds);
}

fn resolveSurfaceColor(sample: vec4<f32>, surfaceAlpha: f32, color: vec3<f32>, monotone: f32) -> vec3<f32> {
  var surfaceColor = sample.rgb * surfaceAlpha;
  if (monotone > 0.5) {
    surfaceColor = color * surfaceAlpha;
  }
  return surfaceColor;
}

fn buildVertexOutput(
  position: vec2<f32>,
  outputUv: vec2<f32>,
  iPos: vec2<f32>,
  iSize: f32,
  iRot: f32,
  iColor: vec3<f32>,
  iGlyph: f32,
  iMonotone: f32,
  iPhase: f32,
  quadScale: f32,
  glowPadding: f32
) -> VSOut {
  let sentenceAspect = 2.0;
  let isGlyph = iGlyph < uniforms.glyphCount;
  let scaleX = select(sentenceAspect, 1.0, isGlyph);
  let local = vec2<f32>(position.x * iSize * scaleX * quadScale, position.y * iSize * quadScale);

  let c = cos(iRot);
  let s = sin(iRot);
  let rotated = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);
  let world = vec2<f32>(iPos.x + rotated.x, iPos.y + rotated.y);

  let clip = vec2<f32>(
    (world.x / uniforms.viewport.x) * 2.0 - 1.0,
    1.0 - (world.y / uniforms.viewport.y) * 2.0
  );

  var output: VSOut;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.uv = outputUv;
  output.color = iColor;
  output.glyph = iGlyph;
  output.monotone = iMonotone;
  output.phase = iPhase;
  output.glowPadding = glowPadding;
  return output;
}

@vertex
fn vsSurface(
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
  @location(11) iGlyph: f32,
  @location(12) iMonotone: f32
) -> VSOut {
  return buildVertexOutput(position, uvIn, iPos, iSize, iRot, iColor, iGlyph, iMonotone, iPhase, 1.0, 0.0);
}

@vertex
fn vsGlow(
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
  @location(11) iGlyph: f32,
  @location(12) iMonotone: f32
) -> VSOut {
  let isGlyph = iGlyph < uniforms.glyphCount;
  let maxGlowRadius = select(6.5, 5.8, isGlyph);
  let glowRadius = clamp(
    sqrt(max(1.0, iSize)) * (0.4 + uniforms.glowStrength * 0.55),
    1.5,
    maxGlowRadius
  );
  let glowPadding = (glowRadius * 1.8) / max(iSize, 1.0);
  let glowScale = 1.0 + glowPadding * 2.0;
  let boundedGlowUV = mix(vec2<f32>(-glowPadding, -glowPadding), vec2<f32>(1.0 + glowPadding, 1.0 + glowPadding), uvIn);
  return buildVertexOutput(position, boundedGlowUV, iPos, iSize, iRot, iColor, iGlyph, iMonotone, iPhase, glowScale, glowPadding);
}

@fragment
fn fsSurface(
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) glyph: f32,
  @location(3) monotone: f32,
  @location(4) phase: f32
) -> @location(0) vec4<f32> {
  let selection = resolveAtlasSelection(glyph);
  let sample = sampleSelectedAtlas(selection, uv);
  let surfaceAlpha = resolveSurfaceAlpha(sample, uv, selection.isGlyph, monotone);
  let surfaceColor = resolveSurfaceColor(sample, surfaceAlpha, color, monotone);
  return vec4<f32>(surfaceColor, surfaceAlpha);
}

@fragment
fn fsGlow(
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) glyph: f32,
  @location(3) monotone: f32,
  @location(4) phase: f32,
  @location(5) glowPadding: f32
) -> @location(0) vec4<f32> {
  let selection = resolveAtlasSelection(glyph);
  let blurRadiusUv = glowPadding / (1.0 + 2.0 * glowPadding);
  let diagonalOffset = blurRadiusUv * 0.70710678;
  let center = sampleGlowCoverage(selection, uv, monotone);
  let top = sampleGlowCoverage(selection, uv + vec2<f32>(0.0, -blurRadiusUv), monotone);
  let bottom = sampleGlowCoverage(selection, uv + vec2<f32>(0.0, blurRadiusUv), monotone);
  let left = sampleGlowCoverage(selection, uv + vec2<f32>(-blurRadiusUv, 0.0), monotone);
  let right = sampleGlowCoverage(selection, uv + vec2<f32>(blurRadiusUv, 0.0), monotone);
  let topLeft = sampleGlowCoverage(selection, uv + vec2<f32>(-diagonalOffset, -diagonalOffset), monotone);
  let topRight = sampleGlowCoverage(selection, uv + vec2<f32>(diagonalOffset, -diagonalOffset), monotone);
  let bottomLeft = sampleGlowCoverage(selection, uv + vec2<f32>(-diagonalOffset, diagonalOffset), monotone);
  let bottomRight = sampleGlowCoverage(selection, uv + vec2<f32>(diagonalOffset, diagonalOffset), monotone);
  let blurredCoverage = center * 0.25
    + (top + bottom + left + right) * 0.125
    + (topLeft + topRight + bottomLeft + bottomRight) * 0.0625;
  let surfaceCoverage = sampleGlowCoverage(selection, uv, monotone);
  let haloSignal = max(0.0, blurredCoverage - surfaceCoverage);
  let glowOpacity = 0.58 + uniforms.glowStrength * 0.55;
  let pulse = 0.68 + 0.32 * sin(phase * 1.6);
  let glowAlpha = clamp(haloSignal * glowOpacity * pulse, 0.0, 1.0);
  let glowTint = color;

  return vec4<f32>(glowTint * glowAlpha, glowAlpha);
}