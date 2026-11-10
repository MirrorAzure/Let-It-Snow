const RESOLUTION_SCALES = [1, 0.85, 0.7, 0.55];

export class AdaptiveQuality {
  constructor() {
    this.level = 0;
    this.targetFps = 60;
    this.currentFps = 60;
    this.samples = [];
    this.resetTiming();
  }

  get resolutionScale() {
    return RESOLUTION_SCALES[this.level];
  }

  resetTiming() {
    this.slowTime = 0;
    this.fastTime = 0;
    this.warmupTime = 0;
    this.averageDelta = 1 / this.targetFps;
    this.samples.length = 0;
  }

  update(frameSeconds, hidden = false) {
    // Pauses and background-tab throttling are not rendering performance samples.
    if (hidden || !Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds >= 1) {
      this.resetTiming();
      return false;
    }

    this.samples.push(frameSeconds);
    if (this.samples.length === 60) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      // A sustained fast cadence reveals refresh rate; isolated short frames do not.
      const candidate = 1 / sorted[Math.floor(sorted.length * 0.2)];
      if (candidate > this.targetFps * 1.08) {
        this.targetFps = candidate;
        this.slowTime = this.fastTime = 0;
      }
      this.samples.length = 0;
    }

    const weight = 1 - Math.exp(-frameSeconds / 0.5);
    this.averageDelta += (frameSeconds - this.averageDelta) * weight;
    this.currentFps = 1 / this.averageDelta;
    this.warmupTime += frameSeconds;
    if (this.warmupTime < 1) return false;

    this.slowTime = this.currentFps < this.targetFps * 0.85
      ? this.slowTime + frameSeconds : 0;
    this.fastTime = this.currentFps >= this.targetFps * 0.94
      ? this.fastTime + frameSeconds : 0;
    if (this.slowTime >= 2 && this.level < RESOLUTION_SCALES.length - 1) {
      this.level++;
    } else if (this.fastTime >= 8 && this.level > 0) {
      this.level--;
    } else {
      return false;
    }
    this.slowTime = this.fastTime = 0;
    return true;
  }
}
