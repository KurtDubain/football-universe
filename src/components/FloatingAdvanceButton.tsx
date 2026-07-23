import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { Icon } from './Icon';
import {
  clampFloatingPosition,
  FLOATING_EDGE_MARGIN,
  type FloatingPosition,
  type FloatingViewportBounds,
} from './floating-position';

const KEYBOARD_STEP = 12;
const DRAG_THRESHOLD = 6;
const POSITION_STORAGE_KEY = 'floating-advance-position-v2';

function getViewportBounds(): FloatingViewportBounds {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

function getElementSize(element: HTMLElement | null): { width: number; height: number } {
  const rect = element?.getBoundingClientRect();
  return { width: rect?.width ?? 56, height: rect?.height ?? 56 };
}

function readSavedPosition(): FloatingPosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPosition>;
    return Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
      ? { x: Number(parsed.x), y: Number(parsed.y) }
      : null;
  } catch {
    return null;
  }
}

function persistPosition(position: FloatingPosition | null): void {
  try {
    if (position) localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    else localStorage.removeItem(POSITION_STORAGE_KEY);
  } catch {
    // Position memory is optional and must never block the advance action.
  }
}

interface FloatingAdvanceButtonProps {
  stageLabel?: string;
  accentClass?: string;
  isAdvancing: boolean;
  disabled: boolean;
  onAdvance: () => void;
}

export default function FloatingAdvanceButton({
  stageLabel,
  accentClass = 'bg-[var(--text-muted)]',
  isAdvancing,
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

  useEffect(() => {
    const current = latestPositionRef.current;
    if (current) {
      const clamped = clampCurrentPosition(current);
      updatePosition(clamped);
      persistPosition(clamped);
    }
  }, [clampCurrentPosition, updatePosition]);

  useEffect(() => {
    const keepVisible = () => {
      const current = latestPositionRef.current;
      if (!current) return;
      const clamped = clampCurrentPosition(current);
      updatePosition(clamped);
      persistPosition(clamped);
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
      persistPosition(snapped);
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
      persistPosition(null);
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
    persistPosition(next);
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
      className={`fixed z-[100] flex h-14 w-14 touch-none items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--action)] text-white shadow-xl transition-[background-color,box-shadow,transform] hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)] sm:h-12 sm:w-auto sm:min-w-24 sm:gap-2 sm:rounded-lg sm:px-4 ${position ? '' : 'floating-advance-docked'} ${dragging ? 'scale-105 cursor-grabbing ring-2 ring-[var(--focus-ring)]' : 'cursor-pointer'}`}
      style={position ? { left: position.x, top: position.y } : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleMoveKey}
    >
      <Icon name="play" size={18} />
      <span className="sr-only sm:not-sr-only sm:text-sm sm:font-semibold">
        {isAdvancing ? '推进中' : '推进'}
      </span>
      <span className={`absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--action)] sm:static sm:h-1.5 sm:w-1.5 sm:ring-0 ${accentClass}`} aria-hidden="true" />
    </button>
  );
}
