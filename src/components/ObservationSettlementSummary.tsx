import type { TeamBase } from '../types/team';
import type { ObservationRecord, ObservationSettlement } from '../engine/observation/judgment';
import { observationSelectionLabel } from '../engine/observation/judgment';
import { Icon } from './Icon';

export default function ObservationSettlementSummary({
  settlements,
  record,
  teamBases,
}: {
  settlements: ObservationSettlement[];
  record: ObservationRecord | undefined;
  teamBases: Record<string, TeamBase>;
}) {
  if (settlements.length === 0 || !record) return null;
  const latest = settlements.at(-1)!;
  const home = teamBases[latest.homeTeamId]?.shortName ?? latest.homeTeamId;
  const away = teamBases[latest.awayTeamId]?.shortName ?? latest.awayTeamId;
  const accuracy = record.total > 0 ? Math.round(record.correct / record.total * 100) : 0;

  return (
    <section
      data-testid="observation-settlement"
      className={`rounded-lg border px-3 py-3 ${latest.correct
        ? 'border-emerald-700/50 bg-emerald-950/30'
        : 'border-rose-800/50 bg-rose-950/25'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon name={latest.correct ? 'check' : 'x'} size={17} className={latest.correct ? 'text-emerald-300' : 'text-rose-300'} />
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-bold ${latest.correct ? 'text-emerald-200' : 'text-rose-200'}`}>
            {latest.correct ? '观察判断命中' : '观察判断落空'}
          </div>
          <p className="mt-1 text-xs text-slate-300">
            {home} vs {away} · 你的判断：{observationSelectionLabel(latest.selection)} · 实际：{observationSelectionLabel(latest.actualSelection)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/5 pt-2 text-[11px] text-slate-500">
        <span>累计 {record.correct}/{record.total}</span>
        {record.total < 5 ? <span>样本积累中 · {record.total}/5</span> : <span>命中率 {accuracy}%</span>}
        <span>当前连中 {record.currentStreak}</span>
        <span>最佳连中 {record.bestStreak}</span>
      </div>
    </section>
  );
}
