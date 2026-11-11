import { executeCurrentWindow, initializeGameWorld } from '../src/engine/season/season-manager';
import type { GameWorld } from '../src/engine/season/season-manager';
import type { LeagueTier } from '../src/engine/awards/award-weights';

/**
 * Where do a season's goals actually come from?
 *
 * `updatePlayerStatsAndSegmentsFromResults` is called with the whole window's
 * results and `buildMatchStatDeltas` applies no competition filter, so
 * `playerStats.goals` is an ALL-COMPETITIONS total. That makes the Golden Boot
 * an all-competitions award, while its schedule normalisation divides by league
 * rounds only. This probe measures the gap.
 *
 * Usage: SEASONS=20 SEED=20260722 npx tsx scripts/probe-goal-sources.ts
 */

const SEASONS = Number(process.env.SEASONS ?? 20);
const SEED = Number(process.env.SEED ?? 20260722);

function levelOf(world: GameWorld, teamId: string, season: number): LeagueTier {
  const record = world.teamSeasonRecords?.[teamId]?.find(r => r.seasonNumber === season);
  return (record?.leagueLevel ?? 1) as LeagueTier;
}

interface Tally {
  goals: number;
  apps: number;
}

type ByComp = Map<string, Tally>;

function snapshot(world: GameWorld): Map<string, ByComp> {
  const byPlayer = new Map<string, ByComp>();
  for (const window of world.seasonState.calendar) {
    if (!window.completed) continue;
    for (const result of window.results ?? []) {
      const comp = result.competitionType ?? 'unknown';
      for (const side of ['home', 'away'] as const) {
        const matchday = side === 'home' ? result.homeMatchday : result.awayMatchday;
        for (const p of matchday?.players ?? []) {
          if ((p.minutesPlayed ?? 0) <= 0) continue;
          const comps = byPlayer.get(p.playerId) ?? new Map<string, Tally>();
          const tally = comps.get(comp) ?? { goals: 0, apps: 0 };
          tally.apps += 1;
          comps.set(comp, tally);
          byPlayer.set(p.playerId, comps);
        }
      }
      for (const event of result.events) {
        if (event.type !== 'goal' || event.minute > 120 || !event.playerId) continue;
        const comps = byPlayer.get(event.playerId) ?? new Map<string, Tally>();
        const tally = comps.get(comp) ?? { goals: 0, apps: 0 };
        tally.goals += 1;
        comps.set(comp, tally);
        byPlayer.set(event.playerId, comps);
      }
    }
  }
  return byPlayer;
}

const goalsByComp = new Map<string, number>();
const appsByComp = new Map<string, number>();
/** Per-tier all-competition appearance totals, to compare against league rounds. */
const tierApps = new Map<LeagueTier, { apps: number; players: number }>();
/** Share of a top scorer's goals that came from outside the league. */
let topScorerCupShare = 0;
let topScorerSamples = 0;
let seasonsCounted = 0;
/** How often is the all-competitions top scorer different from the league-only one? */
let topScorerDiffers = 0;

let world = initializeGameWorld(SEED);

for (let index = 0; index < SEASONS; index += 1) {
  const season = world.seasonState.seasonNumber;
  let last = snapshot(world);
  let guard = 0;
  while (world.seasonState.seasonNumber === season && guard < 300) {
    last = snapshot(world);
    world = executeCurrentWindow(world).world;
    guard += 1;
  }
  if (world.seasonState.seasonNumber === season) throw new Error('season stuck');
  seasonsCounted += 1;

  let allCompTop: { id: string; total: number; league: number } | null = null;
  let leagueTop: { id: string; league: number } | null = null;

  for (const [playerId, comps] of last) {
    let total = 0;
    let league = 0;
    for (const [comp, tally] of comps) {
      total += tally.goals;
      if (comp === 'league') league += tally.goals;
      goalsByComp.set(comp, (goalsByComp.get(comp) ?? 0) + tally.goals);
      appsByComp.set(comp, (appsByComp.get(comp) ?? 0) + tally.apps);
    }
    if (total > 0 && (!allCompTop || total > allCompTop.total)) {
      allCompTop = { id: playerId, total, league };
    }
    if (league > 0 && (!leagueTop || league > leagueTop.league)) {
      leagueTop = { id: playerId, league };
    }

    const stat = world.playerStats[playerId];
    if (stat && total > 0) {
      const tier = levelOf(world, stat.teamId, season);
      const bucket = tierApps.get(tier) ?? { apps: 0, players: 0 };
      let apps = 0;
      for (const tally of comps.values()) apps += tally.apps;
      bucket.apps += apps;
      bucket.players += 1;
      tierApps.set(tier, bucket);
    }
  }

  if (allCompTop) {
    topScorerSamples += 1;
    topScorerCupShare += (allCompTop.total - allCompTop.league) / allCompTop.total;
    if (leagueTop && leagueTop.id !== allCompTop.id) topScorerDiffers += 1;
  }
}

const totalGoals = [...goalsByComp.values()].reduce((s, v) => s + v, 0);
const pct = (n: number) => `${((n / totalGoals) * 100).toFixed(1)}%`;

console.log(`seed ${SEED} · ${seasonsCounted} seasons · ${totalGoals} goals total`);
console.log('');
console.log('进球来源（全部球员，全部赛季）:');
for (const [comp, goals] of [...goalsByComp.entries()].sort((a, b) => b[1] - a[1])) {
  const apps = appsByComp.get(comp) ?? 0;
  console.log(`  ${comp.padEnd(18)} ${String(goals).padStart(6)} 球 (${pct(goals).padStart(6)})  `
    + `${String(apps).padStart(6)} 次出场  ${(goals / Math.max(1, apps)).toFixed(2)} 球/场`);
}

console.log('');
console.log('各层级有进球球员的全赛事场均出场（对比联赛轮次 L1=30 / L2=L3=14）:');
for (const tier of [1, 2, 3] as LeagueTier[]) {
  const bucket = tierApps.get(tier);
  if (!bucket) continue;
  console.log(`  L${tier}  ${(bucket.apps / bucket.players).toFixed(1)} 场/赛季  （${bucket.players} 名有进球球员）`);
}

console.log('');
console.log(`全赛事射手王平均 ${((topScorerCupShare / Math.max(1, topScorerSamples)) * 100).toFixed(1)}% 的进球来自联赛之外`);
console.log(`全赛事射手王与纯联赛射手王不是同一人的赛季: ${topScorerDiffers}/${topScorerSamples}`);
