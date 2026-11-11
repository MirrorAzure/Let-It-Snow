import * as THREE from 'three';
import { resolveGlyphSizeRangePx, resolveInitialSpawnSpanRatio } from './utils/size-utils.js';
import { stepWindState } from './physics/wind-field.js';
import { applyAirBurstImpulse, getWindVelocity, stepSnowflakePhysics } from './physics/snow-physics.js';
import { BackgroundMonitor, getEffectiveBackgroundColor } from './utils/background-monitor.js';
import { resolveMinGlowStrength } from './utils/glow-utils.js';
import { ThreeDGlowPass } from './graphics/three-d-glow-pass.js';
import { isCellMonotone } from './utils/glyph-utils.js';
import { AdaptiveQuality } from './utils/adaptive-quality.js';
import { normalizePhysicsDelta } from './physics/time-step.js';

const CAMERA_Z = 35;
const CAMERA_FOV = 52;
const MIN_DEPTH = -14;
const MAX_DEPTH = 12;
const GLOW_MIN_LUMINANCE = 0.72;
const DEFAULT_GLOW_FLICKER = 0.5;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
const GLYPH_EM_PX = 132;
const GLYPH_CANVAS_PX = 192;
const SENTENCE_UNIT_PX = 200;
const MASK_CACHE_LIMIT = 48;
const GLOW_STATE_RATE = 5;
const glyphMaskCache = new Map();

export function createGlyphDetailGeometry(shape, thickness, step = 1) {
  if (!Number.isInteger(step) || step < 1) {
    throw new RangeError('Glyph detail step must be a positive integer.');
  }
  const width = Math.ceil(shape.width / step);
  const height = Math.ceil(shape.height / step);
  const mask = step === 1 ? shape.mask : new Uint8Array(width * height);
  if (step > 1) {
    // Keep thin branches when reducing detail instead of erasing small glyphs.
    for (let y = 0; y < shape.height; y++) {
      for (let x = 0; x < shape.width; x++) {
        if (shape.mask[y * shape.width + x]) {
          const cx = Math.min(width - 1, Math.floor(x * width / shape.width));
          const cy = Math.min(height - 1, Math.floor(y * height / shape.height));
          mask[cy * width + cx] = 1;
        }
      }
    }
  }
  const scaleX = width / shape.width;
  const scaleY = height / shape.height;
  return createGlyphGeometry(mask, width, height, thickness,
    shape.unit * scaleX, shape.unit * scaleY,
    (shape.width - shape.unit) * scaleX / 2, (shape.height - shape.unit) * scaleY / 2);
}

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
  return 0.72 + 0.28 * wave * wave * (3 - 2 * wave);
}

/**
 * Per-flake twinkle: two incommensurate waves plus a sharpened sparkle peak.
 * @returns {number} Multiplier in [1 - amount, 1].
 */
export function resolveGlowFlicker(time, flake, amount = DEFAULT_GLOW_FLICKER) {
  const depth = THREE.MathUtils.clamp(Number(amount), 0, 1);
  if (!Number.isFinite(depth) || depth === 0 || !Number.isFinite(flake?.twinkleSpeedA)) return 1;
  const slow = 0.5 + 0.5 * Math.sin(time * flake.twinkleSpeedA + flake.twinklePhaseA);
  const fast = 0.5 + 0.5 * Math.sin(time * flake.twinkleSpeedB + flake.twinklePhaseB);
  const sparkle = Math.pow(fast, 6);
  const twinkle = THREE.MathUtils.clamp(slow * 0.7 + sparkle * 0.6, 0, 1);
  return 1 - depth * (1 - twinkle);
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
  const uvs = [];
  const isFilled = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] > 0;
  // Front/back faces map the mask image 1:1.
  const uvFor = (vertex) => [
    (vertex[0] + 0.5) * boundsWidth / width + offsetX / width,
    1 - ((0.5 - vertex[1]) * boundsHeight + offsetY) / height
  ];
  const addQuad = (a, b, c, d) => {
    vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
    uvs.push(...uvFor(a), ...uvFor(b), ...uvFor(c), ...uvFor(a), ...uvFor(c), ...uvFor(d));
  };

  const emitFace = (start, end, top, bottom) => {
    const x0 = (start - offsetX) / boundsWidth - 0.5;
    const x1 = (end - offsetX) / boundsWidth - 0.5;
    const y0 = 0.5 - (top - offsetY) / boundsHeight;
    const y1 = 0.5 - (bottom - offsetY) / boundsHeight;
    addQuad([x0, y1, depth], [x1, y1, depth], [x1, y0, depth], [x0, y0, depth]);
    addQuad([x0, y1, -depth], [x0, y0, -depth], [x1, y0, -depth], [x1, y1, -depth]);
  };

  // Identical horizontal runs on consecutive rows are merged into one rectangle.
  let openRuns = new Map();
  for (let y = 0; y <= height; y++) {
    const nextRuns = new Map();
    let x = 0;
    while (y < height && x < width) {
      if (!isFilled(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x + 1 < width && isFilled(x + 1, y)) x++;
      const key = start * 65536 + x + 1;
      nextRuns.set(key, openRuns.get(key) ?? y);
      openRuns.delete(key);
      x++;
    }
    for (const [key, top] of openRuns) {
      emitFace(Math.floor(key / 65536), key % 65536, top, y);
    }
    openRuns = nextRuns;
  }

  // Side walls are merged into runs, which keeps triangle counts low for detailed glyphs.
  const toX = (px) => (px - offsetX) / boundsWidth - 0.5;
  const toY = (py) => 0.5 - (py - offsetY) / boundsHeight;
  const addWallUv = (u0, v0, u1, v1, order) => {
    const corners = { s: [u0, v0], e: [u1, v1] };
    for (const key of order) uvs.push(...corners[key]);
  };
  const addWall = (a, b, c, d, uvStart, uvEnd, order) => {
    vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
    addWallUv(uvStart[0], uvStart[1], uvEnd[0], uvEnd[1], order);
  };
  const pixelUv = (x, y) => [(x + 0.5) / width, 1 - (y + 0.5) / height];

  for (let x = 0; x < width; x++) {
    for (const side of [-1, 1]) {
      let y = 0;
      while (y < height) {
        if (!isFilled(x, y) || isFilled(x + side, y)) {
          y++;
          continue;
        }
        const start = y;
        while (y + 1 < height && isFilled(x, y + 1) && !isFilled(x + side, y + 1)) y++;
        const wx = toX(side < 0 ? x : x + 1);
        const top = toY(start);
        const bottom = toY(y + 1);
        const uvTop = pixelUv(x, start);
        const uvBottom = pixelUv(x, y);
        if (side < 0) {
          addWall([wx, bottom, -depth], [wx, bottom, depth], [wx, top, depth], [wx, top, -depth],
            uvTop, uvBottom, ['e', 'e', 's', 'e', 's', 's']);
        } else {
          addWall([wx, bottom, -depth], [wx, top, -depth], [wx, top, depth], [wx, bottom, depth],
            uvTop, uvBottom, ['e', 's', 's', 'e', 's', 'e']);
        }
        y++;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (const side of [-1, 1]) {
      let x = 0;
      while (x < width) {
        if (!isFilled(x, y) || isFilled(x, y + side)) {
          x++;
          continue;
        }
        const start = x;
        while (x + 1 < width && isFilled(x + 1, y) && !isFilled(x + 1, y + side)) x++;
        const wy = toY(side < 0 ? y : y + 1);
        const left = toX(start);
        const right = toX(x + 1);
        const uvLeft = pixelUv(start, y);
        const uvRight = pixelUv(x, y);
        if (side < 0) {
          addWall([left, wy, -depth], [left, wy, depth], [right, wy, depth], [right, wy, -depth],
            uvLeft, uvRight, ['s', 's', 'e', 's', 'e', 'e']);
        } else {
          addWall([left, wy, -depth], [right, wy, -depth], [right, wy, depth], [left, wy, depth],
            uvLeft, uvRight, ['s', 'e', 'e', 's', 'e', 's']);
        }
        x++;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Lifts dark flake colors to a luminous sRGB tint; light backgrounds are
 * handled separately by the glow pass's white compositing.
 * @returns {[number, number, number]}
 */
export function resolveGlowColor(color, minLuminance = GLOW_MIN_LUMINANCE) {
  const rgb = new THREE.Color(color).getRGB({}, THREE.SRGBColorSpace);
  if (![rgb.r, rgb.g, rgb.b].every(Number.isFinite)) {
    throw new RangeError('3D glow color channels must be finite.');
  }
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  let r = clamp01(rgb.r);
  let g = clamp01(rgb.g);
  let b = clamp01(rgb.b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < minLuminance) {
    const t = (minLuminance - luminance) / Math.max(1e-6, 1 - luminance);
    r += (1 - r) * t;
    g += (1 - g) * t;
    b += (1 - b) * t;
  }
  return [r, g, b];
}

export function resolveGlowWhiten(backgroundDarkness) {
  const darkness = Number(backgroundDarkness);
  if (!Number.isFinite(darkness)) {
    console.warn('[Let It Snow] Invalid background darkness; using white glow.');
    return 1;
  }
  return 1 - THREE.MathUtils.clamp(darkness, 0, 1);
}

/**
 * Places a new flake above the viewport so snowfall enters from the top.
 * `spanRatio` sets how tall (relative to the viewport) the spawn band above the top is;
 * a positive offset (resumed autostart progress) fast-forwards the fall.
 */
export function resolveInitialFlakeY(size, viewportHeight, fallSpeed = 0, offsetSeconds = 0, spanRatio = 1) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const baseY = -size - Math.random() * height * spanRatio;
  const offset = Math.max(0, Number(offsetSeconds) || 0);
  if (!offset) return baseY;
  const minY = -size;
  const span = height + size * 2;
  const shifted = baseY + Math.max(0, fallSpeed) * offset;
  return minY + (((shifted - minY) % span) + span) % span;
}

function wrapSentence(context, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [String(text || '')];
}

function getCachedGlyphShape(glyph, mode, create) {
  const key = `${mode}\u0000${glyph}`;
  const cached = glyphMaskCache.get(key);
  if (cached) {
    glyphMaskCache.delete(key);
    glyphMaskCache.set(key, cached);
    return cached;
  }
  const shape = create(glyph, mode);
  glyphMaskCache.set(key, shape);
  if (glyphMaskCache.size > MASK_CACHE_LIMIT) {
    glyphMaskCache.delete(glyphMaskCache.keys().next().value);
  }
  return shape;
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
    this.glowPass = null;
    this.glowStrength = 1;
    this.backgroundMonitor = null;
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
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500;
    this.mouseDragStrength = config.mouseDragStrength ?? 0.8;
    this.mouseBurstDuration = 0.2;
    this.mouseBurstRadiusMultiplier = 3.5;
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
    this.glowFlicker = config.snow3dGlowFlicker ?? DEFAULT_GLOW_FLICKER;
    this.glowTarget = null;
    this.glowCurrent = null;
    this.elapsed = 0;
    this.emojiTextures = [];
    this.emojiMaterials = [];
    this._transform = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._scale = new THREE.Vector3();
    this._worldPositions = [];
    this._collisionGrid = new Map();
    this.adaptiveQuality = new AdaptiveQuality();
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
      this.glowPass = new ThreeDGlowPass(this.renderer);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(
        CAMERA_FOV,
        Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight),
        0.1,
        150
      );
      this.camera.position.z = CAMERA_Z;
      // A light ground color keeps tilted glyph sides from turning into dark rims.
      this.scene.add(new THREE.HemisphereLight(0xf2f8ff, 0xb7c6d6, 2.3));

      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(-8, 12, 20);
      this.scene.add(keyLight);

      const { minPx, maxPx } = resolveGlyphSizeRangePx(this.config);
      const count = Math.max(1, Math.min(320, Math.floor(Number(this.config.snowmax) || 80)));
      this.glyphMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x20262d,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide
      });
      const groups = new Map();
      const thickness = this.config.snow3dThickness ?? 0.07;
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const initialOffsetSeconds = Math.max(0, Number(this.config.initialTimeOffsetSeconds) || 0);
      const spawnSpanRatio = resolveInitialSpawnSpanRatio(this.config, 1);
      this.flakes = Array.from({ length: count }, (_, index) => {
        const appearance = resolveGlyphAppearance(this.config, index);
        const { glyph, glyphMode } = appearance;
        const glyphKey = JSON.stringify([glyph, glyphMode, appearance.isSentence]);
        const size = appearance.isSentence
          ? Math.max(maxPx * 1.2, 60) + Math.random() * 20
          : minPx + Math.random() * Math.max(0, maxPx - minPx);
        const depth = MIN_DEPTH + Math.random() * (MAX_DEPTH - MIN_DEPTH);
        const color = new THREE.Color(appearance.color);
        const fallSpeed = Number.isFinite(this.config.gravity)
          ? 0
          : (Number.isFinite(this.config.sinkspeed) ? this.config.sinkspeed : 0.4) * size;
        const flake = {
          _snowflakeIndex: index,
          x: Math.random() * viewportWidth,
          y: resolveInitialFlakeY(size, viewportHeight, fallSpeed, initialOffsetSeconds, spawnSpanRatio),
          z: depth,
          size,
          collisionSize: size,
          fallSpeed: 0,
          verticalVelocity: 0,
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
          twinkleSpeedA: 1.6 + Math.random() * 1.8,
          twinkleSpeedB: 4.5 + Math.random() * 4,
          twinklePhaseA: Math.random() * Math.PI * 2,
          twinklePhaseB: Math.random() * Math.PI * 2,
          color,
          glowRgb: resolveGlowColor(color),
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
            glyphMode: appearance.isSentence ? 'sentence' : glyphMode,
            flakes: [flake]
          });
        }
        return flake;
      });

      for (const [glyphKey, group] of groups) {
        const shape = getCachedGlyphShape(group.glyph, group.glyphMode, (glyph, mode) =>
          this._createGlyphMask(glyph, mode));
        const geometry = createGlyphDetailGeometry(shape, thickness);
        const isEmoji = Boolean(shape.colorCanvas);
        const material = isEmoji ? this._createEmojiMaterial(shape.colorCanvas) : this.glyphMaterial;
        const mesh = new THREE.InstancedMesh(geometry, material, group.flakes.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        if (isEmoji) {
          // Emoji keep their own colors (like WebGPU); the glow uses their average tint.
          const glowRgb = resolveGlowColor(shape.averageColor);
          group.flakes.forEach((flake) => {
            flake.glowRgb = glowRgb;
          });
        } else {
          group.flakes.forEach((flake, meshIndex) => {
            mesh.setColorAt(meshIndex, flake.color);
          });
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        const glow = this.glowPass.addGlyphMesh(mesh, group.flakes);
        this.scene.add(mesh);
        this.glyphMeshes.set(glyphKey, {
          mesh, glow, flakes: group.flakes, shape, geometries: new Map([[1, geometry]])
        });
      }
      this.startBackgroundMonitoring();

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

  _createEmojiMaterial(colorCanvas) {
    const texture = new THREE.CanvasTexture(colorCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.55,
      roughness: 0.6,
      metalness: 0,
      side: THREE.DoubleSide
    });
    this.emojiTextures.push(texture);
    this.emojiMaterials.push(material);
    return material;
  }

  _createGlyphMask(glyph, mode) {
    const isSentence = mode === 'sentence';
    const isEmoji = mode === 'emoji';
    const measureCanvas = document.createElement('canvas');
    const measure = measureCanvas.getContext('2d');
    if (!measure) throw new Error('Unable to create a canvas context for 3D glyph geometry.');

    let font;
    let lines;
    let unit;
    let lineHeight;
    let canvasWidth;
    let canvasHeight;
    if (isSentence) {
      // Mirrors the 2D renderer: bold font at 0.3 × size, wrapped at 2 × size.
      unit = SENTENCE_UNIT_PX;
      const fontSize = unit * 0.3;
      font = `bold ${fontSize}px Arial, sans-serif`;
      measure.font = font;
      lines = wrapSentence(measure, glyph, unit * 2).slice(0, 6);
      lineHeight = fontSize * 1.2;
      const textWidth = Math.max(...lines.map((line) => measure.measureText(line).width), 1);
      canvasWidth = Math.min(1024, Math.ceil(textWidth) + 16);
      canvasHeight = Math.ceil(lines.length * lineHeight) + 16;
    } else {
      unit = GLYPH_EM_PX;
      const fontStack = isEmoji
        ? '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif'
        : '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "Times New Roman", serif';
      font = `${unit}px ${fontStack}`;
      lines = [glyph];
      lineHeight = unit;
      canvasWidth = GLYPH_CANVAS_PX;
      canvasHeight = GLYPH_CANVAS_PX;
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to create a canvas context for 3D glyph geometry.');
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = '#ffffff';
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const firstLineY = canvasHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, lineIndex) => {
      context.fillText(line, canvasWidth / 2, firstLineY + lineIndex * lineHeight, canvasWidth - 8);
    });

    const image = context.getImageData(0, 0, canvasWidth, canvasHeight);
    let minX = canvasWidth;
    let minY = canvasHeight;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        if (image.data[(y * canvasWidth + x) * 4 + 3] < 32) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) {
      throw new Error(`The selected 3D glyph "${glyph}" has no visible pixels in the available font.`);
    }

    const padding = 1;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvasWidth - 1, maxX + padding);
    maxY = Math.min(canvasHeight - 1, maxY + padding);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    // Like the WebGPU atlas, any glyph that the font draws in several colors (color emoji,
    // including ones that fell back to an emoji font in text mode) keeps its own palette.
    const keepsColor = !isSentence
      && !isCellMonotone(image.data, canvasWidth, minX, minY, maxX - minX + 1, maxY - minY + 1);
    const mask = new Uint8Array(width * height);
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = ((minY + y) * canvasWidth + minX + x) * 4;
        const alpha = image.data[offset + 3];
        mask[y * width + x] = alpha >= 32 ? 1 : 0;
        if (keepsColor && alpha >= 32) {
          const a = alpha / 255;
          red += image.data[offset] * a;
          green += image.data[offset + 1] * a;
          blue += image.data[offset + 2] * a;
          weight += a;
        }
      }
    }

    const shape = { mask, width, height, unit };
    if (keepsColor) {
      const colorCanvas = document.createElement('canvas');
      colorCanvas.width = width;
      colorCanvas.height = height;
      const colorContext = colorCanvas.getContext('2d');
      if (colorContext) {
        colorContext.drawImage(canvas, minX, minY, width, height, 0, 0, width, height);
        shape.colorCanvas = colorCanvas;
        const toByte = (value) => Math.round(weight > 0 ? value / weight : 255);
        shape.averageColor = `rgb(${toByte(red)}, ${toByte(green)}, ${toByte(blue)})`;
      }
    }
    return shape;
  }

  updateGlowState() {
    const minGlowStrength = resolveMinGlowStrength(this.config?.minGlowStrength);
    const strength = this.backgroundMonitor
      ? this.backgroundMonitor.calculateGlowStrength(minGlowStrength)
      : 1;
    const darkness = this.backgroundMonitor
      ? this.backgroundMonitor.calculateGlowStrength(0, 1)
      : 0;
    const background = getEffectiveBackgroundColor();
    this.glowTarget = {
      strength,
      whiten: resolveGlowWhiten(darkness),
      r: background.r,
      g: background.g,
      b: background.b
    };
    if (!this.glowCurrent) {
      this.glowCurrent = { ...this.glowTarget };
      this._applyGlowState();
    }
  }

  /** Eases the glow toward the latest background so theme switches fade instead of popping. */
  _stepGlowState(delta) {
    const target = this.glowTarget;
    const current = this.glowCurrent;
    if (!target || !current) return;
    const t = 1 - Math.exp(-GLOW_STATE_RATE * delta);
    let changed = false;
    for (const key of ['strength', 'whiten', 'r', 'g', 'b']) {
      const difference = target[key] - current[key];
      if (Math.abs(difference) < 1e-4) {
        if (current[key] !== target[key]) changed = true;
        current[key] = target[key];
        continue;
      }
      current[key] += difference * t;
      changed = true;
    }
    if (changed) this._applyGlowState();
  }

  _applyGlowState() {
    const current = this.glowCurrent;
    this.glowStrength = current.strength;
    this.glowPass?.setGlowState(current.strength, current.whiten, current);
  }

  startBackgroundMonitoring() {
    this.stopBackgroundMonitoring();
    this.backgroundMonitor = new BackgroundMonitor(() => this.updateGlowState());
    this.backgroundMonitor.start();
    this.updateGlowState();
  }

  stopBackgroundMonitoring() {
    this.backgroundMonitor?.stop();
    this.backgroundMonitor = null;
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    this.viewportWidth = Math.max(1, window.innerWidth);
    this.viewportHeight = Math.max(1, window.innerHeight);
    this.camera.aspect = this.viewportWidth / this.viewportHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.viewportWidth, this.viewportHeight, false);
    this.glowPass?.resize(this.viewportWidth, this.viewportHeight, this.adaptiveQuality.resolutionScale);
  }

  _worldScaleAtDepth(z) {
    const distance = CAMERA_Z - z;
    return (2 * distance * TAN_HALF_FOV) / this.viewportHeight;
  }

  _worldPosition(flake, target = {}) {
    const scale = this._worldScaleAtDepth(flake.z);
    target.x = (flake.x - this.viewportWidth / 2) * scale;
    target.y = (this.viewportHeight / 2 - flake.y) * scale;
    target.z = flake.z;
    target.scale = scale;
    return target;
  }

  updateMousePosition(x, y, velocityX = 0, velocityY = 0) {
    this.environment?.updatePointer(x, y, velocityX, velocityY, this.mouseRadius);
    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = velocityX;
    this.mouseVelocityY = velocityY;
  }

  onMouseDown(x, y, button) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    if (button === 0) {
      this.mouseLeftPressed = true;
      this.mouseBurstMode = 'explode';
    } else if (button === 2) {
      this.mouseRightPressed = true;
      this.mouseBurstMode = 'suction';
    }
    if (button === 0 || button === 2) {
      const radius = this.mouseRadius * this.mouseBurstRadiusMultiplier;
      const strength = this.mouseForce * 10;
      this.environment?.applyAirBurst(x, y, radius, this.mouseBurstMode, strength, this.mouseBurstDuration);
      for (const flake of this.flakes) {
        if (flake.isFinished || flake.isAwaitingRespawn || flake.isSettled) continue;
        applyAirBurstImpulse(flake, x, y, radius, this.mouseBurstMode, strength, this.mouseBurstDuration);
      }
    }
  }

  onMouseUp(button) {
    if (button === 0) this.mouseLeftPressed = false;
    if (button === 2) this.mouseRightPressed = false;
    if (!this.mouseLeftPressed && !this.mouseRightPressed) {
      this.mouseBurstTimer = 0;
      this.mouseBurstMode = null;
    }
  }

  onMouseLeave() {
    if (this.environment) this.environment.pointer = null;
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
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
    const radius = this.mouseRadius * (burst ? this.mouseBurstRadiusMultiplier : 1);
    if (distance >= radius || (!burst && mouseSpeed < 1)) return;

    const burstFactor = burst ? this.mouseBurstTimer / this.mouseBurstDuration : 1;
    const influence = (1 - distance / radius) * burstFactor;
    const direction = this.mouseBurstMode === 'suction' ? -1 : 1;
    if (burst) {
      if (this.mouseBurstMode === 'blower') {
        const divisor = Math.max(distance, 0.001);
        const acceleration = this.mouseForce * 10 * influence * delta;
        flake.velocityX += (dx / divisor) * acceleration;
        flake.velocityY += (dy / divisor - 4) * acceleration;
      } else {
        const divisor = Math.max(distance, 0.001);
        flake.velocityX += (dx / divisor) * direction * this.mouseForce * 10 * influence * delta;
        flake.velocityY += (dy / divisor) * direction * this.mouseForce * 10 * influence * delta;
      }
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
      windResponseSeconds: 0.325,
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
    const grid = this._collisionGrid;
    if (grid.size > this.flakes.length * 4) grid.clear();
    for (const bucket of grid.values()) bucket.length = 0;
    const GRID_OFFSET = 4096;
    const GRID_SPAN = 8192;
    const keyFor = (cx, cy, cz) =>
      ((cx + GRID_OFFSET) * GRID_SPAN + (cy + GRID_OFFSET)) * GRID_SPAN + (cz + GRID_OFFSET);

    for (let index = 0; index < this.flakes.length; index++) {
      if (this.flakes[index].isFinished || this.flakes[index].isSettled) continue;
      const position = worldPositions[index];
      const key = keyFor(
        Math.floor(position.x / cellSize),
        Math.floor(position.y / cellSize),
        Math.floor(position.z / cellSize)
      );
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }

    for (let i = 0; i < this.flakes.length; i++) {
      const a = this.flakes[i];
      if (a.isFinished || a.isSettled) continue;
      const pa = worldPositions[i];
      const radiusA = (a.size * pa.scale) * 0.5;
      const cellX = Math.floor(pa.x / cellSize);
      const cellY = Math.floor(pa.y / cellSize);
      const cellZ = Math.floor(pa.z / cellSize);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const bucket = grid.get(keyFor(cellX + ox, cellY + oy, cellZ + oz));
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
    delta = normalizePhysicsDelta(delta);
    this._stepWind(delta);
    this.environment?.beginFrame(delta, this.flakes, this.viewportWidth, this.viewportHeight, this);
    this.mouseBurstTimer = Math.max(0, this.mouseBurstTimer - delta);
    if (!this.mouseBurstTimer) this.mouseBurstMode = null;
    const windPhase = this.windTime;
    const physicsWind = {
      ...getWindVelocity(this.config, this.currentWindForce, this.currentWindLift, this.windEnabled),
      time: windPhase,
      enabled: this.windEnabled
    };

    this.flakes.forEach((flake) => {
      if (flake.isFinished || flake.isSettled) return;
      this._applyMouseForce(flake, delta);
      if (Number.isFinite(this.config.gravity)) {
        stepSnowflakePhysics(flake, delta, this.config, physicsWind);
      }
      flake.velocityZ += Math.sin(windPhase * 0.7 + flake.y * 0.008 + flake.x * 0.003)
        * this.currentWindVortex * Math.sqrt(flake.size / 20) * 12 * delta;
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
      if (flake.x < -flake.size) {
        flake.x = this.viewportWidth + flake.size;
        this.environment?.resetMotion(flake);
      } else if (flake.x > this.viewportWidth + flake.size) {
        flake.x = -flake.size;
        this.environment?.resetMotion(flake);
      }
      if (flake.y > this.viewportHeight + flake.size) {
        if (this.environment?.retire(flake)) return;
        flake.y = -flake.size;
        flake.x = Math.random() * this.viewportWidth;
        flake.z = MIN_DEPTH + Math.random() * (MAX_DEPTH - MIN_DEPTH);
        flake.velocityX = 0;
        flake.velocityY = 0;
        flake.fallSpeed = 0;
        flake.verticalVelocity = 0;
        flake._physicsInitialized = false;
        this.environment?.resetMotion(flake);
      }
    });

    this.environment?.finishFrame();
    const positions = this._worldPositions;
    positions.length = this.flakes.length;
    for (let index = 0; index < this.flakes.length; index++) {
      positions[index] = this._worldPosition(this.flakes[index], positions[index] || {});
    }
    this._resolveCollisions(positions);
    this.elapsed += delta;
    const time = this.elapsed;
    const position = this._position;
    const scaleVector = this._scale;
    const euler = this._euler;
    const quaternion = this._quaternion;
    const matrix = this._transform;
    const worldPosition = {};
    for (const group of this.glyphMeshes.values()) {
      const glow = group.glow;
      const flakes = group.flakes;
      for (let index = 0; index < flakes.length; index++) {
        const flake = flakes[index];
        this._worldPosition(flake, worldPosition);
        flake.glowPhase += delta * 1.3;
        position.set(worldPosition.x, worldPosition.y, worldPosition.z);
        euler.set(flake.rotationX, flake.rotationY, flake.rotationZ);
        quaternion.setFromEuler(euler);
        const scale = flake.isFinished ? 0 : flake.size * worldPosition.scale;
        scaleVector.set(scale, scale, scale);
        matrix.compose(position, quaternion, scaleVector);
        group.mesh.setMatrixAt(index, matrix);
        if (glow) {
          glow.pulse.setX(
            index,
            resolveGlowPulse(flake.glowPhase) * resolveGlowFlicker(time, flake, this.glowFlicker)
          );
        }
      }
      group.mesh.instanceMatrix.needsUpdate = true;
      if (glow) {
        glow.pulse.needsUpdate = true;
      }
    }
  }

  _adaptQuality(frameSeconds) {
    if (!this.renderer || !this.adaptiveQuality.update(frameSeconds, document.hidden)) return;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 1.5) * this.adaptiveQuality.resolutionScale
    );
    const step = Math.max(1, this.adaptiveQuality.level);
    for (const group of this.glyphMeshes.values()) {
      if (!group.geometries.has(step)) {
        const detail = createGlyphDetailGeometry(group.shape, this.config.snow3dThickness ?? 0.07, step);
        const original = group.geometries.get(1);
        if (detail.getAttribute('position').count < original.getAttribute('position').count) {
          if (group.glow) {
            detail.setAttribute('glowColor', original.getAttribute('glowColor'));
            detail.setAttribute('glowPulse', original.getAttribute('glowPulse'));
          }
          group.geometries.set(step, detail);
        } else {
          detail.dispose();
          group.geometries.set(step, original);
        }
      }
      group.mesh.geometry = group.geometries.get(step);
      if (group.glow) group.glow.mesh.geometry = group.mesh.geometry;
    }
    this.resize();
  }

  start() {
    if (!this.renderer || this.frameRequest !== null) return;
    this.isPaused = false;
    this.lastTimestamp = performance.now();
    this.adaptiveQuality.resetTiming();
    const animate = (timestamp) => {
      if (!this.renderer || this.isPaused) return;
      const frameSeconds = Math.max((timestamp - this.lastTimestamp) / 1000, 0);
      const delta = normalizePhysicsDelta(frameSeconds);
      this.lastTimestamp = timestamp;
      this._adaptQuality(frameSeconds);
      this._updateInstances(delta);
      this._stepGlowState(delta);
      this.glowPass.render(this.scene, this.camera);
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
    this.stopBackgroundMonitoring();
    window.removeEventListener('resize', this.boundResize);
    window.visualViewport?.removeEventListener('resize', this.boundResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.glowPass?.dispose();
    this.glowPass = null;
    for (const group of this.glyphMeshes.values()) {
      this.scene?.remove(group.mesh);
      group.mesh.dispose();
      for (const geometry of new Set(group.geometries?.values() || [group.mesh.geometry])) geometry.dispose();
    }
    this.glyphMeshes.clear();
    this.glyphMaterial?.dispose();
    this.glyphMaterial = null;
    this.emojiMaterials.forEach((material) => material.dispose());
    this.emojiTextures.forEach((texture) => texture.dispose());
    this.emojiMaterials = [];
    this.emojiTextures = [];
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
