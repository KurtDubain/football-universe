import type { MatchEvent } from '../../types/match';

interface Props {
  events: MatchEvent[];
  homeTeamId: string;
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  homeScore: number;
  awayScore: number;
  nextEvent?: MatchEvent;
}

export default function ShootoutTracker({
  events,
  homeTeamId,
  homeName,
  awayName,
  homeColor,
  awayColor,
  homeScore,
  awayScore,
  nextEvent,
}: Props) {
  const homeKicks = events.filter(event => event.teamId === homeTeamId);
  const awayKicks = events.filter(event => event.teamId !== homeTeamId);
  const slotCount = Math.max(5, homeKicks.length, awayKicks.length);
  const latest = events.at(-1);
  const stage = latest?.shootout?.suddenDeath
    ? `突然死亡 · 第${latest.shootout.round - 5}轮`
    : `点球大战 · 第${latest?.shootout?.round ?? 1}轮`;
  const nextTeamName = nextEvent?.teamId === homeTeamId ? homeName : awayName;
  const nextTeamScore = nextEvent?.teamId === homeTeamId ? homeScore : awayScore;
  const opponentScore = nextEvent?.teamId === homeTeamId ? awayScore : homeScore;
  const nextTeamTaken = Math.max(0, (nextEvent?.shootout?.teamKickNumber ?? 1) - 1);
  const opponentTaken = events.filter(event => event.teamId !== nextEvent?.teamId).length;
  const nextKickWins = Boolean(nextEvent && !nextEvent.shootout?.suddenDeath
    && nextTeamScore + 1 > opponentScore + Math.max(0, 5 - opponentTaken));
  const mustScore = Boolean(nextEvent && !nextEvent.shootout?.suddenDeath
    && nextTeamScore + Math.max(0, 5 - nextTeamTaken) <= opponentScore);
  const pressure = !nextEvent
    ? '逐罚结束'
    : nextEvent.shootout?.suddenDeath
      ? `${nextTeamName}进入突然死亡主罚`
      : mustScore
        ? `${nextTeamName}必须罚进`
        : nextKickWins
          ? `${nextTeamName}命中即可结束`
          : `${nextTeamName}即将主罚`;

  const row = (side: 'home' | 'away', name: string, color: string, kicks: MatchEvent[], score: number) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[11px] font-semibold text-slate-300" title={name}>{name}</span>
      </div>
      <div className="flex flex-wrap justify-end gap-1" aria-label={`${name}点球记录`}>
        {Array.from({ length: slotCount }, (_, index) => {
          const kick = kicks[index];
          const scored = kick?.type === 'penalty_goal';
          return (
            <span
              key={index}
              title={kick?.description ?? '尚未主罚'}
              className={`h-3 w-3 rounded-full border ${
                !kick
                  ? 'border-slate-600 bg-transparent'
                  : scored
                    ? 'border-emerald-300 bg-emerald-400'
                    : 'border-rose-300 bg-rose-500'
              }`}
            />
          );
        })}
      </div>
      <span
        data-testid={`shootout-${side}-score`}
        className="w-5 text-right text-sm font-black tabular-nums text-amber-300"
      >{score}</span>
    </div>
  );

  return (
    <div data-testid="shootout-tracker" className="border-y border-amber-400/15 bg-amber-400/[0.04] px-4 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold text-amber-300">{stage}</span>
        <span className="text-[10px] text-slate-500">{pressure} · <span className="tabular-nums">{homeScore} - {awayScore}</span></span>
      </div>
      <div className="space-y-1.5">
        {row('home', homeName, homeColor, homeKicks, homeScore)}
        {row('away', awayName, awayColor, awayKicks, awayScore)}
      </div>
    </div>
  );
}
