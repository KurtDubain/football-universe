import type { PlayerPosition, PlayerSeasonStats, PlayerTeamSeasonStats } from '../../types/player';
import { PLAYER_STAT_COUNTER_FIELDS } from './player-stat-fields';

/**
 * Appearances at which the soft confidence factor reaches 0.5.
 *
 * Read on appearances, not minutes. One match is one observation: a forward
 * who starts and is replaced on the hour was observed once, exactly like a
 * keeper who plays the full ninety. Reading the same season on minutes made
 * the sample size itself a position tax. Measured over 240 seasons the median
 * forward played 25 matches on 1,497 minutes while the median keeper played 25
 * matches on 2,250, so the forward's confidence sat at 0.714 against the
 * keeper's 0.789 — and that 0.075 is applied to the whole distance from 50,
 * which is what pushed keepers to 1.91 times their pool share in the season
 * top twenty. On appearances both read 0.758 and the tax is gone. Small
 * samples still shrink: 2 appearances reads 0.20, 8 reads 0.50.
 */
export const PLAYER_CONFIDENCE_APPEARANCES = 8;
/**
 * Upper bound for position quality and season score.
 *
 * Deliberately above 100. Capping at 100 made the strongest seasons tie: 74
 * player-seasons reached exactly 100 under the v2 scale, 39 of them on fewer
 * than 20 appearances, and once several candidates tie the award falls through
 * to a uuid comparison — which is a coin flip dressed up as a ranking.
 */
export const PLAYER_SCORE_CEILING = 120;
/** Kept as a compatibility export; ranking no longer has a hard minute gate. */
export const PLAYER_RANKING_MINUTES = 0;
/**
 * Bumped whenever the cross-position calibration below changes, so archived
 * seasons keep a readable marker of the scale they were scored on.
 *
 * v2: defender scale narrowed 1.85 -> 1.60. The old value made defenders the
 * highest-variance position (P10 lowest, P90 level with everyone else) and
 * handed 40% of Ballon d'Or wins to centre-backs. See
 * docs/score-params-simulation-report.md for the 50-season comparison.
 *
 * v3: every anchor and every calibration constant resampled from a completed
 * 54-season world (seed 698104882, 11,255 top-flight season rows at 20+
 * appearances). The v2 anchors were sampled from an older simulator whose
 * scoring rates no longer hold: measured against live data the forward goal
 * anchor was 28% low, the goalkeeper routine-save anchor 22% low, and three
 * sparse anchors (defender blocks, midfielder extra passes, midfielder extra
 * chances) had a real median of ZERO while the anchor claimed 0.033-0.039 —
 * so more than half of all players scored a flat 40 on those terms.
 *
 * The v3 calibration puts every position's median on 50 and its P99 on 93,
 * which is what makes the four scales comparable at all. Goalkeeper P99 moves
 * 81.0 -> 93.0; under v2 no keeper could reach 90 in 54 seasons.
 *
 * v4: v3 sampled its anchors from the top flight only but applied them to all
 * three tiers, and the lower divisions generate far fewer shots. The median
 * second- and third-tier goalkeeper fell to 16.2 and 14.9 out of 120, because
 * the two terms carrying 55% of the goalkeeper weight were both far below their
 * p10; `scripts/audit-player-performance.ts` went from passing to failing on
 * cross-position median spread (0.9 -> 9.4). v4 makes anchors and calibration
 * per tier — 54 anchor groups instead of 18 — and resamples all of them from 288
 * completed seasons at 900+ minutes. Every one of the twelve position/tier
 * groups now has its median on 50 and its P99 on 93.
 *
 * v5: the two minute-driven terms are both cut back. Availability moves from
 * 0.20 to 0.15 and from a 0.60/0.40 minute/appearance split to 0.25/0.75, and
 * the confidence constant drops 900 -> 600. The simulator substitutes 54.7%
 * of starting forwards against 8-10% of defenders and midfielders, so a
 * season score that leaned on minutes was quietly a position tax: across 120
 * seasons not one forward finished top of the league, and the forward share
 * of the Ballon d'Or had fallen to 3%. Under v5 the forward share of the
 * season-score top ten goes 5% -> 11%, and the cross-position median spread
 * tightens from 2.2 to 0.5.
 *
 * v6: the confidence factor reads appearances instead of minutes, and the
 * calibration table is solved rather than tuned. Reading sample size on minutes
 * was itself a position tax — the median forward plays the same 25 matches as
 * the median keeper but 753 fewer minutes, because the simulator substitutes
 * 54.7% of starting forwards, so the forward's confidence sat 0.075 under the
 * keeper's and that gap was applied to the whole distance from 50. On
 * appearances both read 0.758 and the tax is gone. With it gone the table no
 * longer has to absorb the difference: median and scale now come from a single
 * formula that lands every group's P95 on 82, replacing twelve hand-picked
 * pairs. Verified on a disjoint seed set, the season-score top twenty moves
 * from pool multipliers of 1.91/0.97/0.97/0.72 to 1.16/1.01/1.02/0.88.
 *
 * v7: every per-90 rate is shrunk toward its own p50 anchor over a 1,440-minute
 * prior before it is scored. Until v6 a rate was read at face value no matter
 * how little it had been observed over, so a substitute whose goals, assists
 * and big chances all happened to land above their p90 anchors collected three
 * capped sub-scores at once and outscored a 36-goal striker. Measured over 144
 * seasons, the top of the season table was a player with more substitute
 * appearances than starts 17.4% of the time and a player with no starts at all
 * 7.0% of the time. The median small-sample season was already LOW (33.6
 * position quality under 600 minutes against 51.5 over 3,000), so this is a fat
 * right tail rather than a shifted distribution, which is what a prior fixes
 * and a threshold cannot. Verified on a seed set disjoint from the one the
 * offsets were re-solved on, the top of the table goes from 26.8% substitute-led
 * to 8.9%, from 5.4% never-started to 1.2%, and the lowest minute total any
 * season leader carried rises from 442 to 1,021.
 */
export const PLAYER_SCORE_VERSION = 8;

export type PlayerScoreConfidence = 'none' | 'low' | 'medium' | 'high';

export interface PlayerPerformanceMetrics {
  minutes: number;
  appearances: number;
  starts: number;
  teamMatchesAllCompetitions: number;
  missedMatches: number;
  injuryAbsenceMatches: number;
  minuteAttendanceRate: number;
  appearanceRate: number;
  goalsPer90: number;
  assistsPer90: number;
  extraBigChancesPer90: number;
  extraKeyPassesPer90: number;
  attackContributionPer90: number;
  routineSavesPer90: number;
  keySavesPer90: number;
  savePercentage: number;
  /** Shots on target this player faced. The sample a save percentage is read over. */
  shotsFaced: number;
  cleanSheetContribution: number;
  goalsConcededPer90: number;
  interceptionsPer90: number;
  clearancesPer90: number;
  goalLineBlocksPer90: number;
}

export interface PlayerPerformanceResult {
  /** Cross-position, attendance-aware season score. */
  score: number;
  seasonScore: number;
  /** Position-specific output before sample and attendance adjustment. */
  positionQuality: number;
  adjustedPositionQuality: number;
  availabilityScore: number;
  leagueStrength: number;
  confidence: number;
  confidenceLabel: PlayerScoreConfidence;
  scoreVersion: number;
  grade: string;
  /** Any player with actual minutes is rankable; confidence remains visible. */
  eligible: boolean;
  metrics: PlayerPerformanceMetrics;
}

interface MetricAnchors {
  p10: number;
  p50: number;
  p90: number;
}

// Anchors sampled from 288 completed seasons across 24 independent seeds
// (20260808 + n*104729), taking every season row with 900+ minutes — the point
// where the confidence factor below reaches 0.5. They are never rebuilt from
// the live universe, so the same performance keeps the same score across saves.
//
// Anchors are per league tier. The simulator generates far fewer shots in the
// lower divisions and a keeper's rate metrics collapse with them: a top-flight
// keeper makes 3.76 routine saves per 90 and stops 76.8% of what he faces, a
// third-tier keeper makes 1.50 and stops 54.7%. Scoring every tier against
// top-flight anchors pinned the median lower-division keeper to 15 out of 120,
// because the two terms carrying 55% of the goalkeeper weight were both far
// below their p10. Per-tier anchors make positionQuality mean "how good,
// against the players you actually face"; which tier that was is carried by
// `leagueStrength` in the season score.
//
// Sparse terms (zero in more than 5% of rows, scored through `sparseMetric`)
// take their P10/P50 from the NON-ZERO rows only. Sampling those from the full
// population would put the anchor at zero and make `sparseMetric` jump from its
// flat 40 baseline straight to the 50-90 band on the first non-zero event; the
// non-zero basis holds that step to about 3 points.
type LeagueTier = 1 | 2 | 3;

interface PositionAnchorSet {
  [group: string]: MetricAnchors;
}

const ANCHORS: Record<PlayerPosition, Record<LeagueTier, PositionAnchorSet>> = {
  GK: {
    1: {
      savePercentage: { p10: 0.6571, p50: 0.7682, p90: 0.8495 },
      keySaves: { p10: 0.0811, p50: 0.1271, p90: 0.2087 },
      goalsConceded: { p10: 0.7241, p50: 1.1628, p90: 1.8387 },
      routineSaves: { p10: 3.3113, p50: 3.7568, p90: 4.1667 },
      cleanSheets: { p10: 0.1667, p50: 0.3514, p90: 0.5338 },
    },
    2: {
      savePercentage: { p10: 0.5517, p50: 0.6556, p90: 0.7544 },
      keySaves: { p10: 0.0455, p50: 0.0899, p90: 0.165 },
      goalsConceded: { p10: 0.913, p50: 1.3973, p90: 1.92 },
      routineSaves: { p10: 2.1333, p50: 2.5714, p90: 3 },
      cleanSheets: { p10: 0.1304, p50: 0.2727, p90: 0.4655 },
    },
    3: {
      savePercentage: { p10: 0.4167, p50: 0.5469, p90: 0.6757 },
      keySaves: { p10: 0.0462, p50: 0.0492, p90: 0.1445 },
      goalsConceded: { p10: 0.8333, p50: 1.2778, p90: 1.8 },
      routineSaves: { p10: 1.1333, p50: 1.5, p90: 1.8824 },
      cleanSheets: { p10: 0.1429, p50: 0.3125, p90: 0.4828 },
    },
  },
  DF: {
    1: {
      interceptions: { p10: 1.0333, p50: 1.3279, p90: 1.6596 },
      clearances: { p10: 1.5495, p50: 1.9286, p90: 2.3529 },
      blocks: { p10: 0.0234, p50: 0.0295, p90: 0.0667 },
      goalsConceded: { p10: 0.7105, p50: 1.1478, p90: 1.8414 },
      cleanSheets: { p10: 0.1668, p50: 0.3543, p90: 0.5366 },
      attack: { p10: 0.0435, p50: 0.0749, p90: 0.1302 },
    },
    2: {
      interceptions: { p10: 0.9524, p50: 1.3134, p90: 1.7143 },
      clearances: { p10: 1.35, p50: 1.7885, p90: 2.2689 },
      blocks: { p10: 0.0411, p50: 0.05, p90: 0.0789 },
      goalsConceded: { p10: 0.9, p50: 1.3889, p90: 1.9315 },
      cleanSheets: { p10: 0.1304, p50: 0.2712, p90: 0.4627 },
      attack: { p10: 0.04, p50: 0.05, p90: 0.1343 },
    },
    3: {
      interceptions: { p10: 0.8333, p50: 1.1917, p90: 1.6 },
      clearances: { p10: 1.0714, p50: 1.5, p90: 2 },
      blocks: { p10: 0.0526, p50: 0.0625, p90: 0.0771 },
      goalsConceded: { p10: 0.8276, p50: 1.2778, p90: 1.8 },
      cleanSheets: { p10: 0.1333, p50: 0.3077, p90: 0.4828 },
      attack: { p10: 0.0545, p50: 0.0667, p90: 0.1333 },
    },
  },
  MF: {
    1: {
      assists: { p10: 0.0321, p50: 0.1262, p90: 0.2419 },
      extraPasses: { p10: 0.0227, p50: 0.0294, p90: 0.0667 },
      goals: { p10: 0, p50: 0.0863, p90: 0.2177 },
      extraChances: { p10: 0.0226, p50: 0.0286, p90: 0.0654 },
      interceptions: { p10: 0.5206, p50: 0.7192, p90: 0.9519 },
      clearances: { p10: 0.7986, p50: 1.0513, p90: 1.3445 },
    },
    2: {
      assists: { p10: 0, p50: 0.1053, p90: 0.2471 },
      extraPasses: { p10: 0.0417, p50: 0.0526, p90: 0.0769 },
      goals: { p10: 0, p50: 0.0645, p90: 0.1935 },
      extraChances: { p10: 0.0411, p50: 0.0526, p90: 0.0741 },
      interceptions: { p10: 0.4667, p50: 0.72, p90: 1 },
      clearances: { p10: 0.6698, p50: 0.9808, p90: 1.3259 },
    },
    3: {
      assists: { p10: 0, p50: 0.1053, p90: 0.2449 },
      extraPasses: { p10: 0.0526, p50: 0.0625, p90: 0.0825 },
      goals: { p10: 0, p50: 0.0667, p90: 0.2 },
      extraChances: { p10: 0.0526, p50: 0.0625, p90: 0.0769 },
      interceptions: { p10: 0.4, p50: 0.6667, p90: 0.9444 },
      clearances: { p10: 0.5333, p50: 0.82, p90: 1.1667 },
    },
  },
  FW: {
    1: {
      goals: { p10: 0.1755, p50: 0.4654, p90: 1.0227 },
      assists: { p10: 0, p50: 0.043, p90: 0.1237 },
      extraChances: { p10: 0.0455, p50: 0.0956, p90: 0.2051 },
      extraPasses: { p10: 0.0236, p50: 0.0342, p90: 0.0701 },
    },
    2: {
      goals: { p10: 0.1333, p50: 0.3661, p90: 0.7368 },
      assists: { p10: 0, p50: 0.0476, p90: 0.1364 },
      extraChances: { p10: 0.0448, p50: 0.0667, p90: 0.1304 },
      extraPasses: { p10: 0.0426, p50: 0.0555, p90: 0.079 },
    },
    3: {
      goals: { p10: 0.1333, p50: 0.3673, p90: 0.7347 },
      assists: { p10: 0, p50: 0, p90: 0.1333 },
      extraChances: { p10: 0.0545, p50: 0.0668, p90: 0.1333 },
      extraPasses: { p10: 0.0556, p50: 0.0631, p90: 0.0894 },
    },
  },
};

// Both fields are solved, never tuned by hand. For each position/tier group:
//
//   median = the group's raw-quality median, so the group lands on 50
//   scale  = (P95_TARGET - 50) / (the group's raw P95 - the group's raw median)
//
// with P95_TARGET = 82. That puts all twelve separately-shaped raw
// distributions on the same number at P95 — the region where awards are
// actually decided — instead of only at the median. Raise or lower the target
// and the entire table recomputes from one formula; there is no second knob to
// chase afterwards.
//
// Fitted on 24 seeds x 12 seasons (110,738 rows at 900+ minutes) and verified
// on a disjoint seed set. Under the previous hand-tuned table the season-score
// top twenty ran at keeper/defender/midfielder/forward pool multipliers of
// 1.91/0.97/0.97/0.72; here it reads 1.16/1.01/1.02/0.88.
//
// These are the raw formula outputs, before the tier rule below.
const RAW_POSITION_QUALITY_CALIBRATION: Record<
  PlayerPosition,
  Record<LeagueTier, { median: number; scale: number }>
> = {
  GK: { 1: { median: 52.07, scale: 1.953 }, 2: { median: 51.21, scale: 2.907 }, 3: { median: 52.48, scale: 2.837 } },
  DF: { 1: { median: 50.67, scale: 3.22 }, 2: { median: 50.24, scale: 4.471 }, 3: { median: 48.75, scale: 4.586 } },
  MF: { 1: { median: 48.95, scale: 2.731 }, 2: { median: 47.55, scale: 4.712 }, 3: { median: 47.22, scale: 4.997 } },
  FW: { 1: { median: 49.57, scale: 2.578 }, 2: { median: 46.58, scale: 3.635 }, 3: { median: 45.01, scale: 3.674 } },
};

/**
 * No tier is stretched further than the top flight of the same position.
 *
 * The formula above assumes a group's raw spread means something. In the lower
 * divisions it often does not: 86% to 96% of second- and third-tier rows are
 * zero on the sparse counters, so the raw distribution collapses around its
 * sparse-metric baselines and the formula answers by stretching whoever is left
 * — up to a scale of 5.0 for a third-tier midfielder against 2.7 in the top
 * flight. At that stretch one recorded key pass is worth more position quality
 * than a full season of goals, and the players collecting those single events
 * are the ones with the fewest minutes.
 *
 * The top flight has the widest and best-estimated distribution for each
 * position. A lower tier is narrower mostly because less football happens in
 * the data, not because its players are genuinely more alike, so it inherits the
 * top flight's stretch rather than being stretched to fit its own. The medians
 * are untouched, so a tier-median season still reads the same in every
 * division; only the spread above the median is compressed, which is also the
 * honest answer to "how much better than his own division is this player".
 *
 * Measured at the same prior on a seed set disjoint from the one the offsets
 * are solved on, this is what moves the share of season leaders under 1,200
 * minutes from 3.0% to 0.6% and their p10 from 1,350 minutes to 1,954.
 */
function capTierScales(
  raw: Record<PlayerPosition, Record<LeagueTier, { median: number; scale: number }>>,
): Record<PlayerPosition, Record<LeagueTier, { median: number; scale: number }>> {
  const capped = {} as Record<PlayerPosition, Record<LeagueTier, { median: number; scale: number }>>;
  for (const position of Object.keys(raw) as PlayerPosition[]) {
    const limit = raw[position][1].scale;
    capped[position] = {
      1: raw[position][1],
      2: { median: raw[position][2].median, scale: Math.min(raw[position][2].scale, limit) },
      3: { median: raw[position][3].median, scale: Math.min(raw[position][3].scale, limit) },
    };
  }
  return capped;
}

const POSITION_QUALITY_CALIBRATION = capTierScales(RAW_POSITION_QUALITY_CALIBRATION);

/**
 * Cross-position value weight, in position-quality points.
 *
 * The calibration table above makes each position internally fair — every
 * group lands on 50 at its own median and on 82 at its own P95 — but internal
 * fairness is not the same as cross-position value. Left at zero, the season
 * top twenty came out at keeper/defender/midfielder/forward pool multipliers of
 * 1.21/0.98/1.03/0.89 and the single best player was a defender or midfielder
 * 83% of the time, which is not how football works: goals decide matches and a
 * keeper who never scores is not worth a forward who scores thirty.
 *
 * These four numbers are solved, not chosen. Take the target share of the top
 * twenty (1:2:3:3 by position), convert it to the percentile each position must
 * reach to fill that share, read the season score at that percentile, and the
 * offset is the distance from the common threshold. Solving on 196 seasons of a
 * seed set disjoint from the one the calibration was fitted on puts the top
 * twenty at 11.3/22.3/33.0/33.4 percent against a target of 11.1/22.2/33.3/33.3.
 *
 * Re-solved for score version 7, because the rate shrinkage above changes the
 * shape these offsets are read against. Shrinking removes the small-sample tail
 * that had been inflating forwards, so the forward offset carries more of the
 * real gap (+5.95 -> +6.82) while midfielder and defender fall back toward the
 * keeper. Solved on 196 seasons (14 seeds x 14 seasons) against the real scorer
 * rather than a re-implementation, this lands the top twenty at 11.1/22.2/33.4/33.2.
 *
 * Re-solved again for score version 8, which moved the shape three ways: the
 * forward and the midfielder each gained terms (key passes, and
 * interceptions/clearances), the rate prior went from 1,440 to 2,520 minutes,
 * and the zero-heavy counters moved from their non-zero anchor median to their
 * population median. The calibration table above was resampled at the same time
 * — it had drifted off its own stated target, since the last audit measured
 * position-quality P99 at 78.2-83.6 when a P95 of 82 makes anything below 82 at
 * P99 impossible. Solved on the same 196 seasons against the real scorer, by
 * analytic inversion of the quantile row's own sensitivity rather than by
 * fixed-step iteration — the step form silently omits the calibration scale and
 * diverges once that scale passes 2 — this lands the top twenty at
 * 11.12/22.24/33.34/33.29.
 *
 * They are deliberately small — the widest gap is 12.4 points between defender
 * and forward — because the anchors, not this table, are what carry a position's
 * character. Raise the target share for a position and its offset recomputes
 * from the same percentile arithmetic.
 */
export const POSITION_VALUE_OFFSET: Record<PlayerPosition, number> = {
  GK: 0.61,
  DF: -6.11,
  MF: -0.83,
  FW: 6.33,
};

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function per90(value: number, minutes: number): number {
  return minutes > 0 ? value * 90 / minutes : 0;
}

/**
 * Prior strength, in minutes, for shrinking a rate toward its own anchor.
 *
 * 2,520 minutes is twenty-eight full matches: the point at which a player's own
 * rate and the positional average are weighted equally. It was 1,440 under
 * score version 7 and is re-derived rather than carried over, because version 8
 * changed what is being shrunk — the forward went from three terms to four and
 * the midfielder from four to six, and the zero-heavy terms moved to a
 * population prior — and a prior fitted to one weighted sum is not the knee of
 * another. Re-measured on a seed set disjoint from the one the offsets are
 * solved on, 2,520 puts the season leader's p10 at 1,954 minutes and its median
 * at 3,510, against 1,528 and 3,510 under version 7, and the share of leaders
 * under 1,200 minutes at 0.6% against 1.2%. At 1,440 the same measurement reads
 * 1,342 and 2,567 with 5.4% of leaders under 1,200 minutes.
 *
 * Raising it never reorders two players who played the same amount — see
 * `shrunkByMinutes` — so the only cost is that a shorter season needs a larger
 * rate advantage to beat a longer one, which is the point.
 *
 * Without it a rate is read at face value no matter how little it was
 * observed over. A forward who came on for 454 minutes and scored 5 goals
 * reads 0.99 goals per 90; if his assist and big-chance rates happen to land
 * above their p90 anchors as well, all three forward terms cap at 100 and he
 * outscores a 42-goal striker. Measured over 144 seasons that put a player
 * with more substitute appearances than starts at the top of the season table
 * in 17.4% of seasons, and a player with no starts at all in 7.0% — the worst
 * case being a midfielder with 1 goal and 3 assists in 625 minutes.
 *
 * The prior for an ordinary rate is that metric's own p50 anchor, so shrinkage
 * pulls toward "an ordinary season at this position and tier" rather than
 * toward a number chosen here; zero-heavy rates shrink toward their population
 * median instead, see `shrunkSparse`. Note that the median small-sample season was already low
 * (33.6 position quality under 600 minutes against 51.5 over 3,000): this is a
 * fat right tail, not a shifted distribution, which is exactly what a prior
 * fixes and a threshold cannot.
 */
const RATE_PRIOR_MINUTES = 2520;

/**
 * Shrink an intensive value observed over `minutes` toward `prior`.
 *
 * At 2,520 minutes the observation and the prior are weighted equally; at
 * 3,000 the observation keeps 54% of the weight, so a full season keeps most of
 * itself, while a 454-minute substitute keeps 15% and is mostly replaced.
 *
 * The map is monotone in `value` at fixed `minutes`, so raising the prior never
 * reorders two players who played the same amount — it only changes how much
 * rate advantage a shorter season needs to beat a longer one.
 */
function shrunkByMinutes(value: number, minutes: number, prior: number): number {
  if (minutes <= 0) return prior;
  return (value * minutes + RATE_PRIOR_MINUTES * prior) / (minutes + RATE_PRIOR_MINUTES);
}

/**
 * Population median of each zero-heavy counter, over every season row at 900+
 * minutes rather than the non-zero basis its anchor is sampled from.
 *
 * Only the exceptions are listed. In fifteen of the twenty-one position x tier
 * x counter groups more than half of all rows are zero, so the population median
 * really is zero and the default below is the measured value rather than a
 * shortcut. The six entries here are the groups where a majority of players
 * recorded at least one: top-flight and lower-division keepers make key saves
 * in 51% to 92% of seasons, a defender's goal-or-assist rate is non-zero for
 * 47% to 74% of them, and a top-flight forward creates a big chance he does not
 * convert in 70%.
 */
const SPARSE_POPULATION_MEDIAN: Record<string, number> = {
  'GK|1|keySaves': 0.0811,
  'GK|2|keySaves': 0.0469,
  'GK|3|keySaves': 0.0484,
  'DF|1|attack': 0.0427,
  'DF|2|attack': 0.0417,
  'FW|1|extraChances': 0.0496,
};

/**
 * Shrink a zero-heavy rate toward its population median, not toward its anchor.
 *
 * `sparseMetric` exists precisely because zero is the common outcome for these
 * counters, and its anchors are sampled from the NON-ZERO rows so that a first
 * event does not jump the sub-score from its flat 40 baseline straight into the
 * 50-90 band. That non-zero median is the right shape for the curve and the
 * wrong centre for a prior: as a prior it claims that a player with no evidence
 * at all should be read as though he matched someone who recorded at least one
 * event. Measured over 288 seasons the zero share runs from 8% to 96%, and
 * shrinking toward the non-zero median handed thin samples a free 50 to 65 on
 * exactly the terms where a full season of nothing scores 40 — which is how a
 * forward with 450 minutes and no starts reached the top of the season table.
 *
 * Shrinking toward the population median keeps the damping — a rate observed
 * over 500 minutes keeps 17% of its face value — while making an unobserved
 * counter read as the below-average baseline it is. Ordinary rates are
 * untouched: their prior is already the all-rows median, so both kinds of rate
 * now shrink toward the centre of the population they are drawn from.
 */
function shrunkSparse(
  value: number,
  minutes: number,
  position: PlayerPosition,
  tier: LeagueTier,
  metric: string,
): number {
  return shrunkByMinutes(value, minutes, SPARSE_POPULATION_MEDIAN[`${position}|${tier}|${metric}`] ?? 0);
}

/** Same shrinkage for a share observed over a count that is not minutes. */
function shrunkByCount(value: number, count: number, prior: number, priorCount: number): number {
  if (count <= 0) return prior;
  return (value * count + priorCount * prior) / (count + priorCount);
}

function interpolate(value: number, from: number, to: number, low: number, high: number): number {
  if (to <= from) return high;
  return low + clamp((value - from) / (to - from), 0, 1) * (high - low);
}

/** P10→25, P50→50 and P90→85, with bounded tails. */
function anchoredMetric(value: number, anchors: MetricAnchors): number {
  if (value <= anchors.p10) {
    return anchors.p10 > 0 ? interpolate(value, 0, anchors.p10, 0, 25) : 25;
  }
  if (value <= anchors.p50) return interpolate(value, anchors.p10, anchors.p50, 25, 50);
  if (value <= anchors.p90) return interpolate(value, anchors.p50, anchors.p90, 50, 85);
  const upper = anchors.p90 + Math.max(anchors.p90 - anchors.p50, anchors.p90 * 0.25, 0.01);
  return interpolate(value, anchors.p90, upper, 85, 100);
}

/** Zero-heavy match events keep a below-average baseline instead of collapsing the scale. */
function sparseMetric(value: number, positiveAnchors: MetricAnchors): number {
  if (value <= 0) return 40;
  if (value <= positiveAnchors.p10) return interpolate(value, 0, positiveAnchors.p10, 40, 50);
  if (value <= positiveAnchors.p50) return interpolate(value, positiveAnchors.p10, positiveAnchors.p50, 50, 65);
  if (value <= positiveAnchors.p90) return interpolate(value, positiveAnchors.p50, positiveAnchors.p90, 65, 90);
  const upper = positiveAnchors.p90 + Math.max(positiveAnchors.p90 - positiveAnchors.p50, 0.01);
  return interpolate(value, positiveAnchors.p90, upper, 90, 100);
}

function inverseMetric(value: number, anchors: MetricAnchors): number {
  if (value <= anchors.p10) {
    const lower = Math.max(0, anchors.p10 - (anchors.p50 - anchors.p10));
    return interpolate(value, lower, anchors.p10, 100, 85);
  }
  if (value <= anchors.p50) return interpolate(value, anchors.p10, anchors.p50, 85, 50);
  if (value <= anchors.p90) return interpolate(value, anchors.p50, anchors.p90, 50, 25);
  const upper = anchors.p90 + Math.max(anchors.p90 - anchors.p50, 0.1);
  return interpolate(value, anchors.p90, upper, 25, 0);
}

function scoreToGrade(score: number, eligible: boolean): string {
  if (!eligible) return '—';
  if (score >= 85) return 'S';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

function confidenceLabel(confidence: number, minutes: number): PlayerScoreConfidence {
  if (minutes <= 0) return 'none';
  if (confidence < 0.25) return 'low';
  if (confidence < 0.5) return 'medium';
  return 'high';
}

export function leagueStrengthScore(level?: 1 | 2 | 3): number {
  if (level === 2) return 95;
  if (level === 3) return 90;
  return 100;
}

export function getPlayerPerformanceMetrics(stats?: PlayerSeasonStats): PlayerPerformanceMetrics {
  const appearances = stats?.appearances ?? 0;
  const starts = stats?.starts ?? appearances;
  const minutes = stats?.minutesPlayed ?? appearances * 90;
  const teamMatches = Math.max(appearances, stats?.teamMatchesAllCompetitions ?? appearances);
  const goals = stats?.goals ?? 0;
  const assists = stats?.assists ?? 0;
  const routineSaves = stats?.routineSaves ?? 0;
  const keySaves = stats?.saves ?? 0;
  const goalsConceded = stats?.goalsConcededWhileOnPitch ?? 0;
  const shotsFaced = stats?.shotsOnTargetFaced ?? routineSaves + keySaves + goalsConceded;
  const cleanSheetMinutes = stats?.cleanSheetMinutes
    ?? Math.min(minutes, (stats?.cleanSheets ?? 0) * 60);

  return {
    minutes,
    appearances,
    starts,
    teamMatchesAllCompetitions: teamMatches,
    missedMatches: stats?.missedMatches ?? Math.max(0, teamMatches - appearances),
    injuryAbsenceMatches: stats?.injuryAbsenceMatches ?? 0,
    minuteAttendanceRate: teamMatches > 0 ? clamp(minutes / (teamMatches * 90), 0, 1) : 0,
    appearanceRate: teamMatches > 0 ? clamp(appearances / teamMatches, 0, 1) : 0,
    goalsPer90: per90(goals, minutes),
    assistsPer90: per90(assists, minutes),
    extraBigChancesPer90: per90(Math.max(0, (stats?.bigChances ?? goals) - goals), minutes),
    extraKeyPassesPer90: per90(Math.max(0, (stats?.keyPasses ?? assists) - assists), minutes),
    attackContributionPer90: per90(goals + assists, minutes),
    routineSavesPer90: per90(routineSaves, minutes),
    keySavesPer90: per90(keySaves, minutes),
    savePercentage: shotsFaced > 0 ? clamp((routineSaves + keySaves) / shotsFaced, 0, 1) : 0,
    shotsFaced,
    cleanSheetContribution: minutes > 0 ? clamp(cleanSheetMinutes / minutes, 0, 1) : 0,
    goalsConcededPer90: per90(goalsConceded, minutes),
    interceptionsPer90: per90(stats?.interceptions ?? 0, minutes),
    clearancesPer90: per90(stats?.clearances ?? 0, minutes),
    goalLineBlocksPer90: per90(stats?.keyBlocks ?? 0, minutes),
  };
}

/**
 * The weighted sub-score sum, before the per-group calibration below.
 *
 * Exported so the calibration table can be resampled against the real scorer
 * instead of a re-implementation of it: `median` and `scale` are read off this
 * number's distribution, and a second copy of the weights would drift.
 */
export function rawPositionQuality(
  position: PlayerPosition,
  metrics: PlayerPerformanceMetrics,
  tier: LeagueTier,
): number {
  const anchors = ANCHORS[position][tier];
  // Every rate below is shrunk toward its own p50 anchor before it is scored,
  // so a handful of minutes cannot read as a season's worth of output.
  const S = (value: number, prior: number) => shrunkByMinutes(value, metrics.minutes, prior);
  const SZ = (value: number, metric: string) => shrunkSparse(value, metrics.minutes, position, tier, metric);
  let quality: number;
  if (position === 'FW') {
    // Four terms, in two pairs. Finishing is goals plus the big chances that
    // were denied — shots that were or would have been goals — and creation is
    // assists plus the key passes that were denied. Both pairs hold the same
    // 3:2 converted-to-denied ratio, and the position splits 0.70 finishing /
    // 0.30 creation. The forward never read `keyPasses` before this, so a
    // forward who created constantly but kept getting denied was paid nothing
    // for it while the identical miss on a shot paid 0.30.
    quality = anchoredMetric(S(metrics.goalsPer90, anchors.goals.p50), anchors.goals) * 0.42
      + sparseMetric(SZ(metrics.extraBigChancesPer90, 'extraChances'), anchors.extraChances) * 0.28
      + anchoredMetric(S(metrics.assistsPer90, anchors.assists.p50), anchors.assists) * 0.18
      + sparseMetric(SZ(metrics.extraKeyPassesPer90, 'extraPasses'), anchors.extraPasses) * 0.12;
  } else if (position === 'MF') {
    // The attacking mix is unchanged and scaled to 0.80; the remaining 0.20
    // goes to the two defensive actions a midfielder actually performs, in the
    // same 55:45 ratio the defender uses. Without them a defensive midfielder
    // had no way to score at all — the formula only ever read goals, assists
    // and the two denied variants, so a screen in front of the back four was
    // indistinguishable from a forward playing in midfield.
    quality = anchoredMetric(S(metrics.assistsPer90, anchors.assists.p50), anchors.assists) * 0.28
      + sparseMetric(SZ(metrics.extraKeyPassesPer90, 'extraPasses'), anchors.extraPasses) * 0.24
      + anchoredMetric(S(metrics.goalsPer90, anchors.goals.p50), anchors.goals) * 0.20
      + sparseMetric(SZ(metrics.extraBigChancesPer90, 'extraChances'), anchors.extraChances) * 0.08
      + anchoredMetric(S(metrics.interceptionsPer90, anchors.interceptions.p50), anchors.interceptions) * 0.11
      + anchoredMetric(S(metrics.clearancesPer90, anchors.clearances.p50), anchors.clearances) * 0.09;
  } else if (position === 'DF') {
    // Interceptions and clearances are generated from the OPPONENT's shot and
    // possession totals, so they measure how much a defence was attacked rather
    // than how well it defended: measured across 4,012 top-flight defender
    // seasons, r(team goals conceded, interceptions/90) = +0.21 and
    // r(.., clearances/90) = +0.26. Under the old 0.30/0.25 weighting a
    // relegation-battling centre-back outscored a title winner, and the best
    // defender award went to a bottom-four club in 4 of 54 seasons.
    //
    // Weight moves from those two counts onto the two terms that actually
    // record an outcome — goals conceded while on the pitch and clean-sheet
    // share — which takes r(team goals conceded, defender quality) from -0.12
    // to -0.53 and drops the bottom-four wins to zero.
    quality = anchoredMetric(S(metrics.interceptionsPer90, anchors.interceptions.p50), anchors.interceptions) * 0.22
      + anchoredMetric(S(metrics.clearancesPer90, anchors.clearances.p50), anchors.clearances) * 0.18
      + sparseMetric(SZ(metrics.goalLineBlocksPer90, 'blocks'), anchors.blocks) * 0.12
      + inverseMetric(S(metrics.goalsConcededPer90, anchors.goalsConceded.p50), anchors.goalsConceded) * 0.22
      + anchoredMetric(S(metrics.cleanSheetContribution, anchors.cleanSheets.p50), anchors.cleanSheets) * 0.16
      + sparseMetric(SZ(metrics.attackContributionPer90, 'attack'), anchors.attack) * 0.10;
  } else {
    // A save percentage is a share over shots faced, not over minutes, so it is
    // shrunk over its own sample. The prior count is what the anchor medians
    // imply over RATE_PRIOR_MINUTES, which keeps one constant behind both.
    const shotsPrior = RATE_PRIOR_MINUTES / 90
      * (anchors.routineSaves.p50 + anchors.keySaves.p50 + anchors.goalsConceded.p50);
    const saveRateScore = metrics.routineSavesPer90 + metrics.keySavesPer90 > 0
      ? anchoredMetric(
        shrunkByCount(metrics.savePercentage, metrics.shotsFaced, anchors.savePercentage.p50, shotsPrior),
        anchors.savePercentage,
      )
      : 50;
    quality = saveRateScore * 0.35
      + sparseMetric(SZ(metrics.keySavesPer90, 'keySaves'), anchors.keySaves) * 0.25
      + anchoredMetric(S(metrics.routineSavesPer90, anchors.routineSaves.p50), anchors.routineSaves) * 0.20
      + inverseMetric(S(metrics.goalsConcededPer90, anchors.goalsConceded.p50), anchors.goalsConceded) * 0.15
      + anchoredMetric(S(metrics.cleanSheetContribution, anchors.cleanSheets.p50), anchors.cleanSheets) * 0.05;
  }
  return quality;
}

/**
 * Calibrated position quality: the raw weighted sum mapped so that every
 * position x tier group lands on 50 at its own median and 82 at its own P95,
 * then shifted by the cross-position value weight.
 */
function computePositionQuality(
  position: PlayerPosition,
  metrics: PlayerPerformanceMetrics,
  tier: LeagueTier,
): number {
  const calibration = POSITION_QUALITY_CALIBRATION[position][tier];
  return round1(clamp(
    50 + (rawPositionQuality(position, metrics, tier) - calibration.median) * calibration.scale
      + POSITION_VALUE_OFFSET[position],
    0,
    PLAYER_SCORE_CEILING,
  ));
}

function resultFromQuality(
  positionQuality: number,
  metrics: PlayerPerformanceMetrics,
  leagueStrength: number,
): PlayerPerformanceResult {
  const confidence = metrics.appearances > 0
    ? metrics.appearances / (metrics.appearances + PLAYER_CONFIDENCE_APPEARANCES)
    : 0;
  const adjustedPositionQuality = 50 + (positionQuality - 50) * confidence;
  // Availability answers "was this player there", not "did he play the full
  // ninety". A forward who starts and is replaced on the hour every week is
  // fully available; the old 0.60 weight on minute share read him as 60%
  // available and docked him for a coach's substitution, not for being
  // absent. The simulator hooks 54.7% of starting forwards — against 9.7% of
  // defenders and 8.4% of midfielders — because a 4-4-2 leaves 1.57 forwards
  // on a bench that supplies 67% of all substitutions. Weight moves to
  // appearance share, which sits between 0.92 and 0.97 at every position.
  const availabilityScore = 100 * (
    metrics.minuteAttendanceRate * 0.25
    + metrics.appearanceRate * 0.75
  );
  const eligible = metrics.minutes > 0;
  // Availability drops from 0.20 to 0.15: the confidence factor above already
  // prices in a thin sample, and the term here was a second penalty on the same
  // minutes. Position output carries 0.75 of the score.
  const score = eligible
    ? clamp(adjustedPositionQuality * 0.75 + availabilityScore * 0.15 + leagueStrength * 0.10, 0, PLAYER_SCORE_CEILING)
    : 0;
  const roundedScore = round1(score);
  return {
    score: roundedScore,
    seasonScore: roundedScore,
    positionQuality: round1(positionQuality),
    adjustedPositionQuality: round1(adjustedPositionQuality),
    availabilityScore: round1(availabilityScore),
    leagueStrength: round1(leagueStrength),
    confidence: Math.round(confidence * 1000) / 1000,
    confidenceLabel: confidenceLabel(confidence, metrics.minutes),
    scoreVersion: PLAYER_SCORE_VERSION,
    grade: scoreToGrade(roundedScore, eligible),
    eligible,
    metrics,
  };
}

export function computePlayerPerformance(
  position: PlayerPosition,
  stats: PlayerSeasonStats | undefined,
  leagueLevel?: 1 | 2 | 3,
): PlayerPerformanceResult {
  const metrics = getPlayerPerformanceMetrics(stats);
  return resultFromQuality(
    computePositionQuality(position, metrics, leagueLevel ?? 1),
    metrics,
    leagueStrengthScore(leagueLevel),
  );
}

function aggregateSegments(segments: PlayerTeamSeasonStats[]): PlayerSeasonStats | undefined {
  const first = segments[0];
  if (!first) return undefined;
  const total = { ...first };
  for (const field of PLAYER_STAT_COUNTER_FIELDS) (total[field] as number | undefined) = 0;
  for (const segment of segments) {
    for (const field of PLAYER_STAT_COUNTER_FIELDS) {
      (total[field] as number | undefined) = Number(total[field] ?? 0) + Number(segment[field] ?? 0);
    }
  }
  return total;
}

export function computeSegmentedPlayerPerformance(
  position: PlayerPosition,
  segments: PlayerTeamSeasonStats[],
  leagueLevels: Record<string, 1 | 2 | 3 | undefined>,
  seasonTotal?: PlayerSeasonStats,
): PlayerPerformanceResult {
  const activeSegments = segments.filter(segment =>
    (segment.minutesPlayed ?? 0) > 0 || (segment.teamMatchesAllCompetitions ?? 0) > 0,
  );
  if (activeSegments.length === 0) {
    return computePlayerPerformance(position, seasonTotal, seasonTotal ? leagueLevels[seasonTotal.teamId] : undefined);
  }
  const total = seasonTotal ?? aggregateSegments(activeSegments);
  const metrics = getPlayerPerformanceMetrics(total);
  const totalMinutes = activeSegments.reduce((sum, segment) => sum + (segment.minutesPlayed ?? 0), 0);
  const weighted = (read: (segment: PlayerTeamSeasonStats) => number) => {
    if (totalMinutes <= 0) return activeSegments.reduce((sum, segment) => sum + read(segment), 0) / activeSegments.length;
    return activeSegments.reduce(
      (sum, segment) => sum + read(segment) * (segment.minutesPlayed ?? 0),
      0,
    ) / totalMinutes;
  };
  const positionQuality = weighted(segment =>
    computePositionQuality(
      position,
      getPlayerPerformanceMetrics(segment),
      leagueLevels[segment.teamId] ?? 1,
    ),
  );
  const leagueStrength = weighted(segment => leagueStrengthScore(leagueLevels[segment.teamId]));
  return resultFromQuality(positionQuality, metrics, leagueStrength);
}

export const PLAYER_STAT_SCOPE_TOOLTIPS = {
  current: '当前赛季全赛事统计，点球大战不计入球员常规数据。',
  leagueContext: '综合评分由位置表现、全赛事出勤与轻量联赛强度共同构成。',
  career: '生涯统计来自保留的赛季档案与尚未归档的当前赛季。',
  legacy: '旧赛季缺少完整评分字段时标记为旧口径，不补造历史动作。',
} as const;
