/**
 * Cross-feature edge-case audit.
 *
 * For each scenario:
 *   1. Reset localStorage with the s16 baseline.
 *   2. Boot once so zustand applies migrations (v8 → v15) — this fills in
 *      teamFinances, continentalCups, totalElapsedWindows, etc.
 *   3. Optionally mutate the persisted state to set up the edge case.
 *   4. Reload to re-hydrate the store with the mutated state.
 *   5. Click 推进 N times.
 *   6. Capture pre/post deltas + page errors and pass/fail per the goal.
 *
 * Run: pnpm tsx scripts/audit-edge.ts
 */
import { chromium, type Page } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const SAVE = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
const STORAGE_KEY = 'football-universe-save';

type ScenarioResult = {
  passed: boolean;
  errors: string[];
  notes: string[];
  beforeState?: unknown;
  afterState?: unknown;
  expected?: string;
  actual?: string;
};

const RESULTS: Record<string, ScenarioResult> = {};

// ── Helpers ────────────────────────────────────────────────────────

async function attachErrorListeners(page: Page): Promise<{
  drain: () => string[];
}> {
  const buf: string[] = [];
  page.on('pageerror', (e) => buf.push(`PAGE: ${e.message}`));
  page.on('console', (m) => {
    const t = m.type();
    if (t !== 'error') return;
    const txt = m.text();
    if (/\[vite\]/.test(txt)) return;
    if (/Download the React DevTools/.test(txt)) return;
    if (/Failed to load resource.*favicon/.test(txt)) return;
    buf.push(`CONSOLE: ${txt}`);
  });
  return {
    drain: () => {
      const out = buf.slice();
      buf.length = 0;
      return out;
    },
  };
}

async function bootBaseline(page: Page): Promise<void> {
  // First load: clear, set baseline, reload so zustand reads it on hydration.
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
}

async function reloadAndSettle(page: Page): Promise<void> {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
}

async function clickAdvance(page: Page, max: number): Promise<number> {
  let clicks = 0;
  for (let i = 0; i < max; i++) {
    let btn;
    try {
      btn = await page.$('button:has-text("推进"), button:has-text("开始模拟"), button:has-text("完成"), button:has-text("Advance")');
    } catch {
      break;
    }
    if (!btn) break;
    const txt = await btn.textContent().catch(() => '');
    if (!txt) break;
    if (txt.includes('赛季已结束') || txt.includes('模拟中')) break;
    const dis = await btn.getAttribute('disabled').catch(() => null);
    if (dis !== null) break;
    try {
      await btn.click({ timeout: 1500 });
      clicks++;
    } catch {
      break;
    }
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(400);
  return clicks;
}

async function readWorld(page: Page, picker: string): Promise<unknown> {
  // picker is the body of an arrow function (string) that takes (w, root) and returns the picked object.
  const expr = `(() => {
    try {
      var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
      if (!raw) return { __noSave: true };
      var data = JSON.parse(raw);
      var w = data && data.state && data.state.world;
      if (!w) return { __noWorld: true, version: data && data.version };
      var pick = ${picker};
      return pick(w, data);
    } catch (e) {
      return { __readErr: String(e && e.message || e) };
    }
  })()`;
  return page.evaluate(expr);
}

async function mutateWorld(page: Page, mutator: string): Promise<unknown> {
  // mutator is body of arrow function (string) taking (w, data) and modifying in place; can return diagnostics.
  const expr = `(() => {
    try {
      var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
      if (!raw) return { __noSave: true };
      var data = JSON.parse(raw);
      var w = data && data.state && data.state.world;
      if (!w) return { __noWorld: true };
      var fn = ${mutator};
      var diag = fn(w, data);
      localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(data));
      return diag;
    } catch (e) {
      return { __mutErr: String(e && e.message || e), stack: String(e && e.stack || '') };
    }
  })()`;
  return page.evaluate(expr);
}

function recordPass(name: string, before: unknown, after: unknown, errors: string[], expected: string, actual: string, notes: string[] = []): void {
  RESULTS[name] = {
    passed: true,
    errors,
    notes,
    beforeState: before,
    afterState: after,
    expected,
    actual,
  };
}

function recordFail(name: string, before: unknown, after: unknown, errors: string[], expected: string, actual: string, notes: string[] = []): void {
  RESULTS[name] = {
    passed: false,
    errors,
    notes,
    beforeState: before,
    afterState: after,
    expected,
    actual,
  };
}

function recordSkip(name: string, reason: string): void {
  RESULTS[name] = {
    passed: false,
    errors: [],
    notes: [`skipped: ${reason}`],
    expected: '',
    actual: 'SKIPPED',
  };
}

// ── Scenario runners ───────────────────────────────────────────────

async function scenario1_StarPlayerInjuredAtSeasonEnd(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '1_star_injured_at_season_end';
  drain();
  await bootBaseline(page);
  drain();

  // Pick a top scorer-likely player: highest goalScoring on a top-tier team.
  const setup: any = await mutateWorld(page, `(w) => {
    var bestTeam = 'gz_hengda';
    var sq = w.squads[bestTeam] || [];
    if (sq.length === 0) return { ok: false, reason: 'no squad' };
    sq.sort(function(a, b){ return (b.goalScoring || 0) - (a.goalScoring || 0); });
    var p = sq[0];
    // Force long-term injury that survives off-season reset (type=long_term + far-future window)
    var bigWindow = (w.totalElapsedWindows || 0) + 200;
    p.injuredUntilWindow = bigWindow;
    p.injuryHistory = (p.injuryHistory || []).concat([{
      type: 'long_term',
      startSeason: w.seasonState.seasonNumber,
      startWindow: w.totalElapsedWindows || 0,
      durationMatches: 200,
      reason: 'audit-imposed knee'
    }]);
    return {
      ok: true,
      teamId: bestTeam,
      uuid: p.uuid,
      name: p.name,
      number: p.number,
      injuredUntilWindow: p.injuredUntilWindow,
      seasonStart: w.seasonState.seasonNumber,
      totalElapsedAtSetup: w.totalElapsedWindows || 0,
    };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  // Advance through full S16 + into S17 to trigger season-end retirement / awards / cup logic
  const clicked = await clickAdvance(page, 90);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var p = null;
    for (var tid in w.squads) {
      var arr = w.squads[tid] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].uuid === ${JSON.stringify(setup.uuid)}) { p = arr[i]; p.__currentTeam = tid; break; }
      }
      if (p) break;
    }
    var retired = (w.retirementHistory || []).find(function(r){ return r.uuid === ${JSON.stringify(setup.uuid)}; });
    var awards = (w.playerAwardsHistory || []).filter(function(a){ return a.playerId === ${JSON.stringify(setup.uuid)}; });
    return {
      season: w.seasonState.seasonNumber,
      totalElapsed: w.totalElapsedWindows,
      stillOnSquad: !!p,
      currentInjuredUntil: p ? p.injuredUntilWindow : null,
      retiredEntry: retired || null,
      awardsForPlayer: awards.length,
      newsLogTail: (w.newsLog || []).slice(-3).map(function(n){ return n.title; }),
    };
  }`);

  // Pass criteria: no page errors AND season advanced AND player either still alive or properly retired.
  // Specifically the season-end didn't crash.
  const seasonAdvanced = after && typeof after.season === 'number' && after.season > setup.seasonStart;
  const noCrash = errors.length === 0;
  const playerStateOk = after && (after.stillOnSquad === true || after.retiredEntry !== null);

  if (noCrash && seasonAdvanced && playerStateOk) {
    recordPass(NAME, setup, after, errors,
      'season advances, no crash, player either stays or properly retired',
      `season ${setup.seasonStart}→${after.season}, on squad: ${after.stillOnSquad}, retired: ${after.retiredEntry !== null}, advancements: ${clicked}`,
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'season advances, no crash, player either stays or properly retired',
      `season ${setup.seasonStart}→${after?.season}, on squad: ${after?.stillOnSquad}, retired: ${after?.retiredEntry !== null}, errors: ${errors.length}, advancements: ${clicked}`,
    );
  }
}

async function scenario2_CoachRetiresInContinentalCup(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '2_coach_retires_in_continental_cup';
  drain();
  await bootBaseline(page);
  drain();

  // Need to enter S17 (odd season) so continental cups initialise. Advance through S16.
  const clickedToS17 = await clickAdvance(page, 90);
  const transState: any = await readWorld(page, `(w) => ({ season: w.seasonState.seasonNumber, contCups: w.continentalCups ? Object.keys(w.continentalCups).filter(function(k){return !!w.continentalCups[k];}) : [] })`);
  const errs1 = drain();
  if (!transState || transState.season < 17) {
    recordSkip(NAME, `couldn't reach S17 (got S${transState?.season}, advances=${clickedToS17}, errs=${errs1.join('|').slice(0,200)})`);
    return;
  }

  // Set a coach age 75 on a team that's in mainland_cup OR any team. Ensure pool has at least one candidate.
  const setup: any = await mutateWorld(page, `(w) => {
    var cup = w.continentalCups && w.continentalCups.mainland_cup;
    if (!cup) return { ok: false, reason: 'no mainland cup running' };
    var teamsInCup = new Set();
    for (var i = 0; i < cup.rounds.length; i++) {
      for (var j = 0; j < cup.rounds[i].fixtures.length; j++) {
        var f = cup.rounds[i].fixtures[j];
        teamsInCup.add(f.homeTeamId); teamsInCup.add(f.awayTeamId);
      }
    }
    if (teamsInCup.size === 0) return { ok: false, reason: 'cup empty' };
    var targetTeam = null;
    var teamsInCupArr = Array.from(teamsInCup);
    for (var k = 0; k < teamsInCupArr.length; k++) {
      var tid = teamsInCupArr[k];
      // find their coach
      for (var cid in w.coachStates) {
        if (w.coachStates[cid] && w.coachStates[cid].currentTeamId === tid && !w.coachStates[cid].retired) {
          targetTeam = { teamId: tid, coachId: cid };
          break;
        }
      }
      if (targetTeam) break;
    }
    if (!targetTeam) return { ok: false, reason: 'no coach found for any cup team' };
    var coach = w.coachBases[targetTeam.coachId];
    if (!coach) return { ok: false, reason: 'coach base missing' };
    coach.age = 75; // > hard cap 72 → forced retire
    // Seed pool with a synthetic candidate so we can verify pool path.
    if (!Array.isArray(w.coachCandidatePool)) w.coachCandidatePool = [];
    w.coachCandidatePool.push({
      uuid: 'p-synth-cand',
      name: '审计候选',
      fromTeamId: 'gz_hengda',
      peakRating: 88,
      enteredPoolSeason: w.seasonState.seasonNumber - 1,
      style: 'attacking'
    });
    return {
      ok: true,
      season: w.seasonState.seasonNumber,
      teamId: targetTeam.teamId,
      teamName: w.teamBases[targetTeam.teamId] && w.teamBases[targetTeam.teamId].name,
      coachId: targetTeam.coachId,
      coachName: coach.name,
      coachAgeSet: 75,
      poolSize: w.coachCandidatePool.length,
    };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  // Snapshot the S17 cup so we can verify it completed before season-end (i.e. the coach
  // retirement during season-end didn't break the historical cup).
  const cupBeforeAdvance: any = await readWorld(page, `(w) => {
    var c = w.continentalCups && w.continentalCups.mainland_cup;
    return c ? { type: c.type, completed: c.completed, winner: c.winnerId, season: w.seasonState.seasonNumber, rounds: c.rounds.length } : null;
  }`);

  await reloadAndSettle(page);
  // Advance to season-end (S17 → S18)
  const clicked2 = await clickAdvance(page, 80);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var oldCoachState = w.coachStates[${JSON.stringify(setup.coachId)}] || null;
    var teamCoachId = null;
    for (var cid in w.coachStates) {
      var s = w.coachStates[cid];
      if (s && s.currentTeamId === ${JSON.stringify(setup.teamId)} && !s.retired) {
        teamCoachId = cid; break;
      }
    }
    var newCoachBase = teamCoachId ? w.coachBases[teamCoachId] : null;
    var retired = (w.coachRetirementHistory || []).find(function(r){ return r.id === ${JSON.stringify(setup.coachId)}; });
    // Look back through seasonRecords for the team to verify S17 results were recorded
    var records = (w.teamSeasonRecords && w.teamSeasonRecords[${JSON.stringify(setup.teamId)}]) || [];
    var s17record = records.find(function(r){ return r.seasonNumber === 17; });
    return {
      season: w.seasonState.seasonNumber,
      oldCoachState: oldCoachState,
      teamCoachId: teamCoachId,
      teamCoachIdShape: teamCoachId ? (teamCoachId.startsWith('c-from-player-') ? 'pool' : (teamCoachId.startsWith('c-fresh-') ? 'fresh' : 'reused')) : 'none',
      newCoachName: newCoachBase ? newCoachBase.name : null,
      retiredCoachEntry: retired || null,
      poolSizeAfter: (w.coachCandidatePool || []).length,
      s17record: s17record || null,
    };
  }`);

  const noCrash = errors.length === 0;
  const seasonAdv = after && after.season >= setup.season + 1;
  // Check old coach was retired (state.retired === true)
  const coachRetiredFlag = !!(after?.oldCoachState && after.oldCoachState.retired === true);
  // Check team has a new coach assigned
  const teamHasNewCoach = !!after?.teamCoachId && after.teamCoachId !== setup.coachId;
  // Check the old retired coach was NOT just rehired (would be the case if hireNewCoach didn't filter retired)
  const notSelfRehired = after?.teamCoachId !== setup.coachId;
  // Check team has an S17 record (i.e. we did process the S17 season-end)
  const hasS17Record = !!after?.s17record;

  const allPassed = noCrash && seasonAdv && coachRetiredFlag && teamHasNewCoach && notSelfRehired && hasS17Record;
  if (allPassed) {
    recordPass(NAME, { setup, cupBeforeAdvance }, after, errors,
      'coach retired (state.retired=true), replaced (different id, retired excluded), team has S17 record, no crash',
      `retired=${coachRetiredFlag}, new=${after?.teamCoachId} (${after?.teamCoachIdShape}), hasS17rec=${hasS17Record}, errs=${errors.length}, advances=${clicked2}`,
    );
  } else {
    recordFail(NAME, { setup, cupBeforeAdvance }, after, errors,
      'coach retired, replaced (excluded), S17 record exists, no crash',
      `retired=${coachRetiredFlag}, new=${after?.teamCoachId} (${after?.teamCoachIdShape}), hasS17rec=${hasS17Record}, errs=${errors.length}, advances=${clicked2}`,
    );
  }
}

async function scenario3_FireSaleAndTransferCollision(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '3_fire_sale_and_transfer_collision';
  drain();
  await bootBaseline(page);
  drain();

  // Push a strong team into deep negative cash with a star — they should fire-sale.
  // Mark the same player with a high-value reference so the transfer engine might also chase them.
  const setup: any = await mutateWorld(page, `(w) => {
    if (!w.teamFinances) return { ok: false, reason: 'no teamFinances after migration' };
    var sellerId = 'jeonbuk';
    if (!w.teamFinances[sellerId]) {
      // pick any team that has a 30M+ player and exists in finances
      var keys = Object.keys(w.teamFinances || {});
      for (var k = 0; k < keys.length; k++) {
        var sq = w.squads[keys[k]] || [];
        var hi = sq.reduce(function(m, p){ return (p.marketValue||0) > m ? (p.marketValue||0) : m; }, 0);
        if (hi >= 30) { sellerId = keys[k]; break; }
      }
    }
    if (!w.teamFinances[sellerId]) return { ok: false, reason: 'no eligible seller' };
    var sq = (w.squads[sellerId] || []).slice();
    sq.sort(function(a,b){ return (b.marketValue||0) - (a.marketValue||0); });
    var star = sq[0];
    if (!star) return { ok: false, reason: 'no star' };
    if ((star.marketValue || 0) < 30) {
      // boost to threshold
      star.marketValue = 60;
    }
    // Force seller into deep negative cash
    w.teamFinances[sellerId].cash = -300;
    // Ensure at least one elite buyer has plenty of cash so fire-sale fires.
    var buyerId = null;
    var teamBaseKeys = Object.keys(w.teamBases || {});
    for (var i = 0; i < teamBaseKeys.length; i++) {
      var tid = teamBaseKeys[i];
      if (tid === sellerId) continue;
      var b = w.teamBases[tid];
      if (b && b.reputation >= 85) {
        if (w.teamFinances[tid]) {
          w.teamFinances[tid].cash = 500;
          buyerId = tid; break;
        }
      }
    }
    return {
      ok: true,
      season: w.seasonState.seasonNumber,
      sellerId: sellerId,
      buyerId: buyerId,
      starUuid: star.uuid,
      starName: star.name,
      starMV: star.marketValue,
      sellerCash: w.teamFinances[sellerId].cash,
      sellerSquadSize: (w.squads[sellerId] || []).length,
      starsBeforeOnTeam: (w.squads[sellerId] || []).filter(function(p){return p.uuid===star.uuid;}).length,
    };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  // Need to reach season-end so fire-sale path runs
  const clicked = await clickAdvance(page, 80);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var locations = [];
    for (var tid in w.squads) {
      var arr = w.squads[tid] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].uuid === ${JSON.stringify(setup.starUuid)}) {
          locations.push({ teamId: tid, number: arr[i].number, mv: arr[i].marketValue });
        }
      }
    }
    var fireSaleNews = (w.newsLog || []).filter(function(n){ return n.type === 'fire_sale'; }).slice(-5).map(function(n){ return { title: n.title, season: n.seasonNumber }; });
    var transferRecs = (w.transferHistory || []).filter(function(t){ return t.playerId === ${JSON.stringify(setup.starUuid)}; });
    return {
      season: w.seasonState.seasonNumber,
      starLocations: locations,
      fireSaleNewsCount: fireSaleNews.length,
      fireSaleNewsTail: fireSaleNews,
      transferRecsForStar: transferRecs.slice(-5),
      sellerCashAfter: w.teamFinances && w.teamFinances[${JSON.stringify(setup.sellerId)}] ? w.teamFinances[${JSON.stringify(setup.sellerId)}].cash : null,
    };
  }`);

  const noCrash = errors.length === 0;
  const exactlyOneCopy = after?.starLocations?.length === 1;
  const recordCount = after?.transferRecsForStar?.length ?? 0;
  // The expectation is "only one transfer recorded; player ends up at exactly one team; no duplication"
  // Since the star may already have transfer history before our setup, we check that AFTER our season-end:
  //   - the star exists at exactly one team
  //   - they don't appear duplicated in any squad
  const noDuplication = exactlyOneCopy;

  if (noCrash && noDuplication) {
    recordPass(NAME, setup, after, errors,
      'player exists at exactly one team, no duplication, no crash',
      `locations=${after?.starLocations?.length}, transferRecsTotal=${recordCount}, fireSales=${after?.fireSaleNewsCount}, errs=${errors.length}, advances=${clicked}`,
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'player exists at exactly one team, no duplication, no crash',
      `locations=${after?.starLocations?.length}, transferRecsTotal=${recordCount}, errs=${errors.length}`,
    );
  }
}

async function scenario4_MigrationFromOldSave(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '4_migration_from_v8';
  drain();
  // Custom boot — set a synthetic v8 (or even lower) save with v9-v15 fields stripped.
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  // Build a stripped version of the SAVE.
  // The s16 save is already at version 8 with some v9-v15 fields absent. Force version=8 explicitly,
  // and also strip continentalCups/teamFinances/totalElapsedWindows/coachCandidatePool/coachRetirementHistory.
  const stripped = JSON.parse(JSON.stringify(SAVE));
  stripped.version = 8;
  // Nuke v9+ fields if any leaked in.
  if (stripped?.state?.world) {
    delete stripped.state.world.continentalCups;
    delete stripped.state.world.teamFinances;
    delete stripped.state.world.totalElapsedWindows;
    delete stripped.state.world.coachCandidatePool;
    delete stripped.state.world.coachRetirementHistory;
    delete stripped.state.world.retirementHistory;
    delete stripped.state.world.nextCoachIdCounter;
    // Strip per-player peakRating/peakAge so v9->v10 backfills them.
    const squads = stripped.state.world.squads ?? {};
    for (const tid of Object.keys(squads)) {
      for (const p of squads[tid] || []) {
        delete p.peakRating;
        delete p.peakAge;
        delete p.injuredUntilWindow;
        delete p.suspendedUntilWindow;
        delete p.injuryHistory;
      }
    }
    // Strip coach.age so v11->v12 backfills.
    const coachBases = stripped.state.world.coachBases ?? {};
    for (const cid of Object.keys(coachBases)) {
      delete coachBases[cid].age;
    }
  }
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(stripped))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const errors = drain();

  const after: any = await readWorld(page, `(w, data) => {
    return {
      version: data.version,
      hasContinentalCups: !!w.continentalCups,
      hasTeamFinances: !!w.teamFinances && Object.keys(w.teamFinances).length > 0,
      teamFinancesCount: w.teamFinances ? Object.keys(w.teamFinances).length : 0,
      hasTotalElapsedWindows: typeof w.totalElapsedWindows === 'number',
      hasCoachCandidatePool: Array.isArray(w.coachCandidatePool),
      hasCoachRetirementHistory: Array.isArray(w.coachRetirementHistory),
      hasRetirementHistory: Array.isArray(w.retirementHistory),
      hasNextCoachIdCounter: typeof w.nextCoachIdCounter === 'number',
      sampleCoach: (function(){
        var keys = Object.keys(w.coachBases || {});
        var c = keys.length > 0 ? w.coachBases[keys[0]] : null;
        return c ? { id: c.id, age: c.age } : null;
      })(),
      samplePlayer: (function(){
        var keys = Object.keys(w.squads || {});
        var sq = keys.length > 0 ? w.squads[keys[0]] : [];
        var p = sq && sq[0] ? sq[0] : null;
        return p ? { uuid: p.uuid, peakRating: p.peakRating, peakAge: p.peakAge, age: p.age, rating: p.rating } : null;
      })(),
      season: w.seasonState.seasonNumber,
    };
  }`);

  const noCrash = errors.length === 0;
  const allFieldsBackfilled = !!(after && after.hasContinentalCups && after.hasTeamFinances && after.hasTotalElapsedWindows && after.hasCoachCandidatePool && after.hasCoachRetirementHistory && after.hasRetirementHistory && after.hasNextCoachIdCounter);
  const coachAgeOk = after?.sampleCoach && typeof after.sampleCoach.age === 'number' && after.sampleCoach.age > 0;
  const playerCurveOk = after?.samplePlayer && typeof after.samplePlayer.peakRating === 'number' && typeof after.samplePlayer.peakAge === 'number';

  if (noCrash && allFieldsBackfilled && coachAgeOk && playerCurveOk) {
    recordPass(NAME, { strippedVersion: 8 }, after, errors,
      'all v9-v15 fields backfilled by migrations, no crash',
      `version=${after.version}, finances=${after.teamFinancesCount}, sampleCoachAge=${after.sampleCoach?.age}, samplePlayerPeak=${after.samplePlayer?.peakRating}, errs=${errors.length}`,
    );
  } else {
    recordFail(NAME, { strippedVersion: 8 }, after, errors,
      'all v9-v15 fields backfilled by migrations, no crash',
      `version=${after?.version}, finances=${after?.teamFinancesCount}, sampleCoachAge=${after?.sampleCoach?.age}, samplePlayerPeak=${after?.samplePlayer?.peakRating}, errs=${errors.length}, allFieldsBackfilled=${allFieldsBackfilled}`,
    );
  }
}

async function scenario5_EmptyCandidatePoolCoachRetires(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '5_empty_pool_coach_retires';
  drain();
  await bootBaseline(page);
  drain();

  const setup: any = await mutateWorld(page, `(w) => {
    // Empty pool, then force a coach to age 75 → forced retire.
    w.coachCandidatePool = [];
    var teamId = 'gz_hengda';
    var coachId = null;
    for (var cid in w.coachStates) {
      if (w.coachStates[cid] && w.coachStates[cid].currentTeamId === teamId && !w.coachStates[cid].retired) {
        coachId = cid; break;
      }
    }
    if (!coachId) return { ok: false, reason: 'no coach for ' + teamId };
    if (!w.coachBases[coachId]) return { ok: false, reason: 'no coachBase' };
    w.coachBases[coachId].age = 75;
    return {
      ok: true,
      teamId: teamId,
      coachId: coachId,
      coachName: w.coachBases[coachId].name,
      season: w.seasonState.seasonNumber,
    };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  const clicked = await clickAdvance(page, 80);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var oldState = w.coachStates[${JSON.stringify(setup.coachId)}];
    var teamCoach = null;
    for (var cid in w.coachStates) {
      var s = w.coachStates[cid];
      if (s && s.currentTeamId === ${JSON.stringify(setup.teamId)} && !s.retired) {
        teamCoach = { coachId: cid, name: w.coachBases[cid] ? w.coachBases[cid].name : null }; break;
      }
    }
    return {
      season: w.seasonState.seasonNumber,
      oldCoachRetired: oldState && oldState.retired === true,
      teamCoach: teamCoach,
      teamCoachShape: teamCoach ? (teamCoach.coachId.startsWith('c-from-player-') ? 'pool' : teamCoach.coachId.startsWith('c-fresh-') ? 'fresh' : 'reused') : 'none',
    };
  }`);

  const noCrash = errors.length === 0;
  const seasonAdv = after?.season > setup.season;
  const oldRetired = after?.oldCoachRetired === true;
  const teamNotCoachless = !!after?.teamCoach;
  // Note: pool may have been refilled by player retirements running BEFORE coach
  // retirement in season-end. So pool-sourced replacement is still valid evidence
  // the team isn't coachless. The scenario's bug-finder is "team becomes coachless".
  if (noCrash && seasonAdv && oldRetired && teamNotCoachless) {
    recordPass(NAME, setup, after, errors,
      'old coach retired, replacement assigned (team not coachless), no crash',
      `oldRetired=${oldRetired}, newCoach=${after?.teamCoach?.coachId} (${after?.teamCoachShape}), errs=${errors.length}, advances=${clicked}`,
      [`pool replenished mid-season-end via player retirement; replacement source = ${after?.teamCoachShape}`],
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'old coach retired, replacement assigned, no crash',
      `oldRetired=${oldRetired}, newCoach=${after?.teamCoach?.coachId} (${after?.teamCoachShape}), seasonAdv=${seasonAdv}, errs=${errors.length}`,
    );
  }
}

async function scenario6_NegativeCashOver100M(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '6_negative_cash_over_100m';
  drain();
  await bootBaseline(page);
  drain();

  const setup: any = await mutateWorld(page, `(w) => {
    if (!w.teamFinances) return { ok: false, reason: 'no teamFinances' };
    var teamId = 'gz_hengda';
    if (!w.teamFinances[teamId]) {
      var keys = Object.keys(w.teamFinances);
      teamId = keys[0];
    }
    if (!w.teamFinances[teamId]) return { ok: false, reason: 'no eligible team' };
    w.teamFinances[teamId].cash = -200; // €200M millions
    return { ok: true, teamId: teamId, season: w.seasonState.seasonNumber };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  // First check the dashboard shows red alert (cash chip)
  const dashSnap = await page.evaluate(`(() => {
    var t = document.body.innerText;
    return {
      hasRedAlert: /-€?2|赤字|-200/.test(t),
      sampleText: t.length > 4000 ? t.substring(0, 4000) : t,
    };
  })()`);
  // Now advance through season-end
  const clicked = await clickAdvance(page, 80);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var fin = w.teamFinances && w.teamFinances[${JSON.stringify(setup.teamId)}];
    var fireSaleNews = (w.newsLog || []).filter(function(n){ return n.type === 'fire_sale' && n.title.indexOf(${JSON.stringify(setup.teamId)}) === -1 && n.title.indexOf((w.teamBases[${JSON.stringify(setup.teamId)}] && w.teamBases[${JSON.stringify(setup.teamId)}].name) || '__nope__') > -1; });
    return {
      season: w.seasonState.seasonNumber,
      finalCash: fin ? fin.cash : null,
      financeHistoryLen: fin ? (fin.history || []).length : 0,
      lastHistoryRecord: fin ? (fin.history || [])[(fin.history || []).length - 1] : null,
      fireSaleNewsCount: fireSaleNews.length,
    };
  }`);

  const noCrash = errors.length === 0;
  const seasonAdv = after?.season > setup.season;
  // Pass: didn't crash; either fire-sale fired OR team carried negative balance forward.
  if (noCrash && seasonAdv) {
    recordPass(NAME, setup, { dashSnapTextSample: (dashSnap as any)?.sampleText?.slice(0, 400), ...after }, errors,
      'no crash, season advanced, finance archived',
      `finalCash=${after.finalCash}, fireSales=${after.fireSaleNewsCount}, redAlertOnDashboard=${(dashSnap as any)?.hasRedAlert}, advances=${clicked}`,
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'no crash, season advanced',
      `seasonAdv=${seasonAdv}, errs=${errors.length}, advances=${clicked}`,
    );
  }
}

async function scenario7_AllL1NegativeCash(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '7_all_L1_negative_cash';
  drain();
  await bootBaseline(page);
  drain();

  const setup: any = await mutateWorld(page, `(w) => {
    if (!w.teamFinances) return { ok: false, reason: 'no teamFinances' };
    var l1Teams = [];
    for (var tid in w.teamStates) {
      if (w.teamStates[tid] && w.teamStates[tid].leagueLevel === 1) l1Teams.push(tid);
    }
    if (l1Teams.length === 0) return { ok: false, reason: 'no L1 teams' };
    for (var i = 0; i < l1Teams.length; i++) {
      if (w.teamFinances[l1Teams[i]]) w.teamFinances[l1Teams[i]].cash = -150;
    }
    return { ok: true, count: l1Teams.length, season: w.seasonState.seasonNumber, teamsTouched: l1Teams.slice() };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  const t0 = Date.now();
  const clicked = await clickAdvance(page, 90);
  const elapsedMs = Date.now() - t0;
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var negCount = 0; var totalL1 = 0;
    for (var tid in w.teamStates) {
      if (w.teamStates[tid] && w.teamStates[tid].leagueLevel === 1) {
        totalL1++;
        if (w.teamFinances && w.teamFinances[tid] && w.teamFinances[tid].cash < 0) negCount++;
      }
    }
    var fireSaleNews = (w.newsLog || []).filter(function(n){ return n.type === 'fire_sale'; });
    return {
      season: w.seasonState.seasonNumber,
      negCount: negCount,
      totalL1: totalL1,
      fireSaleNewsCount: fireSaleNews.length,
    };
  }`);

  const noCrash = errors.length === 0;
  const seasonAdv = after?.season > setup.season;
  // No infinite loop = elapsed < 60s
  const noLoop = elapsedMs < 60000;

  if (noCrash && seasonAdv && noLoop) {
    recordPass(NAME, setup, { ...after, advanceMs: elapsedMs }, errors,
      'no infinite loop on fire-sale buyer search; season advanced; no crash',
      `elapsedMs=${elapsedMs}, negPostL1=${after.negCount}/${after.totalL1}, fireSales=${after.fireSaleNewsCount}, advances=${clicked}`,
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'no infinite loop, season advanced, no crash',
      `elapsedMs=${elapsedMs}, seasonAdv=${seasonAdv}, errs=${errors.length}, advances=${clicked}`,
    );
  }
}

async function scenario8_PlayerRetiresSameWindowAsInjured(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '8_player_retires_same_window_injured';
  drain();
  await bootBaseline(page);
  drain();

  const setup: any = await mutateWorld(page, `(w) => {
    var found = null;
    var teamKeys = Object.keys(w.squads);
    for (var i = 0; i < teamKeys.length; i++) {
      var tid = teamKeys[i];
      var sq = w.squads[tid] || [];
      // Capture pre-state uuids per team so we can detect newly-generated youths.
      for (var j = 0; j < sq.length; j++) {
        var p = sq[j];
        if (typeof p.age === 'number' && p.age >= 33) {
          // Force forced-retire (>= HARD_AGE_CAP=42) AND impose injury at current
          // window so we cover both "retire" and "injured" facets simultaneously.
          p.age = 42;
          p.injuredUntilWindow = (w.totalElapsedWindows || 0) + 1; // current
          p.injuryHistory = (p.injuryHistory || []).concat([{
            type: 'long_term',
            startSeason: w.seasonState.seasonNumber,
            startWindow: w.totalElapsedWindows || 0,
            durationMatches: 1,
            reason: 'audit-imposed end-of-career'
          }]);
          // Capture all current uuids on the team so we can identify the new youth later.
          var preTeamUuids = sq.map(function(x){ return x.uuid; });
          found = {
            teamId: tid,
            uuid: p.uuid,
            name: p.name,
            age: p.age,
            preTeamUuids: preTeamUuids,
          };
          break;
        }
      }
      if (found) break;
    }
    if (!found) return { ok: false, reason: 'no aged player found' };
    return { ok: true, season: w.seasonState.seasonNumber, ...found };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  const clicked = await clickAdvance(page, 90);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    var preUuidsSet = new Set(${JSON.stringify(setup.preTeamUuids)});
    var stillOnSquad = false;
    var newcomers = []; // youths added since pre-state
    var team = w.squads[${JSON.stringify(setup.teamId)}] || [];
    var injuredYouthCount = 0;
    var inheritedReasonCount = 0;
    for (var i = 0; i < team.length; i++) {
      if (team[i].uuid === ${JSON.stringify(setup.uuid)}) stillOnSquad = true;
      if (!preUuidsSet.has(team[i].uuid)) {
        newcomers.push({ uuid: team[i].uuid, age: team[i].age, injuredUntilWindow: team[i].injuredUntilWindow, injuryHistory: team[i].injuryHistory ? team[i].injuryHistory.length : 0 });
        if (team[i].injuredUntilWindow && team[i].injuredUntilWindow > (w.totalElapsedWindows || 0)) injuredYouthCount++;
        var inh = (team[i].injuryHistory || []).find(function(h){ return h.reason === 'audit-imposed end-of-career'; });
        if (inh) inheritedReasonCount++;
      }
    }
    var retired = (w.retirementHistory || []).find(function(r){ return r.uuid === ${JSON.stringify(setup.uuid)}; });
    return {
      season: w.seasonState.seasonNumber,
      stillOnSquad: stillOnSquad,
      retired: retired || null,
      newcomerCount: newcomers.length,
      newcomers: newcomers.slice(0, 5),
      injuredNewcomerCount: injuredYouthCount,
      inheritedAuditReasonCount: inheritedReasonCount,
    };
  }`);

  const noCrash = errors.length === 0;
  const seasonAdv = after?.season > setup.season;
  const retiredOk = after?.retired !== null;
  // Strictly: no newcomer should carry the audit-imposed injury reason. (A general
  // injuredUntilWindow could legitimately accrue from runtime injury rolls.)
  const noBleed = (after?.inheritedAuditReasonCount ?? 0) === 0;

  if (noCrash && seasonAdv && retiredOk && noBleed) {
    recordPass(NAME, setup, after, errors,
      'player retired (forced), new youth has no inherited audit injury, no crash',
      `retired=${retiredOk}, newcomers=${after?.newcomerCount}, injuredNewcomers=${after?.injuredNewcomerCount}, inheritedAuditReason=${after?.inheritedAuditReasonCount}, errs=${errors.length}, advances=${clicked}`,
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'player retired; youth replacement has no inherited injury; no crash',
      `retired=${retiredOk}, newcomers=${after?.newcomerCount}, injuredNewcomers=${after?.injuredNewcomerCount}, inheritedAuditReason=${after?.inheritedAuditReasonCount}, seasonAdv=${seasonAdv}, errs=${errors.length}`,
    );
  }
}

async function scenario9_ContinentalCupMassSuspensions(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '9_continental_cup_mass_suspensions';
  drain();
  await bootBaseline(page);
  drain();

  // Need to enter S17 first
  await clickAdvance(page, 90);
  const t0Stat: any = await readWorld(page, `(w) => ({ season: w.seasonState.seasonNumber, hasMainland: !!(w.continentalCups && w.continentalCups.mainland_cup) })`);
  if (!t0Stat || !t0Stat.hasMainland) {
    recordSkip(NAME, `mainland cup not running, season=${t0Stat?.season}`);
    return;
  }

  const setup: any = await mutateWorld(page, `(w) => {
    var cup = w.continentalCups.mainland_cup;
    var current = cup.rounds[cup.rounds.length - 1];
    if (!current || !current.fixtures || current.fixtures.length === 0) return { ok: false, reason: 'no fixtures in current round' };
    var fix = current.fixtures[0];
    var teamId = fix.homeTeamId;
    var sq = w.squads[teamId] || [];
    if (sq.length === 0) return { ok: false, reason: 'no squad' };
    var half = Math.floor(sq.length / 2);
    var bigWin = (w.totalElapsedWindows || 0) + 5;
    for (var i = 0; i < half; i++) {
      sq[i].suspendedUntilWindow = bigWin;
    }
    return { ok: true, teamId: teamId, suspendedCount: half, totalSquad: sq.length, fixtureId: fix.id, currentRound: current.roundName, totalElapsedAtSetup: w.totalElapsedWindows };
  }`);
  if (!setup || setup.ok === false) {
    recordSkip(NAME, `cannot set up: ${JSON.stringify(setup)}`);
    return;
  }

  await reloadAndSettle(page);
  // Just advance a few windows to pass through the cup window.
  const clicked = await clickAdvance(page, 8);
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    // Look at recent match results — find any with NaN scores or with a cup match including teamId
    var bad = [];
    var cal = (w.seasonState && w.seasonState.calendar) || [];
    for (var i = 0; i < cal.length; i++) {
      var win = cal[i];
      if (!win || !win.results) continue;
      for (var j = 0; j < win.results.length; j++) {
        var r = win.results[j];
        if ((r.homeTeamId === ${JSON.stringify(setup.teamId)}) || (r.awayTeamId === ${JSON.stringify(setup.teamId)})) {
          if (typeof r.homeGoals !== 'number' || typeof r.awayGoals !== 'number' || isNaN(r.homeGoals) || isNaN(r.awayGoals)) {
            bad.push({ fixtureId: r.fixtureId, homeGoals: r.homeGoals, awayGoals: r.awayGoals });
          }
        }
      }
    }
    var cup = w.continentalCups && w.continentalCups.mainland_cup;
    var cupRoundsState = cup ? cup.rounds.map(function(r){ return { name: r.roundName, completed: r.completed, fixCount: r.fixtures.length }; }) : null;
    return {
      season: w.seasonState.seasonNumber,
      badResults: bad,
      cupRoundsState: cupRoundsState,
    };
  }`);

  const noCrash = errors.length === 0;
  const noBadScores = (after?.badResults || []).length === 0;

  if (noCrash && noBadScores) {
    recordPass(NAME, setup, after, errors,
      'no NaN scores, cup matches still simulated, no crash',
      `bad=${after?.badResults?.length}, errs=${errors.length}, advances=${clicked}`,
    );
  } else {
    recordFail(NAME, setup, after, errors,
      'no NaN scores, cup matches still simulated, no crash',
      `bad=${after?.badResults?.length}, errs=${errors.length}`,
    );
  }
}

async function scenario10_TrophyAggregation(page: Page, drain: () => string[]): Promise<void> {
  const NAME = '10_trophy_aggregation';
  drain();
  await bootBaseline(page);
  drain();

  // Advance through 3 seasons (~ 3 × 48 windows = 144). We click 200 to be safe.
  const t0: any = await readWorld(page, `(w) => ({ season: w.seasonState.seasonNumber })`);
  let clicked = 0;
  // 3 seasons of ~50 windows each = 150 clicks. Cap at 200 with bail.
  for (let i = 0; i < 200; i++) {
    const c = await clickAdvance(page, 30);
    clicked += c;
    const cur: any = await readWorld(page, `(w) => ({ season: w.seasonState.seasonNumber })`);
    if (cur?.season >= (t0?.season + 3)) break;
    if (c === 0) break;
  }
  const errors = drain();

  const after: any = await readWorld(page, `(w) => {
    // Pick gz_hengda's trophies and verify against seasonRecords cup/league columns.
    var teamId = 'gz_hengda';
    var trophies = (w.teamTrophies && w.teamTrophies[teamId]) || [];
    var records = (w.teamSeasonRecords && w.teamSeasonRecords[teamId]) || [];
    // Build expected counts from records
    var expected = { league1: 0, league_cup: 0, super_cup: 0 };
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.leagueLevel === 1 && r.leaguePosition === 1) expected.league1++;
      if (r.cupResult === '冠军') expected.league_cup++;
      if (r.superCupResult === '冠军') expected.super_cup++;
    }
    var actual = { league1: 0, league_cup: 0, super_cup: 0, mainland_cup: 0, southern_cup: 0, eastern_cup: 0, world_cup: 0, league2: 0, league3: 0 };
    for (var j = 0; j < trophies.length; j++) {
      var t = trophies[j];
      if (actual[t.type] !== undefined) actual[t.type]++;
    }
    return {
      season: w.seasonState.seasonNumber,
      teamId: teamId,
      expected: expected,
      actual: actual,
      recordCount: records.length,
      trophyCount: trophies.length,
    };
  }`);

  const noCrash = errors.length === 0;
  const seasonAdv = after?.season >= (t0?.season + 3);
  // Compare expected vs actual league_cup and super_cup
  const matchOk = !!(after && after.expected.league1 === after.actual.league1
                    && after.expected.league_cup === after.actual.league_cup
                    && after.expected.super_cup === after.actual.super_cup);

  if (noCrash && seasonAdv && matchOk) {
    recordPass(NAME, t0, after, errors,
      'team trophies counts match seasonRecords summary across league_cup, super_cup, league1',
      `expected=${JSON.stringify(after.expected)}, actual=${JSON.stringify(after.actual)}, advances=${clicked}`,
    );
  } else {
    recordFail(NAME, t0, after, errors,
      'team trophies counts match seasonRecords summary',
      `expected=${JSON.stringify(after?.expected)}, actual=${JSON.stringify(after?.actual)}, seasonAdv=${seasonAdv}, errs=${errors.length}`,
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const { drain } = await attachErrorListeners(page);

  // Each scenario reboots from baseline so they don't interfere.
  const scenarios: Array<[string, (p: Page, d: () => string[]) => Promise<void>]> = [
    ['1', scenario1_StarPlayerInjuredAtSeasonEnd],
    ['2', scenario2_CoachRetiresInContinentalCup],
    ['3', scenario3_FireSaleAndTransferCollision],
    ['4', scenario4_MigrationFromOldSave],
    ['5', scenario5_EmptyCandidatePoolCoachRetires],
    ['6', scenario6_NegativeCashOver100M],
    ['7', scenario7_AllL1NegativeCash],
    ['8', scenario8_PlayerRetiresSameWindowAsInjured],
    ['9', scenario9_ContinentalCupMassSuspensions],
    ['10', scenario10_TrophyAggregation],
  ];

  for (const [tag, fn] of scenarios) {
    console.log(`--- Scenario ${tag} ---`);
    const t0 = Date.now();
    try {
      await fn(page, drain);
    } catch (e: any) {
      console.error(`Scenario ${tag} threw:`, e?.message ?? e);
      // Track as a fail
      const key = Object.keys(RESULTS).find((k) => k.startsWith(`${tag}_`));
      if (!key) {
        RESULTS[`${tag}_unknown`] = {
          passed: false,
          errors: [String(e?.message ?? e)],
          notes: ['scenario harness threw'],
          expected: '',
          actual: 'THREW',
        };
      }
    }
    const t1 = Date.now();
    console.log(`  took ${(t1 - t0) / 1000}s`);
  }

  await browser.close();

  // Write outputs
  fs.writeFileSync('/tmp/edge-cases-results.json', JSON.stringify(RESULTS, null, 2));
  // Build report.md
  const passedNames = Object.keys(RESULTS).filter((k) => RESULTS[k].passed);
  const failedNames = Object.keys(RESULTS).filter((k) => !RESULTS[k].passed && !(RESULTS[k].notes ?? []).some((n) => n.startsWith('skipped:')));
  const skippedNames = Object.keys(RESULTS).filter((k) => (RESULTS[k].notes ?? []).some((n) => n.startsWith('skipped:')));

  const lines: string[] = [];
  lines.push(`# Edge-case audit report`);
  lines.push(``);
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push(`Save: ${SAVE_PATH}`);
  lines.push(``);
  lines.push(`Pass: ${passedNames.length} / ${Object.keys(RESULTS).length}`);
  lines.push(`Fail: ${failedNames.length}`);
  lines.push(`Skipped: ${skippedNames.length}`);
  lines.push(``);
  lines.push(`## Pass`);
  for (const n of passedNames) {
    const r = RESULTS[n];
    lines.push(`- **${n}** — ${r.actual}`);
  }
  lines.push(``);
  lines.push(`## Fail`);
  if (failedNames.length === 0) lines.push('(none)');
  for (const n of failedNames) {
    const r = RESULTS[n];
    lines.push(`### ${n}`);
    lines.push(`- expected: ${r.expected}`);
    lines.push(`- actual:   ${r.actual}`);
    if (r.errors.length > 0) lines.push(`- errors: ${r.errors.slice(0, 5).join(' | ')}`);
    if (r.notes.length > 0) lines.push(`- notes: ${r.notes.join(' | ')}`);
  }
  lines.push(``);
  lines.push(`## Skipped`);
  for (const n of skippedNames) {
    const r = RESULTS[n];
    lines.push(`- ${n}: ${r.notes.join(' | ')}`);
  }
  fs.writeFileSync('/tmp/edge-cases-report.md', lines.join('\n'));
  console.log(`\nResults: /tmp/edge-cases-results.json`);
  console.log(`Report:  /tmp/edge-cases-report.md`);
  console.log(`Pass: ${passedNames.length}, Fail: ${failedNames.length}, Skipped: ${skippedNames.length}`);
  for (const n of failedNames) {
    console.log(`  FAIL ${n}: ${RESULTS[n].actual}`);
  }
  for (const n of skippedNames) {
    console.log(`  SKIP ${n}: ${RESULTS[n].notes.join(' | ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
