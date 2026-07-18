export interface FloatingPosition {
  x: number;
  y: number;
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
