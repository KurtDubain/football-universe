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
  const latestPositionRef = useRef<FloatingPosition | null>(position);
  const [dragging, setDragging] = useState(false);

  const updatePosition = useCallback((next: FloatingPosition | null) => {
    latestPositionRef.current = next;
    setPosition(next);
  }, []);

  const clampCurrentPosition = useCallback((next: FloatingPosition): FloatingPosition => (
    clampFloatingPosition(next, getElementSize(containerRef.current), getViewportBounds())
  ), []);

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
    const keepVisible = () => {
      const current = latestPositionRef.current;
      if (!current) return;
      const clamped = clampCurrentPosition(current);
      updatePosition(clamped);
      persistPosition(clamped, containerRef.current);
    };
    const viewport = window.visualViewport;
    window.addEventListener('resize', keepVisible);
    viewport?.addEventListener('resize', keepVisible);
    viewport?.addEventListener('scroll', keepVisible);
    return () => {
      window.removeEventListener('resize', keepVisible);
      viewport?.removeEventListener('resize', keepVisible);
      viewport?.removeEventListener('scroll', keepVisible);
    };
  }, [clampCurrentPosition, updatePosition]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
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
      aria-label={stageLabel ? `推进到下一阶段：${stageLabel}；拖动可调整位置` : '赛季已完成'}
      aria-busy={isAdvancing}
      title={stageLabel ? `推进到下一阶段：${stageLabel}；拖动可调整位置，方向键微调，Home 复位` : '赛季已完成'}
      disabled={disabled}
      className={`ui-action-feedback floating-advance-overlay fixed z-[100] flex h-12 w-12 touch-none items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--action)] text-white shadow-xl transition-[background-color,box-shadow,transform] hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)] sm:w-auto sm:min-w-24 sm:gap-2 sm:rounded-lg sm:px-4 ${position ? '' : 'floating-advance-docked'} ${dragging ? 'scale-105 cursor-grabbing ring-2 ring-[var(--focus-ring)]' : 'cursor-pointer'}`}
      style={position ? { left: position.x, top: position.y } : undefined}
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
      <span className="sr-only sm:not-sr-only sm:text-sm sm:font-semibold">
        {isAdvancing ? (busyLabel ?? '结算中') : '推进'}
      </span>
      <span className={`absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--action)] sm:static sm:h-1.5 sm:w-1.5 sm:ring-0 ${accentClass}`} aria-hidden="true" />
    </button>
  );
}
