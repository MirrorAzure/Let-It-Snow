/**
 * Возвращает стабильный размер viewport в CSS-пикселях.
 * При временных нулях в layout использует fallback значения.
 */
export function getStableViewportSize(fallbackWidth = 0, fallbackHeight = 0) {
  const vv = window.visualViewport;
  const vvWidth = Number(vv?.width);
  const vvHeight = Number(vv?.height);

  const width =
    (Number.isFinite(vvWidth) && vvWidth > 0 ? vvWidth : 0) ||
    window.innerWidth ||
    document.documentElement?.clientWidth ||
    document.body?.clientWidth ||
    fallbackWidth ||
    1;

  const height =
    (Number.isFinite(vvHeight) && vvHeight > 0 ? vvHeight : 0) ||
    window.innerHeight ||
    document.documentElement?.clientHeight ||
    document.body?.clientHeight ||
    fallbackHeight ||
    1;

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height))
  };
}