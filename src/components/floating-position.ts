export interface FloatingPosition {
  x: number;
  y: number;
}

export interface FloatingPositionMemory extends FloatingPosition {
  edge?: 'left' | 'right';
  verticalRatio?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface FloatingViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const FLOATING_EDGE_MARGIN = 12;

export function clampFloatingPosition(
  position: FloatingPosition,
  element: { width: number; height: number },
  viewport: FloatingViewportBounds,
): FloatingPosition {
  const minX = viewport.left + FLOATING_EDGE_MARGIN;
  const minY = viewport.top + FLOATING_EDGE_MARGIN;
  const maxX = Math.max(minX, viewport.left + viewport.width - element.width - FLOATING_EDGE_MARGIN);
  const maxY = Math.max(minY, viewport.top + viewport.height - element.height - FLOATING_EDGE_MARGIN);
  return {
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(minY, position.y)),
  };
}

export function createFloatingPositionMemory(
  position: FloatingPosition,
  element: { width: number; height: number },
  viewport: FloatingViewportBounds,
): FloatingPositionMemory {
  const clamped = clampFloatingPosition(position, element, viewport);
  const minY = viewport.top + FLOATING_EDGE_MARGIN;
  const maxY = Math.max(minY, viewport.top + viewport.height - element.height - FLOATING_EDGE_MARGIN);
  const verticalRange = maxY - minY;
  return {
    ...clamped,
    edge: clamped.x + element.width / 2 < viewport.left + viewport.width / 2 ? 'left' : 'right',
    verticalRatio: verticalRange > 0 ? (clamped.y - minY) / verticalRange : 0,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
}

export function restoreFloatingPosition(
  memory: FloatingPositionMemory,
  element: { width: number; height: number },
  viewport: FloatingViewportBounds,
): FloatingPosition {
  if (
    (memory.edge !== 'left' && memory.edge !== 'right')
    || !Number.isFinite(memory.verticalRatio)
  ) {
    return clampFloatingPosition(memory, element, viewport);
  }
  const sameViewport = Number.isFinite(memory.viewportWidth)
    && Number.isFinite(memory.viewportHeight)
    && Math.abs((memory.viewportWidth ?? 0) - viewport.width) < 1
    && Math.abs((memory.viewportHeight ?? 0) - viewport.height) < 8;
  if (sameViewport) return clampFloatingPosition(memory, element, viewport);

  const minY = viewport.top + FLOATING_EDGE_MARGIN;
  const maxY = Math.max(minY, viewport.top + viewport.height - element.height - FLOATING_EDGE_MARGIN);
  const ratio = Math.min(1, Math.max(0, memory.verticalRatio ?? 0));
  return clampFloatingPosition({
    x: memory.edge === 'left'
      ? viewport.left + FLOATING_EDGE_MARGIN
      : viewport.left + viewport.width - element.width - FLOATING_EDGE_MARGIN,
    y: minY + (maxY - minY) * ratio,
  }, element, viewport);
}
