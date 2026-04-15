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

const GLOW_PADDING: f32 = 1.15;
const GLOW_EXPANSION: f32 = 1.0 + GLOW_PADDING * 2.0;
const GLOW_FALLOFF: f32 = 2.1;
const GLOW_OPACITY: f32 = 1.35;

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
};

struct AtlasSelection {
  glyphIdx: i32,
  localIdx: i32,
  isGlyph: bool,
};

struct GlowProjection {
  uv: vec2<f32>,
  surfaceAlpha: f32,
  sampleAlpha: f32,
  travel: f32,
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

fn resolveSurfaceColor(sample: vec4<f32>, surfaceAlpha: f32, color: vec3<f32>, monotone: f32) -> vec3<f32> {
  var surfaceColor = sample.rgb * surfaceAlpha;
  if (monotone > 0.5) {
    surfaceColor = color * surfaceAlpha;
  }
  return surfaceColor;
}

fn resolveGlowFlicker(phase: f32) -> f32 {
  let primary = (sin(phase * 3) + 1.0) * 0.5;
  let secondary = (cos(phase * 5) + 1.0) * 0.5;
  let mixed = primary * 0.6 + secondary * 0.4;
  let smoothFlicker = smoothstep(0.0, 1.0, mixed);
  return 0.3 + 1.2 * smoothFlicker;
}

fn applyGlowProbe(
  current: GlowProjection,
  selection: AtlasSelection,
  probeUv: vec2<f32>,
  probeTravel: f32,
  monotone: f32
) -> GlowProjection {
  let probeSample = sampleSelectedAtlas(selection, probeUv);
  let probeSurfaceAlpha = resolveSurfaceAlpha(probeSample, probeUv, selection.isGlyph, monotone);
  let currentCoverage = max(current.surfaceAlpha, current.sampleAlpha);
  let probeCoverage = max(probeSurfaceAlpha, probeSample.a);
  let currentLocked = currentCoverage > 0.08;
  let probeLocked = probeCoverage > 0.08;
  let shouldReplace = select(
    probeCoverage > currentCoverage + 0.001,
    probeLocked && probeTravel < current.travel,
    currentLocked
  );

  var next = current;
  if (shouldReplace) {
    next.uv = probeUv;
    next.surfaceAlpha = probeSurfaceAlpha;
    next.sampleAlpha = probeSample.a;
    next.travel = probeTravel;
  }
  return next;
}

fn resolveGlowProjection(selection: AtlasSelection, projectedUv: vec2<f32>, monotone: f32) -> GlowProjection {
  let projectedSample = sampleSelectedAtlas(selection, projectedUv);
  let centerUv = vec2<f32>(0.5, 0.5);

  var result: GlowProjection;
  result.uv = projectedUv;
  result.surfaceAlpha = resolveSurfaceAlpha(projectedSample, projectedUv, selection.isGlyph, monotone);
  result.sampleAlpha = projectedSample.a;
  result.travel = 0.0;

  result = applyGlowProbe(result, selection, mix(projectedUv, centerUv, 0.14), 0.14, monotone);
  result = applyGlowProbe(result, selection, mix(projectedUv, centerUv, 0.28), 0.28, monotone);
  result = applyGlowProbe(result, selection, mix(projectedUv, centerUv, 0.44), 0.44, monotone);
  result = applyGlowProbe(result, selection, mix(projectedUv, centerUv, 0.62), 0.62, monotone);
  result = applyGlowProbe(result, selection, mix(projectedUv, centerUv, 0.8), 0.8, monotone);
  return result;
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
  quadScale: f32
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
  return buildVertexOutput(position, uvIn, iPos, iSize, iRot, iColor, iGlyph, iMonotone, iPhase, 1.0);
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
  let glowUV = mix(vec2<f32>(-GLOW_PADDING, -GLOW_PADDING), vec2<f32>(1.0 + GLOW_PADDING, 1.0 + GLOW_PADDING), uvIn);
  return buildVertexOutput(position, glowUV, iPos, iSize, iRot, iColor, iGlyph, iMonotone, iPhase, GLOW_EXPANSION);
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
  @location(4) phase: f32
) -> @location(0) vec4<f32> {
  let selection = resolveAtlasSelection(glyph);
  let projectedUv = clamp(uv, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
  let bboxDist = length(uv - projectedUv);
  let inBounds = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;

  let projectedSample = sampleSelectedAtlas(selection, projectedUv);
  let glowProjection = resolveGlowProjection(selection, projectedUv, monotone);
  let actualSurfaceAlpha = select(
    0.0,
    resolveSurfaceAlpha(projectedSample, projectedUv, selection.isGlyph, monotone),
    inBounds
  );

  let isSdfGlyph = selection.isGlyph && monotone > 0.5 && uniforms.isMonotone > 0.5;
  let supportFade = exp(-9.0 * glowProjection.travel * glowProjection.travel);
  let sdfOuterDistance = clamp(0.5 - glowProjection.sampleAlpha, 0.0, 0.5) * 1.4 + glowProjection.travel * 0.85;
  let alphaOuterDistance = max(0.0, 1.0 - glowProjection.surfaceAlpha) * 0.4 + glowProjection.travel * 0.85;
  let contourDistance = select(alphaOuterDistance, sdfOuterDistance, isSdfGlyph);
  let edgeCoverage = select(
    smoothstep(0.0, 0.5, glowProjection.surfaceAlpha) * supportFade,
    exp(-7.0 * contourDistance * contourDistance),
    isSdfGlyph
  );
  let haloSignal = edgeCoverage * exp(-GLOW_FALLOFF * bboxDist * bboxDist);
  let radialDistance = length((uv - vec2<f32>(0.5, 0.5)) * 2.0);
  let roundMask = 1.0 - smoothstep(1.05 + GLOW_PADDING * 0.25, 1.55 + GLOW_PADDING, radialDistance);
  let maxBBoxDist = length(vec2<f32>(GLOW_PADDING, GLOW_PADDING));
  let borderFade = 1.0 - smoothstep(maxBBoxDist * 0.6, maxBBoxDist * 1.0, bboxDist);
  let exteriorMask = 1.0 - smoothstep(0.1, 0.4, actualSurfaceAlpha);
  let flicker = resolveGlowFlicker(phase);
  let glowAlpha = clamp(haloSignal * roundMask * borderFade * exteriorMask * uniforms.glowStrength * flicker * GLOW_OPACITY, 0.0, 1.0);
  let glowTint = clamp(color * 1.5, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));

  return vec4<f32>(glowTint * glowAlpha, glowAlpha);
}