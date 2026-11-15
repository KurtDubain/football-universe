import { describe, expect, it } from 'vitest';
import type { CoachBase } from '../../types/coach';
import type { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import {
  coachAcademyBias,
  deriveDoctrineTags,
  deriveInitialDoctrine,
  DOCTRINE_AXES,
  DOCTRINE_AXIS_MAX,
  DOCTRINE_AXIS_MIN,
  driftDoctrine,
  isDoctrineNeutral,
  NO_DOCTRINE_EVENTS,
  type ClubDoctrine,
  type DoctrineEvents,
} from './doctrine';

function team(id: string, reputation = 70): TeamBase {
  return {
    id,
    name: id,
    shortName: id,
    color: '#000000',
    tier: 'strong',
    overall: 78,
    attack: 78,
    midfield: 78,
    defense: 78,
    stability: 78,
    depth: 78,
    reputation,
    initialLeagueLevel: 1,
    expectation: 4,
    region: '测试',
  };
}

function coach(overrides: Partial<CoachBase> = {}): CoachBase {
  return {
    id: 'coach-1',
    name: '教练',
    rating: 70,
    style: 'balanced',
    attackBuff: 5,
    defenseBuff: 5,
    moraleBuff: 3,
    leagueBuff: 4,
    cupBuff: 4,
    pressureResistance: 60,
    riskBias: 0,
    stabilityBuff: 0,
    age: 50,
    ...overrides,
  };
}

function doctrine(overrides: Partial<ClubDoctrine> = {}): ClubDoctrine {
  return { academy: 0.5, spending: 0.5, selling: 0.5, patience: 0.5, ...overrides };
}

function events(overrides: Partial<DoctrineEvents> = {}): DoctrineEvents {
  return { ...NO_DOCTRINE_EVENTS, ...overrides };
}

/** Run n seasons with no events at all — pure regression plus noise. */
function idle(start: ClubDoctrine, seasons: number, seed = 7): ClubDoctrine {
  let current = start;
  const rng = new SeededRNG(seed);
  for (let index = 0; index < seasons; index++) {
    current = driftDoctrine(current, NO_DOCTRINE_EVENTS, 0, rng);
  }
  return current;
}

describe('club doctrine', () => {
  it('derives a deterministic starting doctrine that is not just reputation', () => {
    expect(deriveInitialDoctrine(team('shimazu', 88))).toEqual(deriveInitialDoctrine(team('shimazu', 88)));

    const ids = Array.from({ length: 32 }, (_, index) => 'club_' + index);
    const academies = ids.map((id) => deriveInitialDoctrine(team(id, 70)).academy);
    expect(Math.min(...academies)).toBeLessThan(0.35);
    expect(Math.max(...academies)).toBeGreaterThan(0.65);

    // Two clubs of identical reputation must still differ, or doctrine is
    // reputation with extra steps and buys nothing.
    const patiences = ids.map((id) => deriveInitialDoctrine(team(id, 70)).patience.toFixed(4));
    expect(new Set(patiences).size).toBeGreaterThan(20);
  });

  it('never lets an axis leave its bounds, however long the pressure lasts', () => {
    const rng = new SeededRNG(99);
    let current = doctrine();
    let violations = 0;
    for (let index = 0; index < 400; index++) {
      current = driftDoctrine(
        current,
        events({ cashTight: true, youthBreakthrough: true, lostCorePlayer: true, relegated: true }),
        0.9,
        rng,
      );
      for (const axis of DOCTRINE_AXES) {
        if (current[axis] < DOCTRINE_AXIS_MIN || current[axis] > DOCTRINE_AXIS_MAX) violations++;
      }
    }
    expect(violations).toBe(0);
    // The bounds are load-bearing, not decorative: on an axis with a flat push,
    // sustained pressure really does drive a club into the wall.
    expect(current.academy).toBeGreaterThan(0.9);
    // The money axes are pulled toward a stance instead of pushed, so they
    // settle near their target and stay off the bound even under 400 seasons of
    // unbroken pressure. That difference is the whole reason for the pull.
    expect(current.selling).toBeGreaterThan(0.7);
    expect(current.selling).toBeLessThan(0.94);
  });

  it('decays an extreme doctrine back towards the middle with no events at all', () => {
    const pinned = doctrine({ academy: 0.95, spending: 0.05, selling: 0.05, patience: 0.95 });
    const after = idle(pinned, 30);
    expect(after.academy).toBeLessThan(pinned.academy);
    expect(after.patience).toBeLessThan(pinned.patience);
    expect(after.spending).toBeGreaterThan(pinned.spending);
    expect(after.selling).toBeGreaterThan(pinned.selling);
  });

  it('still moves a perfectly neutral doctrine in a season where nothing happened', () => {
    const next = driftDoctrine(doctrine(), NO_DOCTRINE_EVENTS, 0, new SeededRNG(5));
    const moved = DOCTRINE_AXES.some((axis) => Math.abs(next[axis] - 0.5) > 1e-9);
    expect(moved).toBe(true);
  });

  it('moves each axis only in response to its own event', () => {
    const base = doctrine({ selling: 0.3, spending: 0.7 });
    // Same seed on both sides so the noise term cancels exactly and the
    // assertion measures the event push and nothing else.
    const step = (e: DoctrineEvents) => driftDoctrine(base, e, 0, new SeededRNG(11));
    const quiet = step(NO_DOCTRINE_EVENTS);

    const tight = step(events({ cashTight: true }));
    expect(tight.selling).toBeGreaterThan(quiet.selling);
    expect(tight.spending).toBeLessThan(quiet.spending);
    expect(tight.academy).toBeCloseTo(quiet.academy, 10);

    const flush = step(events({ cashFlush: true }));
    expect(flush.spending).toBeGreaterThan(quiet.spending);
    expect(flush.selling).toBeLessThan(quiet.selling);
    expect(flush.academy).toBeCloseTo(quiet.academy, 10);

    // Self-limiting, which is the whole point of pulling rather than adding.
    // Cash poverty is persistent — the ranking is league-relative and rich clubs
    // stay rich — so a flat push walked a permanently broke club into the wall.
    const middleDelta = tight.selling - quiet.selling;
    expect(middleDelta).toBeGreaterThan(0);

    const deltaFor = (selling: number) => {
      const doc = doctrine({ selling, spending: 0.2 });
      const run = (e: DoctrineEvents) => driftDoctrine(doc, e, 0, new SeededRNG(11));
      return run(events({ cashTight: true })).selling - run(NO_DOCTRINE_EVENTS).selling;
    };
    // Already near the stance: still nudged up, but far less.
    expect(deltaFor(0.70)).toBeGreaterThan(0);
    expect(deltaFor(0.70)).toBeLessThan(middleDelta);
    // Already past the stance: pulled back rather than pushed further out.
    expect(deltaFor(0.90)).toBeLessThan(0);

    const breakthrough = step(events({ youthBreakthrough: true }));
    expect(breakthrough.academy - quiet.academy).toBeCloseTo(0.06, 10);
    expect(breakthrough.selling).toBeCloseTo(quiet.selling, 10);

    // The club is already a bigger spender than seller, so losing a core
    // player reads as a reason to buy again rather than to sell.
    const poached = step(events({ lostCorePlayer: true }));
    expect(poached.spending - quiet.spending).toBeCloseTo(0.05, 10);

    const champion = step(events({ wonTitle: true }));
    expect(champion.patience - quiet.patience).toBeCloseTo(-0.04, 10);

    const dropped = step(events({ relegated: true }));
    expect(dropped.patience - quiet.patience).toBeCloseTo(0.06, 10);
  });

  it('lets failure reverse a lean more readily than success confirms it', () => {
    const leaning = doctrine({ academy: 0.8, spending: 0.2, selling: 0.2, patience: 0.8 });
    const quiet = driftDoctrine(leaning, NO_DOCTRINE_EVENTS, 0, new SeededRNG(3));
    const confirmed = driftDoctrine(leaning, events({ metExpectation: true }), 0, new SeededRNG(3));
    const reversed = driftDoctrine(leaning, events({ missedExpectation: true }), 0, new SeededRNG(3));

    expect(confirmed.academy - quiet.academy).toBeCloseTo(0.03, 10);
    expect(reversed.academy - quiet.academy).toBeCloseTo(-0.045, 10);
    expect(confirmed.spending - quiet.spending).toBeCloseTo(-0.03, 10);
    expect(reversed.spending - quiet.spending).toBeCloseTo(0.045, 10);

    // A club within 0.1 of the middle has no lean to confirm or reverse.
    const mild = doctrine({ academy: 0.55, spending: 0.45, selling: 0.5, patience: 0.5 });
    const mildQuiet = driftDoctrine(mild, NO_DOCTRINE_EVENTS, 0, new SeededRNG(3));
    const mildMet = driftDoctrine(mild, events({ metExpectation: true }), 0, new SeededRNG(3));
    for (const axis of DOCTRINE_AXES) {
      expect(mildMet[axis]).toBeCloseTo(mildQuiet[axis], 10);
    }
  });

  it('lets the coach pull the academy axis and nothing else', () => {
    const base = doctrine();
    const quiet = driftDoctrine(base, NO_DOCTRINE_EVENTS, 0, new SeededRNG(21));
    const coached = driftDoctrine(base, NO_DOCTRINE_EVENTS, 0.4, new SeededRNG(21));
    expect(coached.academy - quiet.academy).toBeCloseTo(0.1, 10);
    for (const axis of ['spending', 'selling', 'patience'] as const) {
      expect(coached[axis]).toBeCloseTo(quiet[axis], 10);
    }
  });

  it('derives a bounded, individual coach bias from existing coach fields', () => {
    expect(coachAcademyBias(undefined)).toBe(0);

    const balanced = coachAcademyBias(coach());
    expect(Number.isFinite(balanced)).toBe(true);
    expect(Math.abs(balanced)).toBeLessThan(0.7);
    // Same coach, same opinion. Different coach, different opinion.
    expect(coachAcademyBias(coach())).toBe(balanced);
    expect(coachAcademyBias(coach({ id: 'coach-2' }))).not.toBe(balanced);

    expect(coachAcademyBias(coach({ style: 'possession' })))
      .toBeGreaterThan(coachAcademyBias(coach({ style: 'counter' })));
    expect(coachAcademyBias(coach({ riskBias: 9 })))
      .toBeLessThan(coachAcademyBias(coach({ riskBias: -9 })));
    expect(coachAcademyBias(coach({ stabilityBuff: 10 })))
      .toBeGreaterThan(coachAcademyBias(coach({ stabilityBuff: -5 })));
  });

  it('derives at most two tags and treats an unremarkable club as untagged', () => {
    const many = deriveDoctrineTags(doctrine({ academy: 0.8, spending: 0.8, selling: 0.8, patience: 0.2 }));
    expect(many).toHaveLength(2);

    expect(deriveDoctrineTags(doctrine({ academy: 0.8 })).map((tag) => tag.key)).toEqual(['academy_first']);
    expect(deriveDoctrineTags(doctrine({ patience: 0.8 })).map((tag) => tag.key)).toEqual(['long_game']);
    expect(deriveDoctrineTags(doctrine({ patience: 0.2 })).map((tag) => tag.key)).toEqual(['sprint']);
    expect(deriveDoctrineTags(doctrine({ spending: 0.7, academy: 0.3 })).map((tag) => tag.key))
      .toEqual(['big_spender', 'mercenary']);
    expect(deriveDoctrineTags(doctrine()).map((tag) => tag.key)).toEqual(['steady']);

    // No pronounced identity is itself a label, so the badge row is never empty.
    expect(deriveDoctrineTags(doctrine({ academy: 0.65, spending: 0.35, selling: 0.35, patience: 0.65 }))
      .map((tag) => tag.key)).toEqual(['steady']);
    expect(isDoctrineNeutral(doctrine())).toBe(true);
    expect(isDoctrineNeutral(doctrine({ academy: 0.8 }))).toBe(false);
  });

  it('lets a club change its label with nobody ever setting a label', () => {
    // Nothing in the engine assigns tags; they are read off the axes. So a
    // big spender under sustained cash pressure has to be able to turn into
    // a seller on its own.
    const rng = new SeededRNG(1234);
    let current = doctrine({ spending: 0.85, selling: 0.2, academy: 0.3, patience: 0.4 });
    expect(deriveDoctrineTags(current).map((tag) => tag.key)).toContain('big_spender');

    const seen = new Set<string>();
    for (let index = 0; index < 80; index++) {
      current = driftDoctrine(current, events({ cashTight: index < 30 }), -0.2, rng);
      seen.add(deriveDoctrineTags(current).map((tag) => tag.key).join('+'));
    }
    // Squeezed for thirty seasons, then left alone for fifty. The label has to
    // move with the pressure and then move back off it; a sticky label would
    // show a single state here.
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expect([...seen].some((key) => key.includes('seller'))).toBe(true);
    expect(deriveDoctrineTags(current).some((tag) => tag.key === 'seller')).toBe(false);
  });
});
