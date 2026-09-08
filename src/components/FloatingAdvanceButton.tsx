import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { Icon } from './Icon';
import {
  avoidFloatingObstacles,
  clampFloatingPosition,
  createFloatingPositionMemory,
  FLOATING_EDGE_MARGIN,
  type FloatingPosition,
  type FloatingPositionMemory,
  type FloatingViewportBounds,
  restoreFloatingPosition,
} from './floating-position';

const KEYBOARD_STEP = 12;
const DRAG_THRESHOLD = 6;
const POSITION_STORAGE_KEY = 'floating-advance-position-v2';

function isMobileDocked(): boolean {
  return window.matchMedia?.('(max-width: 639px)').matches ?? window.innerWidth < 640;
}

function getViewportBounds(): FloatingViewportBounds {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const content = document.querySelector<HTMLElement>('.app-route-content')?.getBoundingClientRect();
  const left = Math.max(viewportLeft, content?.left ?? viewportLeft);
  const top = Math.max(viewportTop, content?.top ?? viewportTop);
  const right = Math.min(viewportRight, content?.right ?? viewportRight);
  const bottom = Math.min(viewportBottom, content?.bottom ?? viewportBottom);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function getElementSize(element: HTMLElement | null): { width: number; height: number } {
  const rect = element?.getBoundingClientRect();
  if (rect?.width && rect.height) return { width: rect.width, height: rect.height };
  return window.innerWidth < 640
    ? { width: 48, height: 48 }
    : { width: 96, height: 48 };
}

function getSafeAreaInset(property: '--safe-area-right' | '--safe-area-bottom'): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property));
  return Number.isFinite(value) ? value : 0;
}

function getDefaultPosition(
  element: { width: number; height: number },
  viewport: FloatingViewportBounds,
): FloatingPosition {
  return clampFloatingPosition({
    x: viewport.left + viewport.width - element.width - Math.max(12, getSafeAreaInset('--safe-area-right')),
    y: viewport.top + viewport.height - element.height - Math.max(16, getSafeAreaInset('--safe-area-bottom')),
  }, element, viewport);
}

function samePosition(a: FloatingPosition | null, b: FloatingPosition | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function getVisibleObstacles(viewport: FloatingViewportBounds) {
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  return [...document.querySelectorAll<HTMLElement>('[data-floating-advance-obstacle]')]
    .filter(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .map(element => element.getBoundingClientRect())
    .filter(rect => (
      rect.width > 0
      && rect.height > 0
      && rect.right > viewport.left
      && rect.left < viewportRight
      && rect.bottom > viewport.top
      && rect.top < viewportBottom
    ));
}

function readSavedPosition(): FloatingPosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPositionMemory>;
    return Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? restoreFloatingPosition({
        x: Number(parsed.x),
        y: Number(parsed.y),
        edge: parsed.edge,
        verticalRatio: parsed.verticalRatio,
        viewportWidth: parsed.viewportWidth,
        viewportHeight: parsed.viewportHeight,
      }, getElementSize(null), getViewportBounds())
      : null;
  } catch {
    return null;
  }
}

function persistPosition(position: FloatingPosition | null, element: HTMLElement | null): void {
  try {
    if (position) {
      const memory = createFloatingPositionMemory(
        position,
        getElementSize(element),
        getViewportBounds(),
      );
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(memory));
    }
    else localStorage.removeItem(POSITION_STORAGE_KEY);
  } catch {
    // Position memory is optional and must never block the advance action.
  }
}

interface FloatingAdvanceButtonProps {
  stageLabel?: string;
  accentClass?: string;
  isAdvancing: boolean;
  busyLabel?: string;
  disabled: boolean;
  onAdvance: () => void;
}

export default function FloatingAdvanceButton({
  stageLabel,
  accentClass = 'bg-[var(--text-muted)]',
  isAdvancing,
  busyLabel,
  disabled,
  onAdvance,
}: FloatingAdvanceButtonProps) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<FloatingPosition | null>(readSavedPosition);
  const [avoidancePosition, setAvoidancePosition] = useState<FloatingPosition | null>(null);
  const latestPositionRef = useRef<FloatingPosition | null>(position);
  const [dragging, setDragging] = useState(false);
  const [mobileDocked, setMobileDocked] = useState(isMobileDocked);

  const updatePosition = useCallback((next: FloatingPosition | null) => {
    latestPositionRef.current = next;
    setPosition(next);
    setAvoidancePosition(null);
  }, []);

  const clampCurrentPosition = useCallback((next: FloatingPosition): FloatingPosition => (
    clampFloatingPosition(next, getElementSize(containerRef.current), getViewportBounds())
  ), []);

  const recalibratePosition = useCallback(() => {
    if (isMobileDocked()) {
      setAvoidancePosition(current => current ? null : current);
      return;
    }
    const element = containerRef.current;
    if (!element) return;
    const size = getElementSize(element);
    const viewport = getViewportBounds();
    const current = latestPositionRef.current;
    const preferred = current
      ? clampFloatingPosition(current, size, viewport)
      : getDefaultPosition(size, viewport);
    if (current && !samePosition(current, preferred)) {
      latestPositionRef.current = preferred;
      setPosition(preferred);
      persistPosition(preferred, element);
    }
    const avoided = avoidFloatingObstacles(preferred, size, viewport, getVisibleObstacles(viewport));
    setAvoidancePosition(previous => samePosition(avoided, preferred)
      ? previous ? null : previous
      : samePosition(previous, avoided) ? previous : avoided);
  }, []);

  useLayoutEffect(() => {
    // The route content box only exists after commit, so resolve saved relative
    // coordinates once more before paint using the real draggable area.
    const current = readSavedPosition() ?? latestPositionRef.current;
    if (current) {
      const clamped = clampCurrentPosition(current);
      latestPositionRef.current = clamped;
      if (containerRef.current) {
        containerRef.current.style.left = `${clamped.x}px`;
        containerRef.current.style.top = `${clamped.y}px`;
        containerRef.current.classList.remove('floating-advance-docked');
      }
      persistPosition(clamped, containerRef.current);
      const frame = requestAnimationFrame(() => updatePosition(clamped));
      return () => cancelAnimationFrame(frame);
    }
  }, [clampCurrentPosition, updatePosition]);

  useEffect(() => {
    let frame = 0;
    const scheduleCalibration = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recalibratePosition);
    };
    const viewport = window.visualViewport;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleCalibration);
    const observeLayout = () => {
      resizeObserver?.disconnect();
      const routeContent = document.querySelector<HTMLElement>('.app-route-content');
      if (routeContent) resizeObserver?.observe(routeContent);
      for (const obstacle of document.querySelectorAll<HTMLElement>('[data-floating-advance-obstacle]')) {
        resizeObserver?.observe(obstacle);
      }
      scheduleCalibration();
    };
    const mutationObserver = new MutationObserver(observeLayout);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleCalibration);
    window.addEventListener('orientationchange', scheduleCalibration);
    document.addEventListener('scroll', scheduleCalibration, true);
    viewport?.addEventListener('resize', scheduleCalibration);
    viewport?.addEventListener('scroll', scheduleCalibration);
    observeLayout();
    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleCalibration);
      window.removeEventListener('orientationchange', scheduleCalibration);
      document.removeEventListener('scroll', scheduleCalibration, true);
      viewport?.removeEventListener('resize', scheduleCalibration);
      viewport?.removeEventListener('scroll', scheduleCalibration);
    };
  }, [recalibratePosition]);

  useEffect(() => {
    const frame = requestAnimationFrame(recalibratePosition);
    return () => cancelAnimationFrame(frame);
  }, [mobileDocked, position, recalibratePosition]);

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 639px)');
    if (!media) return;
    const updateDockMode = () => setMobileDocked(media.matches);
    media.addEventListener('change', updateDockMode);
    return () => media.removeEventListener('change', updateDockMode);
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (isMobileDocked()) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (isMobileDocked()) return;
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      suppressClickRef.current = true;
      setDragging(true);
    }
    updatePosition(clampCurrentPosition({
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
    }));
  }, [clampCurrentPosition, updatePosition]);

  const finishDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (isMobileDocked()) return;
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const current = latestPositionRef.current;
    if (dragRef.current.moved && current) {
      const viewport = getViewportBounds();
      const size = getElementSize(containerRef.current);
      const midpoint = viewport.left + viewport.width / 2;
      const snapped = clampCurrentPosition({
        x: current.x + size.width / 2 < midpoint
          ? viewport.left + FLOATING_EDGE_MARGIN
          : viewport.left + viewport.width - size.width - FLOATING_EDGE_MARGIN,
        y: current.y,
      });
      updatePosition(snapped);
      persistPosition(snapped, containerRef.current);
    }
    dragRef.current.pointerId = -1;
    setDragging(false);
  }, [clampCurrentPosition, updatePosition]);

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    onAdvance();
  }, [onAdvance]);

  const handleMoveKey = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      updatePosition(null);
      persistPosition(null, containerRef.current);
      return;
    }
    const direction = {
      ArrowLeft: [-KEYBOARD_STEP, 0],
      ArrowRight: [KEYBOARD_STEP, 0],
      ArrowUp: [0, -KEYBOARD_STEP],
      ArrowDown: [0, KEYBOARD_STEP],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = clampCurrentPosition({ x: rect.left + direction[0], y: rect.top + direction[1] });
    updatePosition(next);
    persistPosition(next, containerRef.current);
  }, [clampCurrentPosition, updatePosition]);

  return (
    <button
      ref={containerRef}
      type="button"
      data-testid="floating-advance"
      data-dragging={dragging ? 'true' : 'false'}
      data-avoidance-active={avoidancePosition ? 'true' : 'false'}
      aria-label={stageLabel
        ? `推进到下一阶段：${stageLabel}${mobileDocked ? '' : '；拖动可调整位置'}`
        : '赛季已完成'}
      aria-busy={isAdvancing}
      title={stageLabel
        ? mobileDocked
          ? `推进到下一阶段：${stageLabel}`
          : `推进到下一阶段：${stageLabel}；拖动可调整位置，方向键微调，Home 复位`
        : '赛季已完成'}
      disabled={disabled}
      className={`ui-action-feedback floating-advance-overlay fixed z-[100] flex h-12 w-12 touch-none items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--action)] text-white shadow-xl transition-[background-color,box-shadow,transform] hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)] sm:w-auto sm:min-w-24 sm:gap-2 sm:rounded-lg sm:px-4 ${position || avoidancePosition ? '' : 'floating-advance-docked'} ${dragging ? 'scale-105 cursor-grabbing ring-2 ring-[var(--focus-ring)]' : 'cursor-pointer'}`}
      style={avoidancePosition || position ? {
        left: (avoidancePosition ?? position)!.x,
        top: (avoidancePosition ?? position)!.y,
      } : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleMoveKey}
    >
      <span className={isAdvancing ? 'animate-spin motion-reduce:animate-none' : ''}>
        <Icon name={isAdvancing ? 'refresh' : 'play'} size={18} />
      </span>
      <span className="text-sm font-semibold">
        {isAdvancing ? (busyLabel ?? '结算中') : '推进'}
      </span>
      <span className={`absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--action)] sm:static sm:h-1.5 sm:w-1.5 sm:ring-0 ${accentClass}`} aria-hidden="true" />
    </button>
  );
}
