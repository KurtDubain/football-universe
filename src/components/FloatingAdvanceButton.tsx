import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from './Icon';
import {
  clampFloatingPosition,
  FLOATING_EDGE_MARGIN,
  type FloatingPosition,
  type FloatingViewportBounds,
} from './floating-position';

const KEYBOARD_STEP = 12;

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
  return { width: rect?.width ?? 112, height: rect?.height ?? 48 };
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0 });
  const latestPositionRef = useRef<FloatingPosition | null>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const updatePosition = useCallback((next: FloatingPosition | null) => {
    latestPositionRef.current = next;
    setPosition(next);
  }, []);

  const clampCurrentPosition = useCallback((next: FloatingPosition): FloatingPosition => (
    clampFloatingPosition(next, getElementSize(containerRef.current), getViewportBounds())
  ), []);

  useEffect(() => {
    const keepVisible = () => {
      const current = latestPositionRef.current;
      if (current) updatePosition(clampCurrentPosition(current));
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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!dragging || drag.pointerId !== event.pointerId) return;
    updatePosition(clampCurrentPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  }, [clampCurrentPosition, dragging, updatePosition]);

  const finishDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const current = latestPositionRef.current;
    if (current) {
      const viewport = getViewportBounds();
      const size = getElementSize(containerRef.current);
      const midpoint = viewport.left + viewport.width / 2;
      updatePosition(clampCurrentPosition({
        x: current.x + size.width / 2 < midpoint
          ? viewport.left + FLOATING_EDGE_MARGIN
          : viewport.left + viewport.width - size.width - FLOATING_EDGE_MARGIN,
        y: current.y,
      }));
    }
    dragRef.current.pointerId = -1;
    setDragging(false);
  }, [clampCurrentPosition, updatePosition]);

  const handleMoveKey = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      updatePosition(null);
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
    updatePosition(clampCurrentPosition({ x: rect.left + direction[0], y: rect.top + direction[1] }));
  }, [clampCurrentPosition, updatePosition]);

  return (
    <div
      ref={containerRef}
      data-testid="floating-advance"
      className={`fixed z-[100] flex h-12 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface-floating)] shadow-xl ${position ? '' : 'floating-advance-docked'} ${dragging ? 'ring-2 ring-[var(--focus-ring)]' : ''}`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <button
        type="button"
        aria-label="移动悬浮推进按钮"
        title="拖动调整位置；方向键微调，Home 复位"
        className="flex h-12 w-11 touch-none items-center justify-center border-r border-[var(--border-strong)] text-lg text-[var(--text-muted)] cursor-grab active:cursor-grabbing hover:bg-[var(--surface-raised)] hover:text-[var(--text-secondary)]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={handleMoveKey}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        type="button"
        aria-label={stageLabel ? `推进到下一阶段：${stageLabel}` : '赛季已完成'}
        title={stageLabel ? `推进到下一阶段：${stageLabel}` : '赛季已完成'}
        disabled={disabled}
        onClick={onAdvance}
        className="flex h-12 min-w-17 items-center justify-center gap-1.5 bg-[var(--action)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-raised)] disabled:text-[var(--text-disabled)]"
      >
        <Icon name="play" size={15} />
        <span>{isAdvancing ? '推进中' : '推进'}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${accentClass}`} aria-hidden="true" />
      </button>
    </div>
  );
}
