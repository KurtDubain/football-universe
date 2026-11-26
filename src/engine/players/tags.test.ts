import { describe, it, expect } from 'vitest';
import {
  clutchGoalWeight,
  getPlayerTags,
  hasTag,
  KEEPER_CREDIT_BASE,
  keeperCreditChance,
  peakAgeBandForTags,
  personalityWeight,
  rollStyleTagForUuid,
  rollTagsForUuid,
  STYLE_TAG_META,
  styleWeight,
  TAG_META,
  tagInjuryMultiplier,
  tagMarketMultiplier,
  tagPoachMultiplier,
} from './tags';
import type { PlayerTag, StyleTag } from '../../types/player';

const ALL_TAGS: PlayerTag[] = [
  'loyal', 'ambitious', 'iron', 'glass', 'clutch', 'late_bloomer', 'wanderer',
  'hothead', 'gentleman', 'solo', 'leader', 'early_peak',
];
const ALL_STYLES: StyleTag[] = [
  'poacher', 'creator', 'playmaker', 'engine', 'shadow',
  'marker', 'sweeper', 'raider_df', 'shotstopper', 'flaky',
];
const STYLE_BY_POSITION: Record<string, StyleTag[]> = {
  FW: ['poacher', 'creator'],
  MF: ['playmaker', 'engine', 'shadow'],
  DF: ['marker', 'sweeper', 'raider_df'],
  GK: ['shotstopper', 'flaky'],
};

describe('rollTagsForUuid (v23)', () => {
  it('deterministic — same uuid yields the same tags', () => {
    expect(rollTagsForUuid('p-1234')).toEqual(rollTagsForUuid('p-1234'));
  });

  it('returns 0-2 tags, all from the known set, never duplicated', () => {
    for (let i = 0; i < 2000; i++) {
      const tags = rollTagsForUuid(`p-${i}`);
      expect(tags.length).toBeLessThanOrEqual(2);
      expect(new Set(tags).size).toBe(tags.length);
      for (const tag of tags) expect(ALL_TAGS).toContain(tag);
    }
  });

  it('distribution lands near 29% none / 50% one / 21% two', () => {
    let none = 0;
    let one = 0;
    let two = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const n = rollTagsForUuid(`uuid-${i}`).length;
      if (n === 0) none++;
      else if (n === 1) one++;
      else two++;
    }
    // Slot hit rates are 0.50 / 0.42; the mutex re-roll shaves a little off the
    // two-tag rate, so the band is wider than the nominal 21%.
    expect(none / N).toBeGreaterThan(0.25);
    expect(none / N).toBeLessThan(0.33);
    expect(one / N).toBeGreaterThan(0.45);
    expect(one / N).toBeLessThan(0.56);
    expect(two / N).toBeGreaterThan(0.16);
    expect(two / N).toBeLessThan(0.25);
  });

  it('never pairs mutually exclusive tags', () => {
    const MUTEX: Array<[PlayerTag, PlayerTag]> = [
      ['loyal', 'wanderer'], ['loyal', 'ambitious'], ['iron', 'glass'],
      ['late_bloomer', 'early_peak'], ['hothead', 'gentleman'],
    ];
    for (let i = 0; i < 20000; i++) {
      const tags = rollTagsForUuid(`m-${i}`);
      if (tags.length < 2) continue;
      for (const [a, b] of MUTEX) {
        expect(tags.includes(a) && tags.includes(b)).toBe(false);
      }
    }
  });
});

describe('rollStyleTagForUuid (v23)', () => {
  it('deterministic, and only ever returns a style valid at that position', () => {
    for (const position of ['FW', 'MF', 'DF', 'GK'] as const) {
      for (let i = 0; i < 2000; i++) {
        const style = rollStyleTagForUuid(`s-${i}`, position);
        if (style === undefined) continue;
        expect(STYLE_BY_POSITION[position]).toContain(style);
        expect(rollStyleTagForUuid(`s-${i}`, position)).toBe(style);
      }
    }
  });

  it('per-position mix matches the table within ±4pp', () => {
    const N = 20000;
    const expected: Record<string, Record<string, number>> = {
      FW: { poacher: 45, creator: 35 },
      MF: { playmaker: 30, engine: 30, shadow: 20 },
      DF: { marker: 35, sweeper: 35, raider_df: 15 },
      GK: { shotstopper: 40, flaky: 25 },
    };
    for (const position of ['FW', 'MF', 'DF', 'GK'] as const) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const style = rollStyleTagForUuid(`d-${i}`, position) ?? 'none';
        counts[style] = (counts[style] ?? 0) + 1;
      }
      for (const [style, pct] of Object.entries(expected[position])) {
        const actual = ((counts[style] ?? 0) / N) * 100;
        expect(Math.abs(actual - pct)).toBeLessThan(4);
      }
    }
  });
});

describe('reading tags off a player', () => {
  it('folds the legacy single-tag shape into the array', () => {
    expect(getPlayerTags({ tag: 'iron' })).toEqual(['iron']);
    expect(getPlayerTags({ tags: ['solo', 'leader'] })).toEqual(['solo', 'leader']);
    // tags wins when both are present — a migrated save keeps the new roll.
    expect(getPlayerTags({ tags: ['solo'], tag: 'iron' })).toEqual(['solo']);
    expect(getPlayerTags({})).toEqual([]);
    expect(getPlayerTags(undefined)).toEqual([]);
  });

  it('hasTag reads both shapes', () => {
    expect(hasTag({ tag: 'glass' }, 'glass')).toBe(true);
    expect(hasTag({ tags: ['glass'] }, 'glass')).toBe(true);
    expect(hasTag({ tags: ['solo'] }, 'glass')).toBe(false);
    expect(hasTag(undefined, 'glass')).toBe(false);
  });

  it('peakAgeBandForTags resolves the two age tags and nothing else', () => {
    expect(peakAgeBandForTags(['late_bloomer'])).toEqual([28, 32]);
    expect(peakAgeBandForTags(['early_peak'])).toEqual([21, 24]);
    expect(peakAgeBandForTags(['solo', 'leader'])).toBeUndefined();
  });
});

describe('tag effects', () => {
  it('style weights match the published table', () => {
    expect(styleWeight('poacher', 'goal')).toBeCloseTo(1.55);
    expect(styleWeight('poacher', 'assist')).toBeCloseTo(0.40);
    expect(styleWeight('creator', 'assist')).toBeCloseTo(1.95);
    expect(styleWeight('playmaker', 'assist')).toBeCloseTo(1.90);
    expect(styleWeight('playmaker', 'defense')).toBeCloseTo(0.50);
    expect(styleWeight('engine', 'defense')).toBeCloseTo(1.60);
    expect(styleWeight('shadow', 'goal')).toBeCloseTo(2.20);
    expect(styleWeight('marker', 'interception')).toBeCloseTo(1.55);
    expect(styleWeight('sweeper', 'clearance')).toBeCloseTo(1.55);
    expect(styleWeight('raider_df', 'goal')).toBeCloseTo(4.00);
    // A raider is not punished defensively — the DF attacking term is only 0.10
    // of the score, so any defensive discount made the style a net penalty.
    expect(styleWeight('raider_df', 'defense')).toBe(1);
    // An axis a style says nothing about is neutral, never zero.
    expect(styleWeight('poacher', 'defense')).toBe(1);
    expect(styleWeight(undefined, 'goal')).toBe(1);
  });

  it('personality weights compose across two tags', () => {
    expect(personalityWeight({ tags: ['solo'] }, 'goal')).toBeCloseTo(1.25);
    expect(personalityWeight({ tags: ['solo'] }, 'assist')).toBeCloseTo(0.45);
    // hothead is NOT a share multiplier — see HOTHEAD_EXTRA_BOOKING_CHANCE.
    expect(personalityWeight({ tags: ['hothead'] }, 'card')).toBe(1);
    expect(personalityWeight({ tags: ['gentleman'] }, 'card')).toBeCloseTo(0.20);
    expect(personalityWeight({ tags: ['solo', 'gentleman'] }, 'card')).toBeCloseTo(0.20);
    expect(personalityWeight({}, 'goal')).toBe(1);
  });

  it('market / injury / poach multipliers', () => {
    expect(tagMarketMultiplier({ tags: ['glass'] })).toBeCloseTo(0.7);
    expect(tagMarketMultiplier({ tags: ['leader'] })).toBeCloseTo(1.10);
    expect(tagMarketMultiplier({ tags: ['glass', 'leader'] })).toBeCloseTo(0.77);
    expect(tagMarketMultiplier({})).toBe(1);

    expect(tagInjuryMultiplier({ tags: ['iron'] })).toBeCloseTo(1 / 3);
    expect(tagInjuryMultiplier({ tags: ['glass'] })).toBeCloseTo(2);
    expect(tagInjuryMultiplier({})).toBe(1);

    expect(tagPoachMultiplier({ tags: ['leader'] })).toBeCloseTo(0.6);
    expect(tagPoachMultiplier({})).toBe(1);
  });

  it('clutch only fires in a big match', () => {
    expect(clutchGoalWeight({ tags: ['clutch'] }, true)).toBeCloseTo(1.3);
    expect(clutchGoalWeight({ tags: ['clutch'] }, false)).toBe(1);
    expect(clutchGoalWeight({}, true)).toBe(1);
  });

  it('keeper credit: shot-stopper lifts it, flaky swings, everyone else is base', () => {
    expect(keeperCreditChance({ styleTag: 'shotstopper' })).toBeCloseTo(KEEPER_CREDIT_BASE * 1.30);
    expect(keeperCreditChance({})).toBeCloseTo(KEEPER_CREDIT_BASE);
    expect(keeperCreditChance({ styleTag: 'poacher' })).toBeCloseTo(KEEPER_CREDIT_BASE);
    expect(keeperCreditChance({ styleTag: 'flaky' }, 0.1)).toBeCloseTo(0.48);
    expect(keeperCreditChance({ styleTag: 'flaky' }, 0.9)).toBeCloseTo(0.72);
  });
});

describe('display metadata', () => {
  it('every tag and style has a label, icon and color', () => {
    for (const tag of ALL_TAGS) {
      expect(TAG_META[tag].label.length).toBeGreaterThan(0);
      expect(TAG_META[tag].icon.length).toBeGreaterThan(0);
      expect(TAG_META[tag].color.length).toBeGreaterThan(0);
    }
    for (const style of ALL_STYLES) {
      expect(STYLE_TAG_META[style].label.length).toBeGreaterThan(0);
      expect(STYLE_TAG_META[style].icon.length).toBeGreaterThan(0);
      expect(STYLE_TAG_META[style].color.length).toBeGreaterThan(0);
    }
  });
});
