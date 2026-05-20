/**
 * Phase H+ — long-running E2E audit.
 *
 * Loads the s16 baseline (v8 → v15 migration chain), advances 10 seasons, and
 * captures structured snapshots after each season-end so we can spot
 * regressions, balance issues, and runtime errors before the user plays.
 *
 * Outputs:
 *   /tmp/e2e-snapshots.json — array of per-season snapshots
 *   /tmp/e2e-errors.txt    — flat dump of all collected errors
 *   /tmp/e2e-report.md     — structured report with pass/fail per criteria
 *
 * Notes on tsx + page.evaluate: tsx adds `__name` references that break
 * `page.evaluate(fn)`, so we use the string-form `page.evaluate('(() => {…})()')`
 * exclusively. All snapshot extraction lives inside one big string-evaluated
 * function that walks `localStorage`'s persisted save.
 */
import { chromium, Page, ConsoleMessage } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const TARGET_SEASONS = 10;
const ADVANCE_BUDGET_PER_SEASON = 80; // safety: each season is ~30-50 windows
const SOFT_TIMEOUT_MS = 7 * 60 * 1000; // 7 minutes — finish before 8

interface Snapshot {
  season: number;
  retiredPlayers: number;
  retiredCoaches: number;
  candidatePool: number;
  transferRecords: number;
  fireSales: number;
  awardsHistory: number;
  injuriesActive: number;
  suspensionsActive: number;
  l1Champion: string;
  l2Champion: string;
  l3Champion: string;
  leagueCupWinner: string;
  superCupWinner: string;
  worldCupWinner: string | null;
  mainlandCupWinner: string | null;
  southernCupWinner: string | null;
  easternCupWinner: string | null;
  goldenBoot: { player: string; team: string; goals: number } | null;
  mvp: { player: string; team: string } | null;
  financeStats: {
    p10: number; p25: number; p50: number; p75: number; p90: number;
    teamsNegative: number;
    teamsAboveBillion: number;
    stdDev: number;
    sampleCount: number;
  };
  uniqueLeagueChampionsLast5: number;
  newErrors: string[];
}

interface CrossValidation {
  retirementsStillInSquad: string[];
  transferDestMissingPlayer: string[];
  transferSourceStillHas: string[];
  fireSaleNoCashMove: string[];
  prizeMoneyMismatch: { season: number; expected: number; actual: number }[];
  cupResultMissing: { season: number; cupType: string }[];
}

async function main() {
  const startTime = Date.now();
  const SAVE = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors: string[] = [];
  const newErrorsBuffer: string[] = [];
  const filterError = (msg: string) => {
    if (msg.includes('chrome-extension://')) return false;
    if (msg.includes('favicon')) return false;
    if (msg.match(/Failed to load resource.*404/)) return false;
    return true;
  };
  page.on('pageerror', (e) => {
    const m = `PAGE ERROR: ${e.message}`;
    errors.push(m);
    newErrorsBuffer.push(m);
  });
  page.on('console', (m: ConsoleMessage) => {
    const t = m.type();
    if (t !== 'error' && t !== 'warning') return;
    const txt = m.text();
    if (!filterError(txt)) return;
    const tagged = `${t.toUpperCase()}: ${txt}`;
    errors.push(tagged);
    newErrorsBuffer.push(tagged);
  });
  page.on('crash', () => errors.push('PAGE CRASH'));
  page.on('weberror', (e) => errors.push(`WEB ERROR: ${e.error().message}`));

  // ── Load + migrate ──
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('football-universe-save', ${JSON.stringify(JSON.stringify(SAVE))});
  `);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Pin a favorite so the dashboard cash-chip path is exercised
  await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return;
    var data = JSON.parse(raw);
    data.state.favoriteTeamIds = ['gz_hengda'];
    data.state.favoriteTeamId = 'gz_hengda';
    localStorage.setItem('football-universe-save', JSON.stringify(data));
  })()`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── Migration sanity check ──
  const migrated = (await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    return {
      version: data.version,
      season: w.seasonState ? w.seasonState.seasonNumber : null,
      financeTeams: Object.keys(w.teamFinances || {}).length,
      continentalCupKeys: Object.keys(w.continentalCups || {}),
      totalElapsedWindows: w.totalElapsedWindows,
      retirementHistoryArr: Array.isArray(w.retirementHistory),
      coachCandidatePoolArr: Array.isArray(w.coachCandidatePool),
      coachRetirementHistoryArr: Array.isArray(w.coachRetirementHistory),
    };
  })()`)) as Record<string, unknown> | null;
  console.log('=== MIGRATED STATE ===');
  console.log(JSON.stringify(migrated, null, 2));

  if (!migrated || (migrated.financeTeams as number) === 0) {
    errors.push(`CRITICAL: migration produced empty teamFinances: ${JSON.stringify(migrated)}`);
  }

  // Helper: extract snapshot for the just-finished season N (read state AFTER
  // initializeNewSeason has already bumped seasonNumber to N+1, so we want
  // seasonNumber - 1).
  const SNAPSHOT_FN = `(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;
    var currentSeason = w.seasonState && w.seasonState.seasonNumber;
    var totalElapsed = w.totalElapsedWindows || 0;
    var honor = (w.honorHistory || []).slice(-1)[0] || {};
    var seasonJustFinished = honor.seasonNumber || (currentSeason - 1);

    // Counters (these are append-only; we capture cumulative totals)
    var retired = (w.retirementHistory || []).length;
    var retiredCoaches = (w.coachRetirementHistory || []).length;
    var pool = (w.coachCandidatePool || []).length;
    var transfers = (w.transferHistory || []).length;
    var awards = (w.playerAwardsHistory || []).length;

    // Fire sales — count news entries with type === 'fire_sale'
    var fireSales = (w.newsLog || []).filter(function(n) { return n && n.type === 'fire_sale'; }).length;

    // Active injuries / suspensions
    var injActive = 0, susActive = 0;
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      for (var i = 0; i < sq.length; i++) {
        var p = sq[i];
        if (typeof p.injuredUntilWindow === 'number' && p.injuredUntilWindow > totalElapsed) injActive++;
        if (typeof p.suspendedUntilWindow === 'number' && p.suspendedUntilWindow > totalElapsed) susActive++;
      }
    }

    // Champions (from latest honor record, plus continental cups from world.continentalCups
    // — those reset for the next season, so for an EVEN newly-started season the cup we
    // want belongs to the season that just finished. We read the cup state DURING the
    // season-end window, before initializeNewSeason wipes them.)
    var l1Champ = honor.league1Champion || '';
    var l2Champ = honor.league2Champion || '';
    var l3Champ = honor.league3Champion || '';
    var leagueCupWinner = honor.leagueCupWinner || '';
    var superCupWinner = honor.superCupWinner || '';
    var wcWinner = honor.worldCupWinner || null;
    // Continental cup winners — pulled from teamTrophies for the season that just
    // finished (more reliable than continentalCups since it gets wiped by initializeNewSeason).
    var mainlandWin = null, southernWin = null, easternWin = null;
    for (var teamId in (w.teamTrophies || {})) {
      var trophies = w.teamTrophies[teamId] || [];
      for (var j = 0; j < trophies.length; j++) {
        var t = trophies[j];
        if (t.seasonNumber !== seasonJustFinished) continue;
        if (t.type === 'mainland_cup') mainlandWin = teamId;
        if (t.type === 'southern_cup') southernWin = teamId;
        if (t.type === 'eastern_cup') easternWin = teamId;
      }
    }

    // Top performers — Last entry per type in playerAwardsHistory
    var awardsList = w.playerAwardsHistory || [];
    var goldenBoot = null;
    var mvp = null;
    for (var k = awardsList.length - 1; k >= 0; k--) {
      var a = awardsList[k];
      if (!a || a.season !== seasonJustFinished) continue;
      if (!goldenBoot && a.type === 'golden_boot') {
        goldenBoot = { player: a.playerName, team: a.teamName, goals: a.statValue };
      }
      if (!mvp && a.type === 'mvp') {
        mvp = { player: a.playerName, team: a.teamName };
      }
      if (goldenBoot && mvp) break;
    }

    // Finance stats
    var cashList = [];
    var teamsNeg = 0, teamsAbove1B = 0;
    for (var ftid in (w.teamFinances || {})) {
      var c = w.teamFinances[ftid].cash;
      if (typeof c === 'number') {
        cashList.push(c);
        if (c < 0) teamsNeg++;
        if (c > 1000) teamsAbove1B++; // cash is in millions; 1000M = €1B
      }
    }
    cashList.sort(function(a, b) { return a - b; });
    function pct(arr, p) {
      if (arr.length === 0) return 0;
      var idx = Math.floor(arr.length * p);
      if (idx >= arr.length) idx = arr.length - 1;
      return arr[idx];
    }
    var p10 = pct(cashList, 0.10), p25 = pct(cashList, 0.25),
        p50 = pct(cashList, 0.50), p75 = pct(cashList, 0.75),
        p90 = pct(cashList, 0.90);
    var mean = 0;
    for (var ci = 0; ci < cashList.length; ci++) mean += cashList[ci];
    mean = cashList.length > 0 ? mean / cashList.length : 0;
    var variance = 0;
    for (var cj = 0; cj < cashList.length; cj++) {
      variance += (cashList[cj] - mean) * (cashList[cj] - mean);
    }
    var stdDev = cashList.length > 0 ? Math.sqrt(variance / cashList.length) : 0;

    // Diversity — distinct L1 champions in last 5 honors
    var honors = w.honorHistory || [];
    var last5 = honors.slice(-5);
    var champSet = {};
    for (var hi = 0; hi < last5.length; hi++) {
      var h = last5[hi];
      if (h && h.league1Champion) champSet[h.league1Champion] = 1;
    }
    var uniqueChamps = Object.keys(champSet).length;

    return {
      season: seasonJustFinished,
      currentSeason: currentSeason,
      retiredPlayers: retired,
      retiredCoaches: retiredCoaches,
      candidatePool: pool,
      transferRecords: transfers,
      fireSales: fireSales,
      awardsHistory: awards,
      injuriesActive: injActive,
      suspensionsActive: susActive,
      l1Champion: l1Champ,
      l2Champion: l2Champ,
      l3Champion: l3Champ,
      leagueCupWinner: leagueCupWinner,
      superCupWinner: superCupWinner,
      worldCupWinner: wcWinner,
      mainlandCupWinner: mainlandWin,
      southernCupWinner: southernWin,
      easternCupWinner: easternWin,
      goldenBoot: goldenBoot,
      mvp: mvp,
      financeStats: {
        p10: p10, p25: p25, p50: p50, p75: p75, p90: p90,
        teamsNegative: teamsNeg, teamsAboveBillion: teamsAbove1B,
        stdDev: stdDev, sampleCount: cashList.length,
      },
      uniqueLeagueChampionsLast5: uniqueChamps,
    };
  })()`;

  // Get starting season
  const startSeason = (await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    return data.state.world.seasonState.seasonNumber;
  })()`)) as number;
  console.log(`Starting season: ${startSeason}`);

  // Navigate to a quiet route (no Dashboard modal overlays / Celebration /
  // MatchLive) so clicks on the header "推进" button always land. The /settings
  // page is plain and persistent across advances.
  await page.goto(URL + 'settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const snapshots: Snapshot[] = [];
  let lastObservedSeason = startSeason;
  let totalAdvances = 0;

  // ── Advance loop ──
  // Strategy: click as long as the button is enabled AND its text starts with
  // "开始模拟". When isAdvancing flips on, the button is disabled with text
  // "模拟中..." — we wait then retry. When seasonNumber bumps in localStorage,
  // we know the season-end window just executed and the new season is live.
  const probeSeason = async (): Promise<number> => {
    return (await page.evaluate(`(() => {
      var raw = localStorage.getItem('football-universe-save');
      if (!raw) return -1;
      var data = JSON.parse(raw);
      return data.state.world.seasonState.seasonNumber;
    })()`)) as number;
  };
  for (let s = 0; s < TARGET_SEASONS; s++) {
    if (Date.now() - startTime > SOFT_TIMEOUT_MS) {
      errors.push(`SOFT_TIMEOUT: stopped at season ${s}/${TARGET_SEASONS} after ${(Date.now() - startTime)/1000}s`);
      break;
    }
    let advancedThisSeason = 0;
    let consecutiveWaits = 0;
    let seasonChanged = false;
    for (let i = 0; i < ADVANCE_BUDGET_PER_SEASON * 4; i++) {
      // Use the layout header "推进" button — it's always rendered, never
      // covered by a modal, and triggers the same advanceWindow action.
      const btn = await page.$('header button:has-text("推进"), header button:has-text("...")，header button:has-text("完成")');
      // Fallback: any header button containing 推进/完成/...
      const btn2 = btn ?? (await page.$('header button'));
      if (!btn2) {
        errors.push(`SOFT_LOCK: no advance button at season ${lastObservedSeason}, advance ${i}`);
        break;
      }
      const txt = (await btn2.textContent()) || '';
      const disabled = await btn2.isDisabled();
      if (disabled || txt.includes('...') || txt.includes('完成')) {
        // Either advancing in-flight, or season ended (no current window).
        await page.waitForTimeout(180);
        consecutiveWaits++;
        const seasonNow = await probeSeason();
        if (seasonNow > lastObservedSeason) {
          seasonChanged = true;
          break;
        }
        if (consecutiveWaits > 30) {
          errors.push(`SOFT_LOCK_WAIT: button stuck disabled for ${consecutiveWaits} probes at season ${lastObservedSeason} (text="${txt}")`);
          break;
        }
        continue;
      }
      consecutiveWaits = 0;
      // Active 推进 button — click it. force:true bypasses any potential
      // overlay covering even the header.
      await btn2.click({ timeout: 2000, force: true }).catch(() => {});
      advancedThisSeason++;
      totalAdvances++;
      await page.waitForTimeout(50);
      // Cheap probe every 2 advances
      if (advancedThisSeason % 2 === 0) {
        const seasonNow = await probeSeason();
        if (seasonNow > lastObservedSeason) {
          seasonChanged = true;
          break;
        }
      }
      // DEBUG: every 30 clicks dump current windowIndex / season for visibility
      if (advancedThisSeason % 30 === 0) {
        const stateProbe = (await page.evaluate(`(() => {
          var raw = localStorage.getItem('football-universe-save');
          if (!raw) return null;
          var data = JSON.parse(raw);
          var w = data.state.world;
          return {
            season: w.seasonState.seasonNumber,
            windowIndex: w.seasonState.currentWindowIndex,
            calendarLen: (w.seasonState.calendar || []).length,
          };
        })()`)) as Record<string, unknown>;
        console.log(`  …S${stateProbe?.season} idx=${stateProbe?.windowIndex}/${stateProbe?.calendarLen}`);
      }
    }
    if (!seasonChanged) {
      errors.push(`SOFT_LOCK: season ${lastObservedSeason} did not advance after ${advancedThisSeason} active clicks`);
      break;
    }
    // Wait for any post-advance state to settle
    await page.waitForTimeout(300);

    const snap = (await page.evaluate(SNAPSHOT_FN)) as (Snapshot & { currentSeason: number }) | null;
    if (!snap) {
      errors.push(`SNAPSHOT_NULL: failed to extract snapshot after season ${lastObservedSeason}`);
      break;
    }
    const newErrors = newErrorsBuffer.splice(0, newErrorsBuffer.length);
    const fullSnap: Snapshot = { ...snap, newErrors };
    snapshots.push(fullSnap);
    console.log(
      `[Season ${snap.season}] L1=${snap.l1Champion} | retired=${snap.retiredPlayers} ` +
      `transfers=${snap.transferRecords} fireSales=${snap.fireSales} awards=${snap.awardsHistory} ` +
      `inj=${snap.injuriesActive} sus=${snap.suspensionsActive} ` +
      `cash[p10/p50/p90]=${snap.financeStats.p10.toFixed(0)}/${snap.financeStats.p50.toFixed(0)}/${snap.financeStats.p90.toFixed(0)} ` +
      `neg=${snap.financeStats.teamsNegative} mvp=${snap.mvp ? snap.mvp.player : 'null'}`,
    );
    lastObservedSeason = snap.currentSeason;
  }

  // ── Cross-validation ──
  console.log('\n=== CROSS-VALIDATION ===');
  const xv = (await page.evaluate(`(() => {
    var raw = localStorage.getItem('football-universe-save');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var w = data.state.world;

    var retirementsStillInSquad = [];
    var retSet = {};
    for (var i = 0; i < (w.retirementHistory || []).length; i++) {
      var r = w.retirementHistory[i];
      if (r && r.playerId) retSet[r.playerId] = r.playerName || r.playerId;
    }
    for (var tid in (w.squads || {})) {
      var sq = w.squads[tid] || [];
      for (var j = 0; j < sq.length; j++) {
        if (retSet[sq[j].uuid]) {
          retirementsStillInSquad.push(retSet[sq[j].uuid] + ' still in ' + tid);
          if (retirementsStillInSquad.length > 8) break;
        }
      }
      if (retirementsStillInSquad.length > 8) break;
    }

    var transferDestMissingPlayer = [];
    var transferSourceStillHas = [];
    var transfers = w.transferHistory || [];
    var checked = 0;
    // Check only the most recent 50 to keep this snappy
    for (var ti = transfers.length - 1; ti >= Math.max(0, transfers.length - 50); ti--) {
      var t = transfers[ti];
      if (!t || !t.playerId) continue;
      var dest = w.squads[t.toTeamId] || [];
      var src = w.squads[t.fromTeamId] || [];
      var inDest = dest.some(function(p) { return p.uuid === t.playerId; });
      var inSrc = src.some(function(p) { return p.uuid === t.playerId; });
      // A player may have been transferred again or retired since this transfer.
      // Only flag if the player still exists in the source AND we haven't seen
      // a later transfer/retirement for them.
      if (!inDest && inSrc) {
        // Look forward for a later transfer for the same player
        var laterMove = false;
        for (var ti2 = ti + 1; ti2 < transfers.length; ti2++) {
          if (transfers[ti2].playerId === t.playerId) { laterMove = true; break; }
        }
        if (!retSet[t.playerId] && !laterMove) {
          transferSourceStillHas.push(t.playerName + ' (' + t.fromTeamId + '→' + t.toTeamId + ' S' + t.season + ')');
        }
      }
      checked++;
      if (transferSourceStillHas.length > 8) break;
    }

    var fireSaleNoCashMove = [];
    // For fire-sale news entries from the last season, verify at least the
    // sellers and buyers are tracked (we don't have per-record cash deltas
    // archived, so we check that finance history shows plausible non-zero
    // transferIncome in that season for involved teams).
    var fsNews = (w.newsLog || []).filter(function(n) { return n && n.type === 'fire_sale'; });
    for (var fi = 0; fi < Math.min(fsNews.length, 12); fi++) {
      var n = fsNews[fi];
      var s = n.seasonNumber;
      // Find a transfer with the matching season + reason
      var match = transfers.find(function(tr) {
        return tr.season === s && tr.reason && tr.reason.indexOf('财政告急') >= 0;
      });
      if (!match) {
        fireSaleNoCashMove.push('No transfer record for fire_sale: ' + (n.title || ''));
      }
    }

    var prizeMoneyMismatch = [];
    var cupResultMissing = [];
    // Continental cup ran on odd seasons (S17, S19, ...). For each completed
    // season after the start, check if the season's continental cup winner
    // produced a 冠军 result on at least one team's seasonRecord for that year.
    var seasonRecords = w.teamSeasonRecords || {};
    var honors = w.honorHistory || [];
    for (var hi = 0; hi < honors.length; hi++) {
      var h = honors[hi];
      var sn = h.seasonNumber;
      if (sn % 2 !== 1) continue; // continental cup runs only on odd seasons
      // Did at least one team get continentalCupResult === '冠军' in this season?
      var anyChamp = false;
      for (var tid2 in seasonRecords) {
        var arr = seasonRecords[tid2] || [];
        var rec = arr.find(function(rr) { return rr.seasonNumber === sn; });
        if (rec && rec.continentalCupResult === '冠军') {
          anyChamp = true;
          break;
        }
      }
      // Also check teamTrophies for any continental_cup type with this season
      var anyTrophy = false;
      for (var tid3 in (w.teamTrophies || {})) {
        var trs = w.teamTrophies[tid3] || [];
        if (trs.some(function(tr2) {
          return tr2.seasonNumber === sn && (tr2.type === 'mainland_cup' || tr2.type === 'southern_cup' || tr2.type === 'eastern_cup');
        })) {
          anyTrophy = true;
          break;
        }
      }
      if (anyTrophy && !anyChamp) {
        cupResultMissing.push({ season: sn, cupType: 'continental (trophy awarded but no record marker)' });
      }
    }

    return {
      retirementsStillInSquad: retirementsStillInSquad,
      transferDestMissingPlayer: transferDestMissingPlayer,
      transferSourceStillHas: transferSourceStillHas,
      fireSaleNoCashMove: fireSaleNoCashMove,
      prizeMoneyMismatch: prizeMoneyMismatch,
      cupResultMissing: cupResultMissing,
      transfersChecked: checked,
    };
  })()`)) as CrossValidation & { transfersChecked: number };

  console.log(JSON.stringify(xv, null, 2));

  // ── Persist ──
  fs.writeFileSync('/tmp/e2e-snapshots.json', JSON.stringify(snapshots, null, 2));
  fs.writeFileSync('/tmp/e2e-errors.txt', errors.join('\n') + '\n');

  // ── Detection logic ──
  const critical: string[] = [];
  const warnings: string[] = [];

  // Page errors / unhandled rejections
  const pageErrors = errors.filter(e => e.startsWith('PAGE ERROR:') || e.startsWith('PAGE CRASH') || e.startsWith('WEB ERROR:'));
  if (pageErrors.length > 0) {
    critical.push(`${pageErrors.length} pageerror/crash/weberror events (sample: ${pageErrors.slice(0, 3).join(' | ')})`);
  }
  const consoleErr = errors.filter(e => e.startsWith('ERROR:'));
  if (consoleErr.length > 0) {
    critical.push(`${consoleErr.length} console.error lines (sample: ${consoleErr.slice(0, 3).join(' | ')})`);
  }
  const consoleWarn = errors.filter(e => e.startsWith('WARNING:'));
  if (consoleWarn.length > 0) {
    warnings.push(`${consoleWarn.length} console.warning lines (sample: ${consoleWarn.slice(0, 3).join(' | ')})`);
  }
  if (errors.some(e => e.startsWith('SOFT_LOCK'))) {
    critical.push('Soft-lock observed: advance button stopped advancing seasons');
  }
  if (errors.some(e => e.startsWith('SOFT_TIMEOUT'))) {
    warnings.push(`Soft timeout — completed ${snapshots.length}/${TARGET_SEASONS} seasons in budget`);
  }
  if ((migrated?.financeTeams as number) === 0) {
    critical.push('Migration produced empty teamFinances — Phase H finance UI will be blank');
  }
  if (xv.retirementsStillInSquad.length > 0) {
    critical.push(`Cross-validation: ${xv.retirementsStillInSquad.length} retired players still in squads (sample: ${xv.retirementsStillInSquad.slice(0, 3).join('; ')})`);
  }
  if (xv.transferSourceStillHas.length > 0) {
    critical.push(`Cross-validation: ${xv.transferSourceStillHas.length} transfers where source still has the player (sample: ${xv.transferSourceStillHas.slice(0, 3).join('; ')})`);
  }
  if (xv.fireSaleNoCashMove.length > 0) {
    critical.push(`Cross-validation: ${xv.fireSaleNoCashMove.length} fire-sale news without matching transfer record`);
  }
  if (xv.cupResultMissing.length > 0) {
    critical.push(`Cross-validation: ${xv.cupResultMissing.length} continental cup mismatches`);
  }
  // Diversity checks
  if (snapshots.length >= 1) {
    const champCount: Record<string, number> = {};
    for (const s of snapshots) {
      if (s.l1Champion) champCount[s.l1Champion] = (champCount[s.l1Champion] || 0) + 1;
    }
    const allSameChamp = Object.keys(champCount).length === 1 && snapshots.length >= 5;
    if (allSameChamp) {
      critical.push(`All ${snapshots.length} seasons had same L1 champion: ${Object.keys(champCount)[0]}`);
    }
    for (const [team, n] of Object.entries(champCount)) {
      if (n >= 4) warnings.push(`Mild monopoly: team ${team} won L1 ${n} times in ${snapshots.length} seasons`);
    }
  }
  // Continental cups never running on odd seasons
  const oddSeasonsInRun = snapshots.filter(s => s.season % 2 === 1);
  const hasAnyContinentalWinner = oddSeasonsInRun.some(s => s.mainlandCupWinner || s.southernCupWinner || s.easternCupWinner);
  if (oddSeasonsInRun.length > 0 && !hasAnyContinentalWinner) {
    critical.push(`No continental cup completed in any of ${oddSeasonsInRun.length} odd seasons`);
  }
  // 0 retirements / 0 transfers
  if (snapshots.length >= 3) {
    const last = snapshots[snapshots.length - 1];
    const first = snapshots[0];
    if (last.retiredPlayers - first.retiredPlayers === 0) {
      critical.push('No retirements happened across the run — pipeline broken');
    }
    if (last.transferRecords - first.transferRecords === 0) {
      critical.push('No transfers happened across the run — pipeline broken');
    }
    // Awards growth check
    const awardsGrowth = (last.awardsHistory - first.awardsHistory) / Math.max(1, snapshots.length - 1);
    if (awardsGrowth < 4) {
      warnings.push(`Awards grew only ${awardsGrowth.toFixed(1)}/season (expected 4 — MVP, golden_boot, best_defender, young_player)`);
    }
  }
  // Perma-poor — find teams that stayed negative for 3+ seasons
  if (snapshots.length >= 3) {
    let negativeStreaks = 0;
    let prevNeg = snapshots[0].financeStats.teamsNegative;
    let consec = prevNeg > 0 ? 1 : 0;
    for (let i = 1; i < snapshots.length; i++) {
      const cur = snapshots[i].financeStats.teamsNegative;
      if (cur > 0 && cur >= prevNeg * 0.6) {
        consec++;
        if (consec >= 3) negativeStreaks = Math.max(negativeStreaks, cur);
      } else {
        consec = cur > 0 ? 1 : 0;
      }
      prevNeg = cur;
    }
    if (negativeStreaks > 5) {
      critical.push(`More than 5 teams stayed in negative cash for 3+ consecutive seasons (max ${negativeStreaks})`);
    }
  }
  // Cup winner === runner-up isn't directly observable here — runner-up info isn't in honor.
  // (Skipping for this quick run.)

  // candidatePool memory-leak warning
  const maxPool = snapshots.reduce((m, s) => Math.max(m, s.candidatePool), 0);
  if (maxPool > 50) warnings.push(`candidatePool peaked at ${maxPool} (>50 — possible memory leak)`);

  // Fire sales with negative-cash mismatch
  for (const s of snapshots) {
    if (s.financeStats.teamsNegative > 0 && s.fireSales === 0) {
      // Aggregated count across all seasons; this snap level — flag if every season has it
    }
  }
  const seasonsWithNegNoFireSale = snapshots.filter(s => s.financeStats.teamsNegative > 0 && s.fireSales === 0).length;
  if (seasonsWithNegNoFireSale >= 3) {
    warnings.push(`${seasonsWithNegNoFireSale} seasons had negative-cash teams but 0 fire-sales — eligibility check may be broken`);
  }

  // Std dev growth check
  if (snapshots.length >= 4) {
    const first = snapshots[0].financeStats.stdDev;
    const last = snapshots[snapshots.length - 1].financeStats.stdDev;
    if (last > first * 4) {
      warnings.push(`Finance std dev grew ${(last/first).toFixed(1)}x (from ${first.toFixed(0)} to ${last.toFixed(0)}) — possible Matthew effect drift`);
    }
  }

  // ── Build report ──
  const lines: string[] = [];
  lines.push(`# E2E Audit Report`);
  lines.push('');
  lines.push(`- Save: ${SAVE_PATH} (input version=${SAVE.version}, season=${SAVE.state?.world?.seasonState?.seasonNumber})`);
  lines.push(`- Migrated to v${migrated?.version}, season=${migrated?.season}, financeTeams=${migrated?.financeTeams}`);
  lines.push(`- Seasons advanced: ${snapshots.length} / ${TARGET_SEASONS}`);
  lines.push(`- Total advance clicks: ${totalAdvances}`);
  lines.push(`- Total elapsed: ${((Date.now() - startTime)/1000).toFixed(1)}s`);
  lines.push(`- Total errors collected: ${errors.length} (page errors: ${pageErrors.length}, console errors: ${consoleErr.length}, console warnings: ${consoleWarn.length})`);
  lines.push('');
  lines.push(`## 1. Summary`);
  lines.push('');
  const verdict = critical.length > 0
    ? 'DO NOT PLAY'
    : (warnings.length >= 3 ? 'CAUTION' : 'SAFE');
  lines.push(`**Verdict: ${verdict}**`);
  lines.push(`- Critical findings: ${critical.length}`);
  lines.push(`- Warning findings: ${warnings.length}`);
  lines.push('');
  lines.push(`## 2. Critical findings`);
  lines.push('');
  if (critical.length === 0) lines.push('_None._');
  else for (const c of critical) lines.push(`- ${c}`);
  lines.push('');
  lines.push(`## 3. Warning findings`);
  lines.push('');
  if (warnings.length === 0) lines.push('_None._');
  else for (const w of warnings) lines.push(`- ${w}`);
  lines.push('');
  lines.push(`## 4. Stats per season`);
  lines.push('');
  lines.push('| Season | L1 Champ | Retired | Transfers | FireSales | Awards | Inj | Sus | Cash p10/p50/p90 | Neg | MVP | GoldenBoot | Continental |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of snapshots) {
    const cont = [s.mainlandCupWinner && `M:${s.mainlandCupWinner}`, s.southernCupWinner && `S:${s.southernCupWinner}`, s.easternCupWinner && `E:${s.easternCupWinner}`].filter(Boolean).join(', ');
    lines.push(
      `| ${s.season} | ${s.l1Champion} | ${s.retiredPlayers} | ${s.transferRecords} | ${s.fireSales} | ${s.awardsHistory} | ${s.injuriesActive} | ${s.suspensionsActive} | ${s.financeStats.p10.toFixed(0)}/${s.financeStats.p50.toFixed(0)}/${s.financeStats.p90.toFixed(0)} | ${s.financeStats.teamsNegative} | ${s.mvp?.player ?? '-'} | ${s.goldenBoot ? `${s.goldenBoot.player}(${s.goldenBoot.goals})` : '-'} | ${cont || '-'} |`,
    );
  }
  lines.push('');
  lines.push(`## 5. Cross-validation`);
  lines.push('');
  lines.push(`- transfersChecked: ${xv.transfersChecked}`);
  lines.push(`- retirementsStillInSquad: ${xv.retirementsStillInSquad.length}`);
  if (xv.retirementsStillInSquad.length > 0) lines.push(`  - sample: ${xv.retirementsStillInSquad.slice(0, 5).join('; ')}`);
  lines.push(`- transferSourceStillHas: ${xv.transferSourceStillHas.length}`);
  if (xv.transferSourceStillHas.length > 0) lines.push(`  - sample: ${xv.transferSourceStillHas.slice(0, 5).join('; ')}`);
  lines.push(`- fireSaleNoCashMove: ${xv.fireSaleNoCashMove.length}`);
  lines.push(`- cupResultMissing: ${xv.cupResultMissing.length}`);
  lines.push('');
  lines.push(`## 6. Recommendations`);
  lines.push('');
  if (verdict === 'SAFE') {
    lines.push('- No blocking issues detected. Game should be playable.');
  } else {
    if (critical.length > 0) lines.push('- Resolve critical findings before user plays.');
    if (warnings.length > 0) lines.push('- Investigate warnings during next iteration cycle.');
  }
  lines.push('');
  fs.writeFileSync('/tmp/e2e-report.md', lines.join('\n'));

  // ── Console summary ──
  console.log('\n=== SUMMARY ===');
  console.log(`Verdict: ${verdict}`);
  console.log(`Snapshots captured: ${snapshots.length}/${TARGET_SEASONS}`);
  console.log(`Critical: ${critical.length} | Warnings: ${warnings.length}`);
  for (const c of critical) console.log('  CRITICAL:', c);
  for (const w of warnings) console.log('  WARNING:', w);

  await browser.close();
}

main().catch((err) => {
  console.error('AUDIT CRASHED:', err);
  fs.appendFileSync('/tmp/e2e-errors.txt', `\nAUDIT_CRASH: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
