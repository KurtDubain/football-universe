const KiB = 1024;

export const PRODUCTION_PERFORMANCE_BUDGETS = {
  entryJs: {
    bytes: 210_000,
    gzipBytes: 66_000,
  },
  initialJs: {
    bytes: 480_000,
    gzipBytes: 160_000,
  },
  css: {
    bytes: 190 * KiB,
    gzipBytes: 30 * KiB,
  },
  images: {
    appBytes: 1_050_000,
    deployedBytes: 2_400_000,
    singleAppAssetBytes: 160 * KiB,
  },
  pwaPrecache: {
    // 86 → 87 for v4.62.0. The Ballon d'Or module needs the canonical
    // sortStandings, which made src/engine/standings a chunk shared by
    // season-awards, season-manager and storage-limits instead of being
    // inlined into one of them. Bytes stayed under the cap; only the entry
    // count moved. Pushing the ranking out to season-end.ts would remove the
    // edge, at the cost of widening computeSeasonAwards and
    // buildBallonDorContextResolver and rewriting ~22 call sites across two
    // verified award test files — not worth it for one precache entry.
    entries: 87,
    bytes: 2_150_000,
  },
} as const;

export interface LiveFrameBudget {
  cpuRate: number;
  averageRenderMs: number;
  p95RenderMs: number;
  maxRenderMs: number;
  averageFrameIntervalMs: number;
  p95FrameIntervalMs: number;
  maxConsecutiveSlowFrames: number;
  maxLongTaskMs: number;
}

const NORMAL_LIVE_FRAME_BUDGET: LiveFrameBudget = {
  cpuRate: 1,
  averageRenderMs: 3,
  p95RenderMs: 5,
  maxRenderMs: 12,
  averageFrameIntervalMs: 33,
  p95FrameIntervalMs: 34,
  maxConsecutiveSlowFrames: 4,
  maxLongTaskMs: 120,
};

const THROTTLED_LIVE_FRAME_BUDGET: LiveFrameBudget = {
  cpuRate: 4,
  averageRenderMs: 6,
  p95RenderMs: 12,
  maxRenderMs: 32,
  averageFrameIntervalMs: 33,
  p95FrameIntervalMs: 34,
  maxConsecutiveSlowFrames: 4,
  maxLongTaskMs: 250,
};

export function liveFrameBudgetForCpuRate(cpuRate: number): LiveFrameBudget {
  return cpuRate >= THROTTLED_LIVE_FRAME_BUDGET.cpuRate
    ? THROTTLED_LIVE_FRAME_BUDGET
    : NORMAL_LIVE_FRAME_BUDGET;
}
