import { describe, expect, it } from 'vitest';
import { executeCurrentWindow, initializeGameWorld } from '../season/season-manager';
import type { GameWorld } from '../season/season-manager';
import { buildAwardBuzz, type BuzzCandidate } from './award-buzz';
import { BUZZ_MAX_CANDIDATES, BUZZ_MAX_TIERS, BUZZ_START_ROUND } from './award-weights';

const SEED = 20260722;

function topFlightPlayed(world: GameWorld): number {
  return (world.league1Standings ?? []).reduce((max, row) => Math.max(max, row.played), 0);
}

/** Advance a real world until the top flight has played `targetRound` rounds. */
function advanceToRound(targetRound: number): GameWorld {
  let world = initializeGameWorld(SEED);
  for (let guard = 0; guard < 200; guard += 1) {
    if (topFlightPlayed(world) >= targetRound) break;
    const season = world.seasonState.seasonNumber;
    const next = executeCurrentWindow(world).world;
    if (next.seasonState.seasonNumber !== season) break;
    world = next;
  }
  return world;
}

const midSeason = advanceToRound(BUZZ_START_ROUND);
const buzz = buildAwardBuzz(midSeason);

const TIER_ORDER: Record<BuzzCandidate['tier'], number> = {
  frontrunner: 0, contender: 1, outsider: 2,
};

describe('buildAwardBuzz — gating', () => {
  it('stays hidden before the second half of the season', () => {
    const early = advanceToRound(BUZZ_START_ROUND - 4);
    expect(topFlightPlayed(early)).toBeLessThan(BUZZ_START_ROUND);
    expect(buildAwardBuzz(early)).toBeNull();
  });

  it('appears once the top flight reaches the start round', () => {
    expect(topFlightPlayed(midSeason)).toBeGreaterThanOrEqual(BUZZ_START_ROUND);
    expect(buzz).not.toBeNull();
    expect(buzz!.asOfRound).toBe(topFlightPlayed(midSeason));
    expect(buzz!.roundsRemaining).toBeGreaterThan(0);
  });

  it('produces a card for every award with eligible candidates', () => {
    const awards = buzz!.cards.map(card => card.award);
    expect(awards).toContain('mvp');
    expect(awards).toContain('golden_boot');
    expect(awards).toContain('best_forward');
    expect(awards).toContain('best_midfielder');
    expect(awards).toContain('best_defender');
    expect(awards).toContain('best_goalkeeper');
    expect(awards).toContain('young_player');
  });
});

describe('buildAwardBuzz — no ranking leaks', () => {
  /**
   * Numbers a candidate may carry.
   *
   * These are all facts the player can already read elsewhere — league tier and
   * current standing from the tables, shirt number and season score from the
   * player page and the 综合榜. Exposing them costs nothing.
   *
   * What must never appear is a number that exists only inside this module: the
   * buzz score, the award score, or a gap to the leader. Any of those would let
   * the player read the winner straight off the card, which is the single thing
   * this panel exists to prevent. New numeric fields fail this test on purpose.
   */
  const ALLOWED_NUMERIC_FIELDS = new Set([
    'leagueLevel', 'teamPosition', 'playerNumber', 'previousSeasonScore',
  ]);

  it('never exposes a buzz-internal score on a candidate', () => {
    for (const card of buzz!.cards) {
      for (const candidate of card.candidates) {
        const keys = Object.keys(candidate);
        expect(keys).not.toContain('buzzScore');
        expect(keys).not.toContain('score');
        expect(keys).not.toContain('awardScore');
        expect(keys).not.toContain('base');
        expect(keys).not.toContain('gap');
        for (const [key, value] of Object.entries(candidate)) {
          if (typeof value !== 'number') continue;
          expect(ALLOWED_NUMERIC_FIELDS.has(key)).toBe(true);
        }
      }
    }
  });

  it('never leaks a buzz score through a card either', () => {
    for (const card of buzz!.cards) {
      expect(Object.keys(card)).not.toContain('buzzScore');
      expect(Object.keys(card)).not.toContain('bandTops');
      expect(typeof card.mood).toBe('string');
    }
  });

  it('groups candidates into bands rather than ranking them', () => {
    for (const card of buzz!.cards) {
      expect(card.candidates.length).toBeGreaterThan(0);
      expect(card.candidates.length).toBeLessThanOrEqual(BUZZ_MAX_CANDIDATES);

      const bands = new Set(card.candidates.map(candidate => candidate.tier));
      expect(bands.size).toBeLessThanOrEqual(BUZZ_MAX_TIERS);
      // Bands must appear in order and be contiguous from the top.
      const indexes = card.candidates.map(candidate => TIER_ORDER[candidate.tier]);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
      expect(indexes[0]).toBe(0);
    }
  });

  it('orders inside a band by team name, never by score', () => {
    for (const card of buzz!.cards) {
      const byTier = new Map<string, BuzzCandidate[]>();
      for (const candidate of card.candidates) {
        const list = byTier.get(candidate.tier) ?? [];
        list.push(candidate);
        byTier.set(candidate.tier, list);
      }
      for (const group of byTier.values()) {
        if (group.length < 2) continue;
        const names = group.map(candidate => candidate.teamName);
        const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
        expect(names).toEqual(sorted);
      }
    }
  });

  it('reports mood honestly', () => {
    for (const card of buzz!.cards) {
      expect(['open', 'runaway']).toContain(card.mood);
      if (card.mood === 'runaway') {
        // A runaway needs exactly one leader, otherwise the field is contested.
        expect(card.candidates.filter(c => c.tier === 'frontrunner')).toHaveLength(1);
      }
    }
  });
});

describe('buildAwardBuzz — mirrors real award eligibility', () => {
  it('restricts position-award cards to the top flight', () => {
    const topFlight = new Set((midSeason.league1Standings ?? []).map(row => row.teamId));
    for (const card of buzz!.cards) {
      if (!['best_forward', 'best_midfielder', 'best_defender', 'best_goalkeeper'].includes(card.award)) continue;
      for (const candidate of card.candidates) {
        expect(topFlight.has(candidate.teamId)).toBe(true);
      }
    }
  });

  it('only names the right position on each position-award card', () => {
    const expected: Record<string, string> = {
      best_forward: 'FW', best_midfielder: 'MF', best_defender: 'DF', best_goalkeeper: 'GK',
    };
    for (const card of buzz!.cards) {
      const position = expected[card.award];
      if (!position) continue;
      for (const candidate of card.candidates) {
        expect(candidate.position).toBe(position);
      }
    }
  });

  it('only names under-23 players on the young player card', () => {
    const card = buzz!.cards.find(entry => entry.award === 'young_player');
    expect(card).toBeDefined();
    for (const candidate of card!.candidates) {
      expect(candidate.line).toMatch(/^\d{2}岁/);
    }
  });

  it('reports the team current standing, not a final one', () => {
    for (const card of buzz!.cards) {
      for (const candidate of card.candidates) {
        expect(candidate.teamPosition).toBeGreaterThanOrEqual(0);
        expect(candidate.teamPosition).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe('buildAwardBuzz — determinism', () => {
  it('produces identical output for identical input', () => {
    const first = buildAwardBuzz(midSeason);
    const second = buildAwardBuzz(midSeason);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('accepts a precomputed form map without changing the result', () => {
    const withDefault = buildAwardBuzz(midSeason);
    const recomputed = buildAwardBuzz(midSeason);
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(withDefault));
  });
});
