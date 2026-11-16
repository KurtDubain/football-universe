import { Player, PlayerPosition, PlayerRetirement } from '../../types/player';
import { CoachCandidate, CoachStyle } from '../../types/coach';
import { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import { GameWorld } from '../season/season-manager';
import { rollTagForUuid } from './tags';
import { pickPlayerName } from '../../config/player-names';
import { computeCurrentRating } from './development';
import { computeInitialMarketValue } from '../economy/market-value';
import { formatPlayerUuid } from './generator';
import { computePlayerCareerTotals } from './career-totals';
import { ACADEMY_LEVEL_DEFAULT } from '../clubs/academy';
import { TALENT_ERA_MAX, TALENT_ERA_MIN } from '../clubs/league-climate';

/**
 * Per-team retirement cap. If more than this many players on the same team
 * roll into retirement in a single season, only the top-N (sorted by
 * `retirementChance` descending) actually retire — the rest defer to next
 * season. Prevents a single bad rolling-dice year from gutting one squad.
 */
export const MAX_RETIREMENTS_PER_TEAM = 4;

export type YouthTalentTier = 'regular' | 'prospect' | 'elite';

/**
 * Talent-era weights on the two academy bands.
 *
 * `talentEra` is league-scoped and drifts on its own (see `league-climate`), so
 * these move the SHAPE of the graduate distribution without moving where a club
 * sits inside it — a golden generation is thicker at every club, not a rich-club
 * bonus. At the ±5 bounds the elite band scales ×1.63 / ×0.38 and the prospect
 * band ×1.30 / ×0.70.
 *
 * The elite band carries the larger weight because it is the band that decides
 * whether an era has a tail at all: the league's ≥90 population is almost
 * entirely elite-tier graduates, and a multiplier that only moved the median
 * would produce a generation that is broadly decent with no stars — which is not
 * what a golden generation means.
 */
export const TALENT_ERA_ELITE_WEIGHT = 0.125;
export const TALENT_ERA_PROSPECT_WEIGHT = 0.06;

/**
 * A bounded mixture keeps most academy graduates ordinary while preserving
 * a genuinely rare elite tail after the initial squads have retired.
 *
 * B3 split the single reputation term in two: reputation still nudges the odds,
 * but the club academy level now carries the larger share of the weight. The
 * split is calibrated so the reference club — reputation 70, academy level 50 —
 * gets EXACTLY the probabilities it got before B3:
 *
 *   eliteChance    0.012 + 0.7*0.006 + 0.5*0.0084 = 0.0204   (was 0.0204)
 *   prospectChance 0.13  + 0.7*0.025 + 0.5*0.035  = 0.165    (was 0.165)
 *
 * That conserves output at the reference POINT only. Holding the LEAGUE MEAN at
 * 50 as well is what ACADEMY_TARGET_INTERCEPT is calibrated for; without it the
 * league as a whole quietly produces more (or fewer) geniuses than before.
 *
 * Across the full spans the academy level (15..95) moves eliteChance by 0.67pp
 * against reputation (34..98) 0.38pp — the academy is the 1.8x lever.
 *
 * `talentEra` is the third, league-scoped term. B3 made the academy system
 * deliberately conservative — the league mean is pinned near 50, so with only
 * club-level inputs there is nothing that can move the LEAGUE's talent
 * distribution at all. Measured over 100 seasons, the mean rating fell from
 * 61.1 to 55 in the first 15 seasons and then sat within ±0.9 of 56 for 80 more.
 */
export function youthTalentTierChances(
  reputation: number,
  academyLevel: number,
  talentEra: number = 0,
): { eliteChance: number; prospectChance: number } {
  const normalizedReputation = Math.max(0, Math.min(100, reputation)) / 100;
  const normalizedLevel = Math.max(0, Math.min(100, academyLevel)) / 100;
  const era = Math.max(TALENT_ERA_MIN, Math.min(TALENT_ERA_MAX, talentEra));
  const eliteChance = (0.012 + normalizedReputation * 0.006 + normalizedLevel * 0.0084)
    * (1 + era * TALENT_ERA_ELITE_WEIGHT);
  const prospectChance = (0.13 + normalizedReputation * 0.025 + normalizedLevel * 0.035)
    * (1 + era * TALENT_ERA_PROSPECT_WEIGHT);
  // `rollYouthTalentTier` tests one roll against `elite` and then
  // `elite + prospect`, so the two must not sum past 1. At the current weights
  // they cannot even with every input maxed; this guards a future weight change
  // from silently making the elite tier unreachable.
  const total = eliteChance + prospectChance;
  if (total <= 1) return { eliteChance, prospectChance };
  return { eliteChance: eliteChance / total, prospectChance: prospectChance / total };
}

export function rollYouthTalentTier(
  reputation: number,
  academyLevel: number,
  rng: SeededRNG,
  talentEra: number = 0,
): YouthTalentTier {
  const { eliteChance, prospectChance } = youthTalentTierChances(reputation, academyLevel, talentEra);
  const roll = rng.next();
  if (roll < eliteChance) return 'elite';
  if (roll < eliteChance + prospectChance) return 'prospect';
  return 'regular';
}

export function capYouthPeakByTalentTier(tier: YouthTalentTier, peak: number): number {
  const ceiling = tier === 'elite' ? 98 : tier === 'prospect' ? 89 : 84;
  return Math.max(35, Math.min(ceiling, peak));
}

/**
 * Hard age cap. Once a player reaches this age, retirement is forced
 * regardless of the chance roll. Stops the simulation from accreting
 * 50-year-old zombie veterans across long campaigns.
 */
export const HARD_AGE_CAP = 42;

/** Coach pool max size. Oldest entries are evicted on overflow. */
export const COACH_POOL_CAP = 12;

/** Retirement-history cap (FIFO). */
export const RETIREMENT_HISTORY_CAP = 300;

/**
 * Probability a player retires this season-end.
 *
 * Formula:
 *   chance = clamp((age - 33) / 12 - max(0, peakRating - 80) / 100, 0, 0.95)
 *   age 38+ has a floor of 0.40 — even an elite veteran has serious odds.
 *
 * Rating bonus uses peakRating (destiny) rather than current rating, because
 * a 38yo who PEAKED at 95 should still be presumed important enough to play
 * one more year, even though their *current* rating has decayed.
 *
 * Phase G: if `hasLongTermInjury` is true and the player is 33+, a flat +20%
 * is added on top (capped at the existing 0.95). Long-term knees / Achilles
 * tend to end careers — this expresses that.
 */
export function computeRetirementChance(
  age: number,
  peakRating: number,
  hasLongTermInjury: boolean = false,
): number {
  if (age < 33) return 0;
  const ratingBonus = Math.max(0, peakRating - 80) / 100;
  let chance = (age - 33) / 12 - ratingBonus;
  if (hasLongTermInjury && age >= 33) chance += 0.20;
  chance = Math.max(0, Math.min(0.95, chance));
  if (age >= 38) chance = Math.max(0.40, chance);
  return chance;
}

/**
 * Position-preserving regional flavor. Applied AFTER the base peak roll
 * so the modifiers compose cleanly with the team-overall scaling.
 *
 * 东洲: late-bloomer (peakRating + 5, startBonus -2). Their kids ship
 *        a touch weaker but mature into stronger players — matches the
 *        "patient development" narrative for the eastern continent.
 * 大陆 DF/GK: defensive specialist (peakRating + 2, startBonus +3). Solid
 *        starting floor, slight ceiling bump. Their kids contribute
 *        immediately.
 * 南洲 FW/MF: attacking specialist (peakRating + 2, goalScoring + 10).
 *        Higher ceiling and more goal-prone.
 */
function applyRegionalFlavor(
  region: string,
  position: Player['position'],
  basePeak: number,
  startBonus: number,
  goalScoring: number,
): { peak: number; startBonus: number; goalScoring: number } {
  let peak = basePeak;
  let bonus = startBonus;
  let scoring = goalScoring;
  if (region.startsWith('东洲')) {
    peak += 5;
    bonus -= 2;
  } else if (region.startsWith('大陆') && (position === 'DF' || position === 'GK')) {
    peak += 2;
    bonus += 3;
  } else if (region.startsWith('南洲') && (position === 'FW' || position === 'MF')) {
    peak += 2;
    scoring += 10;
  }
  return { peak, startBonus: bonus, goalScoring: scoring };
}

/**
 * Reputation-tier plus academy-level bonus on peakRating: gives elite-academy
 * youths a structural edge. Layered on top of regional flavor and the
 * team-overall scaled base.
 *
 * B3 narrowed the reputation tiers and handed the difference to the academy
 * level, which can now go NEGATIVE — a club that does not fund its academy
 * actively drags its own graduates down. That is deliberate: without it, "do
 * not invest in the academy" is a neutral choice rather than a cost.
 *
 *   reputation >= 85 -> +2                    (was +5, and +2 from rep >= 65)
 *   academy level 15 -> -3, 50 -> 0, 95 -> +4
 *   combined range: -3 .. +6
 */
function applyAcademyBonus(reputation: number, academyLevel: number, peak: number): number {
  const reputationBonus = reputation >= 85 ? 2 : 0;
  const level = Math.max(0, Math.min(100, academyLevel));
  const levelBonus = Math.round((level - 50) / 11);
  return peak + reputationBonus + levelBonus;
}

/**
 * Map a retiring player's playing position to a coaching style. FW always
 * project as attacking coaches, DF as defensive, GK as balanced (their
 * tactical influence is squad-wide). MF flip a coin between possession and
 * balanced — both fit the central-creator archetype.
 */
function deriveCoachStyle(position: Player['position'], rng: SeededRNG): CoachStyle {
  switch (position) {
    case 'FW': return 'attacking';
    case 'DF': return 'defensive';
    case 'GK': return 'balanced';
    case 'MF': return rng.next() < 0.5 ? 'possession' : 'balanced';
  }
}

/**
 * Generate a youth replacement for a retired player. Position is preserved
 * so the squad's 3-7-7-5 composition is invariant across retirements.
 *
 * The player gets a fresh uuid (via the world's monotonic counter) and a
 * fresh name from the team's regional pool. Shirt number tries to inherit
 * the retiree's number; falls back to the lowest free number (>= 2 — keep
 * the GK #1 reserved unless explicitly inheriting it) on collision.
 *
 * `nextUuid` is the same `{ value }` shape used by `generateSquad`.
 */
export function generateYouthReplacement(
  team: TeamBase,
  position: Player['position'],
  retiredNumber: number,
  usedNumbers: Set<number>,
  usedNames: Set<string>,
  rng: SeededRNG,
  nextUuid: { value: number },
  /**
   * B3 — the club academy level, 0..100. Decides the talent-tier odds and the
   * peak bonus. Defaults to the league average so pre-B3 saves and focused
   * unit tests keep the exact behaviour they had before the rewire.
   */
  academyLevel: number = ACADEMY_LEVEL_DEFAULT,
  /**
   * League talent-era index, -5..+5. Moves the regular-tier median via
   * `basePeak` and the tier odds via `rollYouthTalentTier`. Defaults to the
   * neutral point so pre-climate saves and focused unit tests keep the exact
   * distribution they had before this existed.
   */
  talentEra: number = 0,
): Player {
  // Age 18-22, weighted slightly toward 19-20 via two integer rolls and a
  // min — produces a triangular-ish distribution without an explicit table.
  const ageA = rng.nextInt(18, 22);
  const ageB = rng.nextInt(18, 22);
  const age = Math.min(ageA, ageB);
  // Pre-roll uuid + tag so peakAge can react to late_bloomer.
  const uuid = formatPlayerUuid(nextUuid.value++);
  const tag = rollTagForUuid(uuid);
  const talentRng = rng.fork();
  const talentTier = rollYouthTalentTier(team.reputation ?? 50, academyLevel, talentRng, talentEra);
  const peakAge = tag === 'late_bloomer'
    ? talentRng.nextInt(28, 32)
    : talentTier === 'elite'
      ? talentRng.nextInt(23, 27)
      : talentRng.nextInt(24, 29);

  // The regular population retains the existing club-strength model. A
  // bounded prospect band and a rare elite band restore the long-term tail
  // without lifting the median or guaranteeing elite academies a superstar.
  // The regular band is the median mover: ~83% of graduates land here, so the
  // league's mean rating tracks this term almost one-for-one once a cohort has
  // aged in. The elite and prospect bands use fixed ranges and are moved only
  // through their FREQUENCY, which is what keeps an era's tail and its median
  // from being the same dial.
  const basePeak = 45 + (team.overall - 65) * 0.4 + talentEra;
  let peak: number;
  if (talentTier === 'elite') {
    peak = talentRng.nextInt(89, 96);
  } else if (talentTier === 'prospect') {
    peak = talentRng.nextInt(76, 88);
  } else {
    peak = Math.round(basePeak + talentRng.nextInt(-5, 12));
  }

  // Goal scoring base — same brackets as the generator.
  let goalScoring: number;
  switch (position) {
    case 'FW': goalScoring = rng.nextInt(55, 100); break;
    case 'MF': goalScoring = rng.nextInt(15, 50); break;
    case 'DF': goalScoring = rng.nextInt(2, 15); break;
    case 'GK': goalScoring = rng.nextInt(0, 2); break;
  }

  // Regional flavor
  const flav = applyRegionalFlavor(team.region ?? '大陆+其他', position, peak, 0, goalScoring);
  peak = flav.peak;
  goalScoring = Math.max(0, Math.min(100, flav.goalScoring));

  // Reputation tier + academy level
  peak = applyAcademyBonus(team.reputation ?? 50, academyLevel, peak);

  // Reputation, academy level and regional flavor may improve the odds or the
  // shape of a prospect, but only the rare elite tier is allowed to cross 89.
  peak = capYouthPeakByTalentTier(talentTier, peak);

  // Initial rating from curve, plus the regional startBonus (only 东洲 lowers,
  // 大陆 DF/GK raises). Clamp to [35, 99] consistent with computeCurrentRating.
  const baseRating = computeCurrentRating(peak, age, peakAge);
  const rating = Math.max(35, Math.min(99, baseRating + flav.startBonus));

  // Shirt number — inherit if free, otherwise lowest free.
  let number: number;
  if (!usedNumbers.has(retiredNumber)) {
    number = retiredNumber;
  } else {
    // Skip 1 (GK reserved) when picking a fallback — unless retiredNumber was
    // 1 itself (rare GK retirement) in which case we already would have taken it.
    let candidate = 2;
    while (candidate <= 99 && usedNumbers.has(candidate)) candidate++;
    number = candidate <= 99 ? candidate : retiredNumber;
  }
  usedNumbers.add(number);

  const name = pickPlayerName(team.region ?? '大陆+其他', usedNames, (arr) => rng.pick(arr));

  const player: Player = {
    uuid,
    teamId: team.id,
    name,
    number,
    position,
    rating,
    peakRating: peak,
    peakAge,
    goalScoring,
    age,
    marketValue: 0,
  };
  // Tag — pre-rolled above (deterministic from uuid)
  if (tag) player.tag = tag;
  player.marketValue = computeInitialMarketValue(player);
  return player;
}

/**
 * Lowest shirt number a replacement can take without colliding.
 *
 * Kept local rather than importing `pickFreeSquadNumber` from the transfer
 * module: retirement is upstream of transfers in the season-end pipeline and
 * must not acquire a dependency on it.
 */
export function pickReplacementNumber(used: Set<number>, position: PlayerPosition): number {
  if (position === 'GK' && !used.has(1)) return 1;
  for (let number = 2; number <= 99; number++) {
    if (!used.has(number)) return number;
  }
  return 99;
}

/**
 * Replace every player who left the universe through the free market.
 *
 * `processRetirements` already pairs each retirement with a youth graduate, but
 * the free-agent path was the one exception. A 36-year-old fringe player
 * released into the pool gets `age + 1` applied in the same window, crosses
 * `FREE_AGENT_MAX_AGE` and retires with nothing put back. Measured on seed
 * 20260722 over 100 seasons that leaked 58 players — 3675 graduates
 * (`nextPlayerUuidCounter` delta, cross-checked against a per-season uuid-set
 * diff) against 3733 retirement records — and the player count fell
 * monotonically, 697 -> 644, about -0.5 players per season.
 *
 * The graduate goes back to the club that released them: letting a 36-year-old
 * go is how a club makes room for a youngster, which is what the release action
 * was always meant to express. When that club cannot be resolved — saves
 * written before `Player.releasedFromTeamId` existed carry the market sentinel
 * there — it falls back to the shortest squad, so this can never create a new
 * squad-size floor.
 *
 * IMMUTABLE wrt `squads`: returns fresh arrays for the teams it touches and
 * never mutates the input, matching `processRetirements`.
 */
export function applyFreeAgentReplacements(params: {
  squads: Record<string, Player[]>;
  retirees: ReadonlyArray<{ position: PlayerPosition; releasedFromTeamId: string }>;
  teamBases: Record<string, TeamBase>;
  academyLevels?: Record<string, { level: number }>;
  /** League talent-era index for the graduates; see `generateYouthReplacement`. */
  talentEra?: number;
  rng: SeededRNG;
  nextPlayerUuidCounter: number;
}): { squads: Record<string, Player[]>; nextPlayerUuidCounter: number } {
  const { retirees, teamBases, academyLevels, rng, talentEra = 0 } = params;
  if (retirees.length === 0) {
    return { squads: params.squads, nextPlayerUuidCounter: params.nextPlayerUuidCounter };
  }

  const nextUuid = { value: params.nextPlayerUuidCounter };
  const posOrder: Record<PlayerPosition, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
  let next = params.squads;

  const shortestTeamId = (): string => {
    let best = '';
    let bestLength = Number.POSITIVE_INFINITY;
    for (const [teamId, squad] of Object.entries(next)) {
      if (squad.length < bestLength) {
        bestLength = squad.length;
        best = teamId;
      }
    }
    return best;
  };

  for (const retiree of retirees) {
    const teamId = next[retiree.releasedFromTeamId] ? retiree.releasedFromTeamId : shortestTeamId();
    const team = teamBases[teamId];
    const squad = next[teamId];
    if (!team || !squad) continue;
    const usedNumbers = new Set(squad.map(player => player.number));
    const usedNames = new Set(squad.map(player => player.name));
    const youth = generateYouthReplacement(
      team,
      retiree.position,
      pickReplacementNumber(usedNumbers, retiree.position),
      usedNumbers,
      usedNames,
      rng,
      nextUuid,
      academyLevels?.[teamId]?.level ?? ACADEMY_LEVEL_DEFAULT,
      talentEra,
    );
    next = {
      ...next,
      [teamId]: [...squad, youth].sort(
        (a, b) => posOrder[a.position] - posOrder[b.position] || a.number - b.number,
      ),
    };
  }

  return { squads: next, nextPlayerUuidCounter: nextUuid.value };
}

/**
 * Per-player retirement decision result. Pulled out as a struct so the
 * per-team-cap logic can sort + slice before committing.
 */
type RetirementCandidate = {
  player: Player;
  teamId: string;
  chance: number;
  forced: boolean; // true when age >= HARD_AGE_CAP — bypasses the cap-by-chance roll but still counts toward MAX_RETIREMENTS_PER_TEAM
};

/**
 * Process retirements + youth replacements + coach pool seeding for a
 * season-end pass.
 *
 * IMMUTABLE wrt the input world: returns fresh squads + new pool/history
 * arrays, never mutates `world.squads` / `world.coachCandidatePool` /
 * `world.retirementHistory`. Caller (season-end) wires the patch.
 *
 * Pipeline:
 *   1. Roll chance for every player on every squad. Mark forced retirees.
 *   2. Per-team cap: keep top MAX_RETIREMENTS_PER_TEAM by chance (forced
 *      always counts and is preserved when sorting).
 *   3. For each retirement: build a PlayerRetirement record (with career
 *      goals snapshot from world.playerStats), maybe seed the coach pool,
 *      and generate a position-preserving youth replacement.
 *
 * The replacement uuid pulls from a LOCAL counter that starts at
 * `world.nextPlayerUuidCounter`. Caller is expected to bump that counter
 * to match `result.nextPlayerUuidCounter` (returned).
 */
export function processRetirements(
  world: GameWorld,
  rng: SeededRNG,
  /**
   * League talent-era index for this pass's graduates. Passed in rather than read
   * off `world` because season-end advances the climate at the top of the pass and
   * every consumer downstream of it — the squad top-up included — uses the
   * advanced value; reading `world.leagueClimate` here would make graduates and
   * the top-up disagree about which era it is.
   */
  talentEra: number = 0,
): {
  squads: Record<string, Player[]>;
  retirements: PlayerRetirement[];
  candidatesAdded: CoachCandidate[];
  coachCandidatePool: CoachCandidate[];
  nextPlayerUuidCounter: number;
} {
  const seasonNumber = world.seasonState.seasonNumber;
  const nextUuid = { value: world.nextPlayerUuidCounter ?? 0 };
  const currentWindowIdx = world.totalElapsedWindows ?? 0;

  // ── Step 1: Roll chance per player, gather candidates per team ──
  const candidatesByTeam: Record<string, RetirementCandidate[]> = {};
  for (const [teamId, squad] of Object.entries(world.squads)) {
    if (!Array.isArray(squad)) continue;
    for (const p of squad) {
      const age = p.age ?? 25;
      if (age < 33) continue; // fast path
      const forced = age >= HARD_AGE_CAP;
      // Phase G: a player carrying an active major / long_term injury has
      // an inflated retirement chance. We mark this on the candidate so
      // news copy below can flag it as a "forced by injury" retirement.
      const lastInj = p.injuryHistory?.[p.injuryHistory.length - 1];
      const isLongTerm = !!lastInj
        && (lastInj.type === 'major' || lastInj.type === 'long_term')
        && (p.injuredUntilWindow ?? 0) > currentWindowIdx;
      const chance = computeRetirementChance(age, p.peakRating ?? p.rating ?? 60, isLongTerm);
      // Roll once per player. Forced retirees always end up in the candidate
      // list regardless of the roll.
      const roll = rng.next();
      if (forced || roll < chance) {
        if (!candidatesByTeam[teamId]) candidatesByTeam[teamId] = [];
        candidatesByTeam[teamId].push({ player: p, teamId, chance, forced });
      }
    }
  }

  // ── Step 2: Per-team cap — keep the top N (forced first, then by chance) ──
  const finalCandidates: RetirementCandidate[] = [];
  for (const [teamId, list] of Object.entries(candidatesByTeam)) {
    const forced = list.filter((c) => c.forced);
    const optional = list.filter((c) => !c.forced).sort((a, b) => b.chance - a.chance);
    const sorted = [...forced, ...optional];
    const kept = sorted.slice(0, MAX_RETIREMENTS_PER_TEAM);
    for (const k of kept) finalCandidates.push(k);
    void teamId;
  }

  // ── Step 3: For each retirement, build records + replacement ──
  const retirements: PlayerRetirement[] = [];
  const candidatesAdded: CoachCandidate[] = [];
  let coachCandidatePool: CoachCandidate[] = [...(world.coachCandidatePool ?? [])];

  // Fresh squads (we'll rewrite the per-team arrays for any team that has
  // retirees). Teams with no retirements keep their array reference.
  const squads: Record<string, Player[]> = { ...world.squads };

  // Precompute career goals lookup per uuid from finished-season history
  // plus the current live season row. Retirements run before
  // initializeNewSeason snapshots the just-finished season, so reading only
  // `playerStats` would undercount every veteran's career.
  const careerGoalsLookup = new Map<string, number>();
  for (const stat of Object.values(world.playerStats ?? {})) {
    if (stat?.playerId) {
      careerGoalsLookup.set(stat.playerId, computePlayerCareerTotals(world, stat.playerId).goals);
    }
  }

  // Group candidates by team so we only rebuild each squad once.
  const teamRetirees = new Map<string, RetirementCandidate[]>();
  for (const c of finalCandidates) {
    const list = teamRetirees.get(c.teamId);
    if (list) list.push(c);
    else teamRetirees.set(c.teamId, [c]);
  }

  for (const [teamId, retireeList] of teamRetirees) {
    const oldSquad = world.squads[teamId];
    if (!Array.isArray(oldSquad)) continue;
    const team = world.teamBases[teamId];
    if (!team) continue;

    // Track shirt numbers and names already in use after the retirees leave.
    const retireeUuids = new Set(retireeList.map((r) => r.player.uuid));
    const survivors = oldSquad.filter((p) => !retireeUuids.has(p.uuid));
    const usedNumbers = new Set(survivors.map((p) => p.number));
    const usedNames = new Set(survivors.map((p) => p.name));

    const newPlayers: Player[] = [];
    for (const cand of retireeList) {
      const p = cand.player;
      // Build PlayerRetirement record
      const careerGoals = careerGoalsLookup.get(p.uuid) ?? 0;
      const retirement: PlayerRetirement = {
        uuid: p.uuid,
        name: p.name,
        teamId,
        teamName: team.name,
        position: p.position,
        peakRating: p.peakRating ?? p.rating ?? 60,
        age: p.age ?? 0,
        seasonRetired: seasonNumber,
        careerGoals,
      };
      retirements.push(retirement);

      // Maybe seed the coach pool
      const peak = retirement.peakRating;
      if (peak >= 85 && (p.age ?? 0) >= 35 && rng.next() < 0.40) {
        const cand: CoachCandidate = {
          uuid: p.uuid,
          name: p.name,
          fromTeamId: teamId,
          peakRating: peak,
          enteredPoolSeason: seasonNumber,
          style: deriveCoachStyle(p.position, rng),
        };
        if (coachCandidatePool.length >= COACH_POOL_CAP) {
          // Evict oldest by enteredPoolSeason (tie-break: insertion order — the
          // first match in array order). We rebuild the array minus the evicted
          // index to keep the rest of the order stable.
          let oldestIdx = 0;
          for (let i = 1; i < coachCandidatePool.length; i++) {
            if (coachCandidatePool[i].enteredPoolSeason < coachCandidatePool[oldestIdx].enteredPoolSeason) {
              oldestIdx = i;
            }
          }
          coachCandidatePool = coachCandidatePool.filter((_, i) => i !== oldestIdx);
        }
        coachCandidatePool.push(cand);
        candidatesAdded.push(cand);
      }

      // Generate replacement. B3 — the club academy level decides the talent-tier
      // odds and the peak bonus. Pre-B3 saves carry no record, so the league
      // average applies and the graduate distribution is unchanged for them.
      const youth = generateYouthReplacement(
        team, p.position, p.number, usedNumbers, usedNames, rng, nextUuid,
        world.academyLevels?.[teamId]?.level ?? ACADEMY_LEVEL_DEFAULT,
        talentEra,
      );
      newPlayers.push(youth);
    }

    // Sort the rebuilt squad by position then number to keep the canonical order.
    const posOrder: Record<Player['position'], number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
    const newSquad = [...survivors, ...newPlayers].sort(
      (a, b) => posOrder[a.position] - posOrder[b.position] || a.number - b.number,
    );
    squads[teamId] = newSquad;
  }

  return {
    squads,
    retirements,
    candidatesAdded,
    coachCandidatePool,
    nextPlayerUuidCounter: nextUuid.value,
  };
}
