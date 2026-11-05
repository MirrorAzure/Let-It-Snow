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

  invalidate() {
    this.revision++;
    this.nextScan = 0;
  }

  refresh(now) {
    if (now < this.nextScan) return;
    this.nextScan = now + 750;
    this.surfaces = [];
    if (!document.body || typeof document.elementFromPoint !== 'function') return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let element;
    let visited = 0;
    while ((element = walker.nextNode()) && visited++ < MAX_VISITED && this.surfaces.length < MAX_SURFACES) {
      if (!element.matches(CANDIDATES) || this.isOverlay(element) || element.closest(EXCLUDED)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 64 || rect.height < 28 || rect.top < 28 || rect.top > window.innerHeight
        || rect.right <= 0 || rect.left >= window.innerWidth) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 0.1) continue;
      if (element.tagName === 'DIV' && parseFloat(style.borderTopWidth) === 0
        && (!style.backgroundColor || style.backgroundColor === 'rgba(0, 0, 0, 0)')) continue;
      this.surfaces.push({ element, left: rect.left, right: rect.right, top: rect.top });
    }
  }

  hasRoom(surface, x, size, ignore = null, y = surface.top - size / 2 - 2) {
    const ignored = ignore?.size || 0;
    if (this.placements.size - ignored >= 32) return false;
    const radius = size / 2;
    const top = y - radius;
    for (const [flake, placement] of this.placements) {
      if (ignore?.has(flake)) continue;
      if (Math.hypot(flake.x - x, flake.y - y) < (flake.size + size) / 2 + 2 - 0.05) return false;
    }
    const steps = Math.max(2, Math.ceil(size / 8));
    const checkedText = new Set();
    for (let column = 0; column <= steps; column++) {
      const px = x - radius + size * column / steps;
      const support = document.elementFromPoint(px, surface.top + 1);
      if (!support || (support !== surface.element && !surface.element.contains(support))) return false;
      for (let row = 0; row <= steps; row++) {
        const py = top + size * row / steps;
        const hit = document.elementFromPoint(px, py);
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
