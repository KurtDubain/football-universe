import { chromium, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';
import {
  executeCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';
import { validateWorldData } from '../src/engine/validation/world-data';

const baseUrl = (process.env.VERIFY_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const seed = Number(process.env.VERIFY_SEED ?? 20260715);

type MusicEvent = { owner?: string; scene: string; state: string };
type AuditWindow = Window & {
  __gameStore?: {
    setState: (patch: {
      world: GameWorld;
      initialized: boolean;
      favoriteTeamId: string;
      favoriteTeamIds: string[];
    }) => void;
  };
  __worldCupMusicEvents?: MusicEvent[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function continentOf(world: GameWorld, teamId: string): string {
  return world.teamBases[teamId]?.region?.split('+')[0] ?? '未知';
}

function advance(world: GameWorld): GameWorld {
  return executeCurrentWindow(world).world;
}

function advanceUntil(
  source: GameWorld,
  predicate: (world: GameWorld) => boolean,
  limit: number,
  label: string,
): { world: GameWorld; advances: number } {
  let world = source;
  let advances = 0;
  while (!predicate(world) && advances < limit) {
    const next = advance(world);
    assert(next !== world, `${label}: engine stopped before target state`);
    world = next;
    advances++;
  }
  assert(predicate(world), `${label}: target state not reached after ${advances} advances`);
  return { world, advances };
}

function buildAuditWorlds(): {
  announced: GameWorld;
  active: GameWorld;
  longWorld: GameWorld;
  engineReport: Record<string, unknown>;
} {
  const initial = initializeGameWorld(seed);
  const toAnnouncement = advanceUntil(
    initial,
    world => world.seasonState.seasonNumber === 4,
    300,
    'World Cup announcement',
  );
  const announced = toAnnouncement.world;
  const announcedEdition = announced.worldCupEditions?.find(edition => edition.seasonNumber === 4);
  assert(announcedEdition, 'S4 host was not announced at season start');
  assert(!announced.worldCup, 'S4 tournament began before the domestic season ended');
  assert(
    announced.newsLog.some(item => item.id === 'world-cup-host-S4'),
    'S4 host announcement news is missing',
  );

  const toTournament = advanceUntil(
    announced,
    world => Boolean(world.worldCup),
    100,
    'World Cup opening',
  );
  const active = toTournament.world;
  const cup = active.worldCup;
  assert(cup, 'World Cup state is missing after opening');
  assert(cup.hostTeamId === announcedEdition.hostTeamId, 'Active host differs from announced host');
  assert(cup.participantIds.length === 32, `World Cup has ${cup.participantIds.length} participants`);
  assert(cup.groups.length === 8, `World Cup has ${cup.groups.length} groups`);
  const groupFixtures = cup.groups.flatMap(group => group.fixtures);
  assert(groupFixtures.length === 48, `World Cup has ${groupFixtures.length} group fixtures`);
  assert(groupFixtures.every(fixture => fixture.isNeutralVenue), 'A World Cup group fixture is not neutral');
  assert(
    groupFixtures.every(fixture => fixture.tournamentHostTeamId === cup.hostTeamId),
    'A World Cup group fixture lost its host identity',
  );
  const activeValidation = validateWorldData(active);
  assert(activeValidation.errors.length === 0, `Active World Cup data errors: ${activeValidation.errors.map(issue => issue.code).join(', ')}`);

  const toSeason13 = advanceUntil(
    active,
    world => world.seasonState.seasonNumber === 13,
    700,
    'Three completed World Cups',
  );
  const longWorld = toSeason13.world;
  const editions = (longWorld.worldCupEditions ?? []).filter(edition => edition.seasonNumber <= 12);
  assert(editions.length === 3, `Expected three completed editions, found ${editions.length}`);
  for (const edition of editions) {
    assert(edition.winnerId, `S${edition.seasonNumber} has no champion archive`);
    assert(edition.runnerUpId, `S${edition.seasonNumber} has no runner-up archive`);
    assert(edition.hostResult, `S${edition.seasonNumber} has no host finish`);
    assert(
      longWorld.honorHistory.some(honor =>
        honor.seasonNumber === edition.seasonNumber
        && honor.worldCupHostId === edition.hostTeamId
        && honor.worldCupWinner === edition.winnerId
      ),
      `S${edition.seasonNumber} honor row does not match its edition archive`,
    );
  }
  for (let index = 1; index < editions.length; index++) {
    assert(
      continentOf(longWorld, editions[index].hostTeamId) !== continentOf(longWorld, editions[index - 1].hostTeamId),
      `S${editions[index].seasonNumber} repeated the previous host region`,
    );
    assert(
      !editions.slice(Math.max(0, index - 3), index).some(previous => previous.hostTeamId === editions[index].hostTeamId),
      `S${editions[index].seasonNumber} repeated a recent host`,
    );
  }
  const longValidation = validateWorldData(longWorld);
  assert(longValidation.errors.length === 0, `Long World Cup data errors: ${longValidation.errors.map(issue => issue.code).join(', ')}`);

  return {
    announced,
    active,
    longWorld,
    engineReport: {
      seed,
      advancesToAnnouncement: toAnnouncement.advances,
      advancesToOpening: toTournament.advances,
      advancesToSeason13: toSeason13.advances,
      editions: editions.map(edition => ({
        season: edition.seasonNumber,
        host: longWorld.teamBases[edition.hostTeamId]?.name ?? edition.hostTeamId,
        continent: continentOf(longWorld, edition.hostTeamId),
        hostResult: edition.hostResult,
        champion: longWorld.teamBases[edition.winnerId!]?.shortName ?? edition.winnerId,
      })),
      activeWarnings: activeValidation.warnings.length,
      longWarnings: longValidation.warnings.length,
    },
  };
}

function captureError(message: ConsoleMessage, errors: string[]): void {
  if (message.type() === 'error') errors.push(message.text());
}

async function prepareContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem('football-feedback-preferences-v1', JSON.stringify({
      soundEnabled: true,
      soundProfile: 'balanced',
      effectsVolume: 1,
      musicVolume: 1,
      hapticsEnabled: false,
    }));
    const events: MusicEvent[] = [];
    (window as AuditWindow).__worldCupMusicEvents = events;
    window.addEventListener('football-ambient-music', event => {
      events.push({ ...((event as CustomEvent<MusicEvent>).detail ?? {}) });
    });
  });
}

async function installWorld(page: Page, world: GameWorld, favoriteTeamId: string): Promise<void> {
  await page.goto(`${baseUrl}/?audit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as AuditWindow).__gameStore));
  await page.evaluate(({ nextWorld, teamId }) => {
    const store = (window as AuditWindow).__gameStore;
    if (!store) throw new Error('Audit store unavailable');
    store.setState({
      world: nextWorld,
      initialized: true,
      favoriteTeamId: teamId,
      favoriteTeamIds: [teamId],
    });
  }, { nextWorld: world, teamId: favoriteTeamId });
}

async function verifyHostPage(
  page: Page,
  world: GameWorld,
  viewportName: string,
): Promise<Record<string, unknown>> {
  const edition = world.worldCupEditions?.find(
    item => item.seasonNumber === world.seasonState.seasonNumber,
  );
  assert(edition, `${viewportName}: current edition is missing`);
  await installWorld(page, world, edition.hostTeamId);
  await page.goto(`${baseUrl}/cup/world_cup?audit=1`, { waitUntil: 'networkidle' });
  const feature = page.getByTestId('world-cup-host-feature');
  await feature.waitFor({ state: 'visible' });
  const featureText = await feature.innerText();
  assert(featureText.includes(world.teamBases[edition.hostTeamId].name), `${viewportName}: host name is missing`);
  assert(featureText.includes('赛会氛围 +4%'), `${viewportName}: host atmosphere is missing`);
  assert(featureText.includes('常规主场优势关闭'), `${viewportName}: neutral venue distinction is missing`);

  const musicButton = page.getByTestId('world-cup-music-toggle');
  await musicButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const events = (window as AuditWindow).__worldCupMusicEvents ?? [];
    const playbackState = document.querySelector<HTMLElement>('[data-testid="tournament-music-now-playing"]')?.dataset.playbackState
      ?? document.querySelector<HTMLElement>('[data-testid="world-cup-music-toggle"]')?.dataset.playbackState;
    return events.some(event => event.scene === 'world_cup' && event.state === 'started')
      || playbackState === 'blocked';
  }, null, { timeout: 5_000 });
  const autoStarted = await page.evaluate(() =>
    ((window as AuditWindow).__worldCupMusicEvents ?? [])
      .some(event => event.scene === 'world_cup' && event.state === 'started')
  );
  if (!autoStarted) await musicButton.click();
  await page.waitForFunction(() =>
    (window as AuditWindow).__worldCupMusicEvents?.some(event =>
      event.scene === 'world_cup' && event.state === 'started'
    ),
  null, { timeout: 5_000 });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="world-cup-music-toggle"]')?.getAttribute('aria-pressed') === 'true',
  null, { timeout: 2_000 });
  const media = await page.evaluate(() => ({
    support: document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    resources: performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => name.includes('world-cup-') && name.endsWith('.m4a')),
    events: (window as AuditWindow).__worldCupMusicEvents ?? [],
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert(media.support !== '', `${viewportName}: browser reports no AAC support`);
  assert(media.resources.some(name => name.includes('world-cup-theme-v1')), `${viewportName}: theme asset was not requested`);
  assert(!media.resources.some(name => name.includes('world-cup-final-v1')), `${viewportName}: final music loaded before the final`);
  assert(!media.resources.some(name => name.includes('world-cup-champion-v1')), `${viewportName}: champion music loaded before victory`);
  assert(media.overflow <= 1, `${viewportName}: page overflows by ${media.overflow}px`);

  const screenshot = `/tmp/football-world-cup-${viewportName}.png`;
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  let advancePersistence = false;
  if (viewportName === 'mobile-390') {
    const stoppedBefore = await page.evaluate(() =>
      ((window as AuditWindow).__worldCupMusicEvents ?? [])
        .filter(event => event.scene === 'world_cup' && event.state === 'stopped').length
    );
    await page.getByTestId('header-advance').click();
    await page.waitForURL(url => url.pathname === '/', { timeout: 15_000 });
    const nowPlaying = page.getByTestId('tournament-music-now-playing');
    await nowPlaying.waitFor({ state: 'visible' });
    assert(await nowPlaying.getAttribute('data-music-scene') === 'world_cup', 'World Cup identity was lost after advancing');
    assert(await page.getByTestId('tournament-music-global-toggle').getAttribute('aria-pressed') === 'true', 'World Cup music did not remain active after advancing');
    await page.waitForTimeout(450);
    const stoppedAfter = await page.evaluate(() =>
      ((window as AuditWindow).__worldCupMusicEvents ?? [])
        .filter(event => event.scene === 'world_cup' && event.state === 'stopped').length
    );
    assert(stoppedAfter === stoppedBefore, 'World Cup music restarted or stopped during the route transition');
    await page.screenshot({ path: '/tmp/football-world-cup-mobile-390-persistent.png', animations: 'disabled', fullPage: false });
    advancePersistence = true;
  }
  return { featureText, ...media, advancePersistence, screenshot };
}

async function verifySettings(page: Page): Promise<Record<string, unknown>> {
  await page.goto(`${baseUrl}/settings?audit=1`, { waitUntil: 'networkidle' });
  const effects = page.getByTestId('effects-volume');
  const music = page.getByTestId('music-volume');
  await effects.fill('35');
  await music.fill('80');
  const result = await page.evaluate(() => ({
    effects: (document.querySelector('[data-testid="effects-volume"]') as HTMLInputElement | null)?.value,
    music: (document.querySelector('[data-testid="music-volume"]') as HTMLInputElement | null)?.value,
    persisted: JSON.parse(localStorage.getItem('football-feedback-preferences-v1') ?? '{}') as Record<string, unknown>,
  }));
  assert(result.effects === '35' && result.music === '80', 'Independent volume controls did not retain their values');
  assert(result.persisted.effectsVolume === 0.35, 'Effects volume was not persisted independently');
  assert(result.persisted.musicVolume === 0.8, 'Music volume was not persisted independently');
  return result;
}

async function verifyActiveFixture(page: Page, world: GameWorld): Promise<Record<string, unknown>> {
  const cup = world.worldCup;
  assert(cup?.hostTeamId, 'Active browser world has no host');
  const groupIndex = cup.groups.findIndex(group => group.teamIds.includes(cup.hostTeamId!));
  const fixture = cup.groups[groupIndex]?.fixtures.find(item =>
    item.homeTeamId === cup.hostTeamId || item.awayTeamId === cup.hostTeamId
  );
  assert(fixture, 'Host has no group fixture');
  await installWorld(page, world, cup.hostTeamId);
  await page.goto(`${baseUrl}/cup/world_cup?audit=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /查看赛程/ }).nth(groupIndex).click();
  await page.locator(`[data-fixture-id="${fixture.id}"]`).click();
  const dialog = page.getByRole('dialog', { name: '赛前预测' });
  await dialog.waitFor({ state: 'visible' });
  assert(await dialog.getByTestId('world-cup-host-badge').count() === 1, 'Fixture modal has no unique host badge');
  assert((await dialog.innerText()).includes('中立场'), 'Fixture modal does not identify the neutral venue');
  const factorText = await dialog.getByTestId('match-factors').innerText();
  assert(factorText.includes('东道主氛围'), 'Fixture prediction does not explain the host atmosphere');
  const screenshot = '/tmp/football-world-cup-host-fixture-desktop.png';
  await page.screenshot({ path: screenshot, animations: 'disabled', fullPage: false });
  return { fixtureId: fixture.id, hostInHomeSlot: fixture.homeTeamId === cup.hostTeamId, factorText, screenshot };
}

async function main(): Promise<void> {
  const worlds = buildAuditWorlds();
  const browser = await chromium.launch({ headless: true });
  const browserReports: Record<string, unknown>[] = [];
  const errors: string[] = [];
  try {
    for (const viewport of [
      { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
      { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
      { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      await prepareContext(context);
      const page = await context.newPage();
      page.on('console', message => captureError(message, errors));
      page.on('pageerror', error => errors.push(error.message));
      const pageReport = await verifyHostPage(page, worlds.announced, viewport.name);
      const settingsReport = viewport.name === 'mobile-390' ? await verifySettings(page) : undefined;
      browserReports.push({ viewport: `${viewport.width}x${viewport.height}`, pageReport, settingsReport });
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await prepareContext(context);
    const page = await context.newPage();
    page.on('console', message => captureError(message, errors));
    page.on('pageerror', error => errors.push(error.message));
    browserReports.push({ activeFixture: await verifyActiveFixture(page, worlds.active) });
    await context.close();

    assert(errors.length === 0, `Browser runtime errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ passed: true, engine: worlds.engineReport, browser: browserReports }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
