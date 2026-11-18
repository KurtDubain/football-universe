import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { useUiSessionState } from '../app/ui-session-state';
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
import { formatMarketValue } from '../engine/economy/market-value';
import { SegmentedControl } from '../components/ui';

/** Remove one value from an optional multi-select filter, collapsing empties to undefined. */
function dropValue<T>(list: T[] | undefined, value: T): T[] | undefined {
  const next = (list ?? []).filter((entry) => entry !== value);
  return next.length > 0 ? next : undefined;
}

interface ConditionChip {
  key: string;
  label: string;
  clear: () => void;
}

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
  // 三组 filter 都留在会话里：点进一条结果再返回时，读者不该重填一遍条件。
  // 切换实体不清空——被保留的条件会在「当前条件」里显式列出并可单独移除。
  const [entity, setEntity] = useUiSessionState<SearchEntity>('ui.search.entity', 'team');
  const [teamFilter, setTeamFilter] = useUiSessionState<TeamFilters>('ui.search.teamFilter', {});
  const [playerFilter, setPlayerFilter] = useUiSessionState<PlayerFilters>('ui.search.playerFilter', {});
  const [coachFilter, setCoachFilter] = useUiSessionState<CoachFilters>('ui.search.coachFilter', {});

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

  const tierLabelOf = new Map(tierOptions.map((option) => [option.value, option.label]));
  const positionLabelOf = new Map(positionOptions.map((option) => [option.value, option.label]));
  const leagueLabelOf: Record<string, string> = { '1': '顶级', '2': '甲级', '3': '乙级' };

  const teamChips = (filter: TeamFilters): ConditionChip[] => {
    const chips: ConditionChip[] = [];
    for (const value of filter.tier ?? []) {
      chips.push({ key: `tier:${value}`, label: `等级 · ${tierLabelOf.get(value) ?? value}`, clear: () => setTeamFilter({ ...filter, tier: dropValue(filter.tier, value) }) });
    }
    for (const value of filter.continent ?? []) {
      chips.push({ key: `continent:${value}`, label: `大洲 · ${value}`, clear: () => setTeamFilter({ ...filter, continent: dropValue(filter.continent, value) }) });
    }
    for (const value of filter.leagueLevel ?? []) {
      chips.push({ key: `league:${value}`, label: `联赛 · ${leagueLabelOf[String(value)] ?? value}`, clear: () => setTeamFilter({ ...filter, leagueLevel: dropValue(filter.leagueLevel, value) }) });
    }
    if (filter.minOverall !== undefined) chips.push({ key: 'minOverall', label: `实力 ≥ ${filter.minOverall}`, clear: () => setTeamFilter({ ...filter, minOverall: undefined }) });
    if (filter.maxOverall !== undefined) chips.push({ key: 'maxOverall', label: `实力 ≤ ${filter.maxOverall}`, clear: () => setTeamFilter({ ...filter, maxOverall: undefined }) });
    if (filter.minLeagueChampionships !== undefined) chips.push({ key: 'minChamp', label: `联赛冠军 ≥ ${filter.minLeagueChampionships}`, clear: () => setTeamFilter({ ...filter, minLeagueChampionships: undefined }) });
    return chips;
  };

  const playerChips = (filter: PlayerFilters): ConditionChip[] => {
    const chips: ConditionChip[] = [];
    for (const value of filter.position ?? []) {
      chips.push({ key: `position:${value}`, label: `位置 · ${positionLabelOf.get(value) ?? value}`, clear: () => setPlayerFilter({ ...filter, position: dropValue(filter.position, value) }) });
    }
    if (filter.minRating !== undefined) chips.push({ key: 'minRating', label: `能力 ≥ ${filter.minRating}`, clear: () => setPlayerFilter({ ...filter, minRating: undefined }) });
    if (filter.maxRating !== undefined) chips.push({ key: 'maxRating', label: `能力 ≤ ${filter.maxRating}`, clear: () => setPlayerFilter({ ...filter, maxRating: undefined }) });
    if (filter.minGoals !== undefined) chips.push({ key: 'minGoals', label: `进球 ≥ ${filter.minGoals}`, clear: () => setPlayerFilter({ ...filter, minGoals: undefined }) });
    if (filter.minAssists !== undefined) chips.push({ key: 'minAssists', label: `助攻 ≥ ${filter.minAssists}`, clear: () => setPlayerFilter({ ...filter, minAssists: undefined }) });
    if (filter.minMarketValue !== undefined) chips.push({ key: 'minMarketValue', label: `市值 ≥ €${filter.minMarketValue}M`, clear: () => setPlayerFilter({ ...filter, minMarketValue: undefined }) });
    if (filter.maxAge !== undefined) chips.push({ key: 'maxAge', label: `年龄 ≤ ${filter.maxAge}`, clear: () => setPlayerFilter({ ...filter, maxAge: undefined }) });
    return chips;
  };

  const coachChips = (filter: CoachFilters): ConditionChip[] => {
    const chips: ConditionChip[] = [];
    if (filter.minTrophies !== undefined) chips.push({ key: 'minTrophies', label: `冠军 ≥ ${filter.minTrophies}`, clear: () => setCoachFilter({ ...filter, minTrophies: undefined }) });
    if (filter.minTeamsManaged !== undefined) chips.push({ key: 'minTeamsManaged', label: `执教球队 ≥ ${filter.minTeamsManaged}`, clear: () => setCoachFilter({ ...filter, minTeamsManaged: undefined }) });
    return chips;
  };

  const activeChips = entity === 'team'
    ? teamChips(teamFilter)
    : entity === 'player'
      ? playerChips(playerFilter)
      : coachChips(coachFilter);
  // 切换对象不清空条件——被保留的那几组在这里显式列出，读者不会以为它们消失了。
  const retainedChips = [
    ...(entity === 'team' ? [] : teamChips(teamFilter).map((chip) => ({ ...chip, key: `team-${chip.key}`, label: `球队 · ${chip.label}` }))),
    ...(entity === 'player' ? [] : playerChips(playerFilter).map((chip) => ({ ...chip, key: `player-${chip.key}`, label: `球员 · ${chip.label}` }))),
    ...(entity === 'coach' ? [] : coachChips(coachFilter).map((chip) => ({ ...chip, key: `coach-${chip.key}`, label: `教练 · ${chip.label}` }))),
  ];

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
      <SegmentedControl
        value={entity}
        onChange={setEntity}
        ariaLabel="搜索对象"
        options={[
          { value: 'team', label: '球队' },
          { value: 'player', label: '球员' },
          { value: 'coach', label: '教练' },
        ]}
      />

      {/* Preset queries */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3">
        <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">快速查询</h3>
        <div className="flex flex-wrap gap-2">
          {presetQueries.map((q) => (
            <button
              key={q.label}
              onClick={q.apply}
              className="inline-flex min-h-11 items-center rounded-lg bg-slate-700 px-3 text-xs text-slate-200 transition-colors hover:bg-blue-700 cursor-pointer"
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
            className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-slate-400 transition-colors hover:text-red-400 cursor-pointer"
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

      {/* 当前条件：此前唯一的反馈是右上角的结果条数，读者无法确认筛选是否生效；
          切换搜索对象后上一个对象的条件还会被静默保留。这里逐条列出并可单独移除。 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">当前条件</h3>
          <span className="text-xs tabular-nums text-slate-500">{results.length} 条结果</span>
        </div>
        {activeChips.length === 0 && retainedChips.length === 0 ? (
          <p className="text-xs text-slate-500">未设置任何筛选条件</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.clear}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-blue-600/20 px-3 text-xs text-blue-200 transition-colors hover:bg-blue-600/30 cursor-pointer"
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">移除该条件</span>
                </button>
              ))}
              {retainedChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.clear}
                  title="属于其他搜索对象，切换过去后仍会生效"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs text-slate-400 transition-colors hover:text-slate-200 cursor-pointer"
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">移除该条件</span>
                </button>
              ))}
            </div>
            {retainedChips.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">描边条件属于其他搜索对象，切换过去后仍会生效。</p>
            )}
          </>
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
              className={`inline-flex min-h-11 items-center rounded px-3 text-xs transition-colors cursor-pointer ${
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
          className="w-20 min-h-11 px-3 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 focus:border-[var(--focus-ring)]"
        />
        <span className="text-slate-500">—</span>
        <input
          type="number"
          value={max ?? ''}
          onChange={(e) => onChange(min, e.target.value ? Number(e.target.value) : undefined)}
          placeholder="最大"
          className="w-20 min-h-11 px-3 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 focus:border-[var(--focus-ring)]"
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
        className="w-full min-h-11 px-3 bg-slate-700 border border-slate-600 rounded text-xs text-slate-200 focus:border-[var(--focus-ring)]"
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
          <th className="px-3 py-2 text-right">联赛</th>
          <th className="px-3 py-2 text-right">OVR</th>
          <th className="px-3 py-2 text-right">联赛冠军</th>
          <th className="px-3 py-2 text-right">杯赛冠军</th>
          <th className="px-3 py-2 text-right">当前排名</th>
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
            <td className="px-3 py-2 text-right text-slate-400 text-xs">L{r.leagueLevel}</td>
            <td className="px-3 py-2 text-right font-bold text-slate-100">{r.overall}</td>
            <td className="px-3 py-2 text-right text-amber-400">{r.championships}</td>
            <td className="px-3 py-2 text-right text-emerald-400">{r.cupTrophies}</td>
            <td className="px-3 py-2 text-right text-slate-400">{r.currentRank < 99 ? `#${r.currentRank}` : '-'}</td>
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
          <th className="px-3 py-2 text-right">能力</th>
          <th className="px-3 py-2 text-right">年龄</th>
          <th className="px-3 py-2 text-right" title="当前赛季全赛事">赛季进球</th>
          <th className="px-3 py-2 text-right" title="当前赛季全赛事">赛季助攻</th>
          <th className="px-3 py-2 text-right">市值</th>
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
            <td className="px-3 py-2 text-right font-bold text-slate-100">{r.rating}</td>
            <td className="px-3 py-2 text-right text-slate-400">{r.age}</td>
            <td className="px-3 py-2 text-right text-amber-400">{r.goals}</td>
            <td className="px-3 py-2 text-right text-blue-400">{r.assists}</td>
            <td className="px-3 py-2 text-right text-emerald-400 text-xs">{formatMarketValue(r.marketValue)}</td>
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
          <th className="px-3 py-2 text-right">能力</th>
          <th className="px-3 py-2 text-right">冠军</th>
          <th className="px-3 py-2 text-right">执教过</th>
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
            <td className="px-3 py-2 text-right font-bold text-slate-100">{r.rating}</td>
            <td className="px-3 py-2 text-right text-amber-400">{r.trophies}</td>
            <td className="px-3 py-2 text-right text-slate-400">{r.teamsManaged}支</td>
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
