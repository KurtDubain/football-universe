import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../types/match';
import {
  classifyMatchSoundEvent,
  computeCrowdGainLevel,
  computeCrowdIntensity,
  isPresentationSequencedSoundEvent,
  MATCH_SOUND_PROFILE_MIX,
  matchPrestige,
} from './match-soundscape';

function event(type: MatchEvent['type'], teamId = 'home'): MatchEvent {
  return { minute: 80, type, teamId, description: type };
}

describe('match soundscape semantics', () => {
  it('distinguishes home, away, and neutral goal reactions', () => {
    expect(classifyMatchSoundEvent(event('goal'), 'home', false)).toBe('goal_home');
    expect(classifyMatchSoundEvent(event('goal', 'away'), 'home', false)).toBe('goal_away');
    expect(classifyMatchSoundEvent(event('goal', 'away'), 'home', true)).toBe('goal_neutral');
  });

  it('keeps shootout outcomes distinct', () => {
    const woodwork: MatchEvent = {
      ...event('penalty_miss'),
      shootout: { kickNumber: 1, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'woodwork' },
    };
    const saved: MatchEvent = {
      ...event('penalty_miss'),
      shootout: { kickNumber: 1, round: 1, teamKickNumber: 1, suddenDeath: false, outcome: 'saved' },
    };
    expect(classifyMatchSoundEvent(woodwork, 'home', true)).toBe('woodwork');
    expect(classifyMatchSoundEvent(saved, 'home', true)).toBe('save');
  });

  it('gives noteworthy corners and free kicks a restrained setup cue', () => {
    expect(classifyMatchSoundEvent(event('corner'), 'home', false)).toBe('corner');
    expect(classifyMatchSoundEvent(event('free_kick'), 'home', false)).toBe('free_kick');
  });

  it('routes visible pitch events through the synchronized presentation path', () => {
    expect(isPresentationSequencedSoundEvent(event('goal'))).toBe(true);
    expect(isPresentationSequencedSoundEvent(event('save'))).toBe(true);
    expect(isPresentationSequencedSoundEvent(event('corner'))).toBe(true);
    expect(isPresentationSequencedSoundEvent(event('red_card'))).toBe(false);
    expect(isPresentationSequencedSoundEvent(event('substitution'))).toBe(false);
  });

  it('raises crowd presence by profile without hiding action cues in quiet mode', () => {
    expect(MATCH_SOUND_PROFILE_MIX.quiet.crowd).toBeLessThan(MATCH_SOUND_PROFILE_MIX.balanced.crowd);
    expect(MATCH_SOUND_PROFILE_MIX.stadium.crowd).toBeGreaterThan(MATCH_SOUND_PROFILE_MIX.balanced.crowd);
    expect(MATCH_SOUND_PROFILE_MIX.quiet.action).toBeGreaterThanOrEqual(MATCH_SOUND_PROFILE_MIX.balanced.action);
  });

  it('raises tension late in a close match and for shootouts', () => {
    const early = computeCrowdIntensity({
      minute: 10, maxMinute: 90, homeScore: 0, awayScore: 0, inShootout: false, paused: false,
    }, 0.2);
    const late = computeCrowdIntensity({
      minute: 86, maxMinute: 90, homeScore: 1, awayScore: 1, inShootout: false, paused: false,
    }, 0.2);
    const shootout = computeCrowdIntensity({
      minute: 121, maxMinute: 120, homeScore: 1, awayScore: 1, inShootout: true, paused: false,
    }, 0.2);
    expect(late).toBeGreaterThan(early);
    expect(shootout).toBeGreaterThan(late);
  });

  it('raises the ambient crowd in dangerous play but drops that lift while paused', () => {
    const settled = computeCrowdGainLevel(0.5, 0.1, false);
    const dangerous = computeCrowdGainLevel(0.5, 0.95, false);
    const paused = computeCrowdGainLevel(0.5, 0.95, true);

    expect(dangerous).toBeGreaterThan(settled);
    expect(paused).toBeLessThan(dangerous);
  });

  it('gives finals and world competition a bounded prestige lift', () => {
    expect(matchPrestige({
      fixtureId: 'final', homeTeamId: 'a', awayTeamId: 'b', competitionType: 'world_cup',
      roundLabel: 'Final', featured: true,
    })).toBeGreaterThan(matchPrestige({
      fixtureId: 'round', homeTeamId: 'a', awayTeamId: 'b', competitionType: 'league',
      roundLabel: 'Round 2', featured: false,
    }));
  });
});
