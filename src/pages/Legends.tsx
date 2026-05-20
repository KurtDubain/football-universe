import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getCoachStyleLabel } from '../utils/format';
import { buildCareerArc, type CareerArcPoint } from '../engine/players/career-arc';
import TrophyBreakdown from '../components/TrophyBreakdown';
import type { PlayerPosition, PlayerRetirement } from '../types/player';
import type { CoachCandidate } from '../types/coach';

type EraFilter = 'all' | 'recent' | 'classic';
type SortKey = 'recent' | 'peak' | 'goals';

const POS_LABEL: Record<PlayerPosition, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };
const POS_CHIP: Record<PlayerPosition, string> = {
  GK: 'bg-amber-900/40 text-amber-400 border-amber-700/30',
  DF: 'bg-blue-900/40 text-blue-400 border-blue-700/30',
  MF: 'bg-green-900/40 text-green-400 border-green-700/30',
  FW: 'bg-red-900/40 text-red-400 border-red-700/30',
};

const STYLE_CHIP: Record<string, string> = {
  attacking: 'text-red-400 bg-red-900/30 border-red-700/30',
  defensive: 'text-blue-400 bg-blue-900/30 border-blue-700/30',
  balanced: 'text-slate-300 bg-slate-700/50 border-slate-600/30',
  possession: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/30',
  counter: 'text-amber-400 bg-amber-900/30 border-amber-700/30',
};

export default function Legends() {
  const world = useGameStore((s) => s.world);
  const [era, setEra] = useState<EraFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('recent');

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const currentSeason = world.seasonState.seasonNumber;
  const retirements = world.retirementHistory ?? [];
  const candidatePool = world.coachCandidatePool ?? [];

  // Whole-page empty state — applies BEFORE filtering, so newcomers don't
  // think their filter wiped out the data.
  if (retirements.length === 0 && candidatePool.length === 0) {
    return <FullEmptyState />;
  }

  // ── Section B: filter + sort retirees ──
  const filtered = retirements.filter((r) => {
    const seasonsAgo = currentSeason - r.seasonRetired;
    if (era === 'recent') return seasonsAgo <= 5;
    if (era === 'classic') return seasonsAgo > 5;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        // Most recent first; tie-break by peakRating so a season's batch
        // shows its strongest names at the top.
        return b.seasonRetired - a.seasonRetired || b.peakRating - a.peakRating;
      case 'peak':
        return b.peakRating - a.peakRating;
      case 'goals':
        return (b.careerGoals ?? 0) - (a.careerGoals ?? 0);
    }
  });

  return (
    <div className="max-w-6xl space-y-6">
      {/* ── Section A: header ── */}
      <header>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-100 flex items-center gap-2">
          <span aria-hidden>🏛️</span>
          传奇名人堂
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          已记录 <span className="text-slate-300 font-semibold">{retirements.length}</span> 位退役球员 ·{' '}
          <span className="text-slate-300 font-semibold">{candidatePool.length}</span> 位未来名帅候选
        </p>
      </header>

      {/* ── Section B: retired players ── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-slate-200">退役球员</h3>
          <div className="flex flex-wrap items-center gap-2">
            {/* Era filter */}
            <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5 border border-slate-700/50">
              {([
                { key: 'all', label: '全部' },
                { key: 'recent', label: '近 5 季' },
                { key: 'classic', label: '经典老将' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setEra(key)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                    era === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="text-xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 cursor-pointer"
            >
              <option value="recent">最近退役</option>
              <option value="peak">巅峰能力</option>
              <option value="goals">职业进球</option>
            </select>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/60 p-6 text-center text-sm text-slate-500">
            当前筛选下没有退役球员。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sorted.map((r) => (
              <RetireeCard key={`${r.uuid}-${r.seasonRetired}`} retiree={r} world={world} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section C: coach candidate pool ── */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <span aria-hidden>🎓</span>
            未来名帅候选
          </h3>
          <span className="text-xs text-slate-500">
            <span className="text-slate-300 font-semibold">{candidatePool.length}</span> 位 / 12 位
          </span>
        </div>

        {candidatePool.length === 0 ? (
          <CoachPoolEmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {candidatePool.map((c) => (
              <CandidateCard
                key={`${c.uuid}-${c.enteredPoolSeason}`}
                candidate={c}
                currentSeason={currentSeason}
                world={world}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────

function RetireeCard({
  retiree,
  world,
}: {
  retiree: PlayerRetirement;
  world: ReturnType<typeof useGameStore.getState>['world'];
}) {
  const team = world?.teamBases[retiree.teamId];

  // Career arc — peakAge isn't stored on PlayerRetirement (the retirement
  // record predates the v10 peakAge field on Player); fall back to 27.
  const arc = useMemo(
    () => buildCareerArc(retiree.peakRating, retiree.age, 27, 18),
    [retiree.peakRating, retiree.age],
  );

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4 hover:border-slate-600 transition-colors">
      {/* Header row: position + name */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${POS_CHIP[retiree.position]}`}
            >
              {POS_LABEL[retiree.position]}
            </span>
            <h4 className="text-sm font-semibold text-slate-100 truncate" title={retiree.name}>
              {retiree.name}
            </h4>
          </div>
          {/* Last team */}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
            <span className="shrink-0">前</span>
            {team ? (
              <Link
                to={`/team/${retiree.teamId}`}
                className="flex items-center gap-1.5 hover:text-blue-300 transition-colors min-w-0"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: team.color }}
                />
                <span className="truncate">{team.name}</span>
              </Link>
            ) : (
              <span className="text-slate-500 truncate">{retiree.teamName}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <StatPill label="退役" value={`S${retiree.seasonRetired}`} />
        <StatPill label="退役年龄" value={`${retiree.age}岁`} />
        <StatPill label="巅峰" value={String(retiree.peakRating)} accent="text-amber-300" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <StatPill label="生涯进球" value={String(retiree.careerGoals ?? 0)} accent="text-amber-400" />
        <StatPill
          label="冠军"
          value={String(retiree.careerTrophies?.length ?? 0)}
          accent={(retiree.careerTrophies?.length ?? 0) > 0 ? 'text-emerald-300' : ''}
        />
      </div>

      {/* Trophy breakdown — only if non-empty */}
      {retiree.careerTrophies && retiree.careerTrophies.length > 0 && (
        <div className="mt-2">
          <TrophyBreakdown trophies={retiree.careerTrophies} size="xs" />
        </div>
      )}

      {/* Career trajectory chart */}
      <div className="mt-3 pt-3 border-t border-slate-700/50">
        <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
          <span>生涯轨迹</span>
          <span>18岁 → {retiree.age}岁</span>
        </div>
        <CareerArcChart arc={arc} retirementAge={retiree.age} />
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="bg-slate-900/40 rounded-lg border border-slate-700/40 py-1.5 px-1">
      <div className={`text-sm font-bold ${accent ?? 'text-slate-100'}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function CandidateCard({
  candidate,
  currentSeason,
  world,
}: {
  candidate: CoachCandidate;
  currentSeason: number;
  world: ReturnType<typeof useGameStore.getState>['world'];
}) {
  const fromTeam = world?.teamBases[candidate.fromTeamId];
  const seasonsInPool = Math.max(0, currentSeason - candidate.enteredPoolSeason);
  const styleChip = STYLE_CHIP[candidate.style] ?? 'text-slate-300 bg-slate-700/50 border-slate-600/30';

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-100 truncate" title={candidate.name}>
            {candidate.name}
          </h4>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <span className="shrink-0">前</span>
            {fromTeam ? (
              <Link
                to={`/team/${candidate.fromTeamId}`}
                className="flex items-center gap-1.5 hover:text-blue-300 transition-colors min-w-0"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: fromTeam.color }}
                />
                <span className="truncate">{fromTeam.name}</span>
              </Link>
            ) : (
              <span className="text-slate-500 truncate">{candidate.fromTeamId}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-bold text-amber-300">{candidate.peakRating}</div>
          <div className="text-[10px] text-slate-500">巅峰</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${styleChip}`}>
          {getCoachStyleLabel(candidate.style)}
        </span>
        <span className="text-[10px] text-slate-500">转型为{getCoachStyleLabel(candidate.style)}教练</span>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs">
        {seasonsInPool === 0 ? (
          <span className="text-amber-300">等待执掌帅印</span>
        ) : (
          <span className="text-slate-400">
            已入池 <span className="text-slate-200 font-semibold">{seasonsInPool}</span> 季
          </span>
        )}
      </div>
    </div>
  );
}

function CareerArcChart({
  arc,
  retirementAge,
}: {
  arc: CareerArcPoint[];
  retirementAge: number;
}) {
  const W = 200;
  const H = 80;
  const padX = 6;
  const padY = 6;
  const chartW = W - padX * 2;
  const chartH = H - padY * 2;
  // Y maps rating 30..99 to chartH..0 (top is high). Range 30 keeps the
  // 35-floor visible without smashing the curve into the top edge.
  const Y_MIN = 30;
  const Y_MAX = 99;
  const yRange = Y_MAX - Y_MIN;
  const minAge = arc[0]?.age ?? 18;
  const maxAge = arc[arc.length - 1]?.age ?? Math.max(minAge + 1, retirementAge);
  const ageRange = Math.max(1, maxAge - minAge);

  const xy = (age: number, rating: number) => {
    const x = padX + ((age - minAge) / ageRange) * chartW;
    const y = padY + (1 - (rating - Y_MIN) / yRange) * chartH;
    return { x, y };
  };

  const polyline = arc.map((p) => {
    const { x, y } = xy(p.age, p.rating);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Find the peak point — the first occurrence of the max rating.
  const maxRating = arc.reduce((m, p) => Math.max(m, p.rating), 0);
  const peakPoint = arc.find((p) => p.rating === maxRating);

  // Grid line positions
  const gridY = (rating: number) => padY + (1 - (rating - Y_MIN) / yRange) * chartH;
  const grid50 = gridY(50);
  const grid75 = gridY(75);

  // End (retirement) marker
  const endPoint = arc[arc.length - 1];
  const endXY = endPoint ? xy(endPoint.age, endPoint.rating) : null;
  const peakXY = peakPoint ? xy(peakPoint.age, peakPoint.rating) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      className="block"
      role="img"
      aria-label={`Career trajectory peak ${maxRating}`}
    >
      {/* Grid lines at 50 / 75 */}
      <line x1={padX} x2={W - padX} y1={grid50} y2={grid50} stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />
      <line x1={padX} x2={W - padX} y1={grid75} y2={grid75} stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />
      {/* Grid labels (left side) */}
      <text x={padX} y={grid50 - 1} fontSize="7" fill="#475569">50</text>
      <text x={padX} y={grid75 - 1} fontSize="7" fill="#475569">75</text>
      {/* Peak vertical guide */}
      {peakXY && (
        <line
          x1={peakXY.x}
          x2={peakXY.x}
          y1={padY}
          y2={H - padY}
          stroke="#f59e0b"
          strokeWidth="0.5"
          strokeDasharray="1 2"
          opacity="0.6"
        />
      )}
      {/* Trajectory polyline */}
      <polyline
        points={polyline}
        fill="none"
        stroke="#60a5fa"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Peak dot */}
      {peakXY && (
        <circle cx={peakXY.x} cy={peakXY.y} r={2.5} fill="#f59e0b" stroke="#1e293b" strokeWidth="0.5" />
      )}
      {/* Retirement dot (star-ish: outline ring) */}
      {endXY && (
        <>
          <circle cx={endXY.x} cy={endXY.y} r={3} fill="#ef4444" stroke="#1e293b" strokeWidth="0.75" />
          <circle cx={endXY.x} cy={endXY.y} r={1.2} fill="#fee2e2" />
        </>
      )}
    </svg>
  );
}

function CoachPoolEmptyState() {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-dashed border-slate-700/60 p-5 text-center">
      <div className="text-2xl mb-1" aria-hidden>🎓</div>
      <p className="text-sm text-slate-300 font-medium">暂无候选名帅</p>
      <p className="text-xs text-slate-500 mt-1">
        当巅峰 ≥ 85 的球员在 35 岁后退役时，有概率进入名帅候选池。
      </p>
    </div>
  );
}

function FullEmptyState() {
  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-100 flex items-center gap-2">
          <span aria-hidden>🏛️</span>
          传奇名人堂
        </h2>
      </header>
      <div className="bg-slate-800/60 rounded-xl border border-slate-700/60 p-8 text-center">
        <div className="text-5xl mb-3" aria-hidden>🏟️</div>
        <p className="text-base text-slate-200 font-semibold">尚无退役球员</p>
        <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto leading-relaxed">
          进入下一赛季后，33 岁以上的球员将开始按概率退役。
          <br />
          巅峰能力 ≥ 85 且 35 岁以后退役的球员还有机会进入未来名帅候选池。
        </p>
      </div>
    </div>
  );
}
