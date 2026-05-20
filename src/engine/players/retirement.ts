import { Player, PlayerRetirement } from '../../types/player';
import { CoachCandidate, CoachStyle } from '../../types/coach';
import { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import { GameWorld } from '../season/season-manager';
import { pickPlayerName } from '../../config/player-names';
import { computeCurrentRating } from './development';
import { computeInitialMarketValue } from '../economy/market-value';
import { formatPlayerUuid } from './generator';

/**
 * Per-team retirement cap. If more than this many players on the same team
 * roll into retirement in a single season, only the top-N (sorted by
 * `retirementChance` descending) actually retire — the rest defer to next
 * season. Prevents a single bad rolling-dice year from gutting one squad.
 */
export const MAX_RETIREMENTS_PER_TEAM = 4;

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
 * Reputation-tier bonus on peakRating: gives elite-academy youths a
 * structural edge. Layered on top of regional flavor and the team-overall
 * scaled base.
 */
function applyReputationBonus(reputation: number, peak: number): number {
  if (reputation >= 85) return peak + 5;
  if (reputation >= 65) return peak + 2;
  return peak;
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
): Player {
  // Age 18-22, weighted slightly toward 19-20 via two integer rolls and a
  // min — produces a triangular-ish distribution without an explicit table.
  const ageA = rng.nextInt(18, 22);
  const ageB = rng.nextInt(18, 22);
  const age = Math.min(ageA, ageB);
  const peakAge = rng.nextInt(24, 29);

  // Base peak from team strength: 33-50 for weak (overall ~45), up to 55-70
  // for elite (overall ~90). The +12 noise ceiling lets a kid roll into a
  // proper star occasionally, but never an instant 99 OVR.
  const basePeak = 45 + (team.overall - 65) * 0.4;
  const noise = rng.nextInt(-5, 12);
  let peak = Math.round(basePeak + noise);

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

  // Reputation tier
  peak = applyReputationBonus(team.reputation ?? 50, peak);

  // Final clamp [35, 92] — youths can't ship at 99.
  peak = Math.max(35, Math.min(92, peak));

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
    uuid: formatPlayerUuid(nextUuid.value++),
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
  player.marketValue = computeInitialMarketValue(player);
  return player;
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

  // Precompute career goals lookup per uuid.
  const careerGoalsLookup = new Map<string, number>();
  for (const stat of Object.values(world.playerStats ?? {})) {
    if (stat?.playerId) {
      // Use latest snapshot — playerStats is current-season only here, but
      // future stat-aggregation work may extend this.
      careerGoalsLookup.set(stat.playerId, stat.goals ?? 0);
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
      const teamTrophies = world.teamTrophies?.[teamId] ?? [];
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
        // Snapshot a copy so future mutations on world.teamTrophies don't
        // leak into history.
        careerTrophies: teamTrophies.length > 0 ? [...teamTrophies] : undefined,
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

      // Generate replacement
      const youth = generateYouthReplacement(
        team, p.position, p.number, usedNumbers, usedNames, rng, nextUuid,
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
