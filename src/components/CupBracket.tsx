import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { isDerby, getDerbyName } from '../config/derbies';
import type { CupFixture, CupRound } from '../types/cup';
import type { TeamBase, TeamState } from '../types/team';
import { getTeamName, getTeamShortName, getTierColor, getTierLabel } from '../utils/format';
import { Icon } from './Icon';
import TeamBadge from './TeamBadge';
import {
  buildDisplayRounds,
  buildMergedRounds,
  type MergedRound,
  type MergedTie,
} from './cup-bracket-model';

const VIEW_STORAGE_KEY = 'football-universe:cup-bracket-view-v1';
const BRACKET_CARD_WIDTH = 172;
const BRACKET_CARD_HEIGHT = 82;
const BRACKET_COLUMN_STEP = 224;
const BRACKET_HEADER_HEIGHT = 48;
const BRACKET_ROW_PITCH = 92;

type BracketMode = 'bracket' | 'list';

const levelTag: Record<number, { text: string; cls: string }> = {
  1: { text: '顶', cls: 'bg-amber-900/40 text-amber-400' },
  2: { text: '甲', cls: 'bg-blue-900/40 text-blue-400' },
  3: { text: '乙', cls: 'bg-emerald-900/40 text-emerald-400' },
};

function readBracketMode(): BracketMode {
  if (typeof window === 'undefined') return 'bracket';
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'bracket';
  } catch {
    return 'bracket';
  }
}

function persistBracketMode(mode: BracketMode): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    // Preference persistence is optional; the bracket itself remains usable.
  }
}

export function CupTeamTag({ teamId, ts, tb }: {
  teamId: string;
  ts: Record<string, TeamState>;
  tb?: Record<string, TeamBase>;
}) {
  const leagueLevel = ts[teamId]?.leagueLevel;
  const tier = tb?.[teamId]?.tier;
  const region = tb?.[teamId]?.region?.split('+')[1];
  if (!leagueLevel && !tier) return null;
  const level = leagueLevel ? levelTag[leagueLevel] : null;

  return (
    <span className="flex shrink-0 gap-0.5">
      {level && <span className={`rounded px-1 py-0.5 text-[11px] font-medium ${level.cls}`}>{level.text}</span>}
      {tier && <span className={`rounded px-1 py-0.5 text-[11px] font-medium ${getTierColor(tier)}`}>{getTierLabel(tier)}</span>}
      {region && <span className="rounded bg-slate-700/50 px-1 py-0.5 text-[11px] text-slate-400">{region}</span>}
    </span>
  );
}

export function BracketView({ rounds, tb, ts, onClick }: {
  rounds: CupRound[];
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (fixture: CupFixture) => void;
}) {
  const [mode, setMode] = useState<BracketMode>(readBracketMode);
  const merged = useMemo(() => buildMergedRounds(rounds), [rounds]);
  const signature = merged.map(round => `${round.key}:${round.ties.length}:${round.completed}`).join('|');

  if (merged.length === 0) return <p className="text-sm text-slate-500">淘汰赛尚未开始</p>;

  const selectMode = (nextMode: BracketMode) => {
    setMode(nextMode);
    persistBracketMode(nextMode);
  };

  return (
    <section className="cup-knockout-shell" aria-label="淘汰赛对阵">
      <div className="cup-bracket-view-switch">
        <div className="ui-segmented cup-bracket-mode-control" role="tablist" aria-label="淘汰赛视图">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'bracket'}
            aria-controls="cup-bracket-panel"
            className="ui-segmented-option inline-flex items-center justify-center gap-1.5"
            onClick={() => selectMode('bracket')}
          >
            <Icon name="bracket" size={15} />
            晋级图
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'list'}
            aria-controls="cup-list-panel"
            className="ui-segmented-option inline-flex items-center justify-center gap-1.5"
            onClick={() => selectMode('list')}
          >
            <Icon name="clipboard" size={15} />
            对阵列表
          </button>
        </div>
      </div>

      {mode === 'bracket' ? (
        <ClassicBracket key={signature} merged={merged} tb={tb} onClick={onClick} />
      ) : (
        <RoundList key={signature} merged={merged} tb={tb} ts={ts} onClick={onClick} />
      )}
    </section>
  );
}

function ClassicBracket({ merged, tb, onClick }: {
  merged: MergedRound[];
  tb: Record<string, TeamBase>;
  onClick: (fixture: CupFixture) => void;
}) {
  const displayRounds = useMemo(() => buildDisplayRounds(merged), [merged]);
  const championId = merged.at(-1)?.ties[0]?.winnerId;
  const activeRoundIndex = Math.max(0, (() => {
    const firstIncomplete = merged.findIndex(round => !round.completed);
    return firstIncomplete >= 0 ? firstIncomplete : merged.length - 1;
  })());
  const focusColumn = championId ? displayRounds.length : activeRoundIndex;
  const [visibleColumn, setVisibleColumn] = useState(focusColumn);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const firstRoundTieCount = Math.max(1, displayRounds[0]?.ties.length ?? 1);
  const stageHeight = Math.max(244, BRACKET_HEADER_HEIGHT + firstRoundTieCount * BRACKET_ROW_PITCH);
  const stageWidth = displayRounds.length * BRACKET_COLUMN_STEP + BRACKET_CARD_WIDTH;

  const tieCenter = (roundIndex: number, tieIndex: number): number => {
    const tieCount = Math.max(1, displayRounds[roundIndex]?.ties.length ?? 1);
    return BRACKET_HEADER_HEIGHT
      + BRACKET_ROW_PITCH * (tieIndex + 0.5) * (firstRoundTieCount / tieCount);
  };

  const scrollToColumn = useCallback((index: number, smooth: boolean) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const centeredOffset = Math.max(0, (scroller.clientWidth - BRACKET_CARD_WIDTH) / 2);
    const left = Math.max(0, index * BRACKET_COLUMN_STEP - centeredOffset);
    const targetRoundIndex = Math.min(index, displayRounds.length - 1);
    const targetTieCount = Math.max(1, displayRounds[targetRoundIndex]?.ties.length ?? 1);
    const targetCenter = BRACKET_HEADER_HEIGHT
      + BRACKET_ROW_PITCH * 0.5 * (firstRoundTieCount / targetTieCount);
    const top = scroller.scrollHeight > scroller.clientHeight + 1
      ? Math.max(0, targetCenter - Math.min(148, scroller.clientHeight / 2))
      : scroller.scrollTop;
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ left, top, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
    } else {
      scroller.scrollLeft = left;
      scroller.scrollTop = top;
    }
    setVisibleColumn(index);
  }, [displayRounds, firstRoundTieCount]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => scrollToColumn(focusColumn, false));
    return () => window.cancelAnimationFrame(frame);
  }, [focusColumn, scrollToColumn]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const centeredLeft = scroller.scrollLeft + Math.max(0, (scroller.clientWidth - BRACKET_CARD_WIDTH) / 2);
    const index = Math.max(0, Math.min(displayRounds.length, Math.round(centeredLeft / BRACKET_COLUMN_STEP)));
    setVisibleColumn(previous => previous === index ? previous : index);
  };

  return (
    <div id="cup-bracket-panel" role="tabpanel" data-testid="classic-bracket" className="cup-classic-bracket">
      <div className="cup-bracket-round-nav" role="tablist" aria-label="晋级图轮次">
        {displayRounds.map((round, index) => (
          <button
            key={round.key}
            type="button"
            role="tab"
            aria-selected={visibleColumn === index}
            data-active={index === activeRoundIndex && !championId}
            onClick={() => scrollToColumn(index, true)}
          >
            <span>{round.label}</span>
            {round.completed && <Icon name="check" size={11} className="text-emerald-300" />}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={visibleColumn === displayRounds.length}
          data-active={Boolean(championId)}
          onClick={() => scrollToColumn(displayRounds.length, true)}
        >
          <Icon name="trophy" size={12} className="text-amber-300" />
          <span>冠军</span>
        </button>
      </div>

      <div
        ref={scrollerRef}
        className="cup-bracket-scroll"
        aria-label="可横向滑动的淘汰赛晋级图"
        onScroll={handleScroll}
      >
        <div
          className="cup-bracket-stage"
          style={{ width: stageWidth, height: stageHeight }}
          data-active-round-index={activeRoundIndex}
        >
          <BracketConnectors
            rounds={displayRounds}
            championId={championId}
            width={stageWidth}
            height={stageHeight}
            tieCenter={tieCenter}
          />

          {displayRounds.map((round, roundIndex) => (
            <div key={round.key} data-bracket-round={round.label}>
              <span
                className="cup-bracket-snap-anchor"
                style={{ left: roundIndex * BRACKET_COLUMN_STEP, width: BRACKET_CARD_WIDTH }}
                aria-hidden="true"
              />
              <div
                className="cup-bracket-round-heading"
                data-current={roundIndex === activeRoundIndex && !championId}
                style={{ left: roundIndex * BRACKET_COLUMN_STEP, width: BRACKET_CARD_WIDTH }}
              >
                <span>{round.label}</span>
                {round.twoLegged && <small>两回合</small>}
              </div>
              {round.ties.map((tie, tieIndex) => (
                <ClassicTie
                  key={`${round.key}-${tie.leg1?.id ?? tieIndex}`}
                  tie={tie}
                  round={round}
                  tb={tb}
                  active={roundIndex === activeRoundIndex && !round.synthetic}
                  onClick={onClick}
                  style={{
                    left: roundIndex * BRACKET_COLUMN_STEP,
                    top: tieCenter(roundIndex, tieIndex) - BRACKET_CARD_HEIGHT / 2,
                    width: BRACKET_CARD_WIDTH,
                    height: BRACKET_CARD_HEIGHT,
                  }}
                />
              ))}
            </div>
          ))}

          <div
            className="cup-bracket-round-heading cup-bracket-champion-heading"
            style={{ left: displayRounds.length * BRACKET_COLUMN_STEP, width: BRACKET_CARD_WIDTH }}
          >
            <Icon name="trophy" size={14} />
            <span>冠军</span>
          </div>
          <span
            className="cup-bracket-snap-anchor"
            style={{ left: displayRounds.length * BRACKET_COLUMN_STEP, width: BRACKET_CARD_WIDTH }}
            aria-hidden="true"
          />
          <ChampionCell
            teamId={championId}
            tb={tb}
            style={{
              left: displayRounds.length * BRACKET_COLUMN_STEP,
              top: tieCenter(displayRounds.length - 1, 0) - BRACKET_CARD_HEIGHT / 2,
              width: BRACKET_CARD_WIDTH,
              height: BRACKET_CARD_HEIGHT,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function BracketConnectors({ rounds, championId, width, height, tieCenter }: {
  rounds: MergedRound[];
  championId?: string;
  width: number;
  height: number;
  tieCenter: (roundIndex: number, tieIndex: number) => number;
}) {
  return (
    <svg className="cup-bracket-connectors" width={width} height={height} aria-hidden="true">
      {rounds.slice(0, -1).flatMap((round, roundIndex) => {
        const nextRound = rounds[roundIndex + 1];
        const sourceCount = Math.max(1, round.ties.length);
        const targetCount = Math.max(1, nextRound.ties.length);
        const sourcesPerTarget = sourceCount / targetCount;
        const sourceX = roundIndex * BRACKET_COLUMN_STEP + BRACKET_CARD_WIDTH;
        const targetX = (roundIndex + 1) * BRACKET_COLUMN_STEP;
        const junctionX = sourceX + (targetX - sourceX) / 2;

        return round.ties.map((tie, tieIndex) => {
          const targetIndex = Math.min(targetCount - 1, Math.floor(tieIndex / sourcesPerTarget));
          const sourceY = tieCenter(roundIndex, tieIndex);
          const targetY = tieCenter(roundIndex + 1, targetIndex);
          const targetTie = nextRound.ties[targetIndex];
          const advanced = Boolean(tie.winnerId) && (
            targetTie.team1Id === tie.winnerId || targetTie.team2Id === tie.winnerId
          );
          return (
            <path
              key={`${round.key}-${tieIndex}`}
              className="cup-bracket-connector"
              data-advanced={advanced}
              d={`M ${sourceX} ${sourceY} H ${junctionX} V ${targetY} H ${targetX}`}
            />
          );
        });
      })}
      <path
        className="cup-bracket-connector cup-bracket-champion-connector"
        data-advanced={Boolean(championId)}
        d={`M ${(rounds.length - 1) * BRACKET_COLUMN_STEP + BRACKET_CARD_WIDTH} ${tieCenter(rounds.length - 1, 0)} H ${rounds.length * BRACKET_COLUMN_STEP}`}
      />
    </svg>
  );
}

function ClassicTie({ tie, round, tb, active, onClick, style }: {
  tie: MergedTie;
  round: MergedRound;
  tb: Record<string, TeamBase>;
  active: boolean;
  onClick: (fixture: CupFixture) => void;
  style: CSSProperties;
}) {
  const clickTarget = tie.leg2 ?? tie.leg1;
  const hasResult = tie.agg1 !== undefined && tie.agg2 !== undefined;
  const status = getTieStatus(tie, round);
  const team1 = tb[tie.team1Id];
  const team2 = tb[tie.team2Id];
  const derbyName = team1 && team2 && isDerby(tie.team1Id, tie.team2Id, tb)
    ? getDerbyName(tie.team1Id, tie.team2Id, tb)
    : null;
  const accessibleName = `${round.label}，${team1?.name ?? '待定'} 对 ${team2?.name ?? '待定'}，${status}`;

  return (
    <button
      type="button"
      className="cup-bracket-tie"
      style={style}
      disabled={!clickTarget}
      data-active={active && !hasResult}
      data-completed={Boolean(tie.winnerId)}
      aria-label={accessibleName}
      title={derbyName ?? accessibleName}
      onClick={() => clickTarget && onClick(clickTarget)}
    >
      <BracketTeamRow teamId={tie.team1Id} score={tie.agg1} winnerId={tie.winnerId} tb={tb} />
      <BracketTeamRow teamId={tie.team2Id} score={tie.agg2} winnerId={tie.winnerId} tb={tb} />
      <div className="cup-bracket-tie-meta" data-special={status.startsWith('点球') || status === '加时'}>
        {derbyName ? <span className="truncate text-orange-300">{derbyName}</span> : <span>{status}</span>}
      </div>
    </button>
  );
}

function BracketTeamRow({ teamId, score, winnerId, tb }: {
  teamId: string;
  score?: number;
  winnerId?: string;
  tb: Record<string, TeamBase>;
}) {
  const team = tb[teamId];
  const winner = Boolean(teamId) && winnerId === teamId;
  const eliminated = Boolean(winnerId && teamId && !winner);

  return (
    <span className="cup-bracket-team" data-winner={winner} data-eliminated={eliminated}>
      {team ? (
        <TeamBadge teamId={teamId} shortName={team.shortName} color={team.color} size={18} />
      ) : (
        <span className="cup-bracket-placeholder-dot" aria-hidden="true" />
      )}
      <span className="cup-bracket-team-name" title={team?.name}>
        {team ? getTeamShortName(teamId, tb) : '待定'}
      </span>
      {score !== undefined && <strong>{score}</strong>}
      {winner && <Icon name="check" size={12} className="cup-bracket-winner-check" />}
    </span>
  );
}

function getTieStatus(tie: MergedTie, round: MergedRound): string {
  if (round.synthetic || !tie.leg1) return '等待晋级球队';
  const decisiveResult = tie.leg2?.result ?? tie.leg1.result;
  if (!decisiveResult) return round.twoLegged && tie.leg1.result ? '次回合待赛' : '待赛';
  if (decisiveResult.penalties) return `点球 ${decisiveResult.penHome}-${decisiveResult.penAway}`;
  if (decisiveResult.extraTime) return '加时';
  if (round.twoLegged) return tie.leg2?.result ? '总比分' : '次回合待赛';
  return '已结束';
}

function ChampionCell({ teamId, tb, style }: {
  teamId?: string;
  tb: Record<string, TeamBase>;
  style: CSSProperties;
}) {
  const team = teamId ? tb[teamId] : undefined;
  return (
    <div className="cup-bracket-champion" style={style} data-decided={Boolean(team)}>
      <Icon name="trophy" size={22} accent={team ? '#d7ad55' : undefined} />
      {team ? <TeamBadge teamId={team.id} shortName={team.shortName} color={team.color} size={28} /> : null}
      <strong title={team?.name}>{team ? getTeamShortName(team.id, tb) : '等待决赛'}</strong>
    </div>
  );
}

export function RoundList({ merged, tb, ts, onClick }: {
  merged: MergedRound[];
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (fixture: CupFixture) => void;
}) {
  const defaultRound = merged.find(round => !round.completed)?.label ?? merged.at(-1)?.label ?? '';
  const [selectedLabel, setSelectedLabel] = useState(defaultRound);
  const selectedRound = merged.find(round => round.label === selectedLabel) ?? merged[0];

  return (
    <div id="cup-list-panel" role="tabpanel" className="pb-4">
      {merged.length > 1 && (
        <div role="tablist" aria-label="杯赛轮次" className="ui-cup-round-tabs">
          {merged.map(round => (
            <button
              key={round.key}
              type="button"
              role="tab"
              aria-selected={round.label === selectedRound.label}
              onClick={() => setSelectedLabel(round.label)}
              className={`min-h-11 whitespace-nowrap rounded-md border px-3 text-xs transition-colors sm:min-h-9 ${
                round.label === selectedRound.label
                  ? 'border-[var(--action)] bg-[var(--action)] text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              {round.label}
              {round.completed && <span className="ml-1 text-green-300">✓</span>}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-slate-700/70 bg-slate-800/30 p-2 sm:p-3">
        <RoundHeader round={selectedRound} />
        <div className={`grid gap-2 ${selectedRound.ties.length === 1 ? 'mx-auto max-w-xl grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
          {selectedRound.ties.map((tie, index) => (
            <ListTieCell key={tie.leg1?.id ?? index} tie={tie} round={selectedRound} tb={tb} ts={ts} onClick={onClick} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RoundHeader({ round }: { round: MergedRound }) {
  return (
    <div className="mb-2 whitespace-nowrap rounded border border-slate-700/50 bg-slate-800 px-2 py-1 text-center text-[11px] font-semibold text-slate-300 sm:text-xs">
      {round.label}
      {round.twoLegged && <span className="ml-1 text-slate-600">(两回合)</span>}
      {round.completed && <span className="ml-1 text-green-400">✓</span>}
    </div>
  );
}

function ListTieCell({ tie, round, tb, ts, onClick }: {
  tie: MergedTie;
  round: MergedRound;
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
  onClick: (fixture: CupFixture) => void;
}) {
  const team1 = tb[tie.team1Id];
  const team2 = tb[tie.team2Id];
  const winner1 = tie.winnerId === tie.team1Id;
  const winner2 = tie.winnerId === tie.team2Id;
  const hasResult = tie.agg1 !== undefined;
  const derbyName = isDerby(tie.team1Id, tie.team2Id, tb) ? getDerbyName(tie.team1Id, tie.team2Id, tb) : null;
  const clickTarget = tie.leg2 ?? tie.leg1;

  return (
    <button
      onClick={() => clickTarget && onClick(clickTarget)}
      type="button"
      className={`min-h-11 w-full min-w-0 rounded-lg border bg-slate-800 text-left transition-colors hover:border-slate-500 ${
        derbyName ? 'border-orange-600/40' : 'border-slate-700'
      }`}
    >
      {derbyName && <div className="rounded-t-lg bg-orange-900/20 py-0.5 text-center text-[11px] font-medium text-orange-300">{derbyName}</div>}
      <ListTeamRow teamId={tie.team1Id} score={tie.agg1} winner={winner1} team={team1} tb={tb} ts={ts} />
      <div className="border-t border-slate-700/60" />
      <ListTeamRow teamId={tie.team2Id} score={tie.agg2} winner={winner2} team={team2} tb={tb} ts={ts} />
      {round.twoLegged && (
        <div className="rounded-b-lg border-t border-slate-700/40 bg-slate-700/10 px-2 py-1 text-[11px] text-slate-500">
          {tie.leg1?.result && tie.leg2?.result ? (
            <span>
              首 {tie.leg1.result.home}-{tie.leg1.result.away}
              <span className="mx-1 text-slate-700">|</span>
              次 {tie.leg2.result.home}-{tie.leg2.result.away}
              {tie.agg1 === tie.agg2 && tie.awayGoals1 !== undefined && tie.awayGoals2 !== undefined && tie.awayGoals1 !== tie.awayGoals2 && (
                <span className="ml-1 text-amber-500">客场进球</span>
              )}
              {tie.leg2.result.penalties && <span className="ml-1 text-amber-400">点球 {tie.leg2.result.penHome}-{tie.leg2.result.penAway}</span>}
            </span>
          ) : tie.leg1?.result ? (
            <span>首 {tie.leg1.result.home}-{tie.leg1.result.away}<span className="mx-1 text-slate-700">|</span>次回合待赛</span>
          ) : (
            <span className="text-slate-600">两回合待赛</span>
          )}
        </div>
      )}
      {!round.twoLegged && tie.leg1?.result && (tie.leg1.result.penalties || tie.leg1.result.extraTime) && (
        <div className="pb-1 text-center text-[11px] text-amber-400">
          {tie.leg1.result.penalties ? `点球 ${tie.leg1.result.penHome}-${tie.leg1.result.penAway}` : '加时'}
        </div>
      )}
      {!hasResult && !round.twoLegged && <span className="sr-only">待赛</span>}
    </button>
  );
}

function ListTeamRow({ teamId, score, winner, team, tb, ts }: {
  teamId: string;
  score?: number;
  winner: boolean;
  team?: TeamBase;
  tb: Record<string, TeamBase>;
  ts: Record<string, TeamState>;
}) {
  return (
    <div className={`flex items-center gap-1 px-2 py-1.5 text-xs ${winner ? 'bg-green-900/20' : ''}`}>
      {team ? <TeamBadge teamId={teamId} shortName={team.shortName} color={team.color} size={18} /> : <span className="h-2 w-2 shrink-0 rounded-full bg-slate-600" />}
      <span className="hidden sm:inline-flex"><CupTeamTag teamId={teamId} ts={ts} tb={tb} /></span>
      <span className={`min-w-0 flex-1 truncate ${winner ? 'font-bold text-green-400' : 'text-slate-200'}`} title={team?.name}>
        {team ? <><span className="sm:hidden">{getTeamShortName(teamId, tb)}</span><span className="cup-team-full-name hidden sm:inline" data-team-name={getTeamName(teamId, tb)} aria-label={getTeamName(teamId, tb)} /></> : '待定'}
      </span>
      {score !== undefined && <span className={`font-bold tabular-nums ${winner ? 'text-green-400' : 'text-slate-500'}`}>{score}</span>}
    </div>
  );
}
