import type { MatchResult } from '../../types/match';
import { isUpsetResult, resolveMatchOutcome } from '../match/analysis';

export type ObservationJudgmentKind = 'outcome' | 'goals' | 'upset';
export type ObservationSelection = 'home' | 'draw' | 'away' | 'under-3' | 'over-2' | 'yes' | 'no';

export interface PendingObservationJudgment {
  fixtureId: string;
  seasonNumber: number;
  windowIndex: number;
  kind: ObservationJudgmentKind;
  selection: ObservationSelection;
}

export interface ObservationSettlement extends PendingObservationJudgment {
  homeTeamId: string;
  awayTeamId: string;
  actualSelection: ObservationSelection;
  correct: boolean;
}

export interface ObservationRecord {
  total: number;
  correct: number;
  currentStreak: number;
  bestStreak: number;
  recent: ObservationSettlement[];
}

export interface ObservationSettlementResult {
  pending: PendingObservationJudgment | null;
  record: ObservationRecord;
  settlements: ObservationSettlement[];
}

export const OBSERVATION_HISTORY_LIMIT = 50;

export function isObservationSelectionValid(
  kind: ObservationJudgmentKind,
  selection: ObservationSelection,
): boolean {
  if (kind === 'outcome') return selection === 'home' || selection === 'draw' || selection === 'away';
  if (kind === 'goals') return selection === 'under-3' || selection === 'over-2';
  return selection === 'yes' || selection === 'no';
}

export function createEmptyObservationRecord(): ObservationRecord {
  return { total: 0, correct: 0, currentStreak: 0, bestStreak: 0, recent: [] };
}

export { resolveMatchOutcome } from '../match/analysis';

export function isPredictionUpset(result: MatchResult): boolean {
  return isUpsetResult(result);
}

export function resolveObservationSelection(
  kind: ObservationJudgmentKind,
  result: MatchResult,
): ObservationSelection {
  if (kind === 'outcome') return resolveMatchOutcome(result);
  if (kind === 'goals') {
    const total = result.homeGoals + result.awayGoals
      + (result.etHomeGoals ?? 0) + (result.etAwayGoals ?? 0);
    return total >= 3 ? 'over-2' : 'under-3';
  }
  return isPredictionUpset(result) ? 'yes' : 'no';
}

export function settleObservationJudgment(
  record: ObservationRecord | undefined,
  pending: PendingObservationJudgment | null | undefined,
  results: MatchResult[],
): ObservationSettlementResult {
  const currentRecord = record ?? createEmptyObservationRecord();
  if (!pending || results.length === 0) {
    return { pending: pending ?? null, record: currentRecord, settlements: [] };
  }

  const result = results.find(entry => entry.fixtureId === pending.fixtureId);
  if (!result) return { pending, record: currentRecord, settlements: [] };

  const actualSelection = resolveObservationSelection(pending.kind, result);
  const correct = actualSelection === pending.selection;
  const settlement: ObservationSettlement = {
    ...pending,
    homeTeamId: result.homeTeamId,
    awayTeamId: result.awayTeamId,
    actualSelection,
    correct,
  };
  const currentStreak = correct ? currentRecord.currentStreak + 1 : 0;
  const recent = [...currentRecord.recent, settlement].slice(-OBSERVATION_HISTORY_LIMIT);

  return {
    pending: null,
    record: {
      total: currentRecord.total + 1,
      correct: currentRecord.correct + Number(correct),
      currentStreak,
      bestStreak: Math.max(currentRecord.bestStreak, currentStreak),
      recent,
    },
    settlements: [settlement],
  };
}

export function observationSelectionLabel(selection: ObservationSelection): string {
  const labels: Record<ObservationSelection, string> = {
    home: '主胜',
    draw: '平局',
    away: '客胜',
    'under-3': '0-2 球',
    'over-2': '3+ 球',
    yes: '会爆冷',
    no: '不会爆冷',
  };
  return labels[selection];
}
