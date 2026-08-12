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
import { computeFixtureImportance, pickFocusMatches } from '../src/engine/season/match-importance';
import { buildObservationTheme } from '../src/engine/observation/observation-theme';
import { buildMatchdayNarrativeDigest } from '../src/engine/observation/narrative-sources';
import type { NarrativeSource } from '../src/engine/observation/narrative-types';
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
  importanceScore: number;
  reasons: string[];
}

interface SeedAudit {
  seed: number;
  score: number;
  firstExperienceReady: boolean;
  upsetCount: number;
  closeMatchCount: number;
  naturallyFocusedWindows: number;
  averageGoals: number;
  universeScore: number;
  firstExperienceScore: number;
  observerDepthScore: number;
  meaningfulChoiceWindows: number;
  observationThemeWindows: number;
  narrativeSourceDiversity: number;
  featureWindows: number;
  worldMomentWindows: number;
  firstFocusMatches: FocusMatchAudit[];
}

function auditFocusMatch(
  lens: Exclude<ObserverLens, 'neutral'>,
  teamId: string,
  result: MatchResult,
  world: ReturnType<typeof initializeGameWorld>,
  importanceScore: number,
  reasons: string[],
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
    importanceScore,
    reasons,
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
  let meaningfulChoiceWindows = 0;
  let observationThemeWindows = 0;
  let featureWindows = 0;
  let worldMomentWindows = 0;
  const narrativeSources = new Set<NarrativeSource>();

  for (let index = 0; index < 6; index++) {
    const window = getCurrentWindow(world);
    if (!window) break;
    const highestNaturalImportance = Math.max(
      0,
      ...window.fixtures.map(fixture => computeFixtureImportance(fixture, world, []).score),
    );
    if (highestNaturalImportance >= 4) naturallyFocusedWindows++;

    const lensWindows = getObserverLensOptions(Object.values(world.teamBases))
      .filter((option): option is typeof option & { id: Exclude<ObserverLens, 'neutral'>; teamId: string } => (
        option.id !== 'neutral' && option.teamId !== null
      ))
      .map(option => {
        const focusMatches = pickFocusMatches(window.fixtures, world, [option.teamId], 2, option.teamId);
        const observationTheme = buildObservationTheme(world, option.teamId, 'auto');
        const digest = buildMatchdayNarrativeDigest({
          world,
          currentWindow: window,
          observationTheme,
          focusMatches,
          playerHighlights: [],
          favoriteTeamIds: [option.teamId],
          favoritePlayerIds: [],
          primaryFavoriteTeamId: option.teamId,
          memory: [],
        });
        const primaryFocus = focusMatches[0];
        const hasSpecificStakes = primaryFocus?.importance.reasons.some(
          reason => !reason.includes('观察球队出战'),
        ) ?? false;
        if (hasSpecificStakes || Boolean(digest.feature) || digest.signals.length > 0) {
          meaningfulChoiceWindows++;
        }
        if (observationTheme) observationThemeWindows++;
        if (digest.feature) featureWindows++;
        if (digest.worldMoment) worldMomentWindows++;
        for (const item of [digest.feature, ...digest.signals, ...digest.more]) {
          if (item) narrativeSources.add(item.source);
        }
        return { option, primaryFocus };
      });

    const execution = executeCurrentWindow(world);
    if (index === 0) {
      firstFocusMatches = lensWindows.flatMap(({ option, primaryFocus }) => {
          const result = execution.results.find(entry => (
            entry.homeTeamId === option.teamId || entry.awayTeamId === option.teamId
          ));
          return result ? [auditFocusMatch(
            option.id,
            option.teamId,
            result,
            world,
            primaryFocus?.importance.score ?? 0,
            primaryFocus?.importance.reasons ?? [],
          )] : [];
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

  const universeScore = upsetCount * 3 + closeMatchCount + naturallyFocusedWindows * 2;
  const challenger = firstFocusMatches.find(entry => entry.lens === 'challenger');
  const narrativeSourceDiversity = narrativeSources.size;
  const observerDepthScore = meaningfulChoiceWindows * 2
    + observationThemeWindows
    + featureWindows
    + narrativeSourceDiversity * 5
    - Math.max(0, worldMomentWindows - 3) * 2;
  const closeFirstMatches = firstFocusMatches.filter(entry => entry.margin <= 1).length;
  const firstExperienceReady = firstFocusMatches.length === 3
    && firstFocusMatches.every(entry => entry.importanceScore >= 4)
    && meaningfulChoiceWindows >= 12
    && observationThemeWindows >= 15
    && narrativeSourceDiversity >= 3
    && closeFirstMatches === 3
    && Boolean(challenger && challenger.goals > 0);
  const firstExperienceScore = firstFocusMatches.reduce(
    (total, entry) => total
      + (
        entry.importanceScore * 1.5
        + Math.min(3, entry.reasons.length) * 2
        + Math.min(3, entry.goals) * 2
        + (entry.margin <= 1 ? 12 : entry.margin === 2 ? 6 : 0)
        + entry.lateGoals * 2
        + entry.redCards * 2
        + entry.deniedGoals
        + Number(entry.upset) * 3
        - Math.max(0, entry.margin - 1) * 5
        - Math.max(0, entry.goals - 5) * 3
      ) * (entry.lens === 'challenger' ? 1.5 : 1),
    challenger && challenger.margin <= 1 ? 10 : 0,
  );

  return {
    seed,
    score: universeScore + firstExperienceScore + observerDepthScore,
    firstExperienceReady,
    upsetCount,
    closeMatchCount,
    naturallyFocusedWindows,
    averageGoals: Math.round(totalGoals / Math.max(1, matchCount) * 100) / 100,
    universeScore,
    firstExperienceScore,
    observerDepthScore,
    meaningfulChoiceWindows,
    observationThemeWindows,
    narrativeSourceDiversity,
    featureWindows,
    worldMomentWindows,
    firstFocusMatches,
  };
}

const audits = OBSERVER_SEED_CANDIDATES
  .map(auditSeed)
  .sort((a, b) => Number(b.firstExperienceReady) - Number(a.firstExperienceReady)
    || b.score - a.score
    || a.seed - b.seed);

console.log(JSON.stringify({ selected: audits[0], candidates: audits }, null, 2));
