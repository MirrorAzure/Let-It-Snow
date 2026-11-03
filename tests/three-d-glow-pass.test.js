import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ThreeDGlowPass, resolveGlowTargetSize } from '../src/content/graphics/three-d-glow-pass.js';
import { ThreeDSnowRenderer, resolveGlowPulse } from '../src/content/three-d-renderer.js';

function createRendererStub() {
  return {
    autoClear: true,
    currentTarget: null,
    getRenderTarget() { return this.currentTarget; },
    setRenderTarget: vi.fn(function (target) { this.currentTarget = target; }),
    clear: vi.fn(),
    render: vi.fn()
  };
}

describe('3D glow pass', () => {
  it('bounds the glow buffers while keeping their aspect ratio', () => {
    expect(resolveGlowTargetSize(1000, 600)).toEqual({ width: 500, height: 300 });
    expect(resolveGlowTargetSize(3840, 2160)).toEqual({ width: 1024, height: 576 });
    expect(resolveGlowTargetSize(0, 0)).toEqual({ width: 1, height: 1 });
    expect(() => resolveGlowTargetSize(NaN, 600)).toThrow(RangeError);
    expect(() => resolveGlowTargetSize(1000, -1)).toThrow(RangeError);
  });

  it('uses the exact glyph geometry and instance transforms, including edge-on rotations', () => {
    const pass = new ThreeDGlowPass(createRendererStub());
    const material = new THREE.MeshBasicMaterial();
    const glyphMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1);
    const flake = {
      x: 200, y: 180, z: 0, size: 90, fallSpeed: 0,
      velocityX: 0, velocityY: 0, velocityZ: 0,
      rotationX: 0.8, rotationY: Math.PI / 2, rotationZ: 1.1,
      rotationSpeedX: 0, rotationSpeedY: 0, rotationSpeedZ: 0,
      glowPhase: 0, glowRgb: [0.8, 0.9, 1]
    };
    const glow = pass.addGlyphMesh(glyphMesh, [flake]);
    const snow = new ThreeDSnowRenderer(null, { enableCollisions: false });
    snow.viewportWidth = 1000;
    snow.viewportHeight = 600;
    snow.flakes = [flake];
    snow.glyphMeshes.set('flake', { mesh: glyphMesh, glow, flakes: [flake], aspect: 1 });

    snow._updateInstances(0);

    expect(glow.mesh.geometry).toBe(glyphMesh.geometry);
    expect(glow.mesh.instanceMatrix).toBe(glyphMesh.instanceMatrix);
    expect(glow.pulse.getX(0)).toBeCloseTo(resolveGlowPulse(0));
    const actual = new THREE.Matrix4();
    glow.mesh.getMatrixAt(0, actual);
    const position = snow._worldPosition(flake);
    const expected = new THREE.Object3D();
    expected.position.set(position.x, position.y, position.z);
    expected.rotation.set(flake.rotationX, flake.rotationY, flake.rotationZ);
    expected.scale.setScalar(flake.size * position.scale);
    expected.updateMatrix();
    actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.matrix.elements[index]));
    expect(pass.sourceMaterial.vertexShader).toContain('instanceMatrix');
    expect(pass.sourceMaterial.fragmentShader).toContain('vec4(vColor * vPulse, vPulse)');

    pass.dispose();
    glyphMesh.dispose();
    glyphMesh.geometry.dispose();
    material.dispose();
  });

  it('blurs the projected silhouettes and composites them behind the sharp flakes', () => {
    const renderer = createRendererStub();
    const pass = new ThreeDGlowPass(renderer);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const frames = [];
    renderer.render.mockImplementation((renderedScene) => {
      const uniforms = pass.blurMaterial.uniforms;
      frames.push({
        scene: renderedScene,
        target: renderer.currentTarget,
        source: uniforms.sourceMap.value,
        step: uniforms.pixelStep.value.toArray(),
        opacity: uniforms.opacity.value,
        whiten: uniforms.whiten.value,
        background: uniforms.backgroundColor.value.toArray()
      });
    });
    pass.resize(1000, 600);
    pass.setGlowState(0.42, 1, { r: 0.95, g: 0.97, b: 1 });

    pass.render(scene, camera);

    expect(frames.map((frame) => frame.scene)).toEqual([
      pass.scene, pass.screenScene, pass.screenScene, scene
    ]);
    expect(frames[0].target).toBe(pass.sourceTarget);
    expect(frames[1]).toMatchObject({
      target: pass.blurTarget, source: pass.sourceTarget.texture,
      step: [1 / 500, 0], opacity: 1, whiten: 0, background: [0, 0, 0]
    });
    expect(frames[2].target).toBeNull();
    expect(frames[2].source).toBe(pass.blurTarget.texture);
    expect(frames[2].step).toEqual([0, 1 / 300]);
    expect(frames[2].opacity).toBeCloseTo(0.9 * 0.42);
    expect(frames[2].whiten).toBe(1);
    expect(frames[2].background).toEqual([0.95, 0.97, 1]);
    expect(pass.blurMaterial.fragmentShader).toContain('vec3(blurred.a), whiten');
    expect(pass.blurMaterial.fragmentShader).toContain('max(blurred.rgb, backgroundColor * blurred.a)');
    expect(pass.blurMaterial.blending).toBe(THREE.NoBlending);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.currentTarget).toBeNull();
    pass.dispose();
  });

  it('restores renderer state if a render pass fails', () => {
    const renderer = createRendererStub();
    const target = new THREE.WebGLRenderTarget(1, 1);
    renderer.currentTarget = target;
    renderer.autoClear = false;
    renderer.render.mockImplementation(() => { throw new Error('render failed'); });
    const pass = new ThreeDGlowPass(renderer);

    expect(() => pass.render(new THREE.Scene(), new THREE.Camera())).toThrow('render failed');
    expect(renderer.currentTarget).toBe(target);
    expect(renderer.autoClear).toBe(false);
    pass.dispose();
    target.dispose();
  });

  it('releases its render targets, materials, and fullscreen geometry', () => {
    const pass = new ThreeDGlowPass(createRendererStub());
    const resources = [
      pass.sourceTarget,
      pass.blurTarget,
      pass.sourceMaterial,
      pass.blurMaterial,
      pass.screenMesh.geometry
    ];
    pass.resize(1920, 1080);
    expect([pass.sourceTarget.width, pass.sourceTarget.height]).toEqual([960, 540]);
    const disposals = resources.map((resource) => vi.spyOn(resource, 'dispose'));
    pass.dispose();

    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(pass.scene.children).toHaveLength(0);
  });
});
