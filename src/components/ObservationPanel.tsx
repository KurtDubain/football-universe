import { useMemo, useState } from 'react';
import type { GameWorld } from '../engine/season/season-manager';
import type { MatchFixture } from '../types/match';
import { useGameStore } from '../store/game-store';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { predictMatch } from '../engine/match/prediction';
import {
  observationSelectionLabel,
  type ObservationJudgmentKind,
  type ObservationSelection,
} from '../engine/observation/judgment';
import { Icon } from './Icon';

const KIND_OPTIONS: Array<{ id: ObservationJudgmentKind; label: string }> = [
  { id: 'outcome', label: '胜平负' },
  { id: 'goals', label: '总进球' },
  { id: 'upset', label: '是否爆冷' },
];

export default function ObservationPanel({ world, fixtures }: { world: GameWorld; fixtures: MatchFixture[] }) {
  const setJudgment = useGameStore(state => state.setObservationJudgment);
  const cancelJudgment = useGameStore(state => state.cancelObservationJudgment);
  const pending = world.pendingObservationJudgment ?? null;
  const [expanded, setExpanded] = useState(false);
  const [fixtureId, setFixtureId] = useState(pending?.fixtureId ?? fixtures[0]?.id ?? '');
  const [kind, setKind] = useState<ObservationJudgmentKind>(pending?.kind ?? 'outcome');

  const effectiveFixtureId = fixtures.some(entry => entry.id === fixtureId)
    ? fixtureId
    : pending && fixtures.some(entry => entry.id === pending.fixtureId)
      ? pending.fixtureId
      : fixtures[0]?.id ?? '';
  const fixture = fixtures.find(entry => entry.id === effectiveFixtureId) ?? fixtures[0];
  const prediction = useMemo(() => {
    if (!fixture) return null;
    const home = world.teamBases[fixture.homeTeamId];
    const away = world.teamBases[fixture.awayTeamId];
    const homeState = world.teamStates[fixture.homeTeamId];
    const awayState = world.teamStates[fixture.awayTeamId];
    if (!home || !away || !homeState || !awayState) return null;
    const homeCoachId = getTeamCoachId(world.coachStates, fixture.homeTeamId);
    const awayCoachId = getTeamCoachId(world.coachStates, fixture.awayTeamId);
    return predictMatch(
      home,
      away,
      homeState,
      awayState,
      homeCoachId ? world.coachBases[homeCoachId] ?? null : null,
      awayCoachId ? world.coachBases[awayCoachId] ?? null : null,
      {
        fixture,
        homeSquad: world.squads[fixture.homeTeamId],
        awaySquad: world.squads[fixture.awayTeamId],
        globalWindowIdx: world.totalElapsedWindows,
      },
    );
  }, [fixture, world]);

  if (!fixture || !prediction) return null;
  const home = world.teamBases[fixture.homeTeamId];
  const away = world.teamBases[fixture.awayTeamId];

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-sky-800/50 bg-slate-800/70 px-3 text-xs text-sky-300 transition-colors hover:border-sky-700 hover:bg-slate-800"
      >
        <Icon name={pending ? 'check' : 'target'} size={15} />
        {pending
          ? `本轮已判断：${observationSelectionLabel(pending.selection)} · 点击修改`
          : '做出本轮观察判断 · 可选'}
      </button>
    );
  }

  const selectionOptions = getSelectionOptions(kind, prediction);

  return (
    <section data-testid="observation-panel" className="rounded-lg border border-sky-800/50 bg-slate-800 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
            <Icon name="target" size={15} />
            本轮观察判断
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">每轮最多记录一条，不消耗资源，也不会影响赛果。</p>
        </div>
        <button type="button" onClick={() => setExpanded(false)} className="min-h-11 px-2 text-xs text-slate-500 hover:text-slate-300">收起</button>
      </div>

      <div className="mt-3 space-y-3">
        <select
          aria-label="选择判断比赛"
          value={fixture.id}
          onChange={event => setFixtureId(event.target.value)}
          className="min-h-11 w-full rounded border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 focus:border-sky-600 focus:outline-none"
        >
          {fixtures.map(entry => (
            <option key={entry.id} value={entry.id}>
              {world.teamBases[entry.homeTeamId]?.shortName ?? entry.homeTeamId} vs {world.teamBases[entry.awayTeamId]?.shortName ?? entry.awayTeamId} · {entry.competitionName}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900 p-1" role="tablist" aria-label="判断类型">
          {KIND_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={kind === option.id}
              onClick={() => setKind(option.id)}
              className={`min-h-9 rounded px-2 text-xs font-medium ${kind === option.id ? 'bg-sky-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {selectionOptions.map(option => (
            <button
              key={option.selection}
              type="button"
              onClick={() => {
                setJudgment(fixture.id, kind, option.selection);
                setExpanded(false);
              }}
              className={`min-h-11 rounded border px-2 text-xs transition-colors ${pending?.fixtureId === fixture.id && pending.kind === kind && pending.selection === option.selection
                ? 'border-sky-500 bg-sky-900/50 text-sky-100'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-700'
              }`}
            >
              <span className="font-semibold">{option.label}</span>
              {option.detail && <span className="ml-1 text-[11px] text-slate-500">{option.detail}</span>}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-700 pt-2 text-[11px] text-slate-500">
          <span>{home.shortName} {prediction.homeWinPct}% · 平 {prediction.drawPct}% · {away.shortName} {prediction.awayWinPct}%</span>
          {pending && (
            <button type="button" onClick={cancelJudgment} className="min-h-9 shrink-0 px-2 text-red-400 hover:text-red-300">撤销判断</button>
          )}
        </div>
      </div>
    </section>
  );
}

function getSelectionOptions(
  kind: ObservationJudgmentKind,
  prediction: { homeWinPct: number; drawPct: number; awayWinPct: number },
): Array<{ selection: ObservationSelection; label: string; detail?: string }> {
  if (kind === 'outcome') {
    return [
      { selection: 'home', label: '主胜', detail: `${prediction.homeWinPct}%` },
      { selection: 'draw', label: '平局', detail: `${prediction.drawPct}%` },
      { selection: 'away', label: '客胜', detail: `${prediction.awayWinPct}%` },
    ];
  }
  if (kind === 'goals') {
    return [
      { selection: 'under-3', label: '0-2 球' },
      { selection: 'over-2', label: '3+ 球' },
    ];
  }
  return [
    { selection: 'yes', label: '会爆冷' },
    { selection: 'no', label: '不会爆冷' },
  ];
}
