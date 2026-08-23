import {
  continentalCupConfig,
  superCupConfig,
  worldCupConfig,
} from '../../config/competitions';

export type KnockoutRoundRank = 0 | 1 | 2 | 3 | 4;

/** Shared display/importance rank for the knockout labels emitted by every cup. */
export function getKnockoutRoundRank(roundLabel: string): KnockoutRoundRank {
  const label = roundLabel.trim();
  const lower = label.toLowerCase();
  const upper = label.toUpperCase();

  if (lower === 'final' || label === '决赛') return 4;
  if (lower.includes('semi') || label.includes('半决') || label.includes('四强') || upper.startsWith('SF')) return 3;
  if (lower.includes('quarter') || label.includes('1/4') || label.includes('八强') || upper.startsWith('QF')) return 2;
  if (
    lower.includes('round of 16')
    || lower.includes('round-of-16')
    || label.includes('1/8')
    || label.includes('16强')
    || label.includes('淘汰赛')
    || upper.startsWith('R16')
  ) return 1;
  return 0;
}

function roundNumber(label: string): number | null {
  const compact = label.replace(/\s+/g, '');
  const latin = compact.match(/R(\d+)/i);
  if (latin) return Number.parseInt(latin[1], 10);
  const chinese = compact.match(/第(\d+)轮/);
  return chinese ? Number.parseInt(chinese[1], 10) : null;
}

/** True only for the round that actually closes a configured group stage. */
export function isGroupStageClosingRound(
  competitionType: string,
  roundLabel: string,
): boolean {
  const round = roundNumber(roundLabel);
  if (round == null) return false;
  if (competitionType === 'world_cup_group') return round === worldCupConfig.groupRounds;
  if (competitionType === 'super_cup_group') return round === superCupConfig.groupRounds;
  if (competitionType === 'continental_cup') {
    const isGroupLabel = /group|小组/i.test(roundLabel);
    return isGroupLabel && round === continentalCupConfig.groupRounds;
  }
  return false;
}
