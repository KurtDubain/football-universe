import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import {
  executeSearch,
  type SearchEntity,
  type SearchQuery,
  type TeamFilters,
  type PlayerFilters,
  type CoachFilters,
  type TeamSearchResult,
  type PlayerSearchResult,
  type CoachSearchResult,
} from '../engine/search/query-engine';

const tierOptions: { value: string; label: string }[] = [
  { value: 'elite', label: '豪门' },
  { value: 'strong', label: '强队' },
  { value: 'mid', label: '中游' },
  { value: 'lower', label: '下游' },
  { value: 'underdog', label: '弱旅' },
];
const continentOptions = ['大陆', '南洲', '东洲'];
const positionOptions: { value: 'GK' | 'DF' | 'MF' | 'FW'; label: string }[] = [
  { value: 'GK', label: '门将' },
  { value: 'DF', label: '后卫' },
  { value: 'MF', label: '中场' },
  { value: 'FW', label: '前锋' },
];

export default function AdvancedSearch() {
  const world = useGameStore((s) => s.world);
  const [entity, setEntity] = useState<SearchEntity>('team');
  const [teamFilter, setTeamFilter] = useState<TeamFilters>({});
  const [playerFilter, setPlayerFilter] = useState<PlayerFilters>({});
  const [coachFilter, setCoachFilter] = useState<CoachFilters>({});

  const results = useMemo(() => {
    if (!world) return [];
    const query: SearchQuery = {
      entity,
      team: entity === 'team' ? teamFilter : undefined,
      player: entity === 'player' ? playerFilter : undefined,
      coach: entity === 'coach' ? coachFilter : undefined,
    };
    return executeSearch(world, query);
  }, [world, entity, teamFilter, playerFilter, coachFilter]);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const presetQueries: { label: string; apply: () => void }[] = [
    {
      label: '🏆 豪门球队',
      apply: () => {
        setEntity('team');
        setTeamFilter({ tier: ['elite'] });
      },
    },
    {
      label: '⚽ 顶级射手 (15+球)',
      apply: () => {
        setEntity('player');
        setPlayerFilter({ minGoals: 15, position: ['FW', 'MF'] });
      },
    },
    {
      label: '💎 高市值球员 (€50M+)',
      apply: () => {
        setEntity('player');
        setPlayerFilter({ minMarketValue: 50 });
      },
    },
    {
      label: '🌟 名帅 (3+冠)',
      apply: () => {
        setEntity('coach');
        setCoachFilter({ minTrophies: 3 });
      },
    },
    {
      label: '🌱 年轻新星',
      apply: () => {
        setEntity('player');
        setPlayerFilter({ maxAge: 22, minRating: 75 });
      },
    },
    {
      label: '📊 多支球队执教 (3+)',
      apply: () => {
        setEntity('coach');
        setCoachFilter({ minTeamsManaged: 3 });
      },
    },
  ];

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-100">高级搜索</h2>
        <span className="text-xs text-slate-500">{results.length} 条结果</span>
      </div>

      {/* Entity selector */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700/60 w-fit">
        {(['team', 'player', 'coach'] as SearchEntity[]).map((e) => (
          <button
            key={e}
            onClick={() => setEntity(e)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer ${
              entity === e ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {e === 'team' ? '球队' : e === 'player' ? '球员' : '教练'}
          </button>
        ))}
      </div>

      {/* Preset queries */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3">
        <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">快速查询</h3>
        <div className="flex flex-wrap gap-2">
          {presetQueries.map((q) => (
            <button
              key={q.label}
              onClick={q.apply}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-blue-700 text-slate-200 transition-colors cursor-pointer"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">筛选条件</h3>
          <button
            onClick={() => { setTeamFilter({}); setPlayerFilter({}); setCoachFilter({}); }}
            className="text-[10px] text-slate-500 hover:text-red-400 cursor-pointer"
          >
            清空
          </button>
        </div>

        {entity === 'team' && (
          <div className="space-y-3">
            <FilterChips
              label="球队等级"
              options={tierOptions}
              selected={teamFilter.tier ?? []}
              onChange={(vals) => setTeamFilter({ ...teamFilter, tier: vals.length ? vals : undefined })}
            />
            <FilterChips
              label="所在大洲"
              options={continentOptions.map((c) => ({ value: c, label: c }))}
              selected={teamFilter.continent ?? []}
              onChange={(vals) => setTeamFilter({ ...teamFilter, continent: vals.length ? vals : undefined })}
            />
            <FilterChips
              label="所在联赛"
              options={[{ value: '1', label: '顶级' }, { value: '2', label: '甲级' }, { value: '3', label: '乙级' }]}
              selected={(teamFilter.leagueLevel ?? []).map(String)}
              onChange={(vals) => setTeamFilter({ ...teamFilter, leagueLevel: vals.length ? vals.map((v) => Number(v) as 1 | 2 | 3) : undefined })}
            />
            <NumberRange
              label="综合实力"
              min={teamFilter.minOverall}
              max={teamFilter.maxOverall}
              onChange={(min, max) => setTeamFilter({ ...teamFilter, minOverall: min, maxOverall: max })}
            />
            <NumberInput
              label="历史联赛冠军次数 ≥"
              value={teamFilter.minLeagueChampionships}
              onChange={(v) => setTeamFilter({ ...teamFilter, minLeagueChampionships: v })}
            />
          </div>
        )}

        {entity === 'player' && (
          <div className="space-y-3">
            <FilterChips
              label="位置"
              options={positionOptions}
              selected={playerFilter.position ?? []}
              onChange={(vals) => setPlayerFilter({ ...playerFilter, position: vals.length ? (vals as ('GK' | 'DF' | 'MF' | 'FW')[]) : undefined })}
            />
            <NumberRange
              label="能力"
              min={playerFilter.minRating}
              max={playerFilter.maxRating}
              onChange={(min, max) => setPlayerFilter({ ...playerFilter, minRating: min, maxRating: max })}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <NumberInput label="进球 ≥" value={playerFilter.minGoals} onChange={(v) => setPlayerFilter({ ...playerFilter, minGoals: v })} />
              <NumberInput label="助攻 ≥" value={playerFilter.minAssists} onChange={(v) => setPlayerFilter({ ...playerFilter, minAssists: v })} />
              <NumberInput label="市值 (M) ≥" value={playerFilter.minMarketValue} onChange={(v) => setPlayerFilter({ ...playerFilter, minMarketValue: v })} />
              <NumberInput label="年龄 ≤" value={playerFilter.maxAge} onChange={(v) => setPlayerFilter({ ...playerFilter, maxAge: v })} />
            </div>
          </div>
        )}

        {entity === 'coach' && (
          <div className="space-y-3">
            <NumberInput label="冠军数 ≥" value={coachFilter.minTrophies} onChange={(v) => setCoachFilter({ ...coachFilter, minTrophies: v })} />
            <NumberInput label="执教球队数 ≥" value={coachFilter.minTeamsManaged} onChange={(v) => setCoachFilter({ ...coachFilter, minTeamsManaged: v })} />
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 overflow-hidden">
        <div className="overflow-x-auto">
          {entity === 'team' && <TeamResults rows={results as TeamSearchResult[]} world={world} />}
          {entity === 'player' && <PlayerResults rows={results as PlayerSearchResult[]} world={world} />}
          {entity === 'coach' && <CoachResults rows={results as CoachSearchResult[]} />}
        </div>
      </div>
    </div>
  );
}

function FilterChips<V extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  selected: string[];
  onChange: (vals: V[]) => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const isSel = selected.includes(o.value);
          return (
            <button
              key={o.value}
              onClick={() => {
                const next = isSel ? selected.filter((v) => v !== o.value) : [...selected, o.value];
                onChange(next as V[]);
              }}
              className={`text-[11px] px-2 py-1 rounded transition-colors cursor-pointer ${
                isSel ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberRange({
  label,
  min,
  max,
  onChange,
}: {
  label: string;
  min?: number;
  max?: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={min ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined, max)}
          placeholder="最小"
          className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500"
        />
        <span className="text-slate-500">—</span>
        <input
          type="number"
          value={max ?? ''}
          onChange={(e) => onChange(min, e.target.value ? Number(e.target.value) : undefined)}
          placeholder="最大"
          className="w-20 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

function TeamResults({ rows, world }: { rows: TeamSearchResult[]; world: NonNullable<ReturnType<typeof useGameStore.getState>['world']> }) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-400 border-b border-slate-700">
          <th className="px-3 py-2 text-left">球队</th>
          <th className="px-3 py-2 text-left">大洲</th>
          <th className="px-3 py-2 text-center">联赛</th>
          <th className="px-3 py-2 text-center">OVR</th>
          <th className="px-3 py-2 text-center">联赛冠军</th>
          <th className="px-3 py-2 text-center">杯赛冠军</th>
          <th className="px-3 py-2 text-center">当前排名</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.teamId} className="border-t border-slate-700/40 hover:bg-slate-700/20">
            <td className="px-3 py-2">
              <Link to={`/team/${r.teamId}`} className="flex items-center gap-1.5 text-slate-200 hover:text-blue-300">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: world.teamBases[r.teamId]?.color ?? '#666' }} />
                {r.name}
              </Link>
            </td>
            <td className="px-3 py-2 text-slate-400 text-xs">{r.region.split('+')[0]}</td>
            <td className="px-3 py-2 text-center text-slate-400 text-xs">L{r.leagueLevel}</td>
            <td className="px-3 py-2 text-center font-bold text-slate-100">{r.overall}</td>
            <td className="px-3 py-2 text-center text-amber-400">{r.championships}</td>
            <td className="px-3 py-2 text-center text-emerald-400">{r.cupTrophies}</td>
            <td className="px-3 py-2 text-center text-slate-400">{r.currentRank < 99 ? `#${r.currentRank}` : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlayerResults({ rows, world }: { rows: PlayerSearchResult[]; world: NonNullable<ReturnType<typeof useGameStore.getState>['world']> }) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-400 border-b border-slate-700">
          <th className="px-3 py-2 text-left">球员</th>
          <th className="px-3 py-2 text-left">球队</th>
          <th className="px-3 py-2 text-center">位置</th>
          <th className="px-3 py-2 text-center">能力</th>
          <th className="px-3 py-2 text-center">年龄</th>
          <th className="px-3 py-2 text-center">进球</th>
          <th className="px-3 py-2 text-center">助攻</th>
          <th className="px-3 py-2 text-center">市值</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 100).map((r) => (
          <tr key={r.playerId} className="border-t border-slate-700/40 hover:bg-slate-700/20">
            <td className="px-3 py-2">
              <Link to={`/player/${r.playerId}`} className="text-slate-200 hover:text-blue-300">
                {r.playerName}
              </Link>
            </td>
            <td className="px-3 py-2">
              <Link to={`/team/${r.teamId}`} className="flex items-center gap-1.5 text-slate-400 text-xs hover:text-blue-300">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: world.teamBases[r.teamId]?.color ?? '#666' }} />
                {r.teamName}
              </Link>
            </td>
            <td className="px-3 py-2 text-center text-slate-400 text-xs">{r.position}</td>
            <td className="px-3 py-2 text-center font-bold text-slate-100">{r.rating}</td>
            <td className="px-3 py-2 text-center text-slate-400">{r.age}</td>
            <td className="px-3 py-2 text-center text-amber-400">{r.goals}</td>
            <td className="px-3 py-2 text-center text-blue-400">{r.assists}</td>
            <td className="px-3 py-2 text-center text-emerald-400 text-xs">€{r.marketValue >= 10 ? Math.round(r.marketValue) : r.marketValue.toFixed(1)}M</td>
          </tr>
        ))}
        {rows.length > 100 && (
          <tr><td colSpan={8} className="px-3 py-2 text-center text-[10px] text-slate-600">...仅显示前 100 条 (共 {rows.length} 条)</td></tr>
        )}
      </tbody>
    </table>
  );
}

function CoachResults({ rows }: { rows: CoachSearchResult[] }) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-slate-400 border-b border-slate-700">
          <th className="px-3 py-2 text-left">教练</th>
          <th className="px-3 py-2 text-center">风格</th>
          <th className="px-3 py-2 text-center">能力</th>
          <th className="px-3 py-2 text-center">冠军</th>
          <th className="px-3 py-2 text-center">执教过</th>
          <th className="px-3 py-2 text-left">现任</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.coachId} className="border-t border-slate-700/40 hover:bg-slate-700/20">
            <td className="px-3 py-2">
              <Link to={`/coach/${r.coachId}`} className="text-slate-200 hover:text-blue-300">
                {r.coachName}
              </Link>
            </td>
            <td className="px-3 py-2 text-center text-slate-400 text-xs">{r.style}</td>
            <td className="px-3 py-2 text-center font-bold text-slate-100">{r.rating}</td>
            <td className="px-3 py-2 text-center text-amber-400">{r.trophies}</td>
            <td className="px-3 py-2 text-center text-slate-400">{r.teamsManaged}支</td>
            <td className="px-3 py-2 text-slate-400 text-xs">
              {r.currentTeamId ? (
                <Link to={`/team/${r.currentTeamId}`} className="hover:text-blue-300">{r.currentTeamName}</Link>
              ) : <span className="text-slate-600">无业</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState() {
  return (
    <div className="p-8 text-center">
      <div className="text-3xl mb-2">🔍</div>
      <div className="text-sm text-slate-500">未找到符合条件的结果</div>
      <div className="text-xs text-slate-600 mt-1">尝试放宽筛选条件</div>
    </div>
  );
}
