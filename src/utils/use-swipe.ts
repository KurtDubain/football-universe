import { useRef, useEffect, RefObject } from 'react';

/**
 * Mobile-friendly swipe gesture detection on any element.
 *
 * Listens for touchstart/touchend, computes dx/dy, fires the matching
 * direction handler when the swipe exceeds `threshold` pixels AND is
 * roughly axis-aligned (perpendicular drift < threshold/2). Ignores
 * scrolls, taps, and diagonal "wobble" — only clean horizontal or
 * vertical swipes trigger.
 *
 * Usage:
 *   const ref = useSwipe<HTMLDivElement>({ onSwipeLeft: ..., onSwipeRight: ... });
 *   return <div ref={ref}>...</div>;
 *
 * Defaults: threshold 50px, only X/Y swipes (no diagonal).
 */

export interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
  /** Set true if the element legitimately scrolls vertically — then we
   *  ignore vertical swipes (only horizontal trigger). */
  ignoreVertical?: boolean;
}

export function useSwipe<T extends HTMLElement = HTMLDivElement>(
  handlers: SwipeHandlers,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Use a ref to avoid re-binding listeners on every render
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const threshold = handlers.threshold ?? 50;
    const ignoreVertical = handlers.ignoreVertical ?? false;
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const elapsed = Date.now() - startTime;
      // Tap (not a swipe) — too short, skip
      if (adx < threshold && ady < threshold) return;
      // Slow swipe (> 800ms) usually a drag/scroll, ignore
      if (elapsed > 800) return;
      const h = handlersRef.current;
      // Horizontal-dominant swipe
      if (adx > ady * 1.5) {
        if (dx > threshold && h.onSwipeRight) h.onSwipeRight();
        else if (dx < -threshold && h.onSwipeLeft) h.onSwipeLeft();
        return;
      }
      // Vertical-dominant swipe
      if (!ignoreVertical && ady > adx * 1.5) {
        if (dy > threshold && h.onSwipeDown) h.onSwipeDown();
        else if (dy < -threshold && h.onSwipeUp) h.onSwipeUp();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [handlers.threshold, handlers.ignoreVertical]);

  return ref;
}
