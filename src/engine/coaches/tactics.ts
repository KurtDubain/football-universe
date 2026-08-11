import type {
  CoachBase,
  CoachFormation,
  MatchApproach,
  MatchTacticsSnapshot,
  TacticsReason,
} from '../../types/coach';
import type { MatchFixture } from '../../types/match';
import type { Player, PlayerPosition } from '../../types/player';
import type { TeamBase, TeamState } from '../../types/team';

export type FormationShape = Record<PlayerPosition, number>;

export const FORMATION_SHAPES: Record<CoachFormation, FormationShape> = {
  '4-3-3': { GK: 1, DF: 4, MF: 3, FW: 3 },
  '4-2-3-1': { GK: 1, DF: 4, MF: 5, FW: 1 },
  '4-4-2': { GK: 1, DF: 4, MF: 4, FW: 2 },
  '5-4-1': { GK: 1, DF: 5, MF: 4, FW: 1 },
};

export const FORMATION_LABELS: Record<CoachFormation, string> = {
  '4-3-3': '4-3-3',
  '4-2-3-1': '4-2-3-1',
  '4-4-2': '4-4-2',
  '5-4-1': '5-4-1',
};

export const APPROACH_LABELS: Record<MatchApproach, string> = {
  pressing: '主动压迫',
  control: '控球主导',
  balanced: '均衡应对',
  counter: '快速反击',
  low_block: '低位防守',
};

export const TACTICS_REASON_LABELS: Record<TacticsReason, string> = {
  coach_identity: '延续教练理念',
  underdog_response: '针对实力差距',
  control_favorite: '主动掌控比赛',
  fatigue_management: '控制体能消耗',
  cup_caution: '淘汰赛谨慎部署',
};

export const TACTICAL_IDENTITY: Record<CoachFormation, { strength: string; tradeoff: string }> = {
  '4-3-3': { strength: '边路宽度与前场接应', tradeoff: '高位投入会留下身后空间' },
  '4-2-3-1': { strength: '中路控制与双层保护', tradeoff: '禁区内持续冲击人数较少' },
  '4-4-2': { strength: '直接推进与双前锋接应', tradeoff: '中场中央可能处于人数劣势' },
  '5-4-1': { strength: '压缩空间与禁区保护', tradeoff: '控球和持续进攻能力受限' },
};

const ALL_FORMATIONS = Object.keys(FORMATION_SHAPES) as CoachFormation[];

const STYLE_FORMATIONS: Record<CoachBase['style'], CoachFormation[]> = {
  attacking: ['4-3-3', '4-2-3-1'],
  possession: ['4-2-3-1', '4-3-3'],
  defensive: ['5-4-1', '4-4-2'],
  counter: ['4-4-2', '5-4-1'],
  balanced: ['4-2-3-1', '4-4-2', '4-3-3'],
};

const FORMATION_EFFECTS: Record<CoachFormation, [number, number, number]> = {
  '4-3-3': [0.8, 0.4, -0.3],
  '4-2-3-1': [0.2, 0.8, 0.2],
  '4-4-2': [0.5, -0.2, 0.4],
  '5-4-1': [-0.8, -0.4, 1.2],
};

const APPROACH_EFFECTS: Record<MatchApproach, [number, number, number]> = {
  pressing: [0.9, 0.8, -0.4],
  control: [0, 1, 0.2],
  balanced: [0, 0, 0],
  counter: [0.7, -0.3, 0.5],
  low_block: [-0.8, -0.4, 1.1],
};

interface TacticalDimensions {
  width: number;
  centralControl: number;
  compactness: number;
  pressure: number;
  transition: number;
}

const FORMATION_DIMENSIONS: Record<CoachFormation, TacticalDimensions> = {
  '4-3-3': { width: 0.85, centralControl: 0.52, compactness: 0.4, pressure: 0.7, transition: 0.62 },
  '4-2-3-1': { width: 0.58, centralControl: 0.86, compactness: 0.68, pressure: 0.56, transition: 0.45 },
  '4-4-2': { width: 0.72, centralControl: 0.38, compactness: 0.72, pressure: 0.48, transition: 0.76 },
  '5-4-1': { width: 0.3, centralControl: 0.55, compactness: 1, pressure: 0.24, transition: 0.58 },
};

const APPROACH_DIMENSIONS: Record<MatchApproach, Partial<TacticalDimensions>> = {
  pressing: { pressure: 0.22, compactness: -0.08, transition: 0.08 },
  control: { centralControl: 0.18, transition: -0.08, compactness: 0.05 },
  balanced: {},
  counter: { transition: 0.22, pressure: -0.08, centralControl: -0.06 },
  low_block: { compactness: 0.2, pressure: -0.14, width: -0.08 },
};

type FixtureContext = Pick<
  MatchFixture,
  'homeTeamId' | 'awayTeamId' | 'competitionType' | 'isNeutralVenue' | 'tournamentHostTeamId'
> & Partial<Pick<MatchFixture, 'id' | 'roundLabel' | 'leg'>>;

export interface MatchTacticsInput {
  coach: CoachBase | null;
  team: TeamBase;
  opponent: TeamBase;
  state: TeamState;
  opponentState: TeamState;
  fixture: FixtureContext;
  squad?: Player[];
  globalWindowIdx?: number;
}

export interface MatchTacticsPair {
  home: MatchTacticsSnapshot;
  away: MatchTacticsSnapshot;
  /** Positive means the home setup has the small matchup edge. */
  matchupEdge: number;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundOne(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isAvailable(player: Player, globalWindowIdx: number): boolean {
  return (player.injuredUntilWindow ?? 0) <= globalWindowIdx
    && (player.suspendedUntilWindow ?? 0) <= globalWindowIdx;
}

export function getFormationShape(formation: CoachFormation): FormationShape {
  return FORMATION_SHAPES[formation];
}

export function derivePreferredFormation(coach: CoachBase | null): CoachFormation {
  if (!coach) return '4-3-3';
  if (coach.preferredFormation) return coach.preferredFormation;
  const options = STYLE_FORMATIONS[coach.style];
  return options[stableHash(coach.id) % options.length];
}

function formationDeficit(formation: CoachFormation, players: Player[]): number {
  const shape = FORMATION_SHAPES[formation];
  return (Object.keys(shape) as PlayerPosition[]).reduce((total, position) => {
    const available = players.filter(player => player.position === position).length;
    return total + Math.max(0, shape[position] - available);
  }, 0);
}

/** Keep the coach's identity unless injuries make another supported shape materially safer. */
export function selectMatchFormation(
  coach: CoachBase | null,
  squad: Player[] | undefined,
  globalWindowIdx = 0,
): CoachFormation {
  const preferred = derivePreferredFormation(coach);
  const available = (squad ?? []).filter(player => isAvailable(player, globalWindowIdx));
  if (available.length === 0 || formationDeficit(preferred, available) <= 1) return preferred;

  const styleOptions = coach ? STYLE_FORMATIONS[coach.style] : [];
  const fallbackOrder = [preferred, ...styleOptions, ...ALL_FORMATIONS]
    .filter((formation, index, formations) => formations.indexOf(formation) === index);

  return [...ALL_FORMATIONS].sort((left, right) => (
    formationDeficit(left, available) - formationDeficit(right, available)
    || fallbackOrder.indexOf(left) - fallbackOrder.indexOf(right)
  ))[0];
}

export function derivePreferredApproach(style: CoachBase['style'] | undefined): MatchApproach {
  switch (style) {
    case 'attacking': return 'pressing';
    case 'possession': return 'control';
    case 'defensive': return 'low_block';
    case 'counter': return 'counter';
    default: return 'balanced';
  }
}

export function describeCoachIdentity(coach: CoachBase): string {
  return `${FORMATION_LABELS[derivePreferredFormation(coach)]} / ${APPROACH_LABELS[derivePreferredApproach(coach.style)]}`;
}

/**
 * Preserve a coach's visible identity while allowing a small, deterministic
 * match-to-match variation. Context overrides below still take precedence.
 */
function chooseIdentityApproach(coach: CoachBase, variation: number): MatchApproach {
  const risk = clamp(coach.riskBias / 10, -1, 1);
  switch (coach.style) {
    case 'attacking': {
      const pressingLimit = clamp(0.72 + risk * 0.1, 0.62, 0.82);
      if (variation < pressingLimit) return 'pressing';
      return variation < 0.92 ? 'control' : 'balanced';
    }
    case 'possession': {
      const controlLimit = clamp(0.74 - risk * 0.05, 0.66, 0.8);
      if (variation < controlLimit) return 'control';
      return variation < 0.92 ? 'pressing' : 'balanced';
    }
    case 'defensive': {
      const lowBlockLimit = clamp(0.68 - risk * 0.1, 0.56, 0.78);
      if (variation < lowBlockLimit) return 'low_block';
      return variation < 0.91 ? 'counter' : 'balanced';
    }
    case 'counter': {
      const counterLimit = clamp(0.72 + risk * 0.08, 0.62, 0.82);
      if (variation < counterLimit) return 'counter';
      return variation < 0.92 ? 'low_block' : 'balanced';
    }
    default:
      if (variation < 0.56) return 'balanced';
      if (variation < 0.7) return 'control';
      if (variation < 0.84) return 'counter';
      return risk >= 0 ? 'pressing' : 'low_block';
  }
}

function chooseApproach(input: MatchTacticsInput): { approach: MatchApproach; reason: TacticsReason } {
  const { coach, team, opponent, state, fixture } = input;
  if (!coach) return { approach: 'balanced', reason: 'coach_identity' };
  const gap = team.overall - opponent.overall;
  const knockout = ['league_cup', 'relegation_playoff', 'world_cup', 'super_cup', 'continental_cup']
    .includes(fixture.competitionType);
  const key = fixture.id ?? `${fixture.homeTeamId}:${fixture.awayTeamId}:${fixture.competitionType}`;
  const variation = (stableHash(`${key}:${coach?.id ?? team.id}:approach`) % 1000) / 1000;

  if (gap <= -8) {
    const useLowBlock = gap <= -14 || coach?.style === 'defensive' || variation < 0.34;
    return { approach: useLowBlock ? 'low_block' : 'counter', reason: 'underdog_response' };
  }
  if (state.fatigue >= 72) {
    const conservativeIdentity: Record<CoachBase['style'], MatchApproach> = {
      attacking: 'balanced',
      possession: 'control',
      defensive: 'low_block',
      counter: 'counter',
      balanced: 'balanced',
    };
    return { approach: conservativeIdentity[coach.style], reason: 'fatigue_management' };
  }
  if (gap >= 10 && (coach?.style === 'possession' || coach?.style === 'balanced')) {
    return { approach: 'control', reason: 'control_favorite' };
  }
  if (knockout && Math.abs(gap) < 6 && coach && coach.riskBias <= -3 && variation < 0.65) {
    return { approach: 'low_block', reason: 'cup_caution' };
  }
  return { approach: chooseIdentityApproach(coach, variation), reason: 'coach_identity' };
}

function executionFor(coach: CoachBase | null): MatchTacticsSnapshot['execution'] {
  if (!coach || coach.rating < 66) return 'developing';
  if (coach.rating >= 84) return 'elite';
  return 'coherent';
}

function executionMultiplier(coach: CoachBase | null): number {
  if (!coach) return 0;
  return clamp(0.78 + coach.rating / 300, 0.9, 1.1);
}

function buildTags(
  formation: CoachFormation,
  approach: MatchApproach,
  reason: TacticsReason,
  preferred: CoachFormation,
): string[] {
  const tags: string[] = [];
  if (formation !== preferred) tags.push('伤停适配');
  if (approach === 'pressing') tags.push('前场施压');
  else if (approach === 'control') tags.push('争夺球权');
  else if (approach === 'counter') tags.push('纵向转换');
  else if (approach === 'low_block') tags.push('压缩空间');
  else tags.push('保持平衡');
  if (reason === 'underdog_response') tags.push('以弱抗强');
  else if (reason === 'fatigue_management') tags.push('控制消耗');
  else if (reason === 'cup_caution') tags.push('杯赛谨慎');
  return tags.slice(0, 2);
}

export function deriveMatchTactics(input: MatchTacticsInput): MatchTacticsSnapshot {
  const preferred = derivePreferredFormation(input.coach);
  const formation = selectMatchFormation(input.coach, input.squad, input.globalWindowIdx);
  const { approach, reason } = chooseApproach(input);
  const multiplier = executionMultiplier(input.coach);
  const formationEffect = FORMATION_EFFECTS[formation];
  const approachEffect = APPROACH_EFFECTS[approach];
  const effect = formationEffect.map((value, index) => (value + approachEffect[index]) * multiplier);

  return {
    formation,
    approach,
    reason,
    execution: executionFor(input.coach),
    attackDelta: roundOne(clamp(effect[0], -2.4, 2.4)),
    midfieldDelta: roundOne(clamp(effect[1], -2.4, 2.4)),
    defenseDelta: roundOne(clamp(effect[2], -2.4, 2.4)),
    tags: buildTags(formation, approach, reason, preferred),
  };
}

function tacticalDimensions(tactics: MatchTacticsSnapshot): TacticalDimensions {
  const base = FORMATION_DIMENSIONS[tactics.formation];
  const modifier = APPROACH_DIMENSIONS[tactics.approach];
  return {
    width: clamp(base.width + (modifier.width ?? 0), 0, 1.2),
    centralControl: clamp(base.centralControl + (modifier.centralControl ?? 0), 0, 1.2),
    compactness: clamp(base.compactness + (modifier.compactness ?? 0), 0, 1.2),
    pressure: clamp(base.pressure + (modifier.pressure ?? 0), 0, 1.2),
    transition: clamp(base.transition + (modifier.transition ?? 0), 0, 1.2),
  };
}

function attackFit(attack: TacticalDimensions, defense: TacticalDimensions): number {
  return attack.width * (1.05 - defense.compactness * 0.35)
    + attack.transition * (0.75 - defense.pressure * 0.22)
    + attack.centralControl * 0.45
    - defense.centralControl * 0.24;
}

function applyMatchupDelta(
  tactics: MatchTacticsSnapshot,
  edge: number,
): MatchTacticsSnapshot {
  if (Math.abs(edge) < 0.05) return tactics;
  const tags = edge > 0.35
    ? [...tactics.tags, '对位占优'].slice(0, 3)
    : tactics.tags;
  return {
    ...tactics,
    attackDelta: roundOne(clamp(tactics.attackDelta + edge * 0.55, -3, 3)),
    midfieldDelta: roundOne(clamp(tactics.midfieldDelta + edge * 0.3, -3, 3)),
    defenseDelta: roundOne(clamp(tactics.defenseDelta + edge * 0.15, -3, 3)),
    tags,
  };
}

export function deriveMatchTacticsPair(
  home: Omit<MatchTacticsInput, 'opponent' | 'opponentState'> & { opponent: TeamBase; opponentState: TeamState },
  away: Omit<MatchTacticsInput, 'opponent' | 'opponentState'> & { opponent: TeamBase; opponentState: TeamState },
): MatchTacticsPair {
  const homeBase = deriveMatchTactics(home);
  const awayBase = deriveMatchTactics(away);
  const homeDimensions = tacticalDimensions(homeBase);
  const awayDimensions = tacticalDimensions(awayBase);
  const rawEdge = attackFit(homeDimensions, awayDimensions) - attackFit(awayDimensions, homeDimensions);
  const matchupEdge = roundOne(clamp(rawEdge * 0.9, -1.2, 1.2));

  return {
    home: home.coach ? applyMatchupDelta(homeBase, matchupEdge) : homeBase,
    away: away.coach ? applyMatchupDelta(awayBase, -matchupEdge) : awayBase,
    matchupEdge,
  };
}
