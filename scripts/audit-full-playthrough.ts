/**
 * Comprehensive end-to-end playthrough audit.
 *
 * - Phase 1: fresh game, advance 15 seasons (or fewer if budget tight), capture
 *   per-season snapshots (economy, transfers, champions, retirements, rumors,
 *   tags, pool size, storage size).
 * - Phase 2: tag effects in practice — % cup-final goals by clutch tag,
 *   injury rate by iron/glass, peakAge distribution of late_bloomer, wanderers
 *   released this season.
 * - Phase 3: UI smoke — every major route, screenshot + error capture.
 * - Phase 4: stress — load s16 save, migrate v8 → v18, advance +5 seasons,
 *   verify the compressed save round-trips.
 *
 * Outputs:
 *   /tmp/playthrough-snapshots.json
 *   /tmp/playthrough-report.md
 *   /tmp/playthrough-*.png  (screenshots)
 *   /tmp/playthrough-errors.txt
 *
 * Notes on `page.evaluate`: tsx compiles arrows in a way that breaks
 * `page.evaluate(fn)` because of `__name` references — so we use the
 * string-form `page.evaluate('(() => { ... })()')` exclusively.
 */
import { chromium, type Page, type ConsoleMessage } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const STORAGE_KEY = 'football-universe-save';
const LZSTRING_MIN_PATH = '/Users/mutu/Desktop/personal/res/football-for-me/node_modules/.pnpm/lz-string@1.5.0/node_modules/lz-string/libs/lz-string.min.js';
const TARGET_SEASONS_PHASE1 = 15;
const TARGET_SEASONS_PHASE4 = 5;
const HARD_TIMEOUT_MS = 14 * 60 * 1000;
const ADVANCE_BUDGET_PER_SEASON = 200; // header button can need many polls

// ── Known noise filters (Vite HMR, react hook purity warning) ─────
function isKnownNoise(s: string): boolean {
  if (s.includes('chrome-extension://')) return true;
  if (s.includes('favicon')) return true;
  if (/Failed to load resource.*404/.test(s)) return true;
  if (/\[vite\]/i.test(s)) return true;
  if (/HMR/i.test(s)) return true;
  if (/Download the React DevTools/.test(s)) return true;
  // react-hooks-purity warnings from Celebration/CanvasEffects
  if (/Math\.random/.test(s) && /Celebration|CanvasEffects/.test(s)) return true;
  if (/non-deterministic.*Math\.random/.test(s)) return true;
  return false;
}

interface Snapshot {
  season: number;
  currentSeason: number;
  finance: {
    teamsNegative: number;
    teamsAboveBillion: number;
    p10Cash: number;
    p50Cash: number;
    p90Cash: number;
    eliteMeanCash: number;
    smallMeanCash: number;
    stdDev: number;
  };
  transfers: {
    totalThisSeason: number;
    byType: Record<string, number>;
    uniqueSellers: number;
    uniqueBuyers: number;
  };
  champions: {
    l1: string;
    l2: string;
    l3: string;
    leagueCup: string;
    superCup: string;
    mainlandCup: string | null;
    southernCup: string | null;
    easternCup: string | null;
    worldCup: string | null;
  };
  retirements: {
    totalThisSeason: number;
    sampleNames: string[];
  };
  rumors: {
    totalGenerated: number;
    totalMaterialized: number;
    hitRatePct: number;
  };
  tags: {
    squadTagCounts: Record<string, number>;
    poolTagCounts: Record<string, number>;
  };
  pool: {
    sizeAtEnd: number;
    oldestAge: number;
    youngestAge: number;
  };
  storage: {
    localStorageSizeChars: number;
    rawJsonSizeChars: number;
    compressionRatio: number;
  };
  errorsThisSeason: string[];
}

async function probeSeason(page: Page): Promise<number> {
  return (await page.evaluate(`(() => {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (!raw) return -1;
    var data;
    // Auto-detect compressed (UTF16). The runtime reads-through, but our
    // synchronous probe bypasses zustand: we must mirror the same path.
    if (raw[0] !== '{') {
      // Compressed: decompress via lz-string mirror
      try {
        // Inline LZString decompressFromUTF16 is too big; use the in-app
        // helper if available, else fall through to raw parse (legacy).
        var w = (typeof window.LZString !== 'undefined' && window.LZString && window.LZString.decompressFromUTF16)
          ? window.LZString.decompressFromUTF16(raw)
          : null;
        if (!w) return -2;
        data = JSON.parse(w);
      } catch (e) {
        return -3;
      }
    } else {
      data = JSON.parse(raw);
    }
    return data.state.world.seasonState.seasonNumber;
  })()`)) as number;
}

/**
 * Decompression helper injected once into the page so probeSeason and the
 * snapshot extractor can read localStorage in the same format the app uses.
 * We bundle the lz-string min source directly via addInitScript so we don't
 * depend on the dev server's chunked dep cache being warm. The trailing
 * `module.exports` clause throws in browser context — wrap in try/catch.
 */
async function injectLzAccessor(page: Page): Promise<void> {
  const lzSource = fs.readFileSync(LZSTRING_MIN_PATH, 'utf8');
  await page.addInitScript(`
    try {
      ${lzSource}
      if (typeof LZString !== 'undefined') window.LZString = LZString;
    } catch (e) {
      if (typeof LZString !== 'undefined') window.LZString = LZString;
    }
  `);
}

async function readSaveSize(page: Page): Promise<{ compressedChars: number; rawChars: number }> {
  return (await page.evaluate(`(() => {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (!raw) return { compressedChars: 0, rawChars: 0 };
    var compressedChars = raw.length;
    var rawChars = 0;
    if (raw[0] === '{') {
      rawChars = raw.length;
    } else if (typeof window.LZString !== 'undefined' && window.LZString) {
      try {
        var decompressed = window.LZString.decompressFromUTF16(raw);
        rawChars = decompressed ? decompressed.length : 0;
      } catch (e) { rawChars = 0; }
    }
    return { compressedChars: compressedChars, rawChars: rawChars };
  })()`)) as { compressedChars: number; rawChars: number };
}

const TAG_KEYS = ['loyal', 'ambitious', 'iron', 'glass', 'clutch', 'late_bloomer', 'wanderer', 'none'];

async function extractSnapshot(page: Page, _prevRumorIds: Set<string>): Promise<{
  snap: Snapshot;
  newRumorIds: string[];
} | null> {
  const data = (await page.evaluate(`(() => {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (!raw) return null;
    var data;
    if (raw[0] !== '{') {
      try {
        var w = window.LZString.decompressFromUTF16(raw);
        if (!w) return null;
        data = JSON.parse(w);
      } catch (e) { return null; }
    } else {
      data = JSON.parse(raw);
    }
    var w = data.state.world;
    var currentSeason = w.seasonState && w.seasonState.seasonNumber;
    var honor = (w.honorHistory || []).slice(-1)[0] || {};
    var seasonJustFinished = honor.seasonNumber || (currentSeason - 1);

    var retirementHistory = w.retirementHistory || [];
    var transferHistory = w.transferHistory || [];
    var newsLog = w.newsLog || [];

    // Tag counts in squads
    var squadTagCounts = {};
    var TAG_KEYS = ${JSON.stringify(TAG_KEYS)};
    for (var i = 0; i < TAG_KEYS.length; i++) squadTagCounts[TAG_KEYS[i]] = 0;
    var poolTagCounts = {};
    for (var i = 0; i < TAG_KEYS.length; i++) poolTagCounts[TAG_KEYS[i]] = 0;
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      for (var i = 0; i < sq.length; i++) {
        var p = sq[i];
        var t = p.tag || 'none';
        if (squadTagCounts.hasOwnProperty(t)) squadTagCounts[t]++;
      }
    }
    var pool = w.freeAgentPool || [];
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i].tag || 'none';
      if (poolTagCounts.hasOwnProperty(t)) poolTagCounts[t]++;
    }
    var poolAges = pool.map(function(p) { return p.age || 0; });
    var oldestAge = poolAges.length > 0 ? Math.max.apply(null, poolAges) : 0;
    var youngestAge = poolAges.length > 0 ? Math.min.apply(null, poolAges) : 0;

    // Transfers this season
    var transfersThisSeason = transferHistory.filter(function(t) { return t.season === seasonJustFinished; });
    var byType = {};
    var sellerSet = {}, buyerSet = {};
    for (var i = 0; i < transfersThisSeason.length; i++) {
      var t = transfersThisSeason[i];
      byType[t.type] = (byType[t.type] || 0) + 1;
      if (t.fromTeamId) sellerSet[t.fromTeamId] = 1;
      if (t.toTeamId) buyerSet[t.toTeamId] = 1;
    }

    // Rumors generated this season (from newsLog: type === 'rumor', season === seasonJustFinished)
    var rumorNewsThisSeason = newsLog.filter(function(n) { return n && n.type === 'rumor' && n.seasonNumber === seasonJustFinished; });
    // Rumor → actual: parse from news id (rumor-{uuid}-{eliteId}); for each
    // rumor, see if a transfer in transferHistory has playerId === uuid and
    // toTeamId === eliteId AND season === seasonJustFinished.
    var transferKeySet = {};
    for (var i = 0; i < transfersThisSeason.length; i++) {
      var t = transfersThisSeason[i];
      transferKeySet[t.playerId + '|' + t.toTeamId] = 1;
    }
    var newRumorIds = [];
    var materialized = 0;
    for (var i = 0; i < rumorNewsThisSeason.length; i++) {
      var n = rumorNewsThisSeason[i];
      // News id format: 'S{season}-W{window}-rumor-{playerUuid}-{eliteId}'
      // Parse the trailing -{playerUuid}-{eliteId} part.
      var id = n.id || '';
      var m = id.match(/rumor-(p-\\d+|.+?)-([a-z0-9_-]+)$/);
      if (!m) continue;
      var key = m[1] + '|' + m[2];
      newRumorIds.push(n.id);
      if (transferKeySet[key]) materialized++;
    }
    var totalGenerated = rumorNewsThisSeason.length;
    var hitRatePct = totalGenerated > 0 ? Math.round(materialized * 1000 / totalGenerated) / 10 : 0;

    // Retirements this season
    var retiredThisSeason = retirementHistory.filter(function(r) { return r.seasonRetired === seasonJustFinished; });
    var retSample = retiredThisSeason.slice(0, 5).map(function(r) { return r.name + '(' + r.position + ',age' + r.age + ')'; });

    // Champions
    var champs = {
      l1: honor.league1Champion || '',
      l2: honor.league2Champion || '',
      l3: honor.league3Champion || '',
      leagueCup: honor.leagueCupWinner || '',
      superCup: honor.superCupWinner || '',
      worldCup: honor.worldCupWinner || null,
      mainlandCup: null, southernCup: null, easternCup: null,
    };
    for (var tid in (w.teamTrophies || {})) {
      var trophies = w.teamTrophies[tid] || [];
      for (var j = 0; j < trophies.length; j++) {
        var tr = trophies[j];
        if (tr.seasonNumber !== seasonJustFinished) continue;
        if (tr.type === 'mainland_cup') champs.mainlandCup = tid;
        else if (tr.type === 'southern_cup') champs.southernCup = tid;
        else if (tr.type === 'eastern_cup') champs.easternCup = tid;
      }
    }

    // Finance
    var cashList = [];
    var teamsNeg = 0, teamsAboveBillion = 0;
    var eliteCash = [], smallCash = [];
    for (var ftid in (w.teamFinances || {})) {
      var c = w.teamFinances[ftid].cash;
      if (typeof c !== 'number') continue;
      cashList.push(c);
      if (c < 0) teamsNeg++;
      if (c > 1000) teamsAboveBillion++;
      var base = w.teamBases[ftid];
      if (base) {
        if (base.overall >= 82) eliteCash.push(c);
        else if (base.overall <= 65) smallCash.push(c);
      }
    }
    cashList.sort(function(a, b) { return a - b; });
    function pct(arr, p) {
      if (arr.length === 0) return 0;
      var idx = Math.floor(arr.length * p);
      if (idx >= arr.length) idx = arr.length - 1;
      return arr[idx];
    }
    var mean = function(arr) {
      if (arr.length === 0) return 0;
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += arr[i];
      return s / arr.length;
    };
    var allMean = mean(cashList);
    var variance = 0;
    for (var i = 0; i < cashList.length; i++) variance += (cashList[i] - allMean) * (cashList[i] - allMean);
    var stdDev = cashList.length > 0 ? Math.sqrt(variance / cashList.length) : 0;

    return {
      season: seasonJustFinished,
      currentSeason: currentSeason,
      retirementHistoryLen: retirementHistory.length,
      transferHistoryLen: transferHistory.length,
      retiredThisSeasonCount: retiredThisSeason.length,
      retSample: retSample,
      transfersThisSeasonCount: transfersThisSeason.length,
      transferByType: byType,
      uniqueSellers: Object.keys(sellerSet).length,
      uniqueBuyers: Object.keys(buyerSet).length,
      rumorTotal: totalGenerated,
      rumorMaterialized: materialized,
      hitRatePct: hitRatePct,
      newRumorIds: newRumorIds,
      squadTagCounts: squadTagCounts,
      poolTagCounts: poolTagCounts,
      poolSize: pool.length,
      poolOldestAge: oldestAge,
      poolYoungestAge: youngestAge,
      champs: champs,
      finance: {
        teamsNeg: teamsNeg,
        teamsAboveBillion: teamsAboveBillion,
        p10: pct(cashList, 0.10),
        p50: pct(cashList, 0.50),
        p90: pct(cashList, 0.90),
        eliteMean: mean(eliteCash),
        smallMean: mean(smallCash),
        stdDev: stdDev,
      },
    };
  })()`)) as any;

  if (!data) return null;

  const sizes = await readSaveSize(page);

  const snap: Snapshot = {
    season: data.season,
    currentSeason: data.currentSeason,
    finance: {
      teamsNegative: data.finance.teamsNeg,
      teamsAboveBillion: data.finance.teamsAboveBillion,
      p10Cash: data.finance.p10,
      p50Cash: data.finance.p50,
      p90Cash: data.finance.p90,
      eliteMeanCash: data.finance.eliteMean,
      smallMeanCash: data.finance.smallMean,
      stdDev: data.finance.stdDev,
    },
    transfers: {
      totalThisSeason: data.transfersThisSeasonCount,
      byType: data.transferByType,
      uniqueSellers: data.uniqueSellers,
      uniqueBuyers: data.uniqueBuyers,
    },
    champions: data.champs,
    retirements: {
      totalThisSeason: data.retiredThisSeasonCount,
      sampleNames: data.retSample,
    },
    rumors: {
      totalGenerated: data.rumorTotal,
      totalMaterialized: data.rumorMaterialized,
      hitRatePct: data.hitRatePct,
    },
    tags: {
      squadTagCounts: data.squadTagCounts,
      poolTagCounts: data.poolTagCounts,
    },
    pool: {
      sizeAtEnd: data.poolSize,
      oldestAge: data.poolOldestAge,
      youngestAge: data.poolYoungestAge,
    },
    storage: {
      localStorageSizeChars: sizes.compressedChars,
      rawJsonSizeChars: sizes.rawChars,
      compressionRatio: sizes.rawChars > 0 ? +(sizes.rawChars / sizes.compressedChars).toFixed(2) : 0,
    },
    errorsThisSeason: [],
  };

  return { snap, newRumorIds: data.newRumorIds || [] };
}

/**
 * Click the header advance button until either:
 *  - the seasonNumber bumps (return true)
 *  - we run out of budget (return false)
 *
 * Keeps clicking aggressively. The button text varies:
 *   "推进 1 周" — normal, enabled
 *   "..." or "模拟中" — in-flight (disabled, wait)
 *   "完成" — season-end window, must still click to trigger initializeNewSeason
 */
async function advanceOneSeason(page: Page, lastSeason: number): Promise<{ ok: boolean; clicks: number }> {
  let clicks = 0;
  let waits = 0;
  for (let i = 0; i < ADVANCE_BUDGET_PER_SEASON * 4; i++) {
    // header has the persistent advance button
    const btn = await page.$('header button:has-text("推进"), header button:has-text("完成"), header button:has-text("开始模拟"), header button:has-text("...")');
    if (!btn) {
      // No header advance button — try any
      const fallback = await page.$('button:has-text("推进"), button:has-text("开始模拟")');
      if (!fallback) return { ok: false, clicks };
      const t = (await fallback.textContent()) || '';
      const dis = await fallback.isDisabled();
      if (dis || /模拟中|\.\.\./.test(t)) {
        await page.waitForTimeout(120);
        waits++;
        const cur = await probeSeason(page);
        if (cur > lastSeason) return { ok: true, clicks };
        if (waits > 40) return { ok: false, clicks };
        continue;
      }
      await fallback.click({ timeout: 1500, force: true }).catch(() => {});
      clicks++;
      await page.waitForTimeout(40);
      continue;
    }
    const txt = (await btn.textContent()) || '';
    const disabled = await btn.isDisabled();
    if (disabled || /模拟中|\.\.\./.test(txt)) {
      await page.waitForTimeout(120);
      waits++;
      const cur = await probeSeason(page);
      if (cur > lastSeason) return { ok: true, clicks };
      if (waits > 40) return { ok: false, clicks };
      continue;
    }
    waits = 0;
    await btn.click({ timeout: 1500, force: true }).catch(() => {});
    clicks++;
    await page.waitForTimeout(35);
    if (clicks % 3 === 0) {
      const cur = await probeSeason(page);
      if (cur > lastSeason) return { ok: true, clicks };
    }
  }
  return { ok: false, clicks };
}

async function main() {
  const startTime = Date.now();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors: string[] = [];
  const newErrors: string[] = [];
  page.on('pageerror', (e) => {
    const m = `PAGE: ${e.message}`;
    if (!isKnownNoise(m)) { errors.push(m); newErrors.push(m); }
  });
  page.on('console', (m: ConsoleMessage) => {
    const t = m.type();
    if (t !== 'error' && t !== 'warning') return;
    const text = m.text();
    if (isKnownNoise(text)) return;
    const tagged = `${t.toUpperCase()}: ${text}`;
    errors.push(tagged);
    newErrors.push(tagged);
  });
  page.on('crash', () => errors.push('PAGE CRASH'));

  await injectLzAccessor(page);

  // ── Phase 1: Fresh game, advance 15 seasons ──────────────────────
  console.log('=== PHASE 1: Fresh game ===');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`localStorage.clear();`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Click "开始新游戏" on the Welcome screen to initialize a fresh world
  const startBtn = await page.$('button:has-text("开始新游戏")');
  if (!startBtn) {
    errors.push('PHASE1: Welcome 开始新游戏 button missing');
  } else {
    await startBtn.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  // Wait for lz-string to load (so probeSeason reads work)
  await page.waitForFunction(`(() => typeof window.LZString !== 'undefined' && window.LZString && typeof window.LZString.decompressFromUTF16 === 'function')()`, { timeout: 6_000 }).catch(() => {});

  // Get starting season
  const startSeason = await probeSeason(page);
  console.log(`Starting season: ${startSeason}`);
  if (startSeason < 1) {
    errors.push(`PHASE1: failed to read starting season (got ${startSeason})`);
  }

  // Pin a favorite to exercise dashboard cash chip path. The newly-created
  // save is compressed, so we must decompress, mutate, then recompress (or
  // write back uncompressed — zustand re-detects and rewrites compressed).
  await page.evaluate(`(() => {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (!raw) return;
    var data;
    if (raw[0] !== '{') {
      var w = window.LZString.decompressFromUTF16(raw);
      if (!w) return;
      data = JSON.parse(w);
    } else {
      data = JSON.parse(raw);
    }
    // Pick first elite team id (overall >= 82)
    var ftid = null;
    for (var tid in data.state.world.teamBases) {
      if (data.state.world.teamBases[tid].overall >= 82) { ftid = tid; break; }
    }
    if (ftid) {
      data.state.favoriteTeamIds = [ftid];
      data.state.favoriteTeamId = ftid;
      // Re-compress so zustand picks it up
      var newRaw = window.LZString.compressToUTF16(JSON.stringify(data));
      localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, newRaw);
    }
  })()`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.waitForFunction(`(() => typeof window.LZString !== 'undefined' && window.LZString && typeof window.LZString.decompressFromUTF16 === 'function')()`, { timeout: 6_000 }).catch(() => {});

  // Navigate to /settings (quiet route, no modals)
  await page.goto(URL + 'settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const snapshots: Snapshot[] = [];
  let lastSeason = await probeSeason(page);
  let totalClicks = 0;

  const prevRumorIds = new Set<string>();
  for (let s = 0; s < TARGET_SEASONS_PHASE1; s++) {
    if (Date.now() - startTime > HARD_TIMEOUT_MS * 0.7) {
      console.log(`  budget tight, stopping P1 at season ${s}/${TARGET_SEASONS_PHASE1}`);
      break;
    }
    newErrors.length = 0;
    const r = await advanceOneSeason(page, lastSeason);
    totalClicks += r.clicks;
    if (!r.ok) {
      errors.push(`PHASE1_SOFTLOCK: season ${lastSeason} failed to advance after ${r.clicks} clicks`);
      break;
    }
    await page.waitForTimeout(400);
    const extracted = await extractSnapshot(page, prevRumorIds);
    if (!extracted) {
      errors.push(`PHASE1_SNAPSHOT_FAIL: season ${lastSeason}`);
      break;
    }
    extracted.snap.errorsThisSeason = [...newErrors];
    snapshots.push(extracted.snap);
    for (const id of extracted.newRumorIds) prevRumorIds.add(id);
    lastSeason = extracted.snap.currentSeason;
    console.log(
      `  [S${extracted.snap.season}] L1=${extracted.snap.champions.l1} | ` +
      `transfers=${extracted.snap.transfers.totalThisSeason} (sellers=${extracted.snap.transfers.uniqueSellers},buyers=${extracted.snap.transfers.uniqueBuyers}) | ` +
      `retired=${extracted.snap.retirements.totalThisSeason} | ` +
      `rumors=${extracted.snap.rumors.totalGenerated}/${extracted.snap.rumors.totalMaterialized}(${extracted.snap.rumors.hitRatePct}%) | ` +
      `cash[p10/p50/p90]=${extracted.snap.finance.p10Cash.toFixed(0)}/${extracted.snap.finance.p50Cash.toFixed(0)}/${extracted.snap.finance.p90Cash.toFixed(0)} ` +
      `neg=${extracted.snap.finance.teamsNegative} elite=${extracted.snap.finance.eliteMeanCash.toFixed(0)} small=${extracted.snap.finance.smallMeanCash.toFixed(0)} | ` +
      `pool=${extracted.snap.pool.sizeAtEnd}(${extracted.snap.pool.youngestAge}-${extracted.snap.pool.oldestAge}) | ` +
      `storage=${(extracted.snap.storage.localStorageSizeChars/1024).toFixed(1)}KB(${extracted.snap.storage.compressionRatio}x)`,
    );
  }

  // ── Phase 2: Tag effects after the run ───────────────────────────
  console.log('\n=== PHASE 2: Tag effects ===');
  const tagEffects = (await page.evaluate(`(() => {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var data;
    if (raw[0] !== '{') {
      var w = window.LZString.decompressFromUTF16(raw);
      data = JSON.parse(w);
    } else {
      data = JSON.parse(raw);
    }
    var w = data.state.world;
    var currentSeason = w.seasonState.seasonNumber;

    // Build a uuid → tag lookup from current squads (active players only).
    var tagByUuid = {};
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      for (var i = 0; i < sq.length; i++) {
        var p = sq[i];
        if (p.tag) tagByUuid[p.uuid] = p.tag;
      }
    }
    // Also include retirees (so historical goals don't lose tag info)
    for (var i = 0; i < (w.retirementHistory || []).length; i++) {
      var r = w.retirementHistory[i];
      if (r && r.uuid && r.tag) tagByUuid[r.uuid] = r.tag;
    }

    // Pull calendar from current (post-advance) season — it's now-empty because
    // a new season just started. Use matchHistory instead (richer for cross-
    // seasonal H2H) plus memorableMatches for cup-final detail.
    var memo = w.memorableMatches || [];
    // Final match detection: roundLabel '决赛' or 'Final'.
    var allEvents = [];      // all goal events from memorable + this run
    var finalGoals = [];     // goal events from cup finals only
    function pushEvents(result, isFinal) {
      if (!result || !result.events) return;
      for (var i = 0; i < result.events.length; i++) {
        var e = result.events[i];
        if (e.type === 'goal' && e.playerId) {
          allEvents.push({ pid: e.playerId, tag: tagByUuid[e.playerId] || null });
          if (isFinal) finalGoals.push({ pid: e.playerId, tag: tagByUuid[e.playerId] || null });
        }
      }
    }
    for (var i = 0; i < memo.length; i++) {
      var m = memo[i];
      var rl = (m.result && m.result.roundLabel) || '';
      var isFinal = rl === 'Final' || rl === '决赛';
      pushEvents(m.result, isFinal);
    }

    function pct(arr, predicate) {
      if (arr.length === 0) return { pct: 0, num: 0, denom: 0 };
      var n = 0;
      for (var i = 0; i < arr.length; i++) if (predicate(arr[i])) n++;
      return { pct: Math.round(n * 10000 / arr.length) / 100, num: n, denom: arr.length };
    }

    var clutchGoalsAll = pct(allEvents, function(e) { return e.tag === 'clutch'; });
    var clutchGoalsFinal = pct(finalGoals, function(e) { return e.tag === 'clutch'; });

    // Active player tag rates (denominator for clutch goal rate expectation)
    var totalActive = 0, clutchActive = 0;
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      totalActive += sq.length;
      for (var i = 0; i < sq.length; i++) {
        if (sq[i].tag === 'clutch') clutchActive++;
      }
    }
    var clutchBaseRatePct = totalActive > 0 ? Math.round(clutchActive * 10000 / totalActive) / 100 : 0;

    // Injury counts by tag (use injuryHistory across all squad players)
    var byTag = { iron: 0, glass: 0, none: 0, other: 0 };
    var totalByTag = { iron: 0, glass: 0, none: 0, other: 0 };
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      for (var i = 0; i < sq.length; i++) {
        var p = sq[i];
        var bucket = p.tag === 'iron' ? 'iron' : (p.tag === 'glass' ? 'glass' : (p.tag ? 'other' : 'none'));
        totalByTag[bucket] += 1;
        byTag[bucket] += (p.injuryHistory ? p.injuryHistory.length : 0);
      }
    }
    var injPerPlayer = {};
    for (var k in totalByTag) {
      injPerPlayer[k] = totalByTag[k] > 0 ? +(byTag[k] / totalByTag[k]).toFixed(3) : 0;
    }

    // late_bloomer active players' peakAge stats
    var lateBloomerActive = [];
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      for (var i = 0; i < sq.length; i++) {
        if (sq[i].tag === 'late_bloomer') lateBloomerActive.push({
          uuid: sq[i].uuid, age: sq[i].age, peakAge: sq[i].peakAge, rating: sq[i].rating,
        });
      }
    }
    var avgPeakAgeLB = lateBloomerActive.length > 0
      ? +(lateBloomerActive.reduce(function(s, p) { return s + (p.peakAge || 0); }, 0) / lateBloomerActive.length).toFixed(2)
      : 0;
    var minPeakAgeLB = lateBloomerActive.length > 0 ? Math.min.apply(null, lateBloomerActive.map(function(p) { return p.peakAge; })) : 0;
    var maxPeakAgeLB = lateBloomerActive.length > 0 ? Math.max.apply(null, lateBloomerActive.map(function(p) { return p.peakAge; })) : 0;

    // wanderers released THIS season (transferHistory: type === 'free' && reason includes 浪子)
    var wandererReleases = (w.transferHistory || []).filter(function(t) {
      return t.season === currentSeason - 1 && t.type === 'free' && t.reason && t.reason.indexOf('浪子') >= 0;
    });

    // Also: late_bloomer-tagged players who are 30+ and still rated highly
    var lbAged30 = lateBloomerActive.filter(function(p) { return p.age >= 30; });
    var lbAged30AvgRating = lbAged30.length > 0
      ? +(lbAged30.reduce(function(s, p) { return s + (p.rating || 0); }, 0) / lbAged30.length).toFixed(2)
      : 0;

    return {
      currentSeason: currentSeason,
      totalGoalsObserved: allEvents.length,
      totalFinalGoals: finalGoals.length,
      clutchGoalsAll: clutchGoalsAll,
      clutchGoalsFinal: clutchGoalsFinal,
      clutchBaseRatePct: clutchBaseRatePct,
      injuriesPerPlayer: injPerPlayer,
      injuryCountsByTag: byTag,
      activeCountByTag: totalByTag,
      lateBloomerActiveCount: lateBloomerActive.length,
      lateBloomerAvgPeakAge: avgPeakAgeLB,
      lateBloomerPeakAgeRange: [minPeakAgeLB, maxPeakAgeLB],
      lateBloomerAged30Count: lbAged30.length,
      lateBloomerAged30AvgRating: lbAged30AvgRating,
      wandererReleasesThisSeason: wandererReleases.length,
      wandererSamples: wandererReleases.slice(0, 5).map(function(t) { return t.playerName + '(' + t.fromTeamName + ')'; }),
    };
  })()`)) as any;
  console.log('  clutch goals all:', tagEffects.clutchGoalsAll, '| clutch goals finals:', tagEffects.clutchGoalsFinal, '| base rate:', tagEffects.clutchBaseRatePct + '%');
  console.log('  injuries/player by tag:', JSON.stringify(tagEffects.injuriesPerPlayer), '(counts:', JSON.stringify(tagEffects.injuryCountsByTag), ')');
  console.log(`  late_bloomer active: ${tagEffects.lateBloomerActiveCount} | avg peakAge: ${tagEffects.lateBloomerAvgPeakAge} (range ${tagEffects.lateBloomerPeakAgeRange.join('-')})`);
  console.log(`  late_bloomer 30+: ${tagEffects.lateBloomerAged30Count} | avg rating: ${tagEffects.lateBloomerAged30AvgRating}`);
  console.log(`  wanderer releases this season: ${tagEffects.wandererReleasesThisSeason} | samples: ${tagEffects.wandererSamples.join(', ')}`);

  // ── Phase 3: UI smoke ────────────────────────────────────────────
  console.log('\n=== PHASE 3: UI smoke ===');
  // Need IDs from current world
  const ids = (await page.evaluate(`(() => {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var data;
    if (raw[0] !== '{') {
      var w = window.LZString.decompressFromUTF16(raw);
      data = JSON.parse(w);
    } else {
      data = JSON.parse(raw);
    }
    var w = data.state.world;
    // Elite team id
    var eliteTeamId = null;
    for (var tid in w.teamBases) {
      if (w.teamBases[tid].overall >= 82) { eliteTeamId = tid; break; }
    }
    if (!eliteTeamId) eliteTeamId = Object.keys(w.teamBases)[0];
    // Top scorer player UUID (sort by playerStats goals)
    var topScorer = null;
    var topGoals = -1;
    for (var k in w.playerStats) {
      var st = w.playerStats[k];
      if (st.goals > topGoals) { topGoals = st.goals; topScorer = st.playerId; }
    }
    // A tagged player (any tag)
    var taggedPlayerId = null;
    outer: for (var tid in w.squads) {
      var sq = w.squads[tid] || [];
      for (var i = 0; i < sq.length; i++) {
        if (sq[i].tag === 'clutch' || sq[i].tag === 'late_bloomer' || sq[i].tag === 'wanderer') {
          taggedPlayerId = sq[i].uuid;
          break outer;
        }
      }
    }
    // An active coach id
    var activeCoachId = null;
    for (var cid in (w.coachStates || {})) {
      var cs = w.coachStates[cid];
      if (cs && !cs.isUnemployed) { activeCoachId = cid; break; }
    }
    return { eliteTeamId: eliteTeamId, topScorerId: topScorer, taggedPlayerId: taggedPlayerId, activeCoachId: activeCoachId, topGoals: topGoals };
  })()`)) as any;
  console.log(`  IDs picked: team=${ids.eliteTeamId} | topScorer=${ids.topScorerId}(${ids.topGoals}g) | tagged=${ids.taggedPlayerId} | coach=${ids.activeCoachId}`);

  type RouteSpec = { route: string; name: string };
  const routes: RouteSpec[] = [
    { route: '/', name: 'dashboard' },
    { route: '/league/1', name: 'league-1' },
    { route: '/league/2', name: 'league-2' },
    { route: '/league/3', name: 'league-3' },
    { route: '/cup/league_cup', name: 'cup-league' },
    { route: '/cup/super_cup', name: 'cup-super' },
    { route: '/cup/world_cup', name: 'cup-world' },
    { route: '/cup/mainland_cup', name: 'cup-mainland' },
    { route: '/cup/southern_cup', name: 'cup-southern' },
    { route: '/cup/eastern_cup', name: 'cup-eastern' },
    { route: `/team/${ids.eliteTeamId}`, name: 'team-elite' },
    ...(ids.topScorerId ? [{ route: `/player/${ids.topScorerId}`, name: 'player-topscorer' }] : []),
    ...(ids.taggedPlayerId ? [{ route: `/player/${ids.taggedPlayerId}`, name: 'player-tagged' }] : []),
    ...(ids.activeCoachId ? [{ route: `/coach/${ids.activeCoachId}`, name: 'coach-active' }] : []),
    { route: '/transfers', name: 'transfers' },
    { route: '/history', name: 'history' },
    { route: '/legends', name: 'legends' },
  ];

  const uiResults: { name: string; route: string; ok: boolean; errs: string[]; bodyH: number }[] = [];
  for (const r of routes) {
    newErrors.length = 0;
    try {
      await page.goto(URL.replace(/\/$/, '') + r.route, { waitUntil: 'networkidle', timeout: 12_000 });
      await page.waitForTimeout(450);
    } catch (e) {
      newErrors.push(`NAV_FAIL: ${e}`);
    }
    const bodyH = (await page.evaluate('(() => document.body.getBoundingClientRect().height)()')) as number;
    const badText = (await page.evaluate(`(() => {
      var t = document.body.innerText || '';
      var bad = [];
      if (/Cannot read properties/.test(t)) bad.push('exception');
      if (/\\[object Object\\]/.test(t)) bad.push('[object Object]');
      // Only flag NaN if not part of a known word
      if (/(?<![\\w-])NaN(?![\\w-])/.test(t)) bad.push('NaN');
      return bad;
    })()`)) as string[];
    const errs = [...newErrors, ...badText.map(b => `BAD_TEXT:${b}`)];
    const ok = errs.length === 0 && bodyH > 200;
    uiResults.push({ name: r.name, route: r.route, ok, errs, bodyH });
    try {
      await page.screenshot({ path: `/tmp/playthrough-${r.name}.png`, fullPage: false });
    } catch {}
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${r.name.padEnd(20)} ${r.route} bodyH=${Math.round(bodyH)}` + (errs.length ? ` errs=${errs.length}: ${errs.slice(0, 2).join(' | ')}` : ''));
  }

  // ── Phase 4: s16 save migration + 5 seasons + round-trip ─────────
  console.log('\n=== PHASE 4: s16 save migration ===');
  let phase4Snapshots: Snapshot[] = [];
  let migrated: any = null;
  if (Date.now() - startTime < HARD_TIMEOUT_MS - 90_000 && fs.existsSync(SAVE_PATH)) {
    const SAVE = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate(`localStorage.clear();`);
    // Load the save as plaintext json (zustand will recompress on first save)
    await page.evaluate(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(SAVE))});`);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await page.waitForFunction(`(() => typeof window.LZString !== 'undefined' && window.LZString && typeof window.LZString.decompressFromUTF16 === 'function')()`, { timeout: 8_000 }).catch(() => {});

    migrated = (await page.evaluate(`(() => {
      var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
      if (!raw) return null;
      var data;
      if (raw[0] !== '{') {
        try {
          var w = window.LZString.decompressFromUTF16(raw);
          data = JSON.parse(w);
        } catch (e) { return { migrateError: String(e) }; }
      } else {
        data = JSON.parse(raw);
      }
      var w = data.state.world;
      return {
        version: data.version,
        season: w.seasonState ? w.seasonState.seasonNumber : null,
        squadCount: Object.keys(w.squads || {}).length,
        financeTeams: Object.keys(w.teamFinances || {}).length,
        retirementHistoryLen: (w.retirementHistory || []).length,
        freeAgentPoolLen: (w.freeAgentPool || []).length,
        transferRumorsLen: (w.transferRumors || []).length,
        // Tag presence check — v17 migration must have backfilled tags
        squadHasTag: (function() {
          var n = 0, total = 0;
          for (var tid in (w.squads || {})) {
            var sq = w.squads[tid] || [];
            for (var i = 0; i < sq.length; i++) {
              total++;
              if (sq[i].tag) n++;
            }
          }
          return { tagged: n, total: total, pct: total > 0 ? Math.round(n * 10000 / total) / 100 : 0 };
        })(),
      };
    })()`)) as any;
    console.log('  migration result:', JSON.stringify(migrated));
    if (!migrated || migrated.migrateError) {
      errors.push(`PHASE4_MIGRATION_FAIL: ${migrated && migrated.migrateError}`);
    } else {
      if (migrated.version !== 18) errors.push(`PHASE4_BAD_VERSION: ${migrated.version}`);
      if (migrated.financeTeams === 0) errors.push(`PHASE4_NO_FINANCE: empty teamFinances after migration`);
      if (migrated.squadHasTag.pct < 30) errors.push(`PHASE4_TAGS_NOT_BACKFILLED: only ${migrated.squadHasTag.pct}% tagged`);
    }

    // Advance 5 more seasons
    await page.goto(URL + 'settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    let p4LastSeason = await probeSeason(page);
    for (let s = 0; s < TARGET_SEASONS_PHASE4; s++) {
      if (Date.now() - startTime > HARD_TIMEOUT_MS - 30_000) {
        console.log(`  budget tight, stopping P4 at season ${s}/${TARGET_SEASONS_PHASE4}`);
        break;
      }
      newErrors.length = 0;
      const r = await advanceOneSeason(page, p4LastSeason);
      totalClicks += r.clicks;
      if (!r.ok) {
        errors.push(`PHASE4_SOFTLOCK: season ${p4LastSeason} failed after ${r.clicks} clicks`);
        break;
      }
      await page.waitForTimeout(400);
      const ext = await extractSnapshot(page, prevRumorIds);
      if (!ext) {
        errors.push(`PHASE4_SNAPSHOT_FAIL: season ${p4LastSeason}`);
        break;
      }
      ext.snap.errorsThisSeason = [...newErrors];
      phase4Snapshots.push(ext.snap);
      for (const id of ext.newRumorIds) prevRumorIds.add(id);
      p4LastSeason = ext.snap.currentSeason;
      console.log(`  [P4 S${ext.snap.season}] L1=${ext.snap.champions.l1} transfers=${ext.snap.transfers.totalThisSeason} retired=${ext.snap.retirements.totalThisSeason} cash p50=${ext.snap.finance.p50Cash.toFixed(0)} storage=${(ext.snap.storage.localStorageSizeChars/1024).toFixed(1)}KB`);
    }

    // Round-trip: reload page, ensure save still loads
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const finalProbe = await probeSeason(page);
    console.log(`  Round-trip: after reload, season=${finalProbe}`);
    if (finalProbe < 0) errors.push(`PHASE4_RELOAD_FAIL: probeSeason returned ${finalProbe}`);
  } else {
    console.log('  SKIPPED (budget tight or save missing)');
  }

  await browser.close();

  // ── Output ───────────────────────────────────────────────────────
  fs.writeFileSync('/tmp/playthrough-snapshots.json', JSON.stringify({
    phase1: snapshots,
    phase4: phase4Snapshots,
    tagEffects,
    migrationResult: migrated,
    uiResults,
    errors,
  }, null, 2));
  fs.writeFileSync('/tmp/playthrough-errors.txt', errors.join('\n') + '\n');

  // ── Report ────────────────────────────────────────────────────────
  const critical: string[] = [];
  const warnings: string[] = [];

  // 1. Critical issues
  const pageErrCount = errors.filter(e => e.startsWith('PAGE:') || e.startsWith('PAGE CRASH')).length;
  const consoleErrCount = errors.filter(e => e.startsWith('ERROR:')).length;
  const softlockCount = errors.filter(e => e.includes('SOFTLOCK')).length;
  const migrationFailCount = errors.filter(e => e.startsWith('PHASE4_MIGRATION') || e.startsWith('PHASE4_BAD') || e.startsWith('PHASE4_NO_FINANCE')).length;
  if (pageErrCount > 0) critical.push(`${pageErrCount} pageerror events`);
  if (consoleErrCount > 0) critical.push(`${consoleErrCount} console.error lines`);
  if (softlockCount > 0) critical.push(`${softlockCount} soft-locks`);
  if (migrationFailCount > 0) critical.push(`${migrationFailCount} migration issues`);

  // 2. Balance
  let balanceVerdict = 'good';
  if (snapshots.length >= 3) {
    const last = snapshots[snapshots.length - 1];
    const maxNeg = Math.max(...snapshots.map(s => s.finance.teamsNegative));
    const maxAbove1B = Math.max(...snapshots.map(s => s.finance.teamsAboveBillion));
    if (maxNeg >= 8) balanceVerdict = 'concerning';
    if (last.finance.teamsNegative >= 12) balanceVerdict = 'broken';
    if (maxAbove1B >= 5) balanceVerdict = 'concerning';
  }

  // 3. Champion diversity
  const l1Champs = new Set(snapshots.filter(s => s.champions.l1).map(s => s.champions.l1));
  const championDiversityVerdict = l1Champs.size >= 5 ? 'good' : (l1Champs.size >= 3 ? 'moderate' : 'concerning');

  // 4. Transfer activity
  let transferVerdict = 'good';
  if (snapshots.length >= 3) {
    const avgTransfers = snapshots.reduce((s, sn) => s + sn.transfers.totalThisSeason, 0) / snapshots.length;
    const avgSellers = snapshots.reduce((s, sn) => s + sn.transfers.uniqueSellers, 0) / snapshots.length;
    if (avgTransfers < 5) transferVerdict = 'low';
    if (avgSellers < 3) transferVerdict = 'concentrated';
  }

  // 5. Rumor hit rate
  const totalRumors = snapshots.reduce((s, sn) => s + sn.rumors.totalGenerated, 0);
  const totalMaterialized = snapshots.reduce((s, sn) => s + sn.rumors.totalMaterialized, 0);
  const avgRumorHitRate = totalRumors > 0 ? Math.round(totalMaterialized * 1000 / totalRumors) / 10 : 0;
  if (totalRumors > 0 && (avgRumorHitRate < 20 || avgRumorHitRate > 90)) {
    warnings.push(`Rumor hit rate ${avgRumorHitRate}% outside target 50-70% band`);
  }

  // 6. Storage growth
  const firstStorage = snapshots[0]?.storage.localStorageSizeChars ?? 0;
  const lastStorage = snapshots[snapshots.length - 1]?.storage.localStorageSizeChars ?? 0;
  if (lastStorage > 2 * 1024 * 1024) warnings.push(`Storage above 2MB at end (${(lastStorage / 1024).toFixed(0)}KB)`);
  // Compression — if ratio < 3, compression is underperforming
  const avgRatio = snapshots.length > 0
    ? (snapshots.reduce((s, sn) => s + sn.storage.compressionRatio, 0) / snapshots.length).toFixed(2)
    : '0';
  if (parseFloat(avgRatio) < 2.5 && snapshots.length > 0) {
    warnings.push(`Compression ratio low (${avgRatio}x avg)`);
  }

  // 7. UI smoke
  const uiPass = uiResults.filter(r => r.ok).length;
  const uiFail = uiResults.filter(r => !r.ok).length;
  if (uiFail > 0) critical.push(`${uiFail} UI routes failed`);

  // Tag effects sanity
  let tagEffectFindings: string[] = [];
  if (tagEffects) {
    const baseRate = tagEffects.clutchBaseRatePct || 0;
    const finalRate = tagEffects.clutchGoalsFinal?.pct || 0;
    const allRate = tagEffects.clutchGoalsAll?.pct || 0;
    if (tagEffects.clutchGoalsFinal?.denom >= 3 && finalRate > baseRate * 1.1) {
      tagEffectFindings.push(`Clutch finals OK: ${finalRate}% in finals vs ${baseRate}% base (n=${tagEffects.clutchGoalsFinal.denom})`);
    } else if (tagEffects.clutchGoalsFinal?.denom >= 3) {
      tagEffectFindings.push(`Clutch finals weak: ${finalRate}% in finals vs ${baseRate}% base (n=${tagEffects.clutchGoalsFinal.denom})`);
    } else {
      tagEffectFindings.push(`Clutch finals: only ${tagEffects.clutchGoalsFinal?.denom || 0} final-match goals observed`);
    }
    tagEffectFindings.push(`Clutch all goals: ${allRate}% (n=${tagEffects.clutchGoalsAll?.denom || 0})`);
    const ironRate = tagEffects.injuriesPerPlayer?.iron || 0;
    const glassRate = tagEffects.injuriesPerPlayer?.glass || 0;
    if (glassRate > 0 && ironRate > 0) {
      const ratio = +(glassRate / ironRate).toFixed(2);
      tagEffectFindings.push(`Iron vs Glass injuries/player: ${ironRate} vs ${glassRate} (ratio ${ratio}× — target ~6×)`);
    } else {
      tagEffectFindings.push(`Iron/glass injuries: iron=${ironRate}, glass=${glassRate} (insufficient sample)`);
    }
    tagEffectFindings.push(`Late_bloomer: ${tagEffects.lateBloomerActiveCount} active, avg peakAge ${tagEffects.lateBloomerAvgPeakAge} (range ${tagEffects.lateBloomerPeakAgeRange.join('-')})`);
    if (tagEffects.lateBloomerAvgPeakAge >= 28 && tagEffects.lateBloomerAvgPeakAge <= 32) {
      // Pass
    } else if (tagEffects.lateBloomerActiveCount > 0) {
      warnings.push(`late_bloomer peakAge ${tagEffects.lateBloomerAvgPeakAge} outside 28-32 target band`);
    }
    tagEffectFindings.push(`Wanderer releases this season: ${tagEffects.wandererReleasesThisSeason}`);
  }

  let verdict = 'SHIP';
  if (critical.length > 0) verdict = 'FIX-FIRST';
  else if (warnings.length >= 3) verdict = 'SAFE';

  const lines: string[] = [];
  lines.push('# End-to-End Playthrough Audit');
  lines.push('');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Phase 1 seasons advanced: ${snapshots.length} / ${TARGET_SEASONS_PHASE1}`);
  lines.push(`- Phase 4 seasons advanced: ${phase4Snapshots.length} / ${TARGET_SEASONS_PHASE4}`);
  lines.push(`- Total advance clicks: ${totalClicks}`);
  lines.push(`- Total elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  lines.push(`- Total errors collected: ${errors.length} (page: ${pageErrCount}, console: ${consoleErrCount}, softlock: ${softlockCount}, migration: ${migrationFailCount})`);
  lines.push('');
  lines.push(`**Final verdict: ${verdict}**`);
  lines.push('');
  lines.push('## 1. Critical Issues');
  if (critical.length === 0) lines.push('_None._');
  else for (const c of critical) lines.push(`- ${c}`);
  lines.push('');
  lines.push('## 2. Balance verdict');
  lines.push(`- Economy: **${balanceVerdict}**`);
  lines.push(`- Transfer activity: **${transferVerdict}**`);
  lines.push(`- Champion diversity (L1 distinct in ${snapshots.length} seasons): ${l1Champs.size} → **${championDiversityVerdict}**`);
  lines.push('');
  lines.push('## 3. Tag effects');
  for (const f of tagEffectFindings) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## 4. Rumor hit rate');
  lines.push(`- Total rumors generated: ${totalRumors}, materialized as transfers: ${totalMaterialized}, **rate: ${avgRumorHitRate}%**`);
  lines.push('');
  lines.push('## 5. Storage trajectory');
  if (snapshots.length > 0) {
    lines.push(`- S${snapshots[0].season}: ${(firstStorage / 1024).toFixed(1)}KB compressed, ${(snapshots[0].storage.rawJsonSizeChars / 1024).toFixed(0)}KB raw, ratio ${snapshots[0].storage.compressionRatio}×`);
    lines.push(`- S${snapshots[snapshots.length - 1].season}: ${(lastStorage / 1024).toFixed(1)}KB compressed, ${(snapshots[snapshots.length - 1].storage.rawJsonSizeChars / 1024).toFixed(0)}KB raw, ratio ${snapshots[snapshots.length - 1].storage.compressionRatio}×`);
    lines.push(`- Average compression ratio: ${avgRatio}×`);
  }
  lines.push('');
  lines.push('## 6. UI smoke');
  lines.push(`- Passed: ${uiPass} / ${uiResults.length}`);
  lines.push(`- Failed: ${uiFail}`);
  for (const r of uiResults.filter(rr => !rr.ok)) {
    lines.push(`  - FAIL ${r.name} \`${r.route}\` (bodyH=${Math.round(r.bodyH)}): ${r.errs.slice(0, 3).join(' | ')}`);
  }
  lines.push('');
  lines.push('## 7. Warnings');
  if (warnings.length === 0) lines.push('_None._');
  else for (const w of warnings) lines.push(`- ${w}`);
  lines.push('');
  lines.push('## 8. Per-season detail (Phase 1)');
  lines.push('');
  lines.push('| S | L1 Champ | Trans | Sellers/Buyers | Retired | Rumors→Hit | p10/p50/p90 | Neg | Elite | Small | Pool | Storage |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of snapshots) {
    lines.push(`| ${s.season} | ${s.champions.l1} | ${s.transfers.totalThisSeason} | ${s.transfers.uniqueSellers}/${s.transfers.uniqueBuyers} | ${s.retirements.totalThisSeason} | ${s.rumors.totalGenerated}→${s.rumors.totalMaterialized} (${s.rumors.hitRatePct}%) | ${s.finance.p10Cash.toFixed(0)}/${s.finance.p50Cash.toFixed(0)}/${s.finance.p90Cash.toFixed(0)} | ${s.finance.teamsNegative} | ${s.finance.eliteMeanCash.toFixed(0)} | ${s.finance.smallMeanCash.toFixed(0)} | ${s.pool.sizeAtEnd}(${s.pool.youngestAge}-${s.pool.oldestAge}) | ${(s.storage.localStorageSizeChars / 1024).toFixed(0)}KB |`);
  }
  lines.push('');
  if (phase4Snapshots.length > 0) {
    lines.push('## 9. Per-season detail (Phase 4 — on s16 save)');
    lines.push('');
    lines.push('| S | L1 Champ | Trans | Retired | p50 | Neg | Storage |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const s of phase4Snapshots) {
      lines.push(`| ${s.season} | ${s.champions.l1} | ${s.transfers.totalThisSeason} | ${s.retirements.totalThisSeason} | ${s.finance.p50Cash.toFixed(0)} | ${s.finance.teamsNegative} | ${(s.storage.localStorageSizeChars / 1024).toFixed(0)}KB |`);
    }
    lines.push('');
  }
  if (migrated) {
    lines.push('## 10. Migration (s16 → v18)');
    lines.push('```json');
    lines.push(JSON.stringify(migrated, null, 2));
    lines.push('```');
  }
  fs.writeFileSync('/tmp/playthrough-report.md', lines.join('\n'));

  console.log('\n=== SUMMARY ===');
  console.log(`Verdict: ${verdict}`);
  console.log(`Phase 1 seasons: ${snapshots.length} | Phase 4 seasons: ${phase4Snapshots.length}`);
  console.log(`Critical: ${critical.length} | Warnings: ${warnings.length}`);
  console.log(`UI: ${uiPass}/${uiResults.length} passed`);
  console.log(`Rumor hit rate: ${avgRumorHitRate}% (${totalMaterialized}/${totalRumors})`);
  console.log(`L1 champion diversity: ${l1Champs.size}/${snapshots.length}`);
  for (const c of critical) console.log('  CRITICAL:', c);
  for (const w of warnings) console.log('  WARNING:', w);
  console.log(`\nOutputs:`);
  console.log(`  /tmp/playthrough-snapshots.json`);
  console.log(`  /tmp/playthrough-report.md`);
  console.log(`  /tmp/playthrough-errors.txt`);
  console.log(`  /tmp/playthrough-*.png (UI screenshots)`);
}

main().catch((err) => {
  console.error('AUDIT_CRASHED:', err);
  fs.appendFileSync('/tmp/playthrough-errors.txt', `\nAUDIT_CRASH: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
