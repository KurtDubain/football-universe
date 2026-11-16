import { SeededRNG } from '../match/rng';

/**
 * Per-club academy state (B3).
 *
 * This is the slow variable the four doctrine axes were missing. B2 made a club
 * change its mind about the academy; B3 makes that decision accumulate into
 * something the club then owns. The distinction matters: doctrine regresses
 * towards the middle at 10% a season (6.6-season half-life), while the level
 * below converges at 5% (13.5 seasons). Facilities, scouting networks and
 * coaching traditions outlive the board's philosophy, so the academy has to be
 * the slower of the two. A single manager must not be able to erase a club's
 * academy tradition in three seasons.
 *
 * The level only moves the RAW MATERIAL — the talent-tier odds and the peak
 * bonus on youth graduates. It never touches the match engine. A club that
 * invests well gets better ingredients, not better results: over 150 seasons a
 * top academy produces roughly 14 elite graduates against a bottom one's 10,
 * and which of those seasons turns into a title is still the match engine's
 * business. Good management does not buy championships here.
 */
export interface AcademyState {
  /** Bounded to [ACADEMY_LEVEL_MIN, ACADEMY_LEVEL_MAX]. 50 = league average. */
  level: number;
  /** Consecutive seasons spent in the league's top third of investment intent. */
  investmentStreak: number;
  /** Euros (millions) actually spent last season. 0 when the club could not fund it. */
  lastInvested: number;
}

export const ACADEMY_LEVEL_MIN = 15;
export const ACADEMY_LEVEL_MAX = 95;
/** Level assumed for saves written before B3, and for any club with no record. */
export const ACADEMY_LEVEL_DEFAULT = 50;

/**
 * Investment ceiling as a multiple of the season's booked revenue.
 *
 * Measured against the alternative caps in the design doc (8.6). Capping at
 * 1.2x revenue while funding out of `cash - 2 seasons of wages` drains about 92%
 * of the league's unbounded cash accumulation (median cash S100: 1192 -> 96)
 * while leaving 2 of 32 clubs in the red at any one time. The version that
 * funded out of the transfer market's spendable budget instead flattened cash
 * harder but put at least one club underwater in 99 of 100 seasons, which is a
 * hole rather than a pressure valve.
 */
export const ACADEMY_REVENUE_CAP = 1.2;

/**
 * A club funds its academy out of cash ABOVE this many seasons of wages.
 *
 * This is what keeps the investment from pushing anyone negative. The transfer
 * market's own `spendableBudget` has an escape hatch — its floor is
 * `min(max(wage * 2, 25), cash * 0.5)`, so a club on 36 cash against a 38 wage bill
 * still gets a floor of 18 and can spend 10 it does not have. There is no such
 * hatch here: under two seasons of wages in the bank, the academy gets nothing.
 * Real clubs cut the academy first when the money runs out.
 */
export const ACADEMY_WAGE_BUFFER_SEASONS = 2;

/**
 * Intercept of the level target, and the weight on the realised investment
 * share. Both CALIBRATED against simulation, not derived — see 8.5/8.6/8.7.
 *
 * The conservation constraint in the design doc is checked at the single point
 * rep 70 / level 50. Keeping the LEAGUE MEAN at 50 is a separate requirement,
 * and only a simulation can satisfy it: the mean depends on the realised
 * distribution of investment ratios, which depends on the economy.
 *
 * Method: run the real engine, record each club's realised share x multiplier,
 * streak and reputation every season, then replay the level recursion offline
 * across the whole (weight, intercept) grid. One 200-season run prices the
 * entire grid.
 *
 * The replay is NOT exact, and its error is one-directional. Raising the level
 * improves youth quality, which raises market value, which raises the wage
 * bill, which shrinks the cash above the two-season buffer, which shrinks the
 * investment, which lowers the target. Measured at roughly -0.5 level per point
 * of level, so the real mean only travels about two thirds of the way towards
 * whatever the replay predicts. Two rounds of record-replay-correct are needed,
 * not one, and the second round has to re-record rather than reuse the first
 * round's drivers.
 *
 * Weight: 52 (the first guess) held the mean at 50 with C = 31, but the spread
 * came out at std 9.1 with a maximum of 68 — the top band was unreachable, so in
 * 200 seasons no club ever ran a top academy. The grid says where widening stops
 * paying: at 130 the spread reaches std 15.9 but 4.3-4.5% of all club-seasons
 * sit pinned on the floor of 15, which is a wall rather than a distribution. 110
 * measures at std 12-13 in the real engine with a reachable top band and only a
 * couple of percent on the floor. Nothing reaches the ceiling of 95: the
 * realised share tops out near 0.59, because B2 keeps the academy axis itself in
 * a moderate band.
 *
 * C = 22 puts the measured league mean at 50. It sits 6 above what the first
 * replay asked for, for two reasons that measurement found and the model did
 * not: the feedback above (about +4.5), and the serious-investment cut, which
 * the first implementation inverted and so handed the streak bonus to the top
 * two thirds of the league instead of the top third (about +1.9).
 */
export const ACADEMY_TARGET_INTERCEPT = 22;
/** Weight on realised investment share. Dominates the reputation term by design. */
export const ACADEMY_TARGET_INVEST_WEIGHT = 110;
/** Weight on reputation. Deliberately small — this is the anti-reputation-ratchet term. */
export const ACADEMY_TARGET_REP_WEIGHT = 0.2;
/** Streak bonus per season, and its ceiling (reached after 20 seasons). */
export const ACADEMY_STREAK_STEP = 0.25;
export const ACADEMY_STREAK_CAP = 5;
/**
 * Per-season convergence towards the target. 0.05 = 13.5-season half-life,
 * about twice doctrine's 6.6. See the class comment for why this must be the
 * slower of the two.
 */
export const ACADEMY_CONVERGENCE = 0.05;
/** Symmetric per-season jitter, same role as DOCTRINE_NOISE. */
export const ACADEMY_NOISE = 1.0;
/**
 * Share of the league whose investment intent counts as serious — the TOP
 * third, so that the streak is something a club earns against its peers.
 *
 * This reads as 1/3 rather than 2/3 because the first implementation inverted
 * it: the cut was computed as floor(n * (1 - share)) and then applied with
 * slice(cut), which promotes everything ABOVE the cut — the top two thirds.
 * The symptom was a median investment streak of 33-46 seasons out of 200, which
 * is impossible when only a third of the league qualifies in any one season.
 * With two thirds qualifying the streak bonus became a near-constant +5 for
 * most of the league, which is the same flattening failure the streak term had
 * in the first draft, just smaller. See selectSeriousTeams below.
 */
export const ACADEMY_SERIOUS_SHARE = 1 / 3;

/**
 * The clubs whose investment intent ranks in the league's top
 * ACADEMY_SERIOUS_SHARE, highest intent last.
 *
 * The ranking lives here rather than at the call site so the share and the
 * slice that applies it cannot drift apart again. Ties break on team id so a
 * seed always produces the same set.
 */
export function selectSeriousTeams(intentByTeam: Record<string, number>): Set<string> {
  const order = Object.keys(intentByTeam)
    .sort((a, b) => (intentByTeam[a] - intentByTeam[b]) || a.localeCompare(b));
  const take = Math.floor(order.length * ACADEMY_SERIOUS_SHARE);
  return new Set(order.slice(order.length - take));
}

/** Everything the academy pass needs about one club for one season-end. */
export interface AcademySeasonInput {
  /** Prize + TV + transfer income booked this season (EUR millions). */
  revenue: number;
  /** Cash on hand after income and salaries have landed (EUR millions). */
  cash: number;
  /** This season's wage bill (EUR millions). */
  wage: number;
  /** The club's doctrine academy axis, 0.05..0.95. */
  academyAxis: number;
  /** Coach academy bias, already centred against the league mean. */
  coachBias: number;
  /** Club reputation, 0..100. */
  reputation: number;
  /** Whether this club's investment intent ranked in the league's top third. */
  seriousRank: boolean;
}

export function deriveInitialAcademyState(): AcademyState {
  return { level: ACADEMY_LEVEL_DEFAULT, investmentStreak: 0, lastInvested: 0 };
}

export function clampAcademyLevel(value: number): number {
  return Math.max(ACADEMY_LEVEL_MIN, Math.min(ACADEMY_LEVEL_MAX, value));
}

/** Investment intent: the academy axis scaled by the manager's opinion. */
export function computeInvestRatio(academyAxis: number, coachBias: number): number {
  return Math.max(0.05, Math.min(1, academyAxis * (1 + coachBias)));
}

/**
 * Low-reputation clubs buy more academy level per euro.
 *
 * This is the counterweight to the A+ transfer market, which handed a
 * directional advantage to whoever already had cash. rep 40 -> x1.42,
 * rep 70 -> x1.14, rep 95 -> x0.90.
 */
export function academyReputationMultiplier(reputation: number): number {
  const rep = Math.max(0, Math.min(100, reputation));
  return 1 + ((85 - rep) / 85) * 0.8;
}

/** Cash above the wage buffer. Zero for a club that cannot afford to invest. */
export function computeAffordable(cash: number, wage: number): number {
  return Math.max(0, cash - wage * ACADEMY_WAGE_BUFFER_SEASONS);
}

/**
 * Euros (millions) this club puts into its academy this season.
 *
 * Callers MUST deduct exactly this amount from cash and pass the same number
 * back into `driftAcademyState`, so the level never reflects money that was not
 * actually spent.
 */
export function computeAcademyInvestment(input: AcademySeasonInput): number {
  const revenueBudget = Math.max(0, input.revenue) * ACADEMY_REVENUE_CAP;
  const budget = Math.min(revenueBudget, computeAffordable(input.cash, input.wage));
  if (budget <= 0) return 0;
  const ratio = computeInvestRatio(input.academyAxis, input.coachBias);
  return Math.round(budget * ratio * 10) / 10;
}

export function academyStreakBonus(streak: number): number {
  return Math.min(ACADEMY_STREAK_CAP, Math.max(0, streak) * ACADEMY_STREAK_STEP);
}

/**
 * The level this club's spending supports.
 *
 * `effectiveShare` is the REALISED investment against the revenue ceiling, not the
 * intent: a club whose wage buffer left it unable to fund the academy gets a
 * share of zero and decays towards the floor, however keen its doctrine says it
 * is. Scoring intent instead would let a broke club's academy keep improving,
 * which is the exact bug the streak term had in the first draft.
 */
export function academyTarget(
  input: AcademySeasonInput,
  invest: number,
  streak: number,
): number {
  const revenueBudget = Math.max(0, input.revenue) * ACADEMY_REVENUE_CAP;
  const effectiveShare = revenueBudget > 0
    ? (invest / revenueBudget) * academyReputationMultiplier(input.reputation)
    : 0;
  return (
    ACADEMY_TARGET_INTERCEPT
    + ACADEMY_TARGET_INVEST_WEIGHT * effectiveShare
    + academyStreakBonus(streak)
    + (input.reputation - 70) * ACADEMY_TARGET_REP_WEIGHT
  );
}

/**
 * Advance one club's academy by a season.
 *
 * `invest` must be the value returned by `computeAcademyInvestment` for the same
 * input — the caller owns the cash side of the transaction.
 *
 * Four properties, each of which the first draft got wrong:
 *   1. The streak bonus is part of the TARGET, not a per-season addend. As an
 *      addend under a converging update it becomes a constant offset of
 *      bonus / convergence (the draft's +6 at 0.22 was a flat +27 for everyone),
 *      which compresses the level range and pins it against the clamp.
 *   2. The streak only advances when the club actually funded the academy.
 *      Ranking high on intent while broke does not count.
 *   3. The realised investment drives the target, not the intent (see above).
 *   4. Convergence is slower than doctrine's, so an academy tradition outlives
 *      the managers who built it.
 */
export function driftAcademyState(
  prev: AcademyState,
  input: AcademySeasonInput,
  invest: number,
  rng: SeededRNG,
): AcademyState {
  const streak = input.seriousRank && invest > 0
    ? prev.investmentStreak + 1
    : Math.max(0, prev.investmentStreak - 1);
  const target = academyTarget(input, invest, streak);
  const noise = (rng.next() - 0.5) * 2 * ACADEMY_NOISE;
  const level = clampAcademyLevel(
    prev.level + (target - prev.level) * ACADEMY_CONVERGENCE + noise,
  );
  return { level, investmentStreak: streak, lastInvested: invest };
}

/** Coarse label for the team page. Bands sit inside [15, 95]. */
export function describeAcademyLevel(level: number): string {
  if (level >= 80) return '顶级青训';
  if (level >= 65) return '青训强项';
  if (level >= 45) return '中规中矩';
  if (level >= 30) return '青训薄弱';
  return '形同虚设';
}