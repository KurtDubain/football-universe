/**
 * UI consistency sweep — loads every page under a real save and detects render bugs.
 *
 * Run: pnpm tsx scripts/audit-ui.ts
 */
import { chromium, type Page, type ConsoleMessage } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const DEV_URL = 'http://localhost:5173';
const SAVE_PATH = '/Users/mutu/Downloads/football-universe-s16.json';
const OUT_DIR = '/tmp';
const STORAGE_KEY = 'football-universe-save';

type RouteResult = {
  route: string;
  name: string;
  ok: boolean;
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
  network404: string[];
  contentChecks: {
    hasContent: boolean;
    bodyHeight: number;
    mainHeight: number;
    mainTextLen: number;
    badText: string[];
    title: string;
    enabledButtons: number;
    disabledButtons: number;
    domSize: number;
  };
  special?: Record<string, unknown>;
  skipped?: boolean;
};

function makeRouteHandlers(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const network404: string[] = [];

  const onPageError = (err: Error) => {
    pageErrors.push(err.message);
  };
  const onConsole = (msg: ConsoleMessage) => {
    const t = msg.type();
    if (t === 'error') consoleErrors.push(msg.text());
    else if (t === 'warning') consoleWarnings.push(msg.text());
  };
  const onResponse = (resp: { status: () => number; url: () => string }) => {
    if (resp.status() >= 400) {
      network404.push(`${resp.status()} ${resp.url()}`);
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  return {
    drain() {
      const out = {
        pageErrors: [...pageErrors],
        consoleErrors: [...consoleErrors],
        consoleWarnings: [...consoleWarnings],
        network404: [...network404],
      };
      pageErrors.length = 0;
      consoleErrors.length = 0;
      consoleWarnings.length = 0;
      network404.length = 0;
      return out;
    },
  };
}

async function injectSave(page: Page) {
  const raw = fs.readFileSync(SAVE_PATH, 'utf8');
  // Make sure parsed
  JSON.parse(raw);
  // Navigate to origin first so we have access to localStorage, then write once.
  // We DO NOT use addInitScript because that re-runs on every navigation and
  // would clobber any in-app mutations (like advanceWindow).
  await page.goto(DEV_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
  }, { key: STORAGE_KEY, value: raw });
}

async function checkPage(page: Page) {
  return page.evaluate(() => {
    const body = document.body;
    const title = document.title || '';
    const text = body.innerText || '';
    const html = body.innerHTML || '';
    const bad: string[] = [];
    const patterns: Array<[RegExp, string]> = [
      [/Cannot read/i, 'Cannot read'],
      [/Cannot read properties of (undefined|null)/i, 'Cannot read properties'],
      // crude — exclude placeholder dashes
      [/(?<![\w-])undefined(?![\w-])/, 'undefined token'],
      [/(?<![\w-])NaN(?![\w-])/, 'NaN token'],
      [/\[object Object\]/, '[object Object]'],
    ];
    for (const [re, label] of patterns) {
      const m = re.exec(text);
      if (m) bad.push(`${label}: …${text.substring(Math.max(0, m.index - 20), m.index + 40)}…`);
    }
    const hasErrorBoundary = !!document.querySelector('[class*="error-boundary"], #react-error');
    if (hasErrorBoundary) bad.push('error-boundary element present');

    // Try to identify the main content area — sidebar text gets included in
    // body.innerText, so a route can render an empty content panel and still
    // look "full". Use main / [role=main] / body if all else fails.
    const main = document.querySelector('main') ?? document.querySelector('[role="main"]') ?? document.body;
    const mainText = (main as HTMLElement).innerText || '';
    const mainHeight = (main as HTMLElement).getBoundingClientRect().height;

    const buttons = Array.from(document.querySelectorAll('button'));
    let enabled = 0, disabled = 0;
    for (const b of buttons) {
      if ((b as HTMLButtonElement).disabled) disabled++; else enabled++;
    }
    const bodyHeight = body.getBoundingClientRect().height;
    return {
      hasContent: text.trim().length > 0,
      bodyHeight,
      mainHeight,
      mainTextLen: mainText.length,
      badText: bad,
      title,
      enabledButtons: enabled,
      disabledButtons: disabled,
      domSize: html.length,
    };
  });
}

async function specialChecks(page: Page, name: string): Promise<Record<string, unknown> | undefined> {
  try {
    // Universal "fallback / not-found" check — every route should have real content
    const fallback = await page.evaluate(() => {
      const text = (document.querySelector('main')?.textContent || document.body.innerText || '').trim();
      const fallbackPhrases = ['未找到联赛配置', '未找到该球队', '未找到该球员', '未找到该教练', '未找到', '正在加载...', '本赛季不是环球冠军杯年', '本赛季不是洲际杯年'];
      const matched = fallbackPhrases.filter(p => text.includes(p));
      return { fallbackPhrases: matched, mainTextSnippet: text.substring(0, 200) };
    });

    if (name.startsWith('team-')) {
      const r = await page.evaluate(() => {
        const text = document.body.innerText;
        const financeMatch = /(财政|资金|Finance|Cash|周转|现金|账户)/.test(text);
        const trophyChips = document.querySelectorAll('[class*="trophy"], [aria-label*="trophy"]').length;
        const seasonRow = /\d+赛季|S\d|赛季 ?\d|第\d+赛季/.test(text);
        return { financePanel: financeMatch, seasonRowVisible: seasonRow, trophyChipsCount: trophyChips };
      });
      return { ...r, ...fallback };
    }
    if (name === 'legends') {
      const r = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent || '');
        const tabBtns = Array.from(document.querySelectorAll('[role="tab"], [class*="tab"]')).map(b => b.textContent || '');
        const allBtns = [...buttons, ...tabBtns].join(' || ');
        const hasPlayerTab = /退役球员|球员|player/i.test(allBtns);
        const hasCoachTab = /退役教练|教练|coach/i.test(allBtns);
        const isEmpty = /尚无退役球员|尚无名人|开始按概率退役/.test(document.body.innerText);
        return { hasPlayerTab, hasCoachTab, isEmpty };
      });
      return { ...r, ...fallback };
    }
    if (name === 'transfers') {
      const r = await page.evaluate(() => {
        const text = document.body.innerText;
        const hasArrow = /→|->|⇒|⇨|->|=>|至 |加盟/.test(text);
        const recordCount = document.querySelectorAll('tr, [class*="transfer"], [class*="row"]').length;
        return { hasArrow, hasRecords: recordCount > 1, recordCount };
      });
      return { ...r, ...fallback };
    }
    if (name === 'history') {
      const r = await page.evaluate(() => {
        const text = document.body.innerText;
        const hasWealth = /财富|身价|总财富|身家|资金/.test(text);
        return { hasWealthSection: hasWealth };
      });
      return { ...r, ...fallback };
    }
    if (name === 'dashboard') {
      const r = await page.evaluate(() => {
        const text = document.body.innerText;
        const financeChip = /资金|Cash|财政|💰|￥|¥|账户/.test(text);
        const negativeBanner = /负债|破产|负数|亏损/.test(text);
        return { financeChipPresent: financeChip, negativeBanner };
      });
      return { ...r, ...fallback };
    }
    if (name.startsWith('player-')) {
      const r = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          retiredFallback: /已退役|退役|retired/i.test(text),
          injurySection: /伤病|injuries/i.test(text),
        };
      });
      return { ...r, ...fallback };
    }
    if (name.startsWith('coach-')) {
      const r = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          retiredFallback: /已退役|退役|retired/i.test(text),
          rivalrySection: /宿敌|对手|rivalr/i.test(text),
        };
      });
      return { ...r, ...fallback };
    }
    return fallback;
  } catch (e) {
    return { specialErr: String(e) };
  }
}

async function main() {
  if (!fs.existsSync(SAVE_PATH)) {
    console.error('save not found:', SAVE_PATH);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await injectSave(page);

  // Boot — reload to bring up the app under the persisted save.
  console.log('Booting…');
  const handlers = makeRouteHandlers(page);
  await page.goto(DEV_URL + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Try to advance one season. Find the advance button and click until window resets.
  console.log('Trying to advance one season…');
  let advanced = false;
  try {
    // Initial seasonState.calendar length to detect rollover
    const initialSeason = await page.evaluate(() => {
      const raw = localStorage.getItem('football-universe-save') || '{}';
      try {
        const parsed = JSON.parse(raw);
        return parsed?.state?.world?.seasonState?.seasonNumber ?? 0;
      } catch {
        return -1;
      }
    });
    console.log('  initial season:', initialSeason);
    let safety = 80; // 48 windows + buffer
    while (safety-- > 0) {
      const btn = await page.$('button:has-text("推进"), button:has-text("Advance"), button:has-text("⏭")');
      if (!btn) break;
      const dis = await btn.getAttribute('disabled');
      if (dis !== null) break;
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(50);
      const cur = await page.evaluate(() => {
        try {
          const parsed = JSON.parse(localStorage.getItem('football-universe-save') || '{}');
          return parsed?.state?.world?.seasonState?.seasonNumber ?? 0;
        } catch { return -1; }
      });
      if (cur > initialSeason) { advanced = true; break; }
    }
  } catch (e) {
    console.log('  advance err:', e);
  }
  console.log('  advanced one season:', advanced);

  // Reset error buffers from boot
  handlers.drain();

  // Wait final settle
  await page.waitForTimeout(800);

  // Pick valid IDs from current world
  const ids = await page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('football-universe-save') || '{}');
      const w = parsed?.state?.world;
      if (!w) return null;
      const teamStates = w.teamStates || {};
      const teamIds = Object.keys(teamStates);
      const squads = w.squads || {};
      // Pick a top-rated player from the highest-reputation squad as a stand-in
      // for "top scorer" — we don't have a populated playerStats this early.
      let topPlayerId: string | undefined;
      const teamBases = w.teamBases || {};
      const sortedTeams = teamIds.slice().sort((a, b) => (teamBases[b]?.reputation ?? 0) - (teamBases[a]?.reputation ?? 0));
      for (const tid of sortedTeams) {
        const arr = (squads as any)[tid] as Array<any>;
        if (!arr || arr.length === 0) continue;
        const ranked = arr.slice().sort((p1: any, p2: any) => (p2.rating ?? 0) - (p1.rating ?? 0));
        topPlayerId = ranked[0]?.uuid;
        if (topPlayerId) break;
      }
      // retirement
      const retiredPlayers: string[] = [];
      const ret = w.retirementHistory || [];
      for (const r of ret.slice(0, 5)) {
        if (r?.uuid) retiredPlayers.push(r.uuid);
        else if (r?.playerId) retiredPlayers.push(r.playerId);
      }
      // coaches
      const coachStates = w.coachStates || {};
      const coachIds = Object.keys(coachStates).filter(cid => !coachStates[cid]?.isUnemployed);
      const retiredCoaches: string[] = [];
      const cret = w.coachRetirementHistory || [];
      for (const r of cret.slice(0, 5)) {
        if (r?.id) retiredCoaches.push(r.id);
        else if (r?.coachId) retiredCoaches.push(r.coachId);
      }
      return {
        teamIds: teamIds.slice(0, 5),
        topPlayerId,
        retiredPlayers,
        coachIds: coachIds.slice(0, 5),
        retiredCoaches,
        seasonNumber: w.seasonState?.seasonNumber,
        windowIndex: w.seasonState?.currentWindowIndex,
        coachCandidatePool: (w.coachCandidatePool || []).length,
        retirementHistoryLen: ret.length,
        coachRetirementHistoryLen: cret.length,
      };
    } catch { return null; }
  });
  console.log('IDs picked:', JSON.stringify(ids, null, 2));
  // Diagnostic — capture coach state for the "retired" coach to confirm
  // that retirement-vs-unemployed UX is rendered correctly.
  if (ids.retiredCoaches[0]) {
    const cstate = await page.evaluate((cid: string) => {
      try {
        const w = JSON.parse(localStorage.getItem('football-universe-save') || '{}')?.state?.world;
        return w?.coachStates?.[cid] ?? null;
      } catch { return null; }
    }, ids.retiredCoaches[0]);
    console.log(`retired coach ${ids.retiredCoaches[0]} state:`, JSON.stringify(cstate));
  }
  if (!ids) {
    console.error('Failed to read world state from localStorage');
    process.exit(1);
  }

  type RouteSpec = { route: string; name: string };
  const routes: RouteSpec[] = [
    { route: '/', name: 'dashboard' },
    // Real app uses numeric league level (Layout.tsx links to /league/1)
    { route: '/league/1', name: 'league-1' },
    { route: '/league/2', name: 'league-2' },
    { route: '/league/3', name: 'league-3' },
    // Also test the user-spec L1/L2/L3 to see if those are valid (they fall back to "未找到")
    { route: '/league/L1', name: 'league-L1-userspec' },
    { route: '/cup/league_cup', name: 'cup-league' },
    { route: '/cup/super_cup', name: 'cup-super' },
    { route: '/cup/world_cup', name: 'cup-world' },
    { route: '/cup/mainland_cup', name: 'cup-mainland' },
    { route: '/cup/southern_cup', name: 'cup-southern' },
    { route: '/cup/eastern_cup', name: 'cup-eastern' },
    { route: `/team/${ids.teamIds[0]}`, name: `team-${ids.teamIds[0]}` },
    { route: `/team/${ids.teamIds[1] ?? ids.teamIds[0]}`, name: `team-${ids.teamIds[1] ?? ids.teamIds[0]}` },
    { route: `/player/${ids.topPlayerId ?? 'p-0'}`, name: `player-${ids.topPlayerId ?? 'p-0'}` },
    ...(ids.retiredPlayers[0] ? [{ route: `/player/${ids.retiredPlayers[0]}`, name: `player-retired-${ids.retiredPlayers[0]}` }] : []),
    { route: `/coach/${ids.coachIds[0]}`, name: `coach-${ids.coachIds[0]}` },
    ...(ids.retiredCoaches[0] ? [{ route: `/coach/${ids.retiredCoaches[0]}`, name: `coach-retired-${ids.retiredCoaches[0]}` }] : []),
    { route: '/transfers', name: 'transfers' },
    { route: '/history', name: 'history' },
    { route: '/legends', name: 'legends' },
    { route: '/chronicle', name: 'chronicle' },
    { route: '/settings', name: 'settings' },
    { route: '/search', name: 'search' },
    { route: '/memorable', name: 'memorable' },
    // Bonus pages from App.tsx not in user spec
    { route: '/calendar', name: 'calendar' },
    { route: '/teams', name: 'teams' },
    { route: '/coaches', name: 'coaches' },
    { route: '/players', name: 'players' },
    { route: '/compare', name: 'compare' },
    // bonus — non-existent player to test 404 fallback path is graceful
    { route: '/player/__nonexistent__', name: 'player-nonexistent' },
    { route: '/coach/__nonexistent__', name: 'coach-nonexistent' },
    { route: '/team/__nonexistent__', name: 'team-nonexistent' },
  ];

  const results: RouteResult[] = [];
  const errors: Record<string, RouteResult> = {};

  for (const spec of routes) {
    console.log('→', spec.route);
    handlers.drain();
    let pageErrors: string[] = [], consoleErrors: string[] = [], consoleWarnings: string[] = [], network404: string[] = [];
    try {
      const resp = await page.goto(DEV_URL + spec.route, { waitUntil: 'networkidle', timeout: 15_000 });
      if (resp && resp.status() >= 400) {
        // hard 404 from server — should not happen in SPA
      }
    } catch (e) {
      pageErrors.push(`navigation failed: ${e}`);
    }
    await page.waitForTimeout(800);

    const drained = handlers.drain();
    pageErrors = drained.pageErrors;
    consoleErrors = drained.consoleErrors;
    consoleWarnings = drained.consoleWarnings;
    network404 = drained.network404;

    // Filter out unrelated noisy messages
    const isUnrelated = (s: string) =>
      /Failed to load resource: the server responded.*?favicon/.test(s)
      || /\[vite\]/i.test(s)
      || /HMR/i.test(s)
      || /Download the React DevTools/.test(s);
    consoleWarnings = consoleWarnings.filter(s => !isUnrelated(s));
    consoleErrors = consoleErrors.filter(s => !isUnrelated(s));

    // Take screenshot
    const shotPath = path.join(OUT_DIR, `ui-${spec.name}.png`);
    try {
      await page.screenshot({ path: shotPath, fullPage: true });
    } catch (e) {
      console.log('  screenshot failed:', e);
    }

    // Tab-toggle for legends — click "退役教练" tab and shot again
    if (spec.name === 'legends') {
      try {
        const coachTabBtn = await page.$('button:has-text("退役教练")');
        if (coachTabBtn) {
          await coachTabBtn.click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUT_DIR, 'ui-legends-coach-tab.png'), fullPage: false });
        }
        const playerTabBtn = await page.$('button:has-text("退役球员")');
        if (playerTabBtn) {
          await playerTabBtn.click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUT_DIR, 'ui-legends-player-tab.png'), fullPage: false });
        }
      } catch {}
    }

    const checks = await checkPage(page);
    const special = await specialChecks(page, spec.name);

    const ok = pageErrors.length === 0
      && consoleErrors.length === 0
      && checks.badText.length === 0
      && checks.bodyHeight > 200
      && checks.mainHeight > 50;

    const r: RouteResult = {
      route: spec.route,
      name: spec.name,
      ok,
      pageErrors,
      consoleErrors,
      consoleWarnings,
      network404: network404.filter(u => !/favicon|@vite|@react-refresh|hot-update|sourcemap/.test(u)),
      contentChecks: checks,
      special,
    };
    results.push(r);
    errors[spec.name] = r;
  }

  await browser.close();

  // Write JSON
  fs.writeFileSync(path.join(OUT_DIR, 'ui-errors.json'), JSON.stringify(errors, null, 2));

  // Build markdown report
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  // Routes that loaded without errors but show a fallback / suspicious empty UI
  const concerns = results.filter(r => {
    if (!r.ok) return false;
    const sp = (r.special ?? {}) as Record<string, unknown>;
    const fb = sp.fallbackPhrases as string[] | undefined;
    if (fb && fb.length > 0) return true;
    if (typeof sp.mainTextSnippet === 'string' && (sp.mainTextSnippet as string).length < 80) return true;
    return false;
  });
  const lines: string[] = [];
  lines.push(`# UI Audit Report`);
  lines.push(``);
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push(`Save: ${SAVE_PATH}`);
  lines.push(`Season advanced: ${advanced}`);
  lines.push(`Routes loaded successfully: ${ok.length} / ${results.length}`);
  lines.push(`Routes with content concerns: ${concerns.length}`);
  lines.push(``);

  lines.push(`## Failures`);
  if (fail.length === 0) lines.push(`(none)`);
  for (const r of fail) {
    lines.push(`### ${r.name} \`${r.route}\``);
    lines.push(`- bodyHeight: ${r.contentChecks.bodyHeight}`);
    lines.push(`- mainHeight: ${r.contentChecks.mainHeight}`);
    lines.push(`- title: ${r.contentChecks.title}`);
    if (r.pageErrors.length) lines.push(`- pageErrors: ${r.pageErrors.length} → ${r.pageErrors.join(' | ')}`);
    if (r.consoleErrors.length) lines.push(`- consoleErrors (${r.consoleErrors.length}): ${r.consoleErrors.slice(0, 4).join(' | ')}`);
    if (r.contentChecks.badText.length) lines.push(`- badText: ${r.contentChecks.badText.join(' / ')}`);
    if (r.network404.length) lines.push(`- network4xx: ${r.network404.slice(0, 3).join(' / ')}`);
  }

  lines.push(``);
  lines.push(`## Concerns (loaded but suspicious)`);
  if (concerns.length === 0) lines.push(`(none)`);
  for (const r of concerns) {
    const sp = (r.special ?? {}) as Record<string, unknown>;
    lines.push(`- ${r.name} \`${r.route}\` mainH=${Math.round(r.contentChecks.mainHeight)} mainTextLen=${r.contentChecks.mainTextLen}`);
    if (sp.fallbackPhrases && (sp.fallbackPhrases as string[]).length) lines.push(`    fallbackPhrases: ${JSON.stringify(sp.fallbackPhrases)}`);
    if (sp.mainTextSnippet) lines.push(`    snippet: "${(sp.mainTextSnippet as string).substring(0, 120)}…"`);
  }

  lines.push(``);
  lines.push(`## Warnings (non-fatal)`);
  for (const r of results) {
    if (r.ok && (r.consoleWarnings.length > 0 || r.network404.length > 0)) {
      lines.push(`- ${r.name}: warns=${r.consoleWarnings.length} 4xx=${r.network404.length}`);
    }
  }

  lines.push(``);
  lines.push(`## Per-route summary`);
  for (const r of results) {
    const flag = r.ok ? 'OK' : 'FAIL';
    lines.push(`- [${flag}] ${r.name} \`${r.route}\` body=${Math.round(r.contentChecks.bodyHeight)} main=${Math.round(r.contentChecks.mainHeight)} btn=${r.contentChecks.enabledButtons}+${r.contentChecks.disabledButtons}`);
    if (r.special) lines.push(`    special: ${JSON.stringify(r.special)}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'ui-report.md'), lines.join('\n'));
  console.log(`\nReport: ${path.join(OUT_DIR, 'ui-report.md')}`);
  console.log(`JSON:   ${path.join(OUT_DIR, 'ui-errors.json')}`);
  console.log(`OK:   ${ok.length} / ${results.length}`);
  console.log(`FAIL: ${fail.length}`);
  for (const r of fail) console.log(`  FAIL ${r.name} ${r.route}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
