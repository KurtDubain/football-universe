import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import TeamBadge from '../components/TeamBadge';
import TrophyBreakdown from '../components/TrophyBreakdown';
import {
  getTierLabel,
  getTierColor,
  getCoachName,
  formatForm,
  getLeagueName,
} from '../utils/format';
import { buildTeamCoachMap } from '../engine/coaches/coach-lookup';
import type { TeamTier, TeamBase, TeamState } from '../types/team';
import type { GameWorld } from '../engine/season/season-manager';

type ViewMode = 'tier' | 'league' | 'region';

const TIER_ORDER: TeamTier[] = ['elite', 'strong', 'mid', 'lower', 'underdog'];
const LEAGUE_ORDER: (1 | 2 | 3)[] = [1, 2, 3];

export default function Teams() {
  const world = useGameStore((s) => s.world);

  if (!world) return <div className="text-slate-400">正在加载...</div>;
  return <TeamsContent world={world} />;
}

function TeamsContent({ world }: { world: GameWorld }) {
  const [viewMode, setViewMode] = useState<ViewMode>('tier');

  // Memo a single teamId → coachId map per render so each TeamCard does an
  // O(1) lookup instead of walking coachStates O(N) times.
  const teamCoachMap = useMemo(
    () => buildTeamCoachMap(world.coachStates),
    [world],
  );

  const allTeams = useMemo(() => {
    if (!world) return [];
    return Object.values(world.teamBases).map((base) => ({
      base,
      state: world.teamStates[base.id],
    }));
  }, [world]);

  const teamCount = allTeams.length;
  const leagueCount = new Set(allTeams.map((t) => t.state.leagueLevel)).size;
  const tierCount = new Set(allTeams.map((t) => t.base.tier)).size;

  // Group teams
  const groupedByTier = useMemo(() => {
    const groups: Record<TeamTier, { base: TeamBase; state: TeamState }[]> = {
      elite: [], strong: [], mid: [], lower: [], underdog: [],
    };
    allTeams.forEach((t) => {
      groups[t.base.tier].push(t);
    });
    // Sort each group by overall desc
    Object.values(groups).forEach((g) => g.sort((a, b) => b.base.overall - a.base.overall));
    return groups;
  }, [allTeams]);

  const groupedByLeague = useMemo(() => {
    const groups: Record<number, { base: TeamBase; state: TeamState }[]> = {
      1: [], 2: [], 3: [],
    };
    allTeams.forEach((t) => {
      groups[t.state.leagueLevel].push(t);
    });
    Object.values(groups).forEach((g) => g.sort((a, b) => b.base.overall - a.base.overall));
    return groups;
  }, [allTeams]);

  const groupedByRegion = useMemo(() => {
    const groups: Record<string, { base: TeamBase; state: TeamState }[]> = {};
    allTeams.forEach((t) => {
      const continent = t.base.region?.split('+')[0] ?? '未知';
      if (!groups[continent]) groups[continent] = [];
      groups[continent].push(t);
    });
    Object.values(groups).forEach((g) => g.sort((a, b) => b.base.overall - a.base.overall));
    return groups;
  }, [allTeams]);

  const regionOrder = useMemo(() => {
    return Object.keys(groupedByRegion).sort((a, b) => {
      const aMax = groupedByRegion[a]?.[0]?.base.overall ?? 0;
      const bMax = groupedByRegion[b]?.[0]?.base.overall ?? 0;
      return bMax - aMax;
    });
  }, [groupedByRegion]);

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100">球队中心</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {teamCount}队 · {leagueCount}级联赛 · {tierCount}档
          </p>
        </div>

        {/* View toggle */}
        <div className="flex bg-slate-800 rounded-lg border border-slate-700 p-0.5 self-start sm:self-auto">
          <button
            onClick={() => setViewMode('tier')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'tier'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            按档次
          </button>
          <button
            onClick={() => setViewMode('league')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'league'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            按联赛
          </button>
          <button
            onClick={() => setViewMode('region')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === 'region'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            按地区
          </button>
        </div>
      </div>

      {/* Team groups */}
      {viewMode === 'tier'
        ? TIER_ORDER.map((tier) => {
            const teams = groupedByTier[tier];
            if (teams.length === 0) return null;
            return (
              <TierGroup
                key={tier}
                label={getTierLabel(tier)}
                colorClass={getTierColor(tier)}
                count={teams.length}
                teams={teams}
                world={world}
                teamCoachMap={teamCoachMap}
              />
            );
          })
        : viewMode === 'league'
          ? LEAGUE_ORDER.map((level) => {
            const teams = groupedByLeague[level];
            if (teams.length === 0) return null;
            return (
              <LeagueGroup
                key={level}
                label={getLeagueName(level)}
                level={level}
                count={teams.length}
                teams={teams}
                world={world}
                teamCoachMap={teamCoachMap}
              />
            );
          })
          : regionOrder.map((continent) => {
            const teams = groupedByRegion[continent];
            if (!teams || teams.length === 0) return null;
            return (
              <RegionGroup
                key={continent}
                continent={continent}
                count={teams.length}
                teams={teams}
                world={world}
                teamCoachMap={teamCoachMap}
              />
            );
          })}
    </div>
  );
}

// ── Group components ────────────────────────────────────────────

function TierGroup({
  label,
  colorClass,
  count,
  teams,
  world,
  teamCoachMap,
}: {
  label: string;
  colorClass: string;
  count: number;
  teams: { base: TeamBase; state: TeamState }[];
  world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>;
  teamCoachMap: Map<string, string>;
}) {
  return (
    <div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold mb-2 ${colorClass}`}>
        {label}
        <span className="text-xs opacity-70">{count}队</span>
      </div>
      <div className="space-y-2">
        {teams.map((t) => (
          <TeamCard key={t.base.id} base={t.base} state={t.state} world={world} coachId={teamCoachMap.get(t.base.id) ?? null} />
        ))}
      </div>
    </div>
  );
}

function LeagueGroup({
  label,
  level,
  count,
  teams,
  world,
  teamCoachMap,
}: {
  label: string;
  level: number;
  count: number;
  teams: { base: TeamBase; state: TeamState }[];
  world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>;
  teamCoachMap: Map<string, string>;
}) {
  const bgColor =
    level === 1
      ? 'bg-emerald-900/30 text-emerald-400'
      : level === 2
        ? 'bg-blue-900/30 text-blue-400'
        : 'bg-slate-700/50 text-slate-300';

  return (
    <div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold mb-2 ${bgColor}`}>
        {label}
        <span className="text-xs opacity-70">{count}队</span>
      </div>
      <div className="space-y-2">
        {teams.map((t) => (
          <TeamCard key={t.base.id} base={t.base} state={t.state} world={world} coachId={teamCoachMap.get(t.base.id) ?? null} />
        ))}
      </div>
    </div>
  );
}

const CONTINENT_COLORS: Record<string, string> = {
  '大陆': 'bg-amber-900/30 text-amber-400',
  '南洲': 'bg-teal-900/30 text-teal-400',
  '东洲': 'bg-rose-900/30 text-rose-400',
};

function RegionGroup({
  continent,
  count,
  teams,
  world,
  teamCoachMap,
}: {
  continent: string;
  count: number;
  teams: { base: TeamBase; state: TeamState }[];
  world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>;
  teamCoachMap: Map<string, string>;
}) {
  const colorClass = CONTINENT_COLORS[continent] ?? 'bg-slate-700/50 text-slate-300';
  const subRegions = new Set(teams.map(t => t.base.region?.split('+')[1] ?? ''));

  return (
    <div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold mb-2 ${colorClass}`}>
        {continent}
        <span className="text-xs opacity-70">{count}队 · {subRegions.size}地区</span>
      </div>
      <div className="space-y-2">
        {teams.map((t) => (
          <TeamCard key={t.base.id} base={t.base} state={t.state} world={world} coachId={teamCoachMap.get(t.base.id) ?? null} />
        ))}
      </div>
    </div>
  );
}

// ── Team card ───────────────────────────────────────────────────

function TeamCard({
  base,
  state,
  world,
  coachId,
}: {
  base: TeamBase;
  state: TeamState;
  world: NonNullable<ReturnType<typeof useGameStore.getState>['world']>;
  /** Pre-resolved current coach id (from buildTeamCoachMap), null if unassigned. */
  coachId: string | null;
}) {
  const tierLabel = getTierLabel(base.tier);
  const tierColor = getTierColor(base.tier);
  const coachName = coachId
    ? getCoachName(coachId, world.coachBases)
    : '无教练';
  const formBadges = formatForm(state.recentForm.slice(-3));
  const trophies = world.teamTrophies[base.id] ?? [];

  const moraleDot =
    state.morale > 60
      ? 'bg-green-500'
      : state.morale >= 40
        ? 'bg-amber-500'
        : 'bg-red-500';

  const leagueLevelLabel =
    state.leagueLevel === 1 ? '顶级' : state.leagueLevel === 2 ? '甲级' : '乙级';
  const leagueLevelColor =
    state.leagueLevel === 1
      ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700/50'
      : state.leagueLevel === 2
        ? 'bg-blue-900/50 text-blue-400 border-blue-700/50'
        : 'bg-slate-700/50 text-slate-400 border-slate-600/50';

  return (
    <Link
      to={`/team/${base.id}`}
      className="flex items-center gap-3 bg-slate-800 rounded-lg border border-slate-700 p-3 hover:border-slate-500 hover:bg-slate-800/80 transition-all group hover-lift"
    >
      {/* Team badge */}
      <TeamBadge shortName={base.shortName} color={base.color} size={36} />

      {/* Center: name + tier + OVR */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-100 group-hover:text-blue-400 transition-colors truncate">
            {base.name}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tierColor}`}>
            {tierLabel}
          </span>
          {base.region && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/50 text-slate-400">
              {base.region.split('+')[1]}
            </span>
          )}
          <span className="text-xs text-slate-400 font-mono font-semibold">
            {base.overall}
          </span>
        </div>

        {/* State indicators on small screens stack below */}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {/* Morale dot */}
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            士气
            <span className={`w-2 h-2 rounded-full inline-block ${moraleDot}`} />
          </span>
          {/* Coach */}
          <span className="text-[10px] text-slate-500 truncate max-w-[80px] sm:max-w-none">
            {coachName}
          </span>
          {/* Form badges */}
          {formBadges.length > 0 && (
            <div className="flex gap-0.5">
              {formBadges.map((f, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white ${f.color}`}
                >
                  {f.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Trophy breakdown — only if any */}
        {trophies.length > 0 && (
          <div className="mt-1.5">
            <TrophyBreakdown trophies={trophies} />
          </div>
        )}
      </div>

      {/* Far right: league badge */}
      <div className={`px-2 py-0.5 rounded text-[10px] font-medium border shrink-0 ${leagueLevelColor}`}>
        {leagueLevelLabel}
      </div>
    </Link>
  );
}
