const EXCLUDED = 'a,button,input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[aria-hidden="true"],[inert]';
const TEXT_CONTENT = 'p,h1,h2,h3,h4,h5,h6,li,label,pre,code,td,th';
const CANDIDATES = 'img,video,canvas,figure,article,section,aside,header,footer,nav,div,[role="region"]';
const MAX_SURFACES = 80;
const MAX_VISITED = 2000;

class PageSurfaceTracker {
  constructor() {
    this.users = 0;
    this.surfaces = [];
    this.placements = new Map();
    this.hitTestCache = new Map();
    this.revision = 0;
    this.lastScroll = -Infinity;
    this.nextScan = 0;
    this.onScroll = () => {
      this.lastScroll = performance.now();
      this.invalidate();
    };
    this.onResize = () => { this.nextScan = 0; };
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    window.visualViewport?.addEventListener('scroll', this.onScroll, { passive: true });
    window.visualViewport?.addEventListener('resize', this.onResize, { passive: true });
  }

  isOverlay(element) {
    return Boolean(element.closest?.('[id^="let-it-snow-"]'));
  }

  isSafeSurface(element) {
    if (!element.isConnected || this.isOverlay(element) || element.closest(EXCLUDED)) return false;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible') return false;
    let opacity = 1;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const current = ancestor === element ? style : getComputedStyle(ancestor);
      if (current.display === 'none' || current.contentVisibility === 'hidden') return false;
      const alpha = parseFloat(current.opacity);
      if (Number.isFinite(alpha)) opacity *= alpha;
      if (opacity < 0.1) return false;
    }
    return true;
  }

  invalidate() {
    this.revision++;
    this.nextScan = 0;
  }

  refresh(now) {
    this.hitTestCache.clear();
    if (now < this.nextScan) return;
    this.nextScan = now + 750;
    this.surfaces = [];
    if (!document.body || typeof document.elementFromPoint !== 'function') return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let element;
    let visited = 0;
    while ((element = walker.nextNode()) && visited++ < MAX_VISITED && this.surfaces.length < MAX_SURFACES) {
      if (!element.matches(CANDIDATES)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 64 || rect.height < 28 || rect.top < 28 || rect.top > window.innerHeight
        || rect.right <= 0 || rect.left >= window.innerWidth) continue;
      if (!this.isSafeSurface(element)) continue;
      const style = getComputedStyle(element);
      if (element.tagName === 'DIV' && parseFloat(style.borderTopWidth) === 0
        && (!style.backgroundColor || style.backgroundColor === 'rgba(0, 0, 0, 0)')) continue;
      this.surfaces.push({ element, left: rect.left, right: rect.right, top: rect.top });
    }
  }

  syncPlacements() {
    const rects = new Map();
    const safety = new Map();
    for (const [flake, placement] of this.placements) {
      if (placement.revision !== this.revision || !placement.element.isConnected) {
        placement.environment.release(flake);
        continue;
      }
      let rect = rects.get(placement.element);
      if (!rect) {
        rect = placement.element.getBoundingClientRect();
        rects.set(placement.element, rect);
      }
      if (!safety.has(placement.element)) {
        safety.set(placement.element, this.isSafeSurface(placement.element));
      }
      if (!safety.get(placement.element)) {
        placement.environment.release(flake);
        continue;
      }
      flake.x += rect.left - placement.left;
      flake.baseX = flake.x;
      flake.y = placement.support
        ? flake.y + (rect.top - placement.top)
        : rect.top - flake.size / 2 - 2;
      placement.left = rect.left;
      placement.right = rect.right;
      placement.top = rect.top;
      if (rect.top < 28 || rect.top > window.innerHeight
        || flake.y - flake.size / 2 < 0
        || flake.x - flake.size / 2 < Math.max(0, rect.left)
        || flake.x + flake.size / 2 > Math.min(window.innerWidth, rect.right)) {
        placement.environment.release(flake);
      }
    }
    // Synchronize all layers before checking contacts, regardless of renderer order.
    for (const [flake, placement] of this.placements) {
      if (placement.supports.some((support) => {
        const distance = Math.hypot(flake.x - support.x, flake.y - support.y);
        return !support.isSettled || flake.y >= support.y
          || Math.abs(distance - (flake.size + support.size) / 2 - 2) > 1.5;
      })) placement.environment.release(flake);
    }
  }

  hasRoom(surface, x, size, ignore = null, y = surface.top - size / 2 - 2) {
    if (!this.isSafeSurface(surface.element)) return false;
    const ignored = ignore?.size || 0;
    if (this.placements.size - ignored >= 32) return false;
    const radius = size / 2;
    const top = y - radius;
    if (top < 0) return false;
    for (const [flake, placement] of this.placements) {
      if (ignore?.has(flake)) continue;
      if (Math.hypot(flake.x - x, flake.y - y) < (flake.size + size) / 2 + 2 - 0.05) return false;
    }
    const steps = Math.max(2, Math.ceil(size / 8));
    const checkedText = new Set();
    const hitTest = (px, py) => {
      let column = this.hitTestCache.get(px);
      if (column?.has(py)) return column.get(py);
      if (!column) {
        column = new Map();
        this.hitTestCache.set(px, column);
      }
      const hit = document.elementFromPoint(px, py);
      column.set(py, hit);
      return hit;
    };
    for (let column = 0; column <= steps; column++) {
      const px = x - radius + size * column / steps;
      const support = hitTest(px, surface.top + 1);
      if (!support || (support !== surface.element && !surface.element.contains(support))) return false;
      for (let row = 0; row <= steps; row++) {
        const py = top + size * row / steps;
        const hit = hitTest(px, py);
        if (!hit || hit.closest(`${EXCLUDED},${TEXT_CONTENT},img,video,canvas,svg`)) return false;
        if (hit === surface.element || surface.element.contains(hit)) return false;
        if (checkedText.has(hit)) continue;
        checkedText.add(hit);
        for (const node of hit.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (Array.from(range.getClientRects()).some((rect) =>
            rect.left < x + radius && rect.right > x - radius
            && rect.top < surface.top && rect.bottom > top)) return false;
        }
      }
    }
    return true;
  }

  destroy() {
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('scroll', this.onScroll);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.hitTestCache.clear();
    this.placements.clear();
  }
}

let tracker = null;

export function acquirePageSurfaces() {
  tracker ||= new PageSurfaceTracker();
  tracker.users++;
  return tracker;
}

export function releasePageSurfaces(current) {
  if (--current.users === 0) {
    current.destroy();
    if (tracker === current) tracker = null;
  }
}
