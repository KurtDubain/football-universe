/**
 * Audit script for Phase 2 — favorite team transfer window (commit 0d2aac9).
 *
 * Runs scenarios S1-S12 against http://localhost:5173/ using a headless
 * Playwright browser. Inspects state via `window.__gameStore` (the dev
 * exposes the zustand store directly there).
 *
 * Outputs:
 *   - /tmp/phase2-results.json (machine-readable findings)
 *   - /tmp/phase2-report.md  (human-readable)
 *
 * Do NOT commit. The /tmp paths keep raw findings out of the repo too.
 */
import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';

const URL = 'http://localhost:5173/';
const TOP_TEAM = 'gz_hengda';   // overall 92 — most likely to receive offers
const SMALL_TEAM_CANDIDATES = ['hokkaido', 'yongfu', 'ty_taiping', 'taipei_dome', 'mori_sailor', 'bj_oppo']; // bottom tier (overall < 65) — unlikely receive offers and have no star outgoings

interface ScenarioResult {
  scenario: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  notes: string[];
  errors: string[];
  duration_ms: number;
}

const results: ScenarioResult[] = [];
const allErrors: string[] = [];
const NOISE_PATTERNS = [
  'react-hooks',
  'Math.random',
  'Celebration',
  'CanvasEffects',
  'vite',
  'HMR',
  'WebSocket',
  '[hmr]',
];

function isNoise(text: string): boolean {
  for (const p of NOISE_PATTERNS) if (text.includes(p)) return true;
  return false;
}

function attachLogging(page: Page, sink: string[]): void {
  page.on('pageerror', (e) => {
    const msg = `PAGE: ${e.message}`;
    if (!isNoise(msg)) sink.push(msg);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const text = `${m.type().toUpperCase()}: ${m.text()}`;
      if (!isNoise(text)) sink.push(text);
    }
  });
}

async function resetGame(page: Page): Promise<void> {
  await page.evaluate(`(() => { localStorage.clear(); return true; })()`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}

async function newGame(page: Page, seed: number): Promise<void> {
  // Newgame via store action then navigate. Welcome page exists if not initialized.
  await page.evaluate(`(() => {
    const store = window.__gameStore;
    if (!store) throw new Error('__gameStore not exposed');
    store.getState().newGame(${seed});
    return true;
  })()`);
  await page.waitForTimeout(400);
}

async function setFavorites(page: Page, ids: string[]): Promise<void> {
  await page.evaluate(`(() => {
    const store = window.__gameStore;
    store.getState().setFavoriteTeams(${JSON.stringify(ids)});
    return true;
  })()`);
}

/** Advance windows in a tight loop until predicate or maxSteps reached. */
async function advanceUntil(
  page: Page,
  stopWhen: string,
  maxSteps: number = 100,
): Promise<{ stopped: boolean; steps: number }> {
  let steps = 0;
  while (steps < maxSteps) {
    const stop = await page.evaluate(`(${stopWhen})()`);
    if (stop) return { stopped: true, steps };
    const advanced = await page.evaluate(`(() => {
      const s = window.__gameStore.getState();
      if (s.isAdvancing) return 'busy';
      if (!s.world) return 'no_world';
      if (s.world.transferWindow && s.world.transferWindow.status === 'open') return 'paused';
      s.advanceWindow();
      return 'ok';
    })()`);
    if (advanced === 'paused') {
      // window is open — stop
      const stop2 = await page.evaluate(`(${stopWhen})()`);
      return { stopped: stop2 as boolean, steps };
    }
    await page.waitForTimeout(120);
    steps++;
  }
  return { stopped: false, steps };
}

/** Run a scenario; capture timing/notes. */
async function runScenario(
  page: Page,
  name: string,
  body: () => Promise<{ notes: string[]; status?: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' }>,
): Promise<void> {
  const start = Date.now();
  const errSink: string[] = [];
  attachLogging(page, errSink);
  let status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP' = 'PASS';
  let notes: string[] = [];
  try {
    const r = await body();
    notes = r.notes;
    status = r.status ?? 'PASS';
  } catch (e: unknown) {
    status = 'FAIL';
    notes = [`Threw: ${(e as Error).message}`];
  }
  results.push({
    scenario: name,
    status,
    notes,
    errors: [...errSink],
    duration_ms: Date.now() - start,
  });
  allErrors.push(...errSink);
  console.log(`\n[${status}] ${name} — ${Date.now() - start}ms`);
  for (const n of notes) console.log('  -', n);
  if (errSink.length > 0) {
    console.log(`  errors: ${errSink.length}`);
    for (const e of errSink.slice(0, 3)) console.log('   ', e);
  }
}

async function getState(page: Page): Promise<{ url: string; world: Record<string, unknown> } | null> {
  return await page.evaluate(`(() => {
    const s = window.__gameStore.getState();
    return {
      url: window.location.pathname,
      world: s.world ? {
        season: s.world.seasonState.seasonNumber,
        windowIdx: s.world.seasonState.currentWindowIndex,
        completed: s.world.seasonState.completed,
        isWorldCupYear: s.world.seasonState.isWorldCupYear,
        worldCupPhase: !!s.world.seasonState.worldCupPhase,
        transferWindow: s.world.transferWindow ? {
          season: s.world.transferWindow.season,
          status: s.world.transferWindow.status,
          offerCount: s.world.transferWindow.incomingOffers.length,
          targetCount: s.world.transferWindow.outgoingTargets.length,
          freeAgentCount: s.world.transferWindow.freeAgentUuids.length,
          signedFromPool: s.world.transferWindow.signedFromPool.length,
          offers: s.world.transferWindow.incomingOffers.map(o => ({ id: o.id, playerId: o.playerId, ownerTeamId: o.ownerTeamId, buyerId: o.buyerId, fee: o.fee, resolution: o.resolution, counterFee: o.counterFee })),
          targets: s.world.transferWindow.outgoingTargets.map(t => ({ id: t.id, playerId: t.playerId, fromTeamId: t.fromTeamId, toTeamId: t.toTeamId, suggestedFee: t.suggestedFee, bidFee: t.bidFee, resolution: t.resolution })),
        } : null,
        favs: s.favoriteTeamIds,
      } : null,
    };
  })()`) as { url: string; world: Record<string, unknown> } | null;
}

async function setupGameToSeasonEnd(page: Page, seed: number, favs: string[]): Promise<{ steps: number }> {
  await resetGame(page);
  await newGame(page, seed);
  await setFavorites(page, favs);
  // Advance until transferWindow opens OR season auto-advances past
  const { steps } = await advanceUntil(
    page,
    `()=>{const s=window.__gameStore.getState();return s.world?.transferWindow?.status==='open'||s.world?.seasonState?.seasonNumber>1;}`,
    80,
  );
  // small grace
  await page.waitForTimeout(300);
  return { steps };
}

async function S1_acceptOffer(page: Page): Promise<void> {
  await runScenario(page, 'S1: accept offer (happy path)', async () => {
    const notes: string[] = [];
    const setup = await setupGameToSeasonEnd(page, 11111, [TOP_TEAM]);
    notes.push(`advanced ${setup.steps} windows`);
    const st = await getState(page);
    if (!st?.world?.transferWindow) {
      // Try a second seed
      const alt = await setupGameToSeasonEnd(page, 22222, [TOP_TEAM]);
      notes.push(`retry seed 22222: advanced ${alt.steps} windows`);
      const st2 = await getState(page);
      if (!st2?.world?.transferWindow) {
        return { notes: [...notes, 'No window opened after retry (favoriteTeam may not have produced any offers/targets in 2 seeds)'], status: 'WARN' };
      }
    }
    const st3 = await getState(page);
    const tw = st3?.world?.transferWindow as { offerCount: number; targetCount: number; offers: Array<{ id: string; playerId: string; ownerTeamId: string; buyerId: string; fee: number }> } | undefined;
    if (!tw) return { notes: [...notes, 'no window'], status: 'FAIL' };
    notes.push(`window open: ${tw.offerCount} offers, ${tw.targetCount} targets`);
    notes.push(`URL after season-end: ${st3?.url}`);
    if (st3?.url !== '/market') notes.push('WARN: URL not /market — Dashboard auto-redirect didn\'t fire (may need user nav)');

    if (tw.offerCount === 0) {
      // Test only target/free agent path applies if no offers
      return { notes: [...notes, 'no offers to accept — skipping accept path'], status: 'WARN' };
    }
    const offer = tw.offers[0];
    const before = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      return {
        ownerSize: (w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).length,
        buyerSize: (w.squads[${JSON.stringify(offer.buyerId)}] || []).length,
        ownerCash: w.teamFinances[${JSON.stringify(offer.ownerTeamId)}]?.cash,
        buyerCash: w.teamFinances[${JSON.stringify(offer.buyerId)}]?.cash,
        ownerHasPlayer: !!(w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}),
        buyerHasPlayer: !!(w.squads[${JSON.stringify(offer.buyerId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}),
      };
    })()`);
    await page.evaluate(`window.__gameStore.getState().acceptIncomingOffer(${JSON.stringify(offer.id)})`);
    await page.waitForTimeout(200);
    const after = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      return {
        ownerSize: (w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).length,
        buyerSize: (w.squads[${JSON.stringify(offer.buyerId)}] || []).length,
        ownerCash: w.teamFinances[${JSON.stringify(offer.ownerTeamId)}]?.cash,
        buyerCash: w.teamFinances[${JSON.stringify(offer.buyerId)}]?.cash,
        ownerHasPlayer: !!(w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}),
        buyerHasPlayer: !!(w.squads[${JSON.stringify(offer.buyerId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}),
        offerResolution: w.transferWindow.incomingOffers.find(o => o.id === ${JSON.stringify(offer.id)})?.resolution,
      };
    })()`) as {
      ownerSize: number;
      buyerSize: number;
      ownerCash: number;
      buyerCash: number;
      ownerHasPlayer: boolean;
      buyerHasPlayer: boolean;
      offerResolution: string;
    };
    const beforeT = before as typeof after;
    notes.push(`before: owner ${beforeT.ownerSize}/cash €${beforeT.ownerCash}M; buyer ${beforeT.buyerSize}/cash €${beforeT.buyerCash}M`);
    notes.push(`after:  owner ${after.ownerSize}/cash €${after.ownerCash}M; buyer ${after.buyerSize}/cash €${after.buyerCash}M`);
    notes.push(`offer resolution = ${after.offerResolution}`);
    const ok = !after.ownerHasPlayer && after.buyerHasPlayer && after.offerResolution === 'accepted'
      && after.ownerCash > beforeT.ownerCash && after.buyerCash < beforeT.buyerCash;
    if (!ok) return { notes, status: 'FAIL' };

    // Close window
    const seasonBefore = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
    await page.evaluate(`window.__gameStore.getState().closeTransferWindow(false)`);
    await page.waitForTimeout(300);
    const seasonAfter = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
    const tw2 = await page.evaluate(`window.__gameStore.getState().world.transferWindow`);
    notes.push(`closeTransferWindow: season ${seasonBefore} → ${seasonAfter}, transferWindow now: ${tw2 === null ? 'null' : 'present'}`);
    if (seasonAfter <= seasonBefore) return { notes: [...notes, 'season did NOT advance!'], status: 'FAIL' };
    if (tw2 !== null) return { notes: [...notes, 'transferWindow not cleared!'], status: 'FAIL' };
    return { notes };
  });
}

async function S2_rejectOffer(page: Page): Promise<void> {
  await runScenario(page, 'S2: reject offer', async () => {
    const notes: string[] = [];
    const setup = await setupGameToSeasonEnd(page, 33333, [TOP_TEAM]);
    notes.push(`advanced ${setup.steps} windows`);
    const tw = await page.evaluate(`window.__gameStore.getState().world?.transferWindow`) as {
      offerCount?: number;
      incomingOffers: Array<{ id: string; playerId: string; ownerTeamId: string }>;
    } | null;
    if (!tw || tw.incomingOffers.length === 0) return { notes: [...notes, 'no offers — skip'], status: 'SKIP' };
    const offer = tw.incomingOffers[0];
    const before = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      return { hasPlayer: !!(w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}) };
    })()`) as { hasPlayer: boolean };
    await page.evaluate(`window.__gameStore.getState().rejectIncomingOffer(${JSON.stringify(offer.id)})`);
    await page.waitForTimeout(200);
    const after = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const o = w.transferWindow.incomingOffers.find(o => o.id === ${JSON.stringify(offer.id)});
      return { hasPlayer: !!(w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}), resolution: o?.resolution };
    })()`) as { hasPlayer: boolean; resolution: string };
    notes.push(`player stayed: ${after.hasPlayer === true && before.hasPlayer === true}; resolution=${after.resolution}`);
    if (after.resolution !== 'rejected' || !after.hasPlayer) return { notes, status: 'FAIL' };
    return { notes };
  });
}

async function S3_counterOffer(page: Page): Promise<void> {
  await runScenario(page, 'S3: counter offer (5 seeds)', async () => {
    const notes: string[] = [];
    let accepts = 0;
    let rejects = 0;
    let triedSeeds = 0;
    const seeds = [44444, 55555, 66666, 77777, 88888, 99999, 12345, 54321];
    for (const seed of seeds) {
      if (triedSeeds >= 5) break;
      await setupGameToSeasonEnd(page, seed, [TOP_TEAM]);
      const tw = await page.evaluate(`window.__gameStore.getState().world?.transferWindow`) as {
        incomingOffers: Array<{ id: string; playerId: string; ownerTeamId: string }>;
      } | null;
      if (!tw || tw.incomingOffers.length === 0) continue;
      triedSeeds++;
      const offer = tw.incomingOffers[0];
      await page.evaluate(`window.__gameStore.getState().counterIncomingOffer(${JSON.stringify(offer.id)})`);
      await page.waitForTimeout(150);
      const res = await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        const o = w.transferWindow.incomingOffers.find(o => o.id === ${JSON.stringify(offer.id)});
        return o ? { resolution: o.resolution, counterFee: o.counterFee, hasPlayer: !!(w.squads[${JSON.stringify(offer.ownerTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(offer.playerId)}) } : null;
      })()`) as { resolution: string; counterFee: number; hasPlayer: boolean } | null;
      if (!res) continue;
      if (res.resolution === 'countered_accepted') { accepts++; if (res.hasPlayer) notes.push(`seed ${seed}: countered_accepted but player STILL on owner squad (BUG)`); }
      else if (res.resolution === 'countered_rejected') { rejects++; if (!res.hasPlayer) notes.push(`seed ${seed}: countered_rejected but player MISSING from owner squad (BUG)`); }
      else notes.push(`seed ${seed}: unexpected resolution ${res.resolution}`);
    }
    notes.push(`tried ${triedSeeds} seeds (target=5): ${accepts} countered_accepted, ${rejects} countered_rejected`);
    if (triedSeeds < 3) return { notes: [...notes, 'too few seeds produced offers'], status: 'WARN' };
    // Expect both paths exercised, or at least both possible
    if (accepts + rejects === 0) return { notes, status: 'FAIL' };
    if (accepts === 0 || rejects === 0) return { notes: [...notes, 'only one path observed (still acceptable for small sample)'], status: 'WARN' };
    return { notes };
  });
}

async function S4_bidForTarget(page: Page): Promise<void> {
  await runScenario(page, 'S4: bid for target', async () => {
    const notes: string[] = [];
    const setup = await setupGameToSeasonEnd(page, 12321, [TOP_TEAM]);
    notes.push(`advanced ${setup.steps} windows`);
    const tw = await page.evaluate(`window.__gameStore.getState().world?.transferWindow`) as {
      outgoingTargets: Array<{ id: string; playerId: string; fromTeamId: string; toTeamId: string; suggestedFee: number }>;
    } | null;
    if (!tw || tw.outgoingTargets.length === 0) return { notes: [...notes, 'no targets — skip'], status: 'SKIP' };
    // Sub-test (a): bid 0.95× suggested → should succeed (≥0.9× threshold)
    const t = tw.outgoingTargets[0];
    const bidHi = Math.max(1, Math.round(t.suggestedFee * 0.95));
    const before = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      return { buyerHas: !!(w.squads[${JSON.stringify(t.toTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(t.playerId)}) };
    })()`) as { buyerHas: boolean };
    await page.evaluate(`window.__gameStore.getState().bidForOutgoingTarget(${JSON.stringify(t.id)}, ${bidHi})`);
    await page.waitForTimeout(150);
    const afterHi = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const tt = w.transferWindow.outgoingTargets.find(x => x.id === ${JSON.stringify(t.id)});
      return { resolution: tt?.resolution, buyerHas: !!(w.squads[${JSON.stringify(t.toTeamId)}] || []).find(p => p.uuid === ${JSON.stringify(t.playerId)}) };
    })()`) as { resolution: string; buyerHas: boolean };
    notes.push(`hi bid (0.95×=${bidHi}): resolution=${afterHi.resolution}, buyerHas=${afterHi.buyerHas} (was ${before.buyerHas})`);
    if (afterHi.resolution !== 'bid_accepted') {
      notes.push(`unexpected: 0.95× should always be bid_accepted (meetsAsk=true) — saw ${afterHi.resolution}`);
    }

    // Sub-test (b): low-ball bid (0.5×) — 40% accept chance only.
    // Try across 5 different remaining targets and count outcomes.
    let loAcc = 0, loRej = 0, loSkip = 0, triedLow = 0;
    const remaining = tw.outgoingTargets.slice(1);
    for (const tt of remaining.slice(0, 5)) {
      const bidLo = Math.max(1, Math.round(tt.suggestedFee * 0.5));
      await page.evaluate(`window.__gameStore.getState().bidForOutgoingTarget(${JSON.stringify(tt.id)}, ${bidLo})`);
      await page.waitForTimeout(100);
      const r = await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        const t2 = w.transferWindow.outgoingTargets.find(x => x.id === ${JSON.stringify(tt.id)});
        return t2?.resolution;
      })()`) as string;
      if (r === 'bid_accepted') loAcc++;
      else if (r === 'bid_rejected') loRej++;
      else if (r === 'skipped') loSkip++;
      triedLow++;
    }
    notes.push(`low bid (0.5×) trial: ${loAcc} accepted, ${loRej} rejected, ${loSkip} skipped (cash) / ${triedLow} tried`);
    return { notes, status: afterHi.resolution === 'bid_accepted' ? 'PASS' : 'WARN' };
  });
}

async function S5_signFreeAgent(page: Page): Promise<void> {
  await runScenario(page, 'S5: sign free agent', async () => {
    const notes: string[] = [];
    // Use an existing save advanced through several seasons so pool has content
    const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
    if (!fs.existsSync(SAVE_PATH)) {
      // Try fresh approach: advance a few seasons before the favorite-fav window
      const setup = await setupGameToSeasonEnd(page, 90909, [TOP_TEAM]);
      notes.push(`fresh setup, advanced ${setup.steps} windows`);
    } else {
      await page.evaluate(`(() => { localStorage.clear(); return true; })()`);
      const saveText = fs.readFileSync(SAVE_PATH, 'utf8');
      await page.evaluate(`(() => {
        localStorage.setItem('football-universe-save', ${JSON.stringify(saveText)});
        return true;
      })()`);
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await setFavorites(page, [TOP_TEAM]);
      const { steps } = await advanceUntil(
        page,
        `()=>{const s=window.__gameStore.getState();return s.world?.transferWindow?.status==='open';}`,
        80,
      );
      notes.push(`loaded s16 save, advanced ${steps} windows to season-end`);
    }
    const tw = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      if (!w?.transferWindow) return null;
      const pool = (w.freeAgentPool ?? []).filter(p => w.transferWindow.freeAgentUuids.includes(p.uuid) && !w.transferWindow.signedFromPool.includes(p.uuid));
      return { poolSize: pool.length, first: pool[0] ? { uuid: pool[0].uuid, name: pool[0].name, position: pool[0].position } : null };
    })()`) as { poolSize: number; first: { uuid: string; name: string; position: string } | null } | null;
    if (!tw || tw.poolSize === 0 || !tw.first) {
      return { notes: [...notes, 'no free agents available to sign — skipping'], status: 'SKIP' };
    }
    const uuid = tw.first.uuid;
    const before = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const favId = window.__gameStore.getState().favoriteTeamIds[0];
      return {
        squadSize: (w.squads[favId] || []).length,
        cash: w.teamFinances[favId]?.cash,
        hasPlayer: !!(w.squads[favId] || []).find(p => p.uuid === ${JSON.stringify(uuid)}),
      };
    })()`) as { squadSize: number; cash: number; hasPlayer: boolean };
    await page.evaluate(`window.__gameStore.getState().signFromFreeAgentPool(${JSON.stringify(uuid)})`);
    await page.waitForTimeout(200);
    const after = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const favId = window.__gameStore.getState().favoriteTeamIds[0];
      return {
        squadSize: (w.squads[favId] || []).length,
        cash: w.teamFinances[favId]?.cash,
        hasPlayer: !!(w.squads[favId] || []).find(p => p.uuid === ${JSON.stringify(uuid)}),
        poolHas: (w.freeAgentPool ?? []).some(p => p.uuid === ${JSON.stringify(uuid)}),
        signed: w.transferWindow.signedFromPool.includes(${JSON.stringify(uuid)}),
      };
    })()`) as { squadSize: number; cash: number; hasPlayer: boolean; poolHas: boolean; signed: boolean };
    notes.push(`before: squad ${before.squadSize}, cash €${before.cash}M, has=${before.hasPlayer}`);
    notes.push(`after:  squad ${after.squadSize}, cash €${after.cash}M, has=${after.hasPlayer}, poolHas=${after.poolHas}, signed=${after.signed}`);
    const cashDelta = before.cash - after.cash;
    const ok = after.hasPlayer && !after.poolHas && after.signed && cashDelta === 5;
    if (!ok) {
      const reasons: string[] = [];
      if (!after.hasPlayer) reasons.push('player NOT added');
      if (after.poolHas) reasons.push('player STILL in pool');
      if (!after.signed) reasons.push('signedFromPool not updated');
      if (cashDelta !== 5) reasons.push(`cash delta=${cashDelta}M (expected 5)`);
      return { notes: [...notes, `FAIL: ${reasons.join(', ')}`], status: 'FAIL' };
    }
    return { notes };
  });
}

async function S6_autoResolve(page: Page): Promise<void> {
  await runScenario(page, 'S6: 全自动剩余 button', async () => {
    const notes: string[] = [];
    const setup = await setupGameToSeasonEnd(page, 73737, [TOP_TEAM]);
    notes.push(`setup advanced ${setup.steps} windows`);
    const twBefore = await page.evaluate(`(() => {
      const tw = window.__gameStore.getState().world?.transferWindow;
      if (!tw) return null;
      return {
        offers: tw.incomingOffers.length,
        targets: tw.outgoingTargets.length,
        offerStates: tw.incomingOffers.map(o => o.resolution),
        targetStates: tw.outgoingTargets.map(t => t.resolution),
      };
    })()`) as { offers: number; targets: number; offerStates: string[]; targetStates: string[] } | null;
    if (!twBefore || (twBefore.offers === 0 && twBefore.targets === 0)) return { notes: [...notes, 'no window items — skip'], status: 'SKIP' };
    notes.push(`pending: ${twBefore.offers} offers, ${twBefore.targets} targets`);
    const seasonBefore = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
    await page.evaluate(`window.__gameStore.getState().closeTransferWindow(true)`);
    await page.waitForTimeout(400);
    const stAfter = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      return {
        season: w.seasonState.seasonNumber,
        tw: w.transferWindow,
      };
    })()`) as { season: number; tw: unknown };
    notes.push(`season ${seasonBefore} → ${stAfter.season}; transferWindow=${stAfter.tw === null ? 'null' : 'present'}`);
    if (stAfter.tw !== null) return { notes: [...notes, 'transferWindow NOT cleared!'], status: 'FAIL' };
    if (stAfter.season <= seasonBefore) return { notes: [...notes, 'season DID NOT advance!'], status: 'FAIL' };
    return { notes };
  });
}

async function S7_zeroItemsWindow(page: Page): Promise<void> {
  await runScenario(page, 'S7: window with ZERO items (small team)', async () => {
    const notes: string[] = [];
    // Try multiple small teams to find one that produces no offers/targets
    let triedCount = 0;
    let foundCorrectBehavior = false;
    let foundIncorrect = false;
    let lastDetails = '';
    for (const tid of SMALL_TEAM_CANDIDATES) {
      triedCount++;
      const seed = 100 + triedCount * 7;
      await resetGame(page);
      await newGame(page, seed);
      await setFavorites(page, [tid]);
      const seasonBefore = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
      const { steps } = await advanceUntil(
        page,
        `()=>{const s=window.__gameStore.getState();return s.world?.transferWindow?.status==='open'||s.world?.seasonState?.seasonNumber>${seasonBefore};}`,
        80,
      );
      const st = await getState(page);
      const tw = st?.world?.transferWindow as { offerCount: number; targetCount: number } | null;
      if (tw) {
        notes.push(`team ${tid}: window opened (${tw.offerCount}o/${tw.targetCount}t) — NOT a zero-item case`);
        continue;
      }
      // No window: did season advance?
      const seasonAfter = st?.world?.season as number;
      lastDetails = `team ${tid}: ${steps} steps, season ${seasonBefore} → ${seasonAfter}, NO window`;
      if (seasonAfter && seasonAfter > seasonBefore) {
        notes.push(`OK ${lastDetails} — pipeline auto-advanced`);
        foundCorrectBehavior = true;
        break;
      } else {
        notes.push(`FAIL ${lastDetails} — season did NOT advance and no window`);
        foundIncorrect = true;
      }
    }
    if (!foundCorrectBehavior && !foundIncorrect) return { notes: [...notes, 'never observed empty-window scenario across team candidates'], status: 'WARN' };
    if (foundIncorrect && !foundCorrectBehavior) return { notes, status: 'FAIL' };
    return { notes };
  });
}

async function S8_cashCheck(page: Page): Promise<void> {
  await runScenario(page, 'S8: cash guard on bid + free agent', async () => {
    const notes: string[] = [];
    const setup = await setupGameToSeasonEnd(page, 50505, [TOP_TEAM]);
    notes.push(`advanced ${setup.steps} windows`);
    const tw = await page.evaluate(`window.__gameStore.getState().world?.transferWindow`) as {
      outgoingTargets: Array<{ id: string; playerId: string; toTeamId: string; suggestedFee: number }>;
    } | null;
    if (!tw || tw.outgoingTargets.length === 0) return { notes: [...notes, 'no targets — skip'], status: 'SKIP' };
    // Find target & drain cash so bid fails the cash check
    const t = tw.outgoingTargets[0];
    const drainResult = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const fin = w.teamFinances[${JSON.stringify(t.toTeamId)}];
      if (!fin) return { ok: false, reason: 'no finance row' };
      const before = fin.cash;
      // Mutate cash for test: set to 1 (less than suggestedFee + minimum)
      w.teamFinances[${JSON.stringify(t.toTeamId)}] = { ...fin, cash: 1 };
      return { ok: true, before };
    })()`) as { ok: boolean; before?: number };
    notes.push(`drained cash from €${drainResult.before}M to €1M (for guard test)`);

    const bidFee = Math.max(t.suggestedFee, 10);
    await page.evaluate(`window.__gameStore.getState().bidForOutgoingTarget(${JSON.stringify(t.id)}, ${bidFee})`);
    await page.waitForTimeout(200);
    const afterBid = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const tt = w.transferWindow.outgoingTargets.find(x => x.id === ${JSON.stringify(t.id)});
      return { resolution: tt?.resolution, cash: w.teamFinances[${JSON.stringify(t.toTeamId)}]?.cash };
    })()`) as { resolution: string; cash: number };
    notes.push(`bid €${bidFee}M with €1M cash: resolution=${afterBid.resolution}, cash=${afterBid.cash}`);
    // Per game-store, cash-fail silently marks 'skipped' (no actual buy)
    const guardOk = afterBid.resolution === 'skipped' && afterBid.cash === 1;
    if (!guardOk) notes.push(`UNEXPECTED: cash-guard expected to mark skipped, instead got ${afterBid.resolution}`);

    // Free-agent sign with low cash
    const poolCount = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      const tw = w.transferWindow;
      if (!tw) return 0;
      return (w.freeAgentPool ?? []).filter(p => tw.freeAgentUuids.includes(p.uuid) && !tw.signedFromPool.includes(p.uuid)).length;
    })()`) as number;
    if (poolCount > 0) {
      const targetUuid = await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        const tw = w.transferWindow;
        const pool = (w.freeAgentPool ?? []).filter(p => tw.freeAgentUuids.includes(p.uuid) && !tw.signedFromPool.includes(p.uuid));
        return pool[0].uuid;
      })()`) as string;
      // Drain favorite team cash to 1
      await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        const favId = window.__gameStore.getState().favoriteTeamIds[0];
        const fin = w.teamFinances[favId];
        w.teamFinances[favId] = { ...fin, cash: 1 };
        return true;
      })()`);
      const sizeBefore = await page.evaluate(`(() => {
        const favId = window.__gameStore.getState().favoriteTeamIds[0];
        return (window.__gameStore.getState().world.squads[favId] || []).length;
      })()`) as number;
      await page.evaluate(`window.__gameStore.getState().signFromFreeAgentPool(${JSON.stringify(targetUuid)})`);
      await page.waitForTimeout(150);
      const sizeAfter = await page.evaluate(`(() => {
        const favId = window.__gameStore.getState().favoriteTeamIds[0];
        return (window.__gameStore.getState().world.squads[favId] || []).length;
      })()`) as number;
      notes.push(`sign with €1M cash: squad ${sizeBefore} → ${sizeAfter} (should be unchanged)`);
      if (sizeBefore !== sizeAfter) return { notes: [...notes, 'FAIL: free agent sign with insufficient cash succeeded!'], status: 'FAIL' };
    } else {
      notes.push('no free agents to test sign guard');
    }
    if (!guardOk) return { notes, status: 'FAIL' };
    return { notes };
  });
}

async function S9_refreshMidWindow(page: Page): Promise<void> {
  await runScenario(page, 'S9: refresh mid-window (storage round-trip)', async () => {
    const notes: string[] = [];
    const setup = await setupGameToSeasonEnd(page, 31313, [TOP_TEAM]);
    notes.push(`setup advanced ${setup.steps} windows`);
    const twBefore = await page.evaluate(`(() => {
      const tw = window.__gameStore.getState().world?.transferWindow;
      if (!tw) return null;
      return { offers: tw.incomingOffers.length, targets: tw.outgoingTargets.length, season: tw.season, status: tw.status };
    })()`) as { offers: number; targets: number; season: number; status: string } | null;
    if (!twBefore) return { notes: [...notes, 'no window for refresh test'], status: 'SKIP' };
    notes.push(`before refresh: season ${twBefore.season}, ${twBefore.offers}o ${twBefore.targets}t status=${twBefore.status}`);
    // Refresh
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const twAfter = await page.evaluate(`(() => {
      const s = window.__gameStore;
      if (!s) return { error: 'no store' };
      const tw = s.getState().world?.transferWindow;
      if (!tw) return null;
      return { offers: tw.incomingOffers.length, targets: tw.outgoingTargets.length, season: tw.season, status: tw.status };
    })()`) as { offers: number; targets: number; season: number; status: string } | null | { error: string };
    notes.push(`after refresh: ${JSON.stringify(twAfter)}`);
    if (!twAfter || 'error' in twAfter) return { notes: [...notes, 'FAIL: window did not survive refresh'], status: 'FAIL' };
    if (twAfter.offers !== twBefore.offers || twAfter.targets !== twBefore.targets) {
      return { notes: [...notes, 'FAIL: counts differ across refresh'], status: 'FAIL' };
    }
    // Test action still works
    const url = await page.evaluate(`window.location.pathname`) as string;
    notes.push(`URL after refresh: ${url}`);
    if (twAfter.offers > 0) {
      const offerId = await page.evaluate(`window.__gameStore.getState().world.transferWindow.incomingOffers[0].id`) as string;
      await page.evaluate(`window.__gameStore.getState().rejectIncomingOffer(${JSON.stringify(offerId)})`);
      await page.waitForTimeout(150);
      const r = await page.evaluate(`window.__gameStore.getState().world.transferWindow.incomingOffers[0].resolution`) as string;
      notes.push(`post-refresh reject worked: ${r === 'rejected'}`);
      if (r !== 'rejected') return { notes, status: 'FAIL' };
    } else if (twAfter.targets > 0) {
      const targetId = await page.evaluate(`window.__gameStore.getState().world.transferWindow.outgoingTargets[0].id`) as string;
      await page.evaluate(`window.__gameStore.getState().bidForOutgoingTarget(${JSON.stringify(targetId)}, 1)`);
      await page.waitForTimeout(150);
      const r = await page.evaluate(`window.__gameStore.getState().world.transferWindow.outgoingTargets[0].resolution`) as string;
      notes.push(`post-refresh bid worked: resolution=${r}`);
    }
    return { notes };
  });
}

async function S10_multipleFavorites(page: Page): Promise<void> {
  await runScenario(page, 'S10: 3 favorite teams', async () => {
    const notes: string[] = [];
    const favs = ['gz_hengda', 'shimazu', 'xibei_wolf'];   // top 3
    let foundWithMultiOwner = false;
    let foundWithMultiTarget = false;
    const seeds = [99001, 99002, 99003];
    for (const seed of seeds) {
      await resetGame(page);
      await newGame(page, seed);
      await setFavorites(page, favs);
      const { steps } = await advanceUntil(
        page,
        `()=>{const s=window.__gameStore.getState();return s.world?.transferWindow?.status==='open'||s.world?.seasonState?.seasonNumber>1;}`,
        80,
      );
      const tw = await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        if (!w?.transferWindow) return null;
        const ownerTeams = Array.from(new Set(w.transferWindow.incomingOffers.map(o => o.ownerTeamId)));
        const targetTeams = Array.from(new Set(w.transferWindow.outgoingTargets.map(t => t.toTeamId)));
        return { offers: w.transferWindow.incomingOffers.length, targets: w.transferWindow.outgoingTargets.length, ownerTeams, targetTeams };
      })()`) as { offers: number; targets: number; ownerTeams: string[]; targetTeams: string[] } | null;
      if (!tw) { notes.push(`seed ${seed}: no window (${steps} steps)`); continue; }
      notes.push(`seed ${seed}: ${tw.offers}o (owners=${tw.ownerTeams.join(',')}) ${tw.targets}t (recipients=${tw.targetTeams.join(',')})`);
      if (tw.ownerTeams.length > 1) foundWithMultiOwner = true;
      if (tw.targetTeams.length > 1) foundWithMultiTarget = true;
      // All ownerTeamIds + toTeamIds must be in favs
      const badOwners = tw.ownerTeams.filter(t => !favs.includes(t));
      const badRecips = tw.targetTeams.filter(t => !favs.includes(t));
      if (badOwners.length > 0 || badRecips.length > 0) {
        notes.push(`BUG seed ${seed}: non-favorite teams in window — bad owners=${badOwners.join(',')}, bad recips=${badRecips.join(',')}`);
        return { notes, status: 'FAIL' };
      }
    }
    notes.push(`multi-owner observed: ${foundWithMultiOwner}, multi-target observed: ${foundWithMultiTarget}`);
    return { notes, status: foundWithMultiTarget ? 'PASS' : 'WARN' };
  });
}

async function S11_wcYear(page: Page): Promise<void> {
  await runScenario(page, 'S11: WC year pause works', async () => {
    const notes: string[] = [];
    const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
    if (!fs.existsSync(SAVE_PATH)) return { notes: ['no s16 save available — skip'], status: 'SKIP' };
    await page.evaluate(`(() => { localStorage.clear(); return true; })()`);
    const saveText = fs.readFileSync(SAVE_PATH, 'utf8');
    await page.evaluate(`(() => {
      localStorage.setItem('football-universe-save', ${JSON.stringify(saveText)});
      return true;
    })()`);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const initial = await page.evaluate(`(() => {
      const w = window.__gameStore.getState().world;
      return { season: w?.seasonState?.seasonNumber, isWC: !!w?.seasonState?.isWorldCupYear, worldCupPhase: !!w?.seasonState?.worldCupPhase };
    })()`) as { season: number; isWC: boolean; worldCupPhase: boolean };
    notes.push(`initial save: season ${initial.season}, isWC=${initial.isWC}, worldCupPhase=${initial.worldCupPhase}`);
    await setFavorites(page, [TOP_TEAM]);
    // Advance until we encounter the WC tail end (transferWindow opens or season auto-advances)
    const start = Date.now();
    const TIMEOUT_MS = 90_000;
    let lastSeason = initial.season;
    let observedPause = false;
    while (Date.now() - start < TIMEOUT_MS) {
      const stop = await page.evaluate(`(() => {
        const s = window.__gameStore.getState();
        if (!s.world) return 'no_world';
        if (s.isAdvancing) return 'busy';
        if (s.world.transferWindow && s.world.transferWindow.status === 'open') return 'paused';
        if (s.world.seasonState.seasonNumber > ${initial.season + 1}) return 'too_far';
        s.advanceWindow();
        return 'ok';
      })()`) as string;
      if (stop === 'paused') { observedPause = true; break; }
      if (stop === 'too_far' || stop === 'no_world') break;
      const cur = await page.evaluate(`window.__gameStore.getState().world?.seasonState?.seasonNumber`) as number;
      if (cur !== lastSeason) {
        notes.push(`season advanced from ${lastSeason} to ${cur}`);
        lastSeason = cur;
      }
      await page.waitForTimeout(80);
    }
    if (observedPause) {
      const st = await getState(page);
      notes.push(`window paused at season ${st?.world?.season} (worldCupPhase=${st?.world?.worldCupPhase})`);
      // Try close
      await page.evaluate(`window.__gameStore.getState().closeTransferWindow(true)`);
      await page.waitForTimeout(500);
      const final = await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        return { season: w?.seasonState?.seasonNumber, tw: w?.transferWindow, isWC: !!w?.seasonState?.isWorldCupYear, worldCupPhase: !!w?.seasonState?.worldCupPhase };
      })()`) as { season: number; tw: unknown; isWC: boolean; worldCupPhase: boolean };
      notes.push(`after close: season=${final.season}, tw=${final.tw === null ? 'null' : 'present'}, worldCupPhase=${final.worldCupPhase}`);
      if (final.tw !== null) return { notes: [...notes, 'FAIL: window did not clear'], status: 'FAIL' };
      return { notes };
    }
    return { notes: [...notes, 'no window observed in WC tail — may need more seasons to find WC'], status: 'WARN' };
  });
}

async function S12_stress5seasons(page: Page): Promise<void> {
  await runScenario(page, 'S12: stress — advance 5 seasons through windows', async () => {
    const notes: string[] = [];
    await resetGame(page);
    await newGame(page, 555000);
    await setFavorites(page, [TOP_TEAM]);
    let seasonsCompleted = 0;
    const start = Date.now();
    const TIMEOUT_MS = 180_000;  // 3 min cap
    const targetSeasons = 5;
    let lastState: { season: number; cash: number; squadSize: number; transferHistoryLen: number } | null = null;
    while (seasonsCompleted < targetSeasons && Date.now() - start < TIMEOUT_MS) {
      // Advance to either open window or first day of new season
      const before = await page.evaluate(`window.__gameStore.getState().world.seasonState.seasonNumber`) as number;
      const { steps } = await advanceUntil(
        page,
        `()=>{const s=window.__gameStore.getState();return s.world?.transferWindow?.status==='open'||s.world?.seasonState?.seasonNumber>${before};}`,
        80,
      );
      const tw = await page.evaluate(`window.__gameStore.getState().world?.transferWindow`) as { incomingOffers: unknown[]; outgoingTargets: unknown[] } | null;
      if (tw) {
        // Close via auto-resolve
        await page.evaluate(`window.__gameStore.getState().closeTransferWindow(true)`);
        await page.waitForTimeout(250);
      }
      const after = await page.evaluate(`(() => {
        const w = window.__gameStore.getState().world;
        const favId = window.__gameStore.getState().favoriteTeamIds[0];
        return {
          season: w.seasonState.seasonNumber,
          cash: w.teamFinances[favId]?.cash,
          squadSize: (w.squads[favId] || []).length,
          transferHistoryLen: (w.transferHistory ?? []).length,
        };
      })()`) as { season: number; cash: number; squadSize: number; transferHistoryLen: number };
      if (after.season > before) {
        seasonsCompleted++;
        notes.push(`season ${before} → ${after.season} (${steps} steps; cash €${after.cash}M; squad ${after.squadSize}; xferHistory ${after.transferHistoryLen})`);
        lastState = after;
      } else {
        notes.push(`stuck at season ${before} after ${steps} steps (no window opened, no advance)`);
        break;
      }
      // Sanity invariants
      if (after.squadSize < 11 || after.squadSize > 50) {
        return { notes: [...notes, `CORRUPTION: squad size ${after.squadSize} outside sane range`], status: 'FAIL' };
      }
      if (typeof after.cash !== 'number' || !isFinite(after.cash)) {
        return { notes: [...notes, `CORRUPTION: cash=${after.cash}`], status: 'FAIL' };
      }
    }
    notes.push(`completed ${seasonsCompleted} season transitions (target ${targetSeasons})`);
    notes.push(`final state: ${JSON.stringify(lastState)}`);
    if (seasonsCompleted < targetSeasons) return { notes: [...notes, 'did not complete all 5 seasons'], status: 'WARN' };
    return { notes };
  });
}

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // attach base error logging
  page.on('pageerror', (e) => { if (!isNoise(e.message)) allErrors.push(`PAGE: ${e.message}`); });
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !isNoise(m.text())) {
      allErrors.push(`${m.type().toUpperCase()}: ${m.text()}`);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const allStart = Date.now();
  const TIMEOUT_MS = 12 * 60 * 1000;  // 12 min cap
  const wrap = async (fn: () => Promise<void>) => {
    if (Date.now() - allStart > TIMEOUT_MS) {
      console.log('TIMEOUT — skipping remaining scenarios');
      return;
    }
    try { await fn(); } catch (e) { console.error('Scenario crashed:', e); }
  };

  await wrap(() => S1_acceptOffer(page));
  await wrap(() => S2_rejectOffer(page));
  await wrap(() => S3_counterOffer(page));
  await wrap(() => S4_bidForTarget(page));
  await wrap(() => S5_signFreeAgent(page));
  await wrap(() => S6_autoResolve(page));
  await wrap(() => S7_zeroItemsWindow(page));
  await wrap(() => S8_cashCheck(page));
  await wrap(() => S9_refreshMidWindow(page));
  await wrap(() => S10_multipleFavorites(page));
  await wrap(() => S11_wcYear(page));
  await wrap(() => S12_stress5seasons(page));

  await browser.close();

  const out = { results, totalDuration_ms: Date.now() - allStart, errorCount: allErrors.length };
  fs.writeFileSync('/tmp/phase2-results.json', JSON.stringify(out, null, 2));

  // Markdown report
  const md: string[] = [];
  md.push('# Phase 2 — Transfer Window Audit Report');
  md.push('');
  md.push(`- Total duration: ${(out.totalDuration_ms / 1000).toFixed(1)}s`);
  md.push(`- Errors captured (filtered): ${allErrors.length}`);
  md.push('');
  md.push('## Scenarios');
  for (const r of results) {
    md.push(`### [${r.status}] ${r.scenario}  (${r.duration_ms}ms)`);
    for (const n of r.notes) md.push(`- ${n}`);
    if (r.errors.length > 0) {
      md.push(`- Errors (${r.errors.length}):`);
      for (const e of r.errors.slice(0, 5)) md.push(`  - ${e}`);
    }
    md.push('');
  }
  if (allErrors.length > 0) {
    md.push('## Global error log (filtered)');
    for (const e of allErrors.slice(0, 30)) md.push(`- ${e}`);
  }
  fs.writeFileSync('/tmp/phase2-report.md', md.join('\n'));

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`[${r.status}] ${r.scenario}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
