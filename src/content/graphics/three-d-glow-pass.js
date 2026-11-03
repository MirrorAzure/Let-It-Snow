import * as THREE from 'three';

const GLOW_SCALE = 0.5;
const MAX_GLOW_DIMENSION = 1024;
const GLOW_OPACITY = 0.9;

const SOURCE_VERTEX_SHADER = `
attribute vec3 glowColor;
attribute float glowPulse;
varying vec3 vColor;
varying float vPulse;
void main() {
  vColor = glowColor;
  vPulse = glowPulse;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SOURCE_FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vPulse;
void main() {
  gl_FragColor = vec4(vColor * vPulse, vPulse);
}
`;

const BLUR_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLUR_FRAGMENT_SHADER = `
uniform sampler2D sourceMap;
uniform vec2 pixelStep;
uniform float opacity;
uniform float whiten;
uniform vec3 backgroundColor;
varying vec2 vUv;
void main() {
  vec4 blurred = texture2D(sourceMap, vUv) * 0.227027;
  blurred += texture2D(sourceMap, vUv + pixelStep * 1.384615) * 0.316216;
  blurred += texture2D(sourceMap, vUv - pixelStep * 1.384615) * 0.316216;
  blurred += texture2D(sourceMap, vUv + pixelStep * 3.230769) * 0.070270;
  blurred += texture2D(sourceMap, vUv - pixelStep * 3.230769) * 0.070270;
  blurred.rgb = mix(blurred.rgb, vec3(blurred.a), whiten);
  blurred.rgb = max(blurred.rgb, backgroundColor * blurred.a);
  gl_FragColor = blurred * opacity;
}
`;

export function resolveGlowTargetSize(width, height) {
  if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError('Glow target dimensions must be finite and non-negative.');
  }
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(GLOW_SCALE, MAX_GLOW_DIMENSION / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.ceil(safeWidth * scale)),
    height: Math.max(1, Math.ceil(safeHeight * scale))
  };
}

/**
 * Renders the actual 3D silhouettes into a bounded, half-resolution glow map.
 * The separable blur remains screen-aligned even when a flake turns edge-on.
 */
export class ThreeDGlowPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.sourceMaterial = new THREE.ShaderMaterial({
      vertexShader: SOURCE_VERTEX_SHADER,
      fragmentShader: SOURCE_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NoBlending,
      toneMapped: false
    });
    this.sourceTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.sourceTarget.texture.generateMipmaps = false;
    this.blurTarget.texture.generateMipmaps = false;

    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        sourceMap: { value: null },
        pixelStep: { value: new THREE.Vector2() },
        opacity: { value: 1 },
        whiten: { value: 0 },
        backgroundColor: { value: new THREE.Vector3() }
      },
      vertexShader: BLUR_VERTEX_SHADER,
      fragmentShader: BLUR_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false
    });
    this.screenScene = new THREE.Scene();
    this.screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    this.screenMesh.frustumCulled = false;
    this.screenScene.add(this.screenMesh);
    this.strength = 1;
    this.whiten = 1;
    this.backgroundColor = new THREE.Vector3(1, 1, 1);
  }

  addGlyphMesh(glyphMesh, flakes) {
    const color = new THREE.InstancedBufferAttribute(new Float32Array(flakes.length * 3), 3);
    const pulse = new THREE.InstancedBufferAttribute(new Float32Array(flakes.length), 1);
    pulse.setUsage(THREE.DynamicDrawUsage);
    flakes.forEach((flake, index) => color.setXYZ(index, ...flake.glowRgb));
    glyphMesh.geometry.setAttribute('glowColor', color);
    glyphMesh.geometry.setAttribute('glowPulse', pulse);

    const mesh = new THREE.InstancedMesh(glyphMesh.geometry, this.sourceMaterial, flakes.length);
    mesh.instanceMatrix = glyphMesh.instanceMatrix;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, pulse };
  }

  resize(width, height) {
    const size = resolveGlowTargetSize(width, height);
    this.sourceTarget.setSize(size.width, size.height);
    this.blurTarget.setSize(size.width, size.height);
  }

  setGlowState(strength, whiten, backgroundColor) {
    this.strength = strength;
    this.whiten = whiten;
    this.backgroundColor.set(backgroundColor.r, backgroundColor.g, backgroundColor.b);
  }

  render(scene, camera) {
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const uniforms = this.blurMaterial.uniforms;
    renderer.autoClear = false;

    try {
      if (this.strength <= 0.005) {
        renderer.setRenderTarget(previousTarget);
        renderer.clear();
        renderer.render(scene, camera);
        return;
      }

      renderer.setRenderTarget(this.sourceTarget);
      renderer.clear();
      renderer.render(this.scene, camera);

      renderer.setRenderTarget(this.blurTarget);
      renderer.clear();
      uniforms.sourceMap.value = this.sourceTarget.texture;
      uniforms.pixelStep.value.set(1 / this.sourceTarget.width, 0);
      uniforms.opacity.value = 1;
      uniforms.whiten.value = 0;
      uniforms.backgroundColor.value.set(0, 0, 0);
      renderer.render(this.screenScene, this.screenCamera);

      renderer.setRenderTarget(previousTarget);
      renderer.clear();
      uniforms.sourceMap.value = this.blurTarget.texture;
      uniforms.pixelStep.value.set(0, 1 / this.blurTarget.height);
      uniforms.opacity.value = GLOW_OPACITY * this.strength;
      uniforms.whiten.value = this.whiten;
      uniforms.backgroundColor.value.copy(this.backgroundColor);
      renderer.render(this.screenScene, this.screenCamera);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
    }
  }

  dispose() {
    for (const mesh of [...this.scene.children]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.screenMesh.geometry.dispose();
    this.blurMaterial.dispose();
    this.sourceMaterial.dispose();
    this.sourceTarget.dispose();
    this.blurTarget.dispose();
  }
}
