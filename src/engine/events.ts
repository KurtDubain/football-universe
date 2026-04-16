import { TeamBase } from '../types/team';
import { SeededRNG } from './match/rng';

export interface SeasonEvent {
  id: string;
  type: 'injury' | 'wonderkid' | 'investment' | 'fan_trouble' | 'form_boost';
  teamId: string;
  title: string;
  description: string;
  effect: {
    field: 'overall' | 'attack' | 'defense' | 'midfield' | 'depth' | 'reputation' | 'morale';
    delta: number;
  };
  duration: number; // windows remaining
  windowApplied: number;
}

const EVENT_TEMPLATES = [
  {
    type: 'injury' as const,
    title: (team: string) => `${team} 核心球员受伤`,
    desc: (team: string) => `${team}的核心球员遭遇伤病，将缺席数场比赛。`,
    field: 'overall' as const, delta: -3, duration: 5, targetStrong: true,
  },
  {
    type: 'wonderkid' as const,
    title: (team: string) => `${team} 青训新星崛起`,
    desc: (team: string) => `${team}的青训营走出一位天才球员，即战力大增。`,
    field: 'attack' as const, delta: 4, duration: 0, targetStrong: false, // permanent
  },
  {
    type: 'investment' as const,
    title: (team: string) => `${team} 获得财团注资`,
    desc: (team: string) => `${team}获得大笔资金注入，阵容深度显著提升。`,
    field: 'depth' as const, delta: 5, duration: 0, targetStrong: false,
  },
  {
    type: 'fan_trouble' as const,
    title: (team: string) => `${team} 球迷骚乱`,
    desc: (team: string) => `${team}的球迷发生冲突事件，球队被处以主场禁赛处罚。`,
    field: 'morale' as const, delta: -10, duration: 3, targetStrong: true,
  },
  {
    type: 'form_boost' as const,
    title: (team: string) => `${team} 状态回暖`,
    desc: (team: string) => `${team}经过调整状态全面回升，士气高涨。`,
    field: 'morale' as const, delta: 12, duration: 0, targetStrong: false,
  },
];

/**
 * Maybe generate a random event. Called each window.
 * ~15% chance per window, roughly every 6-7 windows.
 */
export function maybeGenerateEvent(
  rng: SeededRNG,
  teamBases: Record<string, TeamBase>,
  seasonNumber: number,
  windowIndex: number,
  activeEvents: SeasonEvent[],
): SeasonEvent | null {
  if (rng.next() > 0.15) return null;

  const template = rng.pick(EVENT_TEMPLATES);
  const teamIds = Object.keys(teamBases);

  // Pick target team — some events target strong teams, some target weak
  let candidates = teamIds;
  if (template.targetStrong) {
    candidates = teamIds.filter(id => (teamBases[id]?.overall ?? 0) >= 70);
  } else {
    candidates = teamIds.filter(id => (teamBases[id]?.overall ?? 0) < 75);
  }
  if (candidates.length === 0) candidates = teamIds;

  // Don't stack events on same team
  const teamId = rng.pick(candidates.filter(id => !activeEvents.some(e => e.teamId === id)));
  if (!teamId) return null;

  const teamName = teamBases[teamId]?.name ?? teamId;

  return {
    id: `evt-S${seasonNumber}-W${windowIndex}-${template.type}`,
    type: template.type,
    teamId,
    title: template.title(teamName),
    description: template.desc(teamName),
    effect: { field: template.field, delta: template.delta },
    duration: template.duration,
    windowApplied: windowIndex,
  };
}

/**
 * Apply active event effects to team bases/states. Called by season manager.
 */
export function applyEventEffect(
  teamBases: Record<string, TeamBase>,
  event: SeasonEvent,
  reverse: boolean = false,
): Record<string, TeamBase> {
  const bases = { ...teamBases };
  const team = bases[event.teamId];
  if (!team) return bases;

  const base = { ...team };
  const d = reverse ? -event.effect.delta : event.effect.delta;

  if (event.effect.field === 'morale') {
    // Morale is on teamState, not teamBase — handled separately
    return bases;
  }

  (base as any)[event.effect.field] = Math.max(25, Math.min(99, ((base as any)[event.effect.field] ?? 50) + d));
  bases[event.teamId] = base;
  return bases;
}
