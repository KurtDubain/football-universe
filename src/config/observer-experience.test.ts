import { describe, expect, it } from 'vitest';
import { defaultTeams } from './teams';
import { executeCurrentWindow, initializeGameWorld } from '../engine/season/season-manager';
import {
  getObserverLensOptions,
  OBSERVER_SEED_CANDIDATES,
  RECOMMENDED_EXPERIENCE_SEED,
  scoreObserverOpening,
  scoreWorldMomentCadence,
} from './observer-experience';

describe('observer experience configuration', () => {
  it('keeps the seed audit bounded to twenty reproducible candidates', () => {
    expect(OBSERVER_SEED_CANDIDATES).toHaveLength(20);
    expect(new Set(OBSERVER_SEED_CANDIDATES).size).toBe(20);
  });

  it('derives distinct narrative lenses without changing team data', () => {
    const snapshot = structuredClone(defaultTeams);
    const options = getObserverLensOptions(defaultTeams);

    expect(options.map(option => option.id)).toEqual(['giant', 'challenger', 'underdog', 'neutral']);
    expect(options.slice(0, 3).every(option => option.teamId)).toBe(true);
    expect(new Set(options.slice(0, 3).map(option => option.teamId)).size).toBe(3);
    expect(options.at(-1)?.teamId).toBeNull();
    expect(defaultTeams).toEqual(snapshot);
  });

  it('rewards a restrained world-moment cadence and penalizes saturation', () => {
    expect(scoreWorldMomentCadence(1)).toBeGreaterThan(scoreWorldMomentCadence(0));
    expect(scoreWorldMomentCadence(3)).toBeGreaterThan(scoreWorldMomentCadence(1));
    expect(scoreWorldMomentCadence(6)).toBeLessThan(scoreWorldMomentCadence(3));
  });

  it('slightly favors the default challenger lens and explicit opening drama', () => {
    const quiet = {
      importanceScore: 8,
      meaningfulReasonCount: 0,
      goals: 2,
      margin: 0,
      lateGoals: 0,
      redCards: 0,
      deniedGoals: 0,
      upset: false,
    };
    expect(scoreObserverOpening({ ...quiet, lens: 'challenger' }))
      .toBeGreaterThan(scoreObserverOpening({ ...quiet, lens: 'giant' }));
    expect(scoreObserverOpening({
      ...quiet,
      lens: 'challenger',
      meaningfulReasonCount: 1,
      lateGoals: 1,
      deniedGoals: 1,
    })).toBeGreaterThan(scoreObserverOpening({ ...quiet, lens: 'challenger' }));
  });

  it('gives every recommended lens a readable first match and the default lens late drama', () => {
    const world = initializeGameWorld(RECOMMENDED_EXPERIENCE_SEED);
    const result = executeCurrentWindow(world);
    const lenses = getObserverLensOptions(Object.values(world.teamBases)).filter(option => option.teamId);
    const focusResults = lenses.map(option => result.results.find(match => (
      match.homeTeamId === option.teamId || match.awayTeamId === option.teamId
    )));

    expect(focusResults.every(Boolean)).toBe(true);
    expect(focusResults.every(match => match && Math.abs(match.homeGoals - match.awayGoals) <= 1)).toBe(true);
    const challengerResult = focusResults[lenses.findIndex(option => option.id === 'challenger')];
    expect(Math.abs(
      (challengerResult?.homeGoals ?? 0) - (challengerResult?.awayGoals ?? 0),
    )).toBeLessThanOrEqual(1);
    expect((challengerResult?.homeGoals ?? 0) + (challengerResult?.awayGoals ?? 0))
      .toBeGreaterThanOrEqual(2);
    expect(challengerResult?.events.some(event => (
      (event.type === 'goal' || event.type === 'own_goal') && event.minute >= 75
    ))).toBe(true);
  });
});
