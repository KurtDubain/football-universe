import {
  getObserverLensOptions,
  OBSERVER_SEED_CANDIDATES,
  type ObserverLens,
} from '../src/config/observer-experience';
import {
  executeCurrentWindow,
  getCurrentWindow,
  initializeGameWorld,
} from '../src/engine/season/season-manager';
import { isUpset } from '../src/engine/season/helpers';
import { computeFixtureImportance } from '../src/engine/season/match-importance';
import type { MatchResult } from '../src/types/match';

interface FocusMatchAudit {
  lens: Exclude<ObserverLens, 'neutral'>;
  teamId: string;
  fixtureId: string;
  scoreline: string;
  goals: number;
  margin: number;
  lateGoals: number;
  redCards: number;
  deniedGoals: number;
  upset: boolean;
  dramaScore: number;
}

interface SeedAudit {
  seed: number;
  score: number;
  upsetCount: number;
  closeMatchCount: number;
  naturallyFocusedWindows: number;
  averageGoals: number;
  universeScore: number;
  firstExperienceScore: number;
  firstFocusMatches: FocusMatchAudit[];
}

function auditFocusMatch(
  lens: Exclude<ObserverLens, 'neutral'>,
  teamId: string,
  result: MatchResult,
  world: ReturnType<typeof initializeGameWorld>,
): FocusMatchAudit {
  const goals = result.homeGoals + result.awayGoals
    + (result.etHomeGoals ?? 0) + (result.etAwayGoals ?? 0);
  const margin = Math.abs(
    result.homeGoals + (result.etHomeGoals ?? 0)
    - result.awayGoals - (result.etAwayGoals ?? 0),
  );
  const scoringEvents = result.events.filter(event => event.type === 'goal' || event.type === 'own_goal');
  const lateGoals = scoringEvents.filter(event => event.minute >= 75).length;
  const redCards = result.events.filter(event => event.type === 'red_card').length;
  const deniedGoals = result.events.filter(event => event.type === 'gk_save' || event.type === 'df_block').length;
  const home = world.teamBases[result.homeTeamId];
  const away = world.teamBases[result.awayTeamId];
  const upset = Boolean(home && away && isUpset(home, away, result));
  const dramaScore = goals * 4
    + Number(goals >= 2) * 6
    + Number(goals > 0 && margin <= 1) * 2
    + lateGoals * 4
    + redCards * 3
    + deniedGoals * 2
    + Number(upset) * 5;

  return {
    lens,
    teamId,
    fixtureId: result.fixtureId,
    scoreline: `${world.teamBases[result.homeTeamId]?.shortName ?? result.homeTeamId} ${result.homeGoals}-${result.awayGoals} ${world.teamBases[result.awayTeamId]?.shortName ?? result.awayTeamId}`,
    goals,
    margin,
    lateGoals,
    redCards,
    deniedGoals,
    upset,
    dramaScore,
  };
}

function auditSeed(seed: number): SeedAudit {
  let world = initializeGameWorld(seed);
  let upsetCount = 0;
  let closeMatchCount = 0;
  let naturallyFocusedWindows = 0;
  let totalGoals = 0;
  let matchCount = 0;
  let firstFocusMatches: FocusMatchAudit[] = [];

  for (let index = 0; index < 6; index++) {
    const window = getCurrentWindow(world);
    if (!window) break;
    const highestNaturalImportance = Math.max(
      0,
      ...window.fixtures.map(fixture => computeFixtureImportance(fixture, world, []).score),
    );
    if (highestNaturalImportance >= 4) naturallyFocusedWindows++;

    const execution = executeCurrentWindow(world);
    if (index === 0) {
      firstFocusMatches = getObserverLensOptions(Object.values(world.teamBases))
        .filter((option): option is typeof option & { id: Exclude<ObserverLens, 'neutral'>; teamId: string } => (
          option.id !== 'neutral' && option.teamId !== null
        ))
        .flatMap(option => {
          const result = execution.results.find(entry => (
            entry.homeTeamId === option.teamId || entry.awayTeamId === option.teamId
          ));
          return result ? [auditFocusMatch(option.id, option.teamId, result, world)] : [];
        });
    }
    for (const result of execution.results) {
      const home = world.teamBases[result.homeTeamId];
      const away = world.teamBases[result.awayTeamId];
      if (home && away && isUpset(home, away, result)) upsetCount++;
      if (result.prediction
        && Math.abs(result.prediction.homeWinPct - result.prediction.awayWinPct) <= 12) {
        closeMatchCount++;
      }
      totalGoals += result.homeGoals + result.awayGoals
        + (result.etHomeGoals ?? 0) + (result.etAwayGoals ?? 0);
      matchCount++;
    }
    world = execution.world;
  }

  const universeScore = upsetCount * 5 + closeMatchCount + naturallyFocusedWindows * 3;
  const challenger = firstFocusMatches.find(entry => entry.lens === 'challenger');
  const firstExperienceScore = firstFocusMatches.reduce(
    (total, entry) => total + entry.dramaScore * (entry.lens === 'challenger' ? 3 : 1),
    challenger && challenger.goals >= 2 ? 20 : challenger && challenger.goals > 0 ? 8 : 0,
  );

  return {
    seed,
    score: universeScore + firstExperienceScore,
    upsetCount,
    closeMatchCount,
    naturallyFocusedWindows,
    averageGoals: Math.round(totalGoals / Math.max(1, matchCount) * 100) / 100,
    universeScore,
    firstExperienceScore,
    firstFocusMatches,
  };
}

const audits = OBSERVER_SEED_CANDIDATES
  .map(auditSeed)
  .sort((a, b) => b.score - a.score || a.seed - b.seed);

console.log(JSON.stringify({ selected: audits[0], candidates: audits }, null, 2));
