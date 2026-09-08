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

export interface FloatingObstacleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const FLOATING_EDGE_MARGIN = 12;
export const FLOATING_OBSTACLE_GAP = 12;

function intersectsObstacle(
  position: FloatingPosition,
  element: { width: number; height: number },
  obstacle: FloatingObstacleRect,
  gap: number,
): boolean {
  return position.x < obstacle.right + gap
    && position.x + element.width > obstacle.left - gap
    && position.y < obstacle.bottom + gap
    && position.y + element.height > obstacle.top - gap;
}

export function avoidFloatingObstacles(
  preferredPosition: FloatingPosition,
  element: { width: number; height: number },
  viewport: FloatingViewportBounds,
  obstacles: readonly FloatingObstacleRect[],
  gap = FLOATING_OBSTACLE_GAP,
): FloatingPosition {
  const preferred = clampFloatingPosition(preferredPosition, element, viewport);
  const collides = (candidate: FloatingPosition) => obstacles.some(obstacle => (
    intersectsObstacle(candidate, element, obstacle, gap)
  ));
  if (!collides(preferred)) return preferred;

  const candidates: FloatingPosition[] = [];
  for (const obstacle of obstacles) {
    const xPositions = [
      preferred.x,
      obstacle.left - gap - element.width,
      obstacle.right + gap,
    ];
    const yPositions = [
      obstacle.top - gap - element.height,
      obstacle.bottom + gap,
      preferred.y,
    ];
    for (const y of yPositions) {
      for (const x of xPositions) {
        candidates.push(clampFloatingPosition({ x, y }, element, viewport));
      }
    }
  }
  candidates.push(
    clampFloatingPosition({ x: viewport.left, y: viewport.top }, element, viewport),
    clampFloatingPosition({ x: viewport.left + viewport.width, y: viewport.top }, element, viewport),
    clampFloatingPosition({ x: viewport.left, y: viewport.top + viewport.height }, element, viewport),
    clampFloatingPosition({ x: viewport.left + viewport.width, y: viewport.top + viewport.height }, element, viewport),
  );

  const clearCandidates = candidates.filter(candidate => !collides(candidate));
  if (clearCandidates.length === 0) return preferred;
  clearCandidates.sort((a, b) => {
    const distanceA = (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2;
    const distanceB = (b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2;
    return distanceA - distanceB || a.y - b.y || a.x - b.x;
  });
  return clearCandidates[0];
}

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
