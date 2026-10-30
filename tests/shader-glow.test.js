import { describe, expect, it } from 'vitest';
import shaderSource from '../src/content/shader.wgsl?raw';
import fallbackRendererSource from '../src/content/fallback-2d-renderer.js?raw';

describe('WebGPU glow shader', () => {
  it('blurs glyph coverage into a visible halo with a pronounced pulse', () => {
    expect(shaderSource).toContain('let glowPadding = (glowRadius * 1.8) / max(iSize, 1.0);');
    expect(shaderSource).toContain('let glowOpacity = 0.58 + uniforms.glowStrength * 0.55;');
    expect(shaderSource).toContain('let blurredCoverage = center * 0.25');
    expect(shaderSource).toContain('let pulse = 0.68 + 0.32 * sin(phase * 1.6);');
    expect(shaderSource).not.toContain('resolveGlowProjection');
  });

  it('uses a matching pulse and additive blend for Canvas2D glow', () => {
    expect(fallbackRendererSource).toContain("ctx.globalCompositeOperation = 'lighter';");
    expect(fallbackRendererSource).toContain('0.58 + glowStrength * 0.55');
    expect(fallbackRendererSource).toContain('0.68 + 0.32 * Math.sin((flake.phase || 0) * 1.6)');
  });
});
