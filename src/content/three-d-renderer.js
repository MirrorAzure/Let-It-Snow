import * as THREE from 'three';
import { resolveGlyphSizeRangePx } from './utils/size-utils.js';
import { stepWindState } from './physics/wind-field.js';

const CAMERA_Z = 35;
const CAMERA_FOV = 52;
const MIN_DEPTH = -14;
const MAX_DEPTH = 12;
const GLOW_LAYERS = [
  { radius: 0.015, opacity: 0.008 },
  { radius: 0.03, opacity: 0.013 },
  { radius: 0.05, opacity: 0.019 },
  { radius: 0.075, opacity: 0.025 },
  { radius: 0.105, opacity: 0.03 },
  { radius: 0.14, opacity: 0.032 },
  { radius: 0.18, opacity: 0.03 },
  { radius: 0.225, opacity: 0.026 },
  { radius: 0.275, opacity: 0.021 },
  { radius: 0.33, opacity: 0.016 },
  { radius: 0.39, opacity: 0.011 },
  { radius: 0.46, opacity: 0.007 }
];

export function resolveGlyphAppearance(config, index) {
  const count = Math.max(1, Math.floor(Number(config.snowmax) || 80));
  const sentences = Array.isArray(config.snowsentences)
    ? config.snowsentences.map((sentence) => String(sentence || '').trim()).filter(Boolean)
    : [];
  const sentenceCount = sentences.length
    ? Math.min(count, Math.max(0, Math.floor(Number(config.sentenceCount) || 0)))
    : 0;
  const sentenceSlot = Math.floor(((index + 1) * sentenceCount) / count)
    - Math.floor((index * sentenceCount) / count);
  const precedingSentences = Math.floor((index * sentenceCount) / count);
  const configuredGlyphs = Array.isArray(config.snowletters)
    ? config.snowletters.map((glyph) => String(glyph || '').trim()).filter(Boolean)
    : [];
  const glyphs = configuredGlyphs.length ? configuredGlyphs : ['❄'];
  const glyphIndex = index % glyphs.length;
  const colors = Array.isArray(config.snowcolor) && config.snowcolor.length
    ? config.snowcolor
    : ['#ffffff'];
  const isSentence = sentenceSlot > 0;
  return {
    glyph: isSentence ? sentences[precedingSentences % sentences.length] : glyphs[glyphIndex],
    glyphMode: !isSentence && config.snowglyphmodes?.[glyphIndex] === 'emoji' ? 'emoji' : 'text',
    color: colors[index % colors.length],
    isSentence
  };
}

export function resolveGlowPulse(phase) {
  const wave = 0.5 + 0.5 * Math.sin(phase);
  return 0.16 + 0.84 * wave * wave;
}

export function createGlyphGeometry(
  mask,
  width,
  height,
  thickness = 0.07,
  boundsWidth = width,
  boundsHeight = height,
  offsetX = 0,
  offsetY = 0
) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Glyph mask dimensions must be positive integers.');
  }
  if (mask.length !== width * height) {
    throw new RangeError('Glyph mask length must match its dimensions.');
  }

  const depth = THREE.MathUtils.clamp(Number(thickness) || 0.07, 0.02, 0.18) * 0.5;
  const vertices = [];
  const isFilled = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] > 0;
  const addQuad = (a, b, c, d) => {
    vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
  };

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!isFilled(x, y)) {
        x++;
        continue;
      }

      const start = x;
      while (x + 1 < width && isFilled(x + 1, y)) x++;
      const x0 = (start - offsetX) / boundsWidth - 0.5;
      const x1 = (x + 1 - offsetX) / boundsWidth - 0.5;
      const y0 = 0.5 - (y - offsetY) / boundsHeight;
      const y1 = 0.5 - (y + 1 - offsetY) / boundsHeight;

      addQuad([x0, y1, depth], [x1, y1, depth], [x1, y0, depth], [x0, y0, depth]);
      addQuad([x0, y1, -depth], [x0, y0, -depth], [x1, y0, -depth], [x1, y1, -depth]);
      x++;
    }

    for (let x = 0; x < width; x++) {
      if (!isFilled(x, y)) continue;
      const x0 = (x - offsetX) / boundsWidth - 0.5;
      const x1 = (x + 1 - offsetX) / boundsWidth - 0.5;
      const y0 = 0.5 - (y - offsetY) / boundsHeight;
      const y1 = 0.5 - (y + 1 - offsetY) / boundsHeight;

      if (!isFilled(x - 1, y)) {
        addQuad([x0, y1, -depth], [x0, y1, depth], [x0, y0, depth], [x0, y0, -depth]);
      }
      if (!isFilled(x + 1, y)) {
        addQuad([x1, y1, -depth], [x1, y0, -depth], [x1, y0, depth], [x1, y1, depth]);
      }
      if (!isFilled(x, y - 1)) {
        addQuad([x0, y0, -depth], [x0, y0, depth], [x1, y0, depth], [x1, y0, -depth]);
      }
      if (!isFilled(x, y + 1)) {
        addQuad([x0, y1, -depth], [x1, y1, -depth], [x1, y1, depth], [x0, y1, depth]);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function dilateGlyphMask(mask, width, height, radius, padding) {
  const expandedWidth = width + padding * 2;
  const expandedHeight = height + padding * 2;
  const expanded = new Uint8Array(expandedWidth * expandedHeight);
  const radiusSquared = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radiusSquared) continue;
          expanded[(y + padding + dy) * expandedWidth + x + padding + dx] = 1;
        }
      }
    }
  }
  return expanded;
}

export function createGlyphGlowGeometry(mask, width, height, thickness, innerRadius, outerRadius) {
  if (!Number.isInteger(innerRadius) || !Number.isInteger(outerRadius)
    || innerRadius < 0 || outerRadius <= innerRadius) {
    throw new RangeError('Glow radii must be non-negative integers with outerRadius greater than innerRadius.');
  }

  const expandedWidth = width + outerRadius * 2;
  const expandedHeight = height + outerRadius * 2;
  const outerMask = dilateGlyphMask(mask, width, height, outerRadius, outerRadius);
  const innerMask = dilateGlyphMask(mask, width, height, innerRadius, outerRadius);
  for (let pixel = 0; pixel < outerMask.length; pixel++) {
    if (innerMask[pixel]) outerMask[pixel] = 0;
  }
  const glowThickness = Math.max(Number(thickness) || 0.07, 0.2);
  return createGlyphGeometry(
    outerMask,
    expandedWidth,
    expandedHeight,
    glowThickness,
    width,
    height,
    outerRadius,
    outerRadius
  );
}

export class ThreeDSnowRenderer {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.config = config;
    this.is3D = true;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.glyphMeshes = new Map();
    this.glyphMaterial = null;
    this.glowMaterials = [];
    this.flakes = [];
    this.frameRequest = null;
    this.resizeObserver = null;
    this.lastTimestamp = 0;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500;
    this.mouseDragStrength = config.mouseDragStrength ?? 0.8;
    this.mouseBurstDuration = 0.2;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    this.windEnabled = config.windEnabled ?? false;
    this.windDirection = config.windDirection ?? 'left';
    this.windStrength = config.windStrength ?? 0.5;
    this.windGustFrequency = config.windGustFrequency ?? 3;
    this.windTime = 0;
    this.currentWindForce = 0;
    this.currentWindLift = 0;
    this.currentWindVortex = 0;
    this.windState = {
      prevWindForce: 0,
      prevWindLift: 0,
      prevWindVortex: 0
    };
    this.enableCollisions = config.enableCollisions ?? true;
    this.isPaused = false;
    this.boundResize = () => this.resize();
  }

  init() {
    try {
      const context = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      });
      if (!context) return false;

      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        context,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(
        CAMERA_FOV,
        Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight),
        0.1,
        150
      );
      this.camera.position.z = CAMERA_Z;
      this.scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x61758a, 2.2));

      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(-8, 12, 20);
      this.scene.add(keyLight);

      const { minPx, maxPx } = resolveGlyphSizeRangePx(this.config);
      const count = Math.max(1, Math.min(320, Math.floor(Number(this.config.snowmax) || 80)));
      this.glyphMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide
      });
      this.glowMaterials = GLOW_LAYERS.map(({ opacity }) => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      }));
      const colors = Array.isArray(this.config.snowcolor) && this.config.snowcolor.length
        ? this.config.snowcolor
        : ['#ffffff'];
      const groups = new Map();
      const thickness = this.config.snow3dThickness ?? 0.07;
      const sinkSpeed = Number(this.config.sinkspeed) || 0.4;
      this.flakes = Array.from({ length: count }, (_, index) => {
        const appearance = resolveGlyphAppearance(this.config, index);
        const { glyph, glyphMode } = appearance;
        const glyphKey = JSON.stringify([glyph, glyphMode]);
        const size = appearance.isSentence
          ? Math.max(maxPx * 1.2, 60) + Math.random() * 20
          : minPx + Math.random() * Math.max(0, maxPx - minPx);
        const depth = MIN_DEPTH + Math.random() * (MAX_DEPTH - MIN_DEPTH);
        const flake = {
          x: Math.random() * Math.max(1, window.innerWidth),
          y: Math.random() * Math.max(1, window.innerHeight),
          z: depth,
          size,
          collisionSize: size,
          fallSpeed: sinkSpeed * size,
          velocityX: (Math.random() - 0.5) * 5,
          velocityY: 0,
          velocityZ: (Math.random() - 0.5) * 0.08,
          rotationX: Math.random() * Math.PI * 2,
          rotationY: Math.random() * Math.PI * 2,
          rotationZ: Math.random() * Math.PI * 2,
          rotationSpeedX: (Math.random() - 0.5) * 0.5,
          rotationSpeedY: (Math.random() - 0.5) * 0.5,
          rotationSpeedZ: (Math.random() - 0.5) * 0.6,
          glowPhase: Math.random() * Math.PI * 2,
          color: new THREE.Color(appearance.color),
          glyph,
          glyphKey,
          isSentence: appearance.isSentence,
          isGrabbed: false
        };
        const group = groups.get(glyphKey);
        if (group) {
          group.flakes.push(flake);
        } else {
          groups.set(glyphKey, {
            glyph,
            glyphMode,
            flakes: [flake]
          });
        }
        return flake;
      });

      for (const [glyphKey, group] of groups) {
        const { mask, width, height } = this._createGlyphMask(group.glyph, group.glyphMode);
        const geometry = createGlyphGeometry(mask, width, height, thickness);
        const aspect = width / height;
        const mesh = new THREE.InstancedMesh(geometry, this.glyphMaterial, group.flakes.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        const maxDimension = Math.max(width, height);
        const glowRadii = GLOW_LAYERS.map(({ radius }, index) => (
          Math.max(1, Math.round(maxDimension * radius))
        ));
        for (let index = 1; index < glowRadii.length; index++) {
          glowRadii[index] = Math.max(glowRadii[index], glowRadii[index - 1] + 1);
        }
        const glowMeshes = GLOW_LAYERS.map((_, layerIndex) => {
          const innerRadius = layerIndex === 0 ? 0 : glowRadii[layerIndex - 1];
          const geometry = createGlyphGlowGeometry(
            mask,
            width,
            height,
            thickness,
            innerRadius,
            glowRadii[layerIndex]
          );
          const glowMesh = new THREE.InstancedMesh(
            geometry,
            this.glowMaterials[layerIndex],
            group.flakes.length
          );
          glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          glowMesh.frustumCulled = false;
          glowMesh.renderOrder = layerIndex;
          this.scene.add(glowMesh);
          return glowMesh;
        });
        group.flakes.forEach((flake, meshIndex) => {
          mesh.setColorAt(meshIndex, flake.color);
          for (const glowMesh of glowMeshes) glowMesh.setColorAt(meshIndex, flake.color);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        for (const glowMesh of glowMeshes) {
          if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
        }
        mesh.renderOrder = GLOW_LAYERS.length;
        this.scene.add(mesh);
        this.glyphMeshes.set(glyphKey, { mesh, glowMeshes, flakes: group.flakes, aspect });
      }

      this.resize();
      window.addEventListener('resize', this.boundResize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.boundResize);
      }
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(this.boundResize);
        this.resizeObserver.observe(document.documentElement);
      }
      return true;
    } catch (error) {
      console.warn('[Let It Snow] Unable to initialize the 3D renderer:', error);
      this.cleanup();
      return false;
    }
  }

  _createGlyphMask(glyph, mode) {
    const canvas = document.createElement('canvas');
    const resolution = 96;
    canvas.width = resolution;
    canvas.height = resolution;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to create a canvas context for 3D glyph geometry.');

    const fontStack = mode === 'emoji'
      ? '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
      : '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", serif';
    context.clearRect(0, 0, resolution, resolution);
    context.fillStyle = '#ffffff';
    context.font = `72px ${fontStack}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(glyph, resolution / 2, resolution / 2, resolution - 8);

    const image = context.getImageData(0, 0, resolution, resolution);
    let minX = resolution;
    let minY = resolution;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        if (image.data[(y * resolution + x) * 4 + 3] < 32) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) {
      throw new Error(`The selected 3D glyph "${glyph}" has no visible pixels in the available font.`);
    }

    const padding = 1;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(resolution - 1, maxX + padding);
    maxY = Math.min(resolution - 1, maxY + padding);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        mask[y * width + x] = image.data[((minY + y) * resolution + minX + x) * 4 + 3] >= 32 ? 1 : 0;
      }
    }
    return { mask, width, height };
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    this.viewportWidth = Math.max(1, window.innerWidth);
    this.viewportHeight = Math.max(1, window.innerHeight);
    this.camera.aspect = this.viewportWidth / this.viewportHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.viewportWidth, this.viewportHeight, false);
  }

  _worldScaleAtDepth(z) {
    const distance = CAMERA_Z - z;
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2))) / this.viewportHeight;
  }

  _worldPosition(flake) {
    const scale = this._worldScaleAtDepth(flake.z);
    return {
      x: (flake.x - this.viewportWidth / 2) * scale,
      y: (this.viewportHeight / 2 - flake.y) * scale,
      z: flake.z,
      scale
    };
  }

  updateMousePosition(x, y, velocityX = 0, velocityY = 0) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = velocityX;
    this.mouseVelocityY = velocityY;
  }

  onMouseDown(x, y, button) {
    this.mouseX = x;
    this.mouseY = y;
    if (button === 0 || button === 2) {
      this.mouseBurstMode = button === 0 ? 'explode' : 'suction';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
  }

  onMouseUp() {}

  onMouseLeave() {
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
  }

  _applyMouseForce(flake, delta) {
    const dx = flake.x - this.mouseX;
    const dy = flake.y - this.mouseY;
    const distance = Math.hypot(dx, dy);
    const mouseSpeed = Math.hypot(this.mouseVelocityX, this.mouseVelocityY);
    const burst = this.mouseBurstTimer > 0;
    const radius = this.mouseRadius * (burst ? 3.5 : 1);
    if (distance >= radius || (!burst && mouseSpeed < 1)) return;

    const influence = (1 - distance / radius) * (burst ? this.mouseBurstTimer / this.mouseBurstDuration : 1);
    const direction = this.mouseBurstMode === 'suction' ? -1 : 1;
    if (burst) {
      const divisor = Math.max(distance, 0.001);
      flake.velocityX += (dx / divisor) * direction * this.mouseForce * 10 * influence * delta;
      flake.velocityY += (dy / divisor) * direction * this.mouseForce * 10 * influence * delta;
      flake.velocityZ += direction * (flake.z / CAMERA_Z) * this.mouseForce * 0.004 * influence * delta;
    } else if (mouseSpeed > this.mouseDragThreshold) {
      const drag = influence * this.mouseDragStrength * Math.min(mouseSpeed, 1600) * delta;
      flake.velocityX += (this.mouseVelocityX / mouseSpeed) * drag;
      flake.velocityY += (this.mouseVelocityY / mouseSpeed) * drag;
    } else {
      const divisor = Math.max(distance, 0.001);
      flake.velocityX += (dx / divisor) * influence * this.mouseForce * delta;
      flake.velocityY += (dy / divisor) * influence * this.mouseForce * delta;
    }
  }

  _stepWind(delta) {
    const state = stepWindState({
      enabled: this.windEnabled,
      delta,
      windTime: this.windTime,
      windDirection: this.windDirection,
      windDirectionPhase: 0,
      windStrength: this.windStrength,
      windGustFrequency: this.windGustFrequency,
      windVortexStrength: 0.35,
      ...this.windState
    });
    this.windTime = state.windTime;
    this.currentWindForce = state.currentWindForce;
    this.currentWindLift = state.currentWindLift;
    this.currentWindVortex = state.currentWindVortex;
    this.windState = {
      prevWindForce: state.prevWindForce,
      prevWindLift: state.prevWindLift,
      prevWindVortex: state.prevWindVortex
    };
  }

  _resolveCollisions(worldPositions) {
    if (!this.enableCollisions) return;
    const restitution = 0.55;
    const maxRadius = this.flakes.reduce((max, flake, index) => {
      return Math.max(max, (flake.size * worldPositions[index].scale) * 0.5);
    }, 0);
    const cellSize = Math.max(0.1, maxRadius * 2);
    const grid = new Map();
    const keyFor = (x, y, z) =>
      `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;

    worldPositions.forEach((position, index) => {
      const key = keyFor(position.x, position.y, position.z);
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    });

    for (let i = 0; i < this.flakes.length; i++) {
      const a = this.flakes[i];
      const pa = worldPositions[i];
      const radiusA = (a.size * pa.scale) * 0.5;
      const cellX = Math.floor(pa.x / cellSize);
      const cellY = Math.floor(pa.y / cellSize);
      const cellZ = Math.floor(pa.z / cellSize);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const bucket = grid.get(`${cellX + ox},${cellY + oy},${cellZ + oz}`);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const b = this.flakes[j];
              const pb = worldPositions[j];
              const radiusB = (b.size * pb.scale) * 0.5;
              let dx = pb.x - pa.x;
              let dy = pb.y - pa.y;
              let dz = pb.z - pa.z;
              const distanceSq = dx * dx + dy * dy + dz * dz;
              const minDistance = radiusA + radiusB;
              if (distanceSq >= minDistance * minDistance) continue;

              const distance = Math.sqrt(distanceSq);
              let nx;
              let ny;
              let nz;
              if (distance < 1e-5) {
                nx = 1;
                ny = 0;
                nz = 0;
              } else {
                const inverseDistance = 1 / distance;
                nx = dx * inverseDistance;
                ny = dy * inverseDistance;
                nz = dz * inverseDistance;
              }
              const relativeX = b.velocityX * pb.scale - a.velocityX * pa.scale;
              const relativeY = -b.velocityY * pb.scale + a.velocityY * pa.scale;
              const relativeZ = b.velocityZ - a.velocityZ;
              const normalVelocity = relativeX * nx + relativeY * ny + relativeZ * nz;

              if (normalVelocity < 0) {
                const impulse = -(1 + restitution) * normalVelocity * 0.5;
                a.velocityX -= impulse * nx / pa.scale;
                a.velocityY += impulse * ny / pa.scale;
                a.velocityZ -= impulse * nz;
                b.velocityX += impulse * nx / pb.scale;
                b.velocityY -= impulse * ny / pb.scale;
                b.velocityZ += impulse * nz;
              }

              const overlap = Math.max(0, minDistance - distance);
              const correction = overlap * 0.5;
              pa.x -= nx * correction;
              pa.y -= ny * correction;
              pa.z -= nz * correction;
              pb.x += nx * correction;
              pb.y += ny * correction;
              pb.z += nz * correction;
              pa.scale = this._worldScaleAtDepth(pa.z);
              pb.scale = this._worldScaleAtDepth(pb.z);
              a.x = pa.x / pa.scale + this.viewportWidth / 2;
              a.y = this.viewportHeight / 2 - pa.y / pa.scale;
              a.z = pa.z;
              b.x = pb.x / pb.scale + this.viewportWidth / 2;
              b.y = this.viewportHeight / 2 - pb.y / pb.scale;
              b.z = pb.z;
            }
          }
        }
      }
    }
  }

  _updateInstances(delta) {
    this._stepWind(delta);
    this.mouseBurstTimer = Math.max(0, this.mouseBurstTimer - delta);
    if (!this.mouseBurstTimer) this.mouseBurstMode = null;
    const windPhase = this.windTime;

    this.flakes.forEach((flake) => {
      this._applyMouseForce(flake, delta);
      const sizeRatio = Math.sqrt(flake.size / 20);
      flake.velocityX += this.currentWindForce * sizeRatio * 35 * delta;
      flake.velocityY += -this.currentWindLift * sizeRatio * 48 * delta;
      flake.velocityZ += Math.sin(windPhase * 0.7 + flake.y * 0.008 + flake.x * 0.003)
        * this.currentWindVortex * sizeRatio * 12 * delta;
      flake.velocityX += Math.sin(windPhase * 0.43 + flake.z) * 1.8 * delta;
      flake.velocityZ += Math.cos(windPhase * 0.31 + flake.x * 0.01) * 0.18 * delta;

      flake.x += flake.velocityX * delta;
      flake.y += (flake.fallSpeed + flake.velocityY) * delta;
      flake.z += flake.velocityZ * delta;
      flake.rotationX += flake.rotationSpeedX * delta;
      flake.rotationY += flake.rotationSpeedY * delta;
      flake.rotationZ += flake.rotationSpeedZ * delta;
      const damping = Math.pow(0.985, delta * 60);
      flake.velocityX *= damping;
      flake.velocityY *= damping;
      flake.velocityZ *= damping;

      if (flake.z < MIN_DEPTH || flake.z > MAX_DEPTH) {
        flake.z = THREE.MathUtils.clamp(flake.z, MIN_DEPTH, MAX_DEPTH);
        flake.velocityZ *= -0.5;
      }
      if (flake.x < -flake.size) flake.x = this.viewportWidth + flake.size;
      if (flake.x > this.viewportWidth + flake.size) flake.x = -flake.size;
      if (flake.y > this.viewportHeight + flake.size) {
        flake.y = -flake.size;
        flake.x = Math.random() * this.viewportWidth;
        flake.z = MIN_DEPTH + Math.random() * (MAX_DEPTH - MIN_DEPTH);
        flake.velocityX = 0;
        flake.velocityY = 0;
      }
    });

    const positions = this.flakes.map((flake) => this._worldPosition(flake));
    this._resolveCollisions(positions);
    const transform = new THREE.Object3D();
    const glowColor = new THREE.Color();
    for (const group of this.glyphMeshes.values()) {
      group.flakes.forEach((flake, index) => {
        const position = this._worldPosition(flake);
        flake.glowPhase += delta * 3.6;
        transform.position.set(position.x, position.y, position.z);
        transform.rotation.set(flake.rotationX, flake.rotationY, flake.rotationZ);
        const scale = flake.size * position.scale;
        transform.scale.set(scale * group.aspect, scale, scale);
        transform.updateMatrix();
        group.mesh.setMatrixAt(index, transform.matrix);
        const pulse = resolveGlowPulse(flake.glowPhase);
        glowColor.copy(flake.color).multiplyScalar(pulse);
        for (const glowMesh of group.glowMeshes) {
          glowMesh.setMatrixAt(index, transform.matrix);
          glowMesh.setColorAt(index, glowColor);
        }
      });
      group.mesh.instanceMatrix.needsUpdate = true;
      for (const glowMesh of group.glowMeshes) {
        glowMesh.instanceMatrix.needsUpdate = true;
        if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  start() {
    if (!this.renderer || this.frameRequest !== null) return;
    this.isPaused = false;
    this.lastTimestamp = performance.now();
    const animate = (timestamp) => {
      if (!this.renderer || this.isPaused) return;
      const delta = Math.min(Math.max((timestamp - this.lastTimestamp) / 1000, 0), 0.05);
      this.lastTimestamp = timestamp;
      this._updateInstances(delta);
      this.renderer.render(this.scene, this.camera);
      this.frameRequest = requestAnimationFrame(animate);
    };
    this.frameRequest = requestAnimationFrame(animate);
  }

  pause() {
    this.isPaused = true;
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
  }

  resume() {
    if (!this.isPaused) return;
    this.start();
  }

  stop() {
    this.pause();
    this.flakes = [];
  }

  cleanup() {
    this.stop();
    window.removeEventListener('resize', this.boundResize);
    window.visualViewport?.removeEventListener('resize', this.boundResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const group of this.glyphMeshes.values()) {
      this.scene?.remove(group.mesh);
      for (const glowMesh of group.glowMeshes) {
        this.scene?.remove(glowMesh);
        glowMesh.geometry.dispose();
      }
      group.mesh.geometry.dispose();
    }
    this.glyphMeshes.clear();
    this.glyphMaterial?.dispose();
    this.glyphMaterial = null;
    for (const material of this.glowMaterials) material.dispose();
    this.glowMaterials = [];
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }

  updateConfig(config = {}) {
    if (config.mouseRadius !== undefined) this.mouseRadius = config.mouseRadius;
    if (config.mouseForce !== undefined) this.mouseForce = config.mouseForce;
    if (config.windEnabled !== undefined) this.windEnabled = config.windEnabled;
    if (config.windDirection !== undefined) this.windDirection = config.windDirection;
    if (config.windStrength !== undefined) this.windStrength = config.windStrength;
    if (config.windGustFrequency !== undefined) this.windGustFrequency = config.windGustFrequency;
  }
}
