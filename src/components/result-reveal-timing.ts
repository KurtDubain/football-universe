export interface OrdinaryRevealPlan {
  step: number;
  delayMs: number;
  totalMs: number;
}

export function getOrdinaryRevealPlan(resultCount: number): OrdinaryRevealPlan {
  if (resultCount <= 0) return { step: 1, delayMs: 100, totalMs: 0 };
  const step = Math.max(1, Math.ceil(resultCount / 10));
  const ticks = Math.ceil(resultCount / step);
  const delayMs = Math.max(100, Math.min(160, Math.floor(1000 / ticks)));
  return { step, delayMs, totalMs: ticks * delayMs };
}

export function getDramaticRevealDelay(importance: number): number {
  return importance >= 3 ? 600 : importance >= 2 ? 400 : 0;
}
