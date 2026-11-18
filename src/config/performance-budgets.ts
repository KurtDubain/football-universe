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
    // 190 KiB → 191.4 KiB for v4.69.0. The ceremony pages ship their own
    // stylesheet with the lazy overlay chunk (src/components/ceremony/
    // ceremony.css, 6.2 KB). It is fetched only when a season opens or
    // closes, a cup final is decided, or a World Cup begins or ends, so it
    // costs nothing on the first paint — but the check sums every deployed
    // stylesheet, lazy ones included. Measured total is 195,941 against this
    // cap, and gzip stays at roughly 30.1 KB against 30 KiB, so the initial
    // critical path is unchanged. Inlining the sheet into index.css would
    // move the same bytes onto the critical path rather than remove them.
    //
    // 197,000 → 199,500 for v4.76.0, and the gzip cap 30 KiB → 31 KiB with it.
    // The interaction round adds tokens and utilities rather than components:
    // three text-colour tokens (--gold-text / --success-text / --danger-text)
    // that replace eight scattered hex values, --text-micro as the 11 px floor
    // for the 8–11 px helper classes, --radius-chip, --pitch-chrome-budget, the
    // three .finance-* utilities and the seven [data-tone]::before glyphs that
    // give every status colour a shape as well as a hue. Measured total is
    // 198,273 bytes / 30,577 gzipped, so the raw cap clears it by 1.2 KB and
    // the gzip cap by 1.1 KB. The gzip figure is the one to watch: it had 143
    // bytes of headroom left, which is not a margin, so the next round that
    // adds a stylesheet rule should expect to trim rather than to raise again.
    bytes: 199_500,
    gzipBytes: 31 * KiB,
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
    //
    // 87 → 88 for v4.63.0. The award rework put the seven scoring formulas in
    // src/engine/awards/award-scoring, which five non-test modules now import:
    // season-end, season-awards, ballon-dor, award-buzz and the player stat
    // selectors behind the player centre. That fan-out is the point — one
    // formula per award, applied exactly once — so it became a shared chunk
    // rather than being inlined into season-manager. Measured precache bytes
    // are 1,957,575 against the 2,150,000 cap, so only the entry count moved.
    //
    // 88 → 89 for the club doctrine system (B2). src/engine/clubs/doctrine is
    // imported from both sides of the route boundary: the engine graph
    // (season-end, season-manager, transfer-decision) and the TeamDetail route
    // chunk that renders the badge row. Rolldown extracts a module reachable
    // from two chunk graphs as a shared chunk rather than inlining it twice, so
    // this is doctrine-Tep_-RRg.js at 2,001 bytes / 1,028 gzipped. Inlining it
    // into one side would mean either the engine importing a UI module or the
    // team page re-deriving the axes with its own copy of the thresholds — the
    // second is how a badge ends up disagreeing with the simulation. Measured
    // precache bytes are 1,995,795 against the 2,150,000 cap and initial JS
    // gzip is 158,464 against 160,000, so only the entry count moved.
    //
    // 89 → 90 for v4.69.0. The ceremony overlay is the first React.lazy
    // boundary in the product, and that boundary is what moves React out of
    // the chunks it used to be inlined into: Rolldown now emits react-*.js
    // as a chunk shared by the entry graph and the overlay. The overlay chunk
    // and its stylesheet are both excluded in pwa-precache-policy; this
    // shared React shard cannot be, because it is also an initial dependency
    // and omitting it would fail the initial-precache assertion. Measured
    // precache bytes are 1,976,573 against the 2,150,000 cap.
    //
    // 90 → 92 for v4.76.0, and both new entries are the same phenomenon as
    // the four moves above: a module reachable from several route chunks is
    // extracted as a shared chunk instead of being inlined into each of them.
    // use-focus-trap-DadOs6Jq.js (1,339 bytes) is imported by MobileDrawer,
    // MatchDetailModal and MatchLive; position-chip-vFrpiTJP.js (235 bytes) by
    // Transfers, TeamDetail, Players and PlayerDetail. Inlining either one
    // would put a second copy of the focus-trap logic or of the position
    // palette in four different route chunks, which is exactly the drift this
    // round was written to remove. Measured precache bytes are 2,068,231
    // against the 2,150,000 cap, so only the entry count moved.
    entries: 92,
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
