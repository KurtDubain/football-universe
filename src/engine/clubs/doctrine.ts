/**
 * Club operating doctrine — four continuous axes that describe how a club runs
 * itself, independent of how good it currently is.
 *
 * Before this module a club's recruitment identity was a pure FNV hash of its
 * teamId (see the old deriveRecruitmentProfile): one club kept the same
 * personality for 300 seasons, and that permanence was asserted by a test. That
 * is the third hard-coded permanent identity in the engine — reputation had one
 * (fixed in B1), youth quality is a pure function of reputation, and recruitment
 * style was this hash.
 *
 * Continuous axes rather than discrete labels, because the transfer market is
 * asked to stay flexible: a club should be able to drift from selling-to-survive
 * towards buying-stars over a decade rather than flipping between two states.
 * Readable labels are derived from the axes (see deriveDoctrineTags), never
 * stored, so a label change is a consequence of drift rather than a separate
 * piece of state that can disagree with it.
 */

import type { CoachBase } from '../../types/coach';
import type { TeamBase } from '../../types/team';
import type { SeededRNG } from '../match/rng';

export interface ClubDoctrine {
  /** Appetite for pouring money into the academy. */
  academy: number;
  /** Appetite for paying over the odds in the transfer market. */
  spending: number;
  /** Appetite for listing own players for sale. */
  selling: number;
  /** Long-termism. High tolerates a bad season, low demands an immediate sprint. */
  patience: number;
}

export const DOCTRINE_AXES = ['academy', 'spending', 'selling', 'patience'] as const;
export type DoctrineAxis = (typeof DOCTRINE_AXES)[number];

/** Hard bounds. No club ever reaches 0 or 1, so no identity is ever absolute. */
export const DOCTRINE_AXIS_MIN = 0.05;
export const DOCTRINE_AXIS_MAX = 0.95;
/**
 * Per-season pull back towards the middle. This is what stops a club that once
 * went full mercenary from staying there forever.
 *
 * 0.05 was the first guess and measurement killed it: with the event pushes
 * below, 5% left the axes with a standard deviation of 0.20 and left roughly
 * half the league with at least one axis clamped against its hard bound. 0.10
 * holds the spread at ~0.16 — clubs are still clearly different from each other,
 * which is the whole point — while the walls stay empty. The economy couples
 * back into this (a selling club accumulates cash and therefore stops being
 * ranked tight), which is why the real world needs more restoring force than a
 * standalone simulation of this function suggests.
 */
export const DOCTRINE_REGRESSION = 0.10;
/** Symmetric per-season jitter. Guarantees movement even in a season where no
 *  event fired at all, which is the difference between dynamic and frozen. */
export const DOCTRINE_NOISE = 0.05;

function clampAxis(value: number): number {
  return Math.max(DOCTRINE_AXIS_MIN, Math.min(DOCTRINE_AXIS_MAX, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** FNV-1a, matching the hash the old recruitment profile used. */
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic [0, 1) from a string. */
function unitHash(input: string): number {
  return fnv1a(input) / 4294967296;
}

/**
 * Starting doctrine for a club that has never had one — used for world creation
 * and as the fallback when an older save has no clubDoctrines record.
 *
 * Deterministic in (teamId, reputation) so a given world always starts the same,
 * but the 32 clubs are spread across the space rather than clustered at 0.5.
 * Reputation enters only as a mild prior: rich clubs lean towards spending and
 * away from selling, small clubs the reverse. The axes stay mostly their own
 * thing, which is the point — doctrine must be able to contradict reputation or
 * it is just reputation with extra steps.
 */
export function deriveInitialDoctrine(team: TeamBase): ClubDoctrine {
  const repFactor = clamp01((team.reputation - 55) / 45);
  return {
    academy: clampAxis(0.22 + unitHash(team.id + ':academy') * 0.56),
    spending: clampAxis(0.18 + unitHash(team.id + ':spending') * 0.44 + repFactor * 0.22),
    selling: clampAxis(0.18 + unitHash(team.id + ':selling') * 0.44 + (1 - repFactor) * 0.22),
    patience: clampAxis(0.22 + unitHash(team.id + ':patience') * 0.56),
  };
}

/**
 * How strongly a coach pushes a club towards (or away from) academy investment.
 *
 * Deliberately derived from existing CoachBase fields rather than a new field, so
 * no save-schema change is needed and every coach in an existing save immediately
 * has an opinion. This is the cross-club perturbation source: coaches change
 * clubs, retire and get replaced, so a club's academy culture shifts when its
 * staff does.
 */
export function coachAcademyBias(coach: CoachBase | undefined): number {
  if (!coach) return 0;
  let bias = (unitHash(coach.id + ':academy') - 0.5) * 0.3;
  const styleBias: Record<CoachBase['style'], number> = {
    possession: 0.08,
    balanced: 0.02,
    attacking: -0.02,
    defensive: -0.03,
    counter: -0.05,
  };
  bias += styleBias[coach.style] ?? 0;
  bias += -(coach.riskBias / 100) * 0.6;
  bias += (coach.stabilityBuff / 10) * 0.3;
  if (coach.age < 45) bias += 0.05;
  if (coach.age > 60) bias -= 0.05;
  return bias;
}

/**
 * Real events from the season just played. Every doctrine movement that is not
 * regression or noise comes from one of these — the v2 底蕴 attempt decayed
 * unconditionally and drove reputation to 27, so nothing here fires without a
 * cause.
 */
export interface DoctrineEvents {
  /** Finished inside the band its reputation claims. */
  metExpectation: boolean;
  /** Finished outside that band. */
  missedExpectation: boolean;
  /** Cash is thin relative to the wage bill. */
  cashTight: boolean;
  /** Cash is comfortable relative to the wage bill — the mirror of cashTight. */
  cashFlush: boolean;
  /** An academy graduate came through with peak >= 88. */
  youthBreakthrough: boolean;
  /** Lost a peak >= 85 player to a paid transfer. */
  lostCorePlayer: boolean;
  /** Won the top flight, league cup or super cup. */
  wonTitle: boolean;
  /** Dropped a division. */
  relegated: boolean;
}

export const NO_DOCTRINE_EVENTS: DoctrineEvents = {
  metExpectation: false,
  missedExpectation: false,
  cashTight: false,
  cashFlush: false,
  youthBreakthrough: false,
  lostCorePlayer: false,
  wonTitle: false,
  relegated: false,
};

/**
 * Advance one club's doctrine by a season.
 *
 * Four independent anti-lock mechanisms, any one of which alone keeps the system
 * moving:
 *   1. regression towards 0.5 — extremes decay on their own
 *   2. event pull — movement has a cause a player can read in the news
 *   3. noise — movement happens even in a season with no events at all
 *   4. hard bounds [0.05, 0.95] — no club becomes an absolute anything
 */
export function driftDoctrine(
  doctrine: ClubDoctrine,
  events: DoctrineEvents,
  coachBias: number,
  rng: SeededRNG,
): ClubDoctrine {
  const next: ClubDoctrine = { ...doctrine };

  // 1. Regression towards the middle.
  for (const axis of DOCTRINE_AXES) {
    next[axis] += (0.5 - next[axis]) * DOCTRINE_REGRESSION;
  }

  // 2. Event pull.
  if (events.metExpectation) {
    // Success reinforces whichever way the club already leans: a selling club
    // that over-performs concludes selling works, and doubles down.
    for (const axis of DOCTRINE_AXES) {
      const deviation = doctrine[axis] - 0.5;
      if (Math.abs(deviation) > 0.1) next[axis] += Math.sign(deviation) * 0.03;
    }
  }
  if (events.missedExpectation) {
    // Failure pushes the other way, and harder than success pushes — a club
    // changes its mind more readily than it confirms one. The magnitudes are
    // paired with the met/missed split in season-end (60/40 against 0.03/0.045)
    // so the two products match and the league as a whole has no lean.
    for (const axis of DOCTRINE_AXES) {
      const deviation = doctrine[axis] - 0.5;
      if (Math.abs(deviation) > 0.1) next[axis] -= Math.sign(deviation) * 0.045;
    }
  }
  if (events.cashTight) {
    // Pulls towards a stance rather than adding a fixed step.
    //
    // The flat version (+0.07 selling, -0.06 spending) was balanced across the
    // league and still wrong, because balance in aggregate is not balance over
    // time: cash poverty is persistent. The event fires off a league-relative
    // ranking, and rich clubs stay rich, so the same club sits in the bottom
    // third season after season and collected +0.07 every year until its
    // selling axis sat against the wall. Half the league ended up with a pinned
    // axis even though the league-wide rate was 31% tight against 31% flush.
    //
    // A proportional pull is self-limiting: the closer a club already is to
    // "sell to survive", the less this event has left to say.
    next.selling += (0.80 - next.selling) * 0.25;
    next.spending += (0.25 - next.spending) * 0.20;
  }
  if (events.cashFlush) {
    // The exact mirror of cashTight, target for target and rate for rate. Both
    // events cover the same share of clubs in every season, so the league has no
    // net lean on either money axis.
    next.spending += (0.80 - next.spending) * 0.25;
    next.selling += (0.25 - next.selling) * 0.20;
  }
  if (events.youthBreakthrough) next.academy += 0.06;
  if (events.lostCorePlayer) {
    // Whichever of the two responses the club is already inclined towards wins.
    if (doctrine.selling >= doctrine.spending) next.selling += 0.04;
    else next.spending += 0.05;
  }
  if (events.wonTitle) next.patience -= 0.04;
  if (events.relegated) next.patience += 0.06;

  // Coach pull on the academy axis only. The other three axes are the board's,
  // not the manager's.
  next.academy += coachBias * 0.25;

  // 3. Noise.
  for (const axis of DOCTRINE_AXES) {
    next[axis] += (rng.next() - 0.5) * 2 * DOCTRINE_NOISE;
  }

  // 4. Hard bounds.
  for (const axis of DOCTRINE_AXES) {
    next[axis] = clampAxis(next[axis]);
  }

  return next;
}

export interface DoctrineTag {
  key: string;
  label: string;
}

/**
 * Readable labels, derived on read and never stored. Because the axes drift, a
 * club's label can change without any explicit event — a club turning from
 * 金元足球 to 青训为本 is something the simulation produces on its own.
 *
 * Capped at two: more than that and the badge row stops being readable.
 */
export function deriveDoctrineTags(doctrine: ClubDoctrine, margin = 0): DoctrineTag[] {
  const tags: DoctrineTag[] = [];
  if (doctrine.academy >= 0.70 + margin) tags.push({ key: 'academy_first', label: '青训为本' });
  if (doctrine.spending >= 0.70 + margin) tags.push({ key: 'big_spender', label: '金元足球' });
  if (doctrine.selling >= 0.70 + margin) tags.push({ key: 'seller', label: '卖人求生' });
  if (doctrine.patience <= 0.30 - margin) tags.push({ key: 'sprint', label: '短期冲刺' });
  if (doctrine.patience >= 0.75 + margin) tags.push({ key: 'long_game', label: '长线布局' });
  if (doctrine.spending >= 0.65 + margin && doctrine.academy <= 0.35 - margin) {
    tags.push({ key: 'mercenary', label: '雇佣兵路线' });
  }
  // Fallback, not a band test. Requiring every axis inside [0.40, 0.60] left
  // roughly half the league with an empty badge row, which reads as a missing
  // feature rather than as an answer. "No pronounced identity" is itself the
  // honest label for those clubs, and it is the same state deriveRecruitmentProfile
  // calls 'balanced'.
  if (tags.length === 0) tags.push({ key: 'steady', label: '稳健经营' });
  return tags.slice(0, 2);
}

/**
 * How far past a threshold an axis must sit before a tag counts as settled.
 *
 * The axes jitter every season, so a club sitting near a threshold crosses it
 * constantly: measured over 300 seasons the plain tag set changed every three
 * to five seasons per club, which turns a club's identity into noise. The badge
 * on the team page still reads the plain set — it is a live readout and should
 * flicker — but the news feed and any "this club has changed" claim use the
 * confirmed set, so a shift is only reported once the club has clearly, not
 * marginally, moved.
 */
export const DOCTRINE_TAG_CONFIRM_MARGIN = 0.06;

/** The tag set a club's doctrine clearly supports, not merely crosses. */
export function deriveConfirmedDoctrineTags(doctrine: ClubDoctrine): DoctrineTag[] {
  return deriveDoctrineTags(doctrine, DOCTRINE_TAG_CONFIRM_MARGIN);
}

/** True when every axis sits in the middle band — the no-strong-identity case. */
export function isDoctrineNeutral(doctrine: ClubDoctrine): boolean {
  return DOCTRINE_AXES.every((axis) => doctrine[axis] >= 0.40 && doctrine[axis] <= 0.60);
}