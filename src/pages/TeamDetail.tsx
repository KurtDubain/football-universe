import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import {
  getCoachName,
  getLeagueName,
  formatForm,
} from '../utils/format';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { formatMoney } from '../engine/economy/finance';
import { computePlayerBoostReport } from '../engine/players/player-boosts';
import { getPlayerClubStatRowMap } from '../engine/players/player-stat-selectors';
import { buildTeamStory, type TeamStoryMomentKind, type TeamStoryTone } from '../engine/season/team-story';
import type { Player, PlayerPosition } from '../types/player';
import TeamBadge from '../components/TeamBadge';
import { Icon, type IconName } from '../components/Icon';
import { PageShell, Panel, SegmentedControl } from '../components/ui';

type TeamSection = 'overview' | 'squad' | 'history';

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const world = useGameStore((s) => s.world);
  const [section, setSection] = useState<TeamSection>('overview');

  if (!world || !id) {
    return <div className="text-slate-400">正在加载...</div>;
  }

  const base = world.teamBases[id];
  const state = world.teamStates[id];

  if (!base || !state) {
    return <div className="text-slate-400">未找到球队: {id}</div>;
  }

  const trophies = world.teamTrophies[id] ?? [];
  const records = world.teamSeasonRecords[id] ?? [];
  // Coach is derived from coachStates (single source of truth post-v7).
  const coachId = getTeamCoachId(world.coachStates, id);

  return (
    <PageShell width="standard" className="tabular-nums">
      {/* Header */}
      <Panel className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <TeamBadge shortName={base.shortName} color={base.color} size={48} />
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold text-slate-100 sm:text-2xl">{base.name}</h1>
            <div className="flex items-center gap-2 sm:gap-3 mt-0.5 flex-wrap">
              <span className="text-xs text-slate-400">{getLeagueName(state.leagueLevel)}</span>
              <span className="text-xs text-slate-500">OVR {base.overall}</span>
              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300" aria-label={`期望等级 ${base.expectation}`}>
                {'★'.repeat(base.expectation)}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <SegmentedControl
        value={section}
        onChange={setSection}
        ariaLabel="球队详情分区"
        stretch
        options={[
          { value: 'overview', label: '概览' },
          { value: 'squad', label: '阵容' },
          { value: 'history', label: '历史' },
        ]}
      />

      {section === 'overview' && (
        <>
          <TeamStoryPanel teamId={id} />

          <Panel padded={false}>
            <div className="grid grid-cols-1 divide-y divide-slate-700/60 md:grid-cols-2 md:divide-x md:divide-y-0">
              {/* Base Attributes */}
              <section className="p-4" aria-labelledby="team-ability-heading">
                <h2 id="team-ability-heading" className="mb-3 text-sm font-semibold text-slate-200">球队实力</h2>
                <div className="space-y-2">
                  <AttrBar label="综合" value={base.overall} />
                  <AttrBar label="进攻" value={base.attack} color="bg-red-500" />
                  <AttrBar label="中场" value={base.midfield} color="bg-amber-500" />
                  <AttrBar label="防守" value={base.defense} color="bg-blue-500" />
                  <AttrBar label="稳定" value={base.stability} color="bg-green-500" />
                  <AttrBar label="深度" value={base.depth} color="bg-purple-500" />
                  <AttrBar label="声望" value={base.reputation} color="bg-sky-500" />
                </div>
              </section>

              {/* Current State */}
              <section className="p-4" aria-labelledby="team-state-heading">
                <h2 id="team-state-heading" className="mb-3 text-sm font-semibold text-slate-200">当前状态</h2>
                <div className="space-y-2">
                  <StateBar label="士气" value={state.morale} max={100} color="bg-green-500" />
                  <StateBar label="疲劳" value={state.fatigue} max={100} color="bg-red-500" inverted />
                  <StateBar label="动力" value={state.momentum + 10} max={20} color="bg-amber-500" />
                  <StateBar label="球员健康" value={state.squadHealth} max={100} color="bg-blue-500" />
                  <StateBar label="教练压力" value={state.coachPressure} max={100} color="bg-orange-500" inverted />
                </div>

                <div className="mt-4">
                  <span className="text-xs text-slate-400">近期战绩</span>
                  <div className="flex gap-1 mt-1">
                    {state.recentForm.length === 0 ? (
                      <span className="text-xs text-slate-500">暂无</span>
                    ) : formatForm(state.recentForm).map((f, i) => (
                      <span key={i} className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white ${f.color}`}>
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </Panel>

          {/* Coach */}
          <Panel>
            <h2 className="mb-2 text-sm font-semibold text-slate-200">现任教练</h2>
            {coachId ? (
              <div className="flex items-center gap-3">
                <Link to={`/coach/${coachId}`} className="text-blue-400 hover:text-blue-300">
                  {getCoachName(coachId, world.coachBases)}
                </Link>
                {world.coachBases[coachId] && <span className="text-xs text-slate-400">评分: {world.coachBases[coachId].rating}</span>}
                <FireCoachButton teamId={id!} />
              </div>
            ) : <span className="text-sm text-slate-500">暂无教练</span>}
          </Panel>

          <FinancePanel teamId={id} />
        </>
      )}

      {section === 'history' && (
        <>

      {/* Coach history for this team */}
      {(() => {
        const changes = world.honorHistory.flatMap(h =>
          h.coachChanges.filter(c => c.teamId === id).map(c => ({ ...c, season: h.seasonNumber }))
        );
        if (changes.length === 0) return null;
        return (
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">教练变更记录</h3>
            <div className="space-y-1.5">
              {changes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 w-8 shrink-0">S{c.season}</span>
                  <Link to={`/coach/${c.oldCoachId}`} className="text-red-400 hover:text-red-300">
                    {getCoachName(c.oldCoachId, world.coachBases)}
                  </Link>
                  <span className="text-slate-600">→</span>
                  <Link to={`/coach/${c.newCoachId}`} className="text-green-400 hover:text-green-300">
                    {getCoachName(c.newCoachId, world.coachBases)}
                  </Link>
                  <span className="text-slate-600 text-[10px]">{c.reason}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Trophies */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">
          奖杯柜 ({trophies.length})
        </h3>
        {trophies.length === 0 ? (
          <p className="text-sm text-slate-500">暂无奖杯</p>
        ) : (() => {
          const grouped: Record<string, number[]> = {};
          for (const t of trophies) {
            if (!grouped[t.type]) grouped[t.type] = [];
            grouped[t.type].push(t.seasonNumber);
          }
          const typeOrder = ['league1', 'league2', 'league3', 'league_cup', 'super_cup', 'world_cup', 'mainland_cup', 'southern_cup', 'eastern_cup'];
          const typeLabels: Record<string, string> = { league1: '顶级联赛', league2: '甲级联赛', league3: '乙级联赛', league_cup: '联赛杯', super_cup: '超级杯', world_cup: '环球冠军杯', mainland_cup: '大陆杯', southern_cup: '南洲杯', eastern_cup: '东洲杯' };
          const typeColors: Record<string, string> = { league1: 'text-amber-400', league2: 'text-blue-400', league3: 'text-emerald-400', league_cup: 'text-amber-300', super_cup: 'text-purple-400', world_cup: 'text-sky-400', mainland_cup: 'text-orange-300', southern_cup: 'text-cyan-300', eastern_cup: 'text-pink-300' };
          const sortedTypes = Object.keys(grouped).sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b));

          return (
            <div className="space-y-2">
              {sortedTypes.map(type => {
                const seasons = grouped[type].sort((a, b) => a - b);
                return (
                  <div key={type} className="flex items-center gap-3 bg-slate-700/20 rounded-lg px-3 py-2">
                    <div className="w-20 shrink-0">
                      <div className={`text-xs font-semibold ${typeColors[type] ?? 'text-slate-300'}`}>{typeLabels[type] ?? type}</div>
                      <div className="text-lg font-black text-slate-100">{seasons.length}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 flex-1">
                      {seasons.map(s => (
                        <span key={s} className="text-[10px] bg-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded">S{s}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Season records */}
      {records.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-200">
              历史赛季记录
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-700">
                  <th className="px-2 py-1.5 text-left">赛季</th>
                  <th className="px-2 py-1.5 text-center">级别</th>
                  <th className="px-2 py-1.5 text-center">名次</th>
                  <th className="hidden sm:table-cell px-2 py-1.5 text-center">赛</th>
                  <th className="hidden sm:table-cell px-2 py-1.5 text-center">胜</th>
                  <th className="hidden sm:table-cell px-2 py-1.5 text-center">平</th>
                  <th className="hidden sm:table-cell px-2 py-1.5 text-center">负</th>
                  <th className="hidden md:table-cell px-2 py-1.5 text-center">进</th>
                  <th className="hidden md:table-cell px-2 py-1.5 text-center">失</th>
                  <th className="px-2 py-1.5 text-center">积分</th>
                  <th className="hidden sm:table-cell px-2 py-1.5 text-center">联杯</th>
                  <th className="hidden sm:table-cell px-2 py-1.5 text-center">超杯</th>
                  <th className="hidden md:table-cell px-2 py-1.5 text-center">洲际杯</th>
                  <th className="hidden md:table-cell px-2 py-1.5 text-center">冠军杯</th>
                  <th className="px-2 py-1.5 text-left">教练</th>
                  <th className="px-2 py-1.5 text-center">备注</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => {
                  const isChamp = rec.leaguePosition === 1;
                  const honor = world.honorHistory.find(h => h.seasonNumber === rec.seasonNumber);
                  const cupWins: string[] = [];
                  if (honor?.leagueCupWinner === id) cupWins.push('联杯');
                  if (honor?.superCupWinner === id) cupWins.push('超杯');
                  if (honor?.worldCupWinner === id) cupWins.push('冠军杯');
                  // Determine the team's region — drives which color the
                  // continental cup chip uses for "champion" rendering. We
                  // only use the region prefix; we don't care about the city.
                  const teamRegion = base.region?.split('+')[0];
                  const ccChampColor = teamRegion === '大陆' ? 'orange'
                    : teamRegion === '南洲' ? 'cyan'
                    : teamRegion === '东洲' ? 'pink'
                    : 'orange';
                  if (rec.continentalCupResult === '冠军') {
                    cupWins.push(teamRegion === '大陆' ? '大陆杯'
                      : teamRegion === '南洲' ? '南洲杯'
                      : teamRegion === '东洲' ? '东洲杯'
                      : '洲际杯');
                  }

                  return (
                    <tr key={rec.seasonNumber} className={`border-t border-slate-700/50 ${isChamp ? 'bg-amber-900/10' : ''}`}>
                      <td className="px-2 py-1.5 text-slate-300">S{rec.seasonNumber}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`text-[10px] px-1 py-0.5 rounded ${rec.leagueLevel === 1 ? 'bg-amber-900/40 text-amber-400' : rec.leagueLevel === 2 ? 'bg-blue-900/40 text-blue-400' : 'bg-emerald-900/40 text-emerald-400'}`}>
                          {rec.leagueLevel === 1 ? '顶' : rec.leagueLevel === 2 ? '甲' : '乙'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`font-semibold ${isChamp ? 'text-amber-400' : rec.leaguePosition <= 3 ? 'text-slate-200' : 'text-slate-400'}`}>
                          {rec.leaguePosition}
                        </span>
                      </td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-center text-slate-400">{rec.leaguePlayed}</td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-center text-slate-300">{rec.leagueWon}</td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-center text-slate-300">{rec.leagueDrawn}</td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-center text-slate-300">{rec.leagueLost}</td>
                      <td className="hidden md:table-cell px-2 py-1.5 text-center text-slate-300">{rec.leagueGF}</td>
                      <td className="hidden md:table-cell px-2 py-1.5 text-center text-slate-300">{rec.leagueGA}</td>
                      <td className="px-2 py-1.5 text-center text-slate-100 font-bold">{rec.leaguePoints}</td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-center">
                        {rec.cupResult && (
                          <span className={`text-[9px] px-1 rounded ${cupResultStyle(rec.cupResult, 'amber')}`}>
                            {rec.cupResult}
                          </span>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-center">
                        {rec.superCupResult && (
                          <span className={`text-[9px] px-1 rounded ${cupResultStyle(rec.superCupResult, 'purple')}`}>
                            {rec.superCupResult}
                          </span>
                        )}
                      </td>
                      <td className="hidden md:table-cell px-2 py-1.5 text-center">
                        {rec.continentalCupResult ? (
                          <span className={`text-[9px] px-1 rounded ${cupResultStyle(rec.continentalCupResult, ccChampColor)}`}>
                            {rec.continentalCupResult}
                          </span>
                        ) : <span className="text-slate-700">—</span>}
                      </td>
                      <td className="hidden md:table-cell px-2 py-1.5 text-center">
                        {rec.worldCupResult && (
                          <span className={`text-[9px] px-1 rounded ${cupResultStyle(rec.worldCupResult, 'sky')}`}>
                            {rec.worldCupResult}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {rec.coachId ? (
                          <Link to={`/coach/${rec.coachId}`} className="text-xs text-slate-400 hover:text-blue-400 truncate block max-w-[80px]">
                            {getCoachName(rec.coachId, world.coachBases)}
                          </Link>
                        ) : <span className="text-xs text-slate-600">-</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex flex-wrap gap-0.5 justify-center">
                          {isChamp && <span className="text-[9px] bg-amber-900/50 text-amber-300 px-1 rounded">冠军</span>}
                          {rec.promoted && <span className="text-[9px] bg-green-900/50 text-green-400 px-1 rounded">升级</span>}
                          {rec.relegated && <span className="text-[9px] bg-red-900/50 text-red-400 px-1 rounded">降级</span>}
                          {cupWins.map(c => <span key={c} className="text-[9px] bg-purple-900/50 text-purple-300 px-1 rounded">{c}</span>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ 球队水平走势 ═══ */}
      {records.length >= 1 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">球队水平走势</h3>
          <TeamTrendChart records={records} color={base.color} />
        </div>
      )}

        </>
      )}

      {section === 'squad' && (
        <>
          {/* ═══ 伤员 / 停赛 ═══ */}
          <InjuryBoard teamId={id} />

          {/* ═══ 球员加成 (v3.8.1) ═══ */}
          <PlayerBoostsCard teamId={id} />

          {/* ═══ 阵容名单 ═══ */}
          <SquadRoster teamId={id} />
        </>
      )}
    </PageShell>
  );
}

const storyToneClasses: Record<TeamStoryTone, { title: string; border: string; badge: string }> = {
  amber: { title: 'text-amber-300', border: 'border-amber-500', badge: 'bg-amber-900/35 text-amber-300' },
  emerald: { title: 'text-emerald-300', border: 'border-emerald-500', badge: 'bg-emerald-900/35 text-emerald-300' },
  red: { title: 'text-red-300', border: 'border-red-500', badge: 'bg-red-900/35 text-red-300' },
  blue: { title: 'text-blue-300', border: 'border-blue-500', badge: 'bg-blue-900/35 text-blue-300' },
  slate: { title: 'text-slate-200', border: 'border-slate-500', badge: 'bg-slate-700 text-slate-300' },
};

const storyMomentMeta: Record<TeamStoryMomentKind, { icon: IconName; color: string }> = {
  trophy: { icon: 'trophy', color: 'text-amber-400' },
  transition: { icon: 'arrow-up', color: 'text-emerald-400' },
  match: { icon: 'ball', color: 'text-blue-400' },
  coach: { icon: 'tie', color: 'text-purple-400' },
  transfer: { icon: 'handshake', color: 'text-cyan-400' },
};

function TeamStoryPanel({ teamId }: { teamId: string }) {
  const world = useGameStore((s) => s.world);
  const story = useMemo(() => world ? buildTeamStory(world, teamId) : null, [world, teamId]);
  if (!world) return null;
  if (!story || (story.moments.length === 0 && !story.rivalry)) {
    return (
      <Panel className="flex items-center gap-3 py-3" data-testid="compact-team-story">
        <Icon name="building" size={16} className="shrink-0 text-slate-500" />
        <div className="min-w-0 text-xs text-slate-500">
          <span className="mr-2 font-semibold text-slate-300">球队故事</span>
          {story?.chapter.summary ?? '赛季推进后，这里会记录球队转折与焦点对手。'}
        </div>
      </Panel>
    );
  }

  const tone = storyToneClasses[story.chapter.tone];
  return (
    <section className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden" aria-labelledby="team-story-heading">
      <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between gap-3">
        <h3 id="team-story-heading" className="text-sm font-semibold text-slate-200 inline-flex items-center gap-2">
          <Icon name="building" size={15} /> 球队故事
        </h3>
        <span className="text-xs text-slate-500">依据真实历程即时生成</span>
      </div>

      <div className={`px-4 py-3 border-l-4 ${tone.border}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-0.5 text-[11px] text-slate-500">当前篇章</div>
            <div className={`text-base font-bold ${tone.title}`}>{story.chapter.title}</div>
            <p className="text-xs text-slate-400 leading-relaxed mt-1 max-w-3xl">{story.chapter.summary}</p>
          </div>
          <Icon name="sparkle" size={22} className={`${tone.title} shrink-0 mt-1`} />
        </div>
        {story.chapter.signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {story.chapter.signals.map(signal => (
              <span key={signal} className={`rounded px-2 py-1 text-[11px] ${tone.badge}`}>{signal}</span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.75fr)] border-t border-slate-700/40">
        <div className="px-4 py-3 md:border-r border-slate-700/40">
          <div className="text-[11px] font-semibold text-slate-400 mb-2">近期转折</div>
          {story.moments.length === 0 ? (
            <p className="text-xs text-slate-600">故事仍在书写，完成赛季后会留下更多转折。</p>
          ) : (
            <div className="space-y-2.5">
              {story.moments.map(moment => {
                const meta = storyMomentMeta[moment.kind];
                const content = (
                  <>
                    <span className={`w-6 h-6 shrink-0 flex items-center justify-center ${meta.color}`}>
                      <Icon name={meta.icon} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs font-medium text-slate-200">{moment.title}</span>
                        <span className="text-[11px] text-slate-600">S{moment.season}</span>
                      </span>
                      <span className="block text-[11px] text-slate-500 leading-relaxed mt-0.5">{moment.detail}</span>
                    </span>
                  </>
                );
                return moment.linkTo ? (
                  <Link key={moment.id} to={moment.linkTo} className="flex items-start gap-2 hover:bg-slate-700/20 -mx-1 px-1 py-0.5 rounded transition-colors">
                    {content}
                  </Link>
                ) : (
                  <div key={moment.id} className="flex items-start gap-2">{content}</div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t md:border-t-0 border-slate-700/40">
          <div className="text-[11px] font-semibold text-slate-400 mb-2">近期焦点对手</div>
          {story.rivalry ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <Link to={`/team/${story.rivalry.opponentId}`} className="text-sm font-semibold text-blue-300 hover:text-blue-200 truncate">
                  {story.rivalry.opponentName}
                </Link>
                <span className="shrink-0 rounded bg-red-900/30 px-1.5 py-0.5 text-[11px] text-red-300">{story.rivalry.label}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 mt-3 text-center">
                <StoryStat value={story.rivalry.meetings} label="交锋" />
                <StoryStat value={story.rivalry.wins} label="胜" valueClass="text-emerald-300" />
                <StoryStat value={story.rivalry.draws} label="平" />
                <StoryStat value={story.rivalry.losses} label="负" valueClass="text-red-300" />
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                总比分 {story.rivalry.goalsFor}-{story.rivalry.goalsAgainst} · 最近一次 {story.rivalry.latest}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-600">至少完成两次交锋后，才会形成焦点对手。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function StoryStat({ value, label, valueClass = 'text-slate-200' }: { value: number; label: string; valueClass?: string }) {
  return (
    <div>
      <div className={`text-base font-bold tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-slate-600">{label}</div>
    </div>
  );
}

/** Phase 1B — display the team's player-derived attack/midfield/defense
 *  buffs alongside coach buffs. Helps the player see how injuries +
 *  star quality affect their team's effective strength. */
function PlayerBoostsCard({ teamId }: { teamId: string }) {
  const world = useGameStore((s) => s.world);
  if (!world) return null;
  const squad = world.squads[teamId] ?? [];
  if (squad.length === 0) return null;
  const report = computePlayerBoostReport(squad, world.totalElapsedWindows ?? 0);
  const boosts = report.current;
  const injured = squad.filter(p => (p.injuredUntilWindow ?? 0) > (world.totalElapsedWindows ?? 0)).length;
  const suspended = squad.filter(p => (p.suspendedUntilWindow ?? 0) > (world.totalElapsedWindows ?? 0)).length;
  const cls = (n: number) => n > 0 ? 'text-emerald-300' : n < 0 ? 'text-red-300' : 'text-slate-400';
  const sign = (n: number) => n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
  const loss = Object.values(report.absenceLoss).some(value => value > 0);
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Icon name="shield" size={14} /> 球员阵容加成
        </h3>
        <span className="text-xs text-slate-500">可用首发质量 · ±15 极限</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className={`text-2xl font-bold ${cls(boosts.attack)}`}>{sign(boosts.attack)}</div>
          <div className="text-xs text-slate-500">进攻</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${cls(boosts.midfield)}`}>{sign(boosts.midfield)}</div>
          <div className="text-xs text-slate-500">中场</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${cls(boosts.defense)}`}>{sign(boosts.defense)}</div>
          <div className="text-xs text-slate-500">防守</div>
        </div>
      </div>
      {(injured + suspended) > 0 && (
        <div className="mt-3 border-t border-slate-700/60 pt-2 text-center text-xs text-amber-300">
          <div className="flex items-center justify-center gap-1">
            <Icon name="warning" size={13} /> 当前 {injured > 0 ? `${injured}人伤停` : ''}{injured > 0 && suspended > 0 ? '、' : ''}{suspended > 0 ? `${suspended}人停赛` : ''}
          </div>
          {loss && (
            <p className="mt-1 text-xs text-slate-400">
              满员可达 攻{sign(report.fullStrength.attack)} / 中{sign(report.fullStrength.midfield)} / 防{sign(report.fullStrength.defense)}
              {' · '}当前损失 {report.absenceLoss.attack.toFixed(1)} / {report.absenceLoss.midfield.toFixed(1)} / {report.absenceLoss.defense.toFixed(1)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cup result chip styling ──────────────────────────────
//   冠军 → champion color (per-cup)
//   亚军 → silver
//   四强 → bronze (made the semi-finals)
//   八强 → faint bronze
//   16强 / 32强 → muted gray (made knockouts)
//   小组赛淘汰 → very muted (didn't make knockouts)
//   未参加  → dim, leading dash-like rendering
//   参赛中 → blue (still alive)
function cupResultStyle(label: string, championColor: 'amber' | 'purple' | 'sky' | 'orange' | 'cyan' | 'pink'): string {
  if (label === '冠军') {
    switch (championColor) {
      case 'amber':  return 'bg-amber-900/50 text-amber-300';
      case 'purple': return 'bg-purple-900/50 text-purple-300';
      case 'sky':    return 'bg-sky-900/50 text-sky-300';
      case 'orange': return 'bg-orange-900/50 text-orange-300';
      case 'cyan':   return 'bg-cyan-900/50 text-cyan-300';
      case 'pink':   return 'bg-pink-900/50 text-pink-300';
    }
  }
  if (label === '亚军') return 'bg-slate-600/40 text-slate-200';
  if (label === '四强') return 'bg-orange-900/40 text-orange-300';
  if (label === '八强') return 'bg-amber-950/50 text-amber-400/80';
  if (label === '16强' || label === '32强') return 'bg-slate-700/40 text-slate-400';
  if (label === '小组赛淘汰') return 'text-slate-500';
  if (label === '未参加') return 'text-slate-600';
  if (label === '参赛中') return 'bg-blue-900/40 text-blue-300';
  return 'text-slate-500';
}

// ── Attribute bar ──────────────────────────────────────────

function AttrBar({
  label,
  value,
  color = 'bg-blue-500',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-8 text-right">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-slate-300 w-7 text-right font-mono">
        {value}
      </span>
    </div>
  );
}

function StateBar({
  label,
  value,
  max,
  color = 'bg-blue-500',
  inverted = false,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  inverted?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const displayColor = inverted && pct > 60 ? 'bg-red-500' : color;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-16 text-right">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${displayColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-300 w-7 text-right font-mono">
        {value}
      </span>
    </div>
  );
}

// ── Squad Roster ─────────────────────────────────────────

const posLabel: Record<PlayerPosition, string> = {
  GK: '门将',
  DF: '后卫',
  MF: '中场',
  FW: '前锋',
};

const posBgColor: Record<PlayerPosition, string> = {
  GK: 'bg-amber-900/40 text-amber-300',
  DF: 'bg-blue-900/40 text-blue-300',
  MF: 'bg-green-900/40 text-green-300',
  FW: 'bg-red-900/40 text-red-300',
};

const posBarColor: Record<PlayerPosition, string> = {
  GK: 'bg-amber-500',
  DF: 'bg-blue-500',
  MF: 'bg-green-500',
  FW: 'bg-red-500',
};

const positionOrder: PlayerPosition[] = ['GK', 'DF', 'MF', 'FW'];

function SquadRoster({ teamId }: { teamId: string }) {
  const world = useGameStore((s) => s.world);

  const { grouped, starIds } = useMemo(() => {
    if (!world) return { grouped: {} as Record<PlayerPosition, Player[]>, starIds: new Set<string>() };

    const squad = world.squads[teamId] ?? [];

    // Group by position
    const g: Record<PlayerPosition, Player[]> = { GK: [], DF: [], MF: [], FW: [] };
    for (const p of squad) {
      g[p.position].push(p);
    }
    // Sort within groups by rating desc
    for (const pos of positionOrder) {
      g[pos].sort((a, b) => b.rating - a.rating);
    }

    // Top 3 rated in squad get star
    const sorted = [...squad].sort((a, b) => b.rating - a.rating);
    const stars = new Set(sorted.slice(0, 3).map((p) => p.uuid));

    return { grouped: g, starIds: stars };
  }, [world, teamId]);

  const statRows = useMemo(
    () => (world ? getPlayerClubStatRowMap(world, teamId) : new Map()),
    [world, teamId],
  );

  if (!world) return null;

  const squad = world.squads[teamId] ?? [];
  if (squad.length === 0) return null;

  const currentWindowIdx = world.totalElapsedWindows ?? 0;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-700">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">
            阵容名单 ({squad.length}人)
          </h3>
          <span className="text-[10px] text-slate-500">本赛季效力本队期间</span>
        </div>
      </div>

      <div className="divide-y divide-slate-700/40">
        {positionOrder.map((pos) => {
          const players = grouped[pos];
          if (!players || players.length === 0) return null;

          return (
            <div key={pos}>
              {/* Position group header */}
              <div className="px-4 py-1.5 bg-slate-750 border-b border-slate-700/30">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${posBgColor[pos]}`}>
                  {posLabel[pos]}
                </span>
              </div>

              {/* Player rows */}
              {players.map((player) => {
                const stats = statRows.get(player.uuid);
                const isStar = starIds.has(player.uuid);
                const injuredUntil = player.injuredUntilWindow ?? 0;
                const suspendedUntil = player.suspendedUntilWindow ?? 0;
                const isInjured = injuredUntil > currentWindowIdx;
                const isSuspended = suspendedUntil > currentWindowIdx;

                return (
                  <Link
                    key={player.uuid}
                    to={`/player/${player.uuid}`}
                    data-testid="squad-player-row"
                    className={`flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-slate-700/25 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)] sm:px-4 ${isInjured ? 'opacity-70' : ''}`}
                  >
                    {/* Number badge */}
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/80">
                      <span className="text-xs font-bold text-slate-200">
                        {player.number}
                      </span>
                      {isInjured && (
                        <span
                          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-slate-800"
                          title="伤病"
                        />
                      )}
                      {!isInjured && isSuspended && (
                        <span
                          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-yellow-500 border border-slate-800"
                          title="停赛"
                        />
                      )}
                    </span>

                    {/* Flexible identity and mobile stat line */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`min-w-0 break-words text-sm font-medium leading-5 ${isInjured ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                          {player.name ?? `${player.number}号`}
                        </span>
                        <span className={`shrink-0 rounded px-1 py-0.5 text-[11px] font-medium ${posBgColor[player.position]}`}>
                          {posLabel[player.position]}
                        </span>
                        {isStar && <span className="shrink-0 text-xs text-amber-400" title="球队核心">★</span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500 sm:hidden">
                        {stats && stats.appearances > 0 ? (
                          <>
                            <span>{stats.appearances}场/{stats.starts ?? 0}首发</span>
                            {(player.position === 'FW' || player.position === 'MF') && <span>{stats.goals}球/{stats.assists}助</span>}
                            {(player.position === 'GK' || player.position === 'DF') && <span>{stats.cleanSheets}零封</span>}
                            {player.position === 'GK' && <span>{stats.saves}神扑</span>}
                            {player.position === 'DF' && <span>{stats.keyBlocks}封堵</span>}
                          </>
                        ) : <span>本季尚未出场</span>}
                      </div>
                    </div>

                    {/* Rating */}
                    <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-24">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
                        <div className={`h-full rounded-full ${posBarColor[player.position]}`} style={{ width: `${player.rating}%` }} />
                      </div>
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-300">{player.rating}</span>
                    </div>

                    {/* Desktop season stats */}
                    <div className="hidden max-w-[26rem] shrink-0 flex-wrap items-center justify-end gap-2 text-xs sm:flex">
                      {player.marketValue !== undefined && player.marketValue > 0 && (
                        <span className="text-emerald-400">
                          €{player.marketValue >= 10 ? Math.round(player.marketValue) : player.marketValue.toFixed(1)}M
                        </span>
                      )}
                      {stats && stats.appearances > 0 ? (
                        <>
                          <span className="text-slate-400">
                            {stats.appearances}场 · {stats.starts ?? 0}首发 · {stats.substituteAppearances ?? 0}替补 · {stats.minutesPlayed ?? 0}分钟
                          </span>
                          {stats.goals > 0 && (
                            <span className="text-slate-200 font-medium">
                              {stats.goals}球
                            </span>
                          )}
                          {stats.assists > 0 && (
                            <span className="text-slate-300">
                              {stats.assists}助
                            </span>
                          )}
                          {(player.position === 'GK' || player.position === 'DF') && stats.cleanSheets > 0 && (
                            <span className="text-blue-300" title="实际登场且球队整场（含加时）零失球">
                              {stats.cleanSheets}零封
                            </span>
                          )}
                          {player.position === 'GK' && stats.saves > 0 && (
                            <span className="text-amber-300">
                              {stats.saves}神扑
                            </span>
                          )}
                          {player.position === 'DF' && stats.keyBlocks > 0 && (
                            <span className="text-blue-400">
                              {stats.keyBlocks}关键封堵
                            </span>
                          )}
                          {(player.position === 'MF' || player.position === 'FW') && stats.keyPasses > stats.assists && (
                            <span className="text-emerald-300">
                              {stats.keyPasses}威胁传球
                            </span>
                          )}
                          {stats.yellowCards > 0 && (
                            <span className="text-yellow-400">
                              {stats.yellowCards}黄
                            </span>
                          )}
                          {stats.redCards > 0 && (
                            <span className="text-red-400">
                              {stats.redCards}红
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-600">本季尚未出场</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Injury / suspension board ─────────────────────────────────

/**
 * Phase G — list active injuries and suspensions for the team. Hidden when
 * neither side has any entries. The chips link to PlayerDetail (for the
 * full injury history) and the right-side count is the games-remaining
 * value relative to `world.totalElapsedWindows`.
 */
function InjuryBoard({ teamId }: { teamId: string }) {
  const world = useGameStore((s) => s.world);
  if (!world) return null;
  const squad = world.squads[teamId] ?? [];
  if (squad.length === 0) return null;

  const cur = world.totalElapsedWindows ?? 0;
  const injured = squad
    .filter((p) => (p.injuredUntilWindow ?? 0) > cur)
    .sort((a, b) => (b.injuredUntilWindow ?? 0) - (a.injuredUntilWindow ?? 0));
  const suspended = squad
    .filter((p) => (p.injuredUntilWindow ?? 0) <= cur && (p.suspendedUntilWindow ?? 0) > cur)
    .sort((a, b) => (b.suspendedUntilWindow ?? 0) - (a.suspendedUntilWindow ?? 0));

  if (injured.length === 0 && suspended.length === 0) return null;

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">
        🩹 伤员 / 停赛 ({injured.length + suspended.length})
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] text-red-400 mb-1.5 font-semibold">伤员 ({injured.length})</div>
          {injured.length === 0 ? (
            <div className="text-[11px] text-slate-600">—</div>
          ) : (
            <div className="space-y-1">
              {injured.map((p) => {
                const lastInj = p.injuryHistory?.[p.injuryHistory.length - 1];
                const remaining = Math.max(0, (p.injuredUntilWindow ?? 0) - cur);
                return (
                  <Link
                    key={p.uuid}
                    to={`/player/${p.uuid}`}
                    className="flex items-center gap-2 text-[11px] bg-red-900/15 hover:bg-red-900/30 border border-red-900/30 rounded px-2 py-1 transition-colors"
                  >
                    <span className="text-slate-300 truncate flex-1">{p.name}</span>
                    <span className="text-slate-500 text-[10px]">{lastInj?.reason ?? '伤病'}</span>
                    <span className="text-red-400 font-mono shrink-0">{remaining}场</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] text-yellow-400 mb-1.5 font-semibold">停赛 ({suspended.length})</div>
          {suspended.length === 0 ? (
            <div className="text-[11px] text-slate-600">—</div>
          ) : (
            <div className="space-y-1">
              {suspended.map((p) => {
                const remaining = Math.max(0, (p.suspendedUntilWindow ?? 0) - cur);
                return (
                  <Link
                    key={p.uuid}
                    to={`/player/${p.uuid}`}
                    className="flex items-center gap-2 text-[11px] bg-yellow-900/10 hover:bg-yellow-900/20 border border-yellow-900/30 rounded px-2 py-1 transition-colors"
                  >
                    <span className="text-slate-300 truncate flex-1">{p.name}</span>
                    <span className="text-slate-500 text-[10px]">累计纪律</span>
                    <span className="text-yellow-400 font-mono shrink-0">{remaining}场</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Team trend chart
// ══════════════════════════════════════════════════════════════

function TeamTrendChart({ records, color }: { records: { seasonNumber: number; leaguePosition: number; leaguePoints: number; leagueLevel: 1|2|3; teamOverall?: number }[]; color: string }) {
  const sorted = [...records].sort((a, b) => a.seasonNumber - b.seasonNumber);
  if (sorted.length < 1) return null;
  const n = sorted.length;
  const chartW = Math.max(n * 60, 150);
  const chartH = 140;
  const padL = 30; const padR = 10; const padT = 10; const padB = 25;
  const xScale = n > 1 ? (chartW - padL - padR) / (n - 1) : 0;
  const getX = (i: number) => padL + (n > 1 ? i * xScale : (chartW - padL - padR) / 2);

  // Points line
  const maxPts = Math.max(...sorted.map(r => r.leaguePoints), 1);
  const ptsPoints = sorted.map((r, i) => `${getX(i)},${padT + (1 - r.leaguePoints / maxPts) * (chartH - padT - padB)}`).join(' ');

  // Position line (inverted)
  const maxPos = Math.max(...sorted.map(r => r.leaguePosition), 1);
  const posPoints = sorted.map((r, i) => `${getX(i)},${padT + ((r.leaguePosition - 1) / Math.max(maxPos - 1, 1)) * (chartH - padT - padB)}`).join(' ');

  // OVR line
  const hasOvr = sorted.some(r => r.teamOverall && r.teamOverall > 0);
  const maxOvr = hasOvr ? Math.max(...sorted.map(r => r.teamOverall ?? 0)) : 100;
  const minOvr = hasOvr ? Math.min(...sorted.filter(r => r.teamOverall).map(r => r.teamOverall!)) : 0;
  const ovrRange = Math.max(maxOvr - minOvr, 10); // at least 10 range for visibility
  const ovrPoints = hasOvr ? sorted.map((r, i) => {
    const ovr = r.teamOverall ?? 0;
    if (ovr === 0) return null;
    const y = padT + (1 - (ovr - minOvr + 5) / (ovrRange + 10)) * (chartH - padT - padB);
    return `${getX(i)},${y}`;
  }).filter(Boolean).join(' ') : '';

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ minWidth: '200px', height: `${chartH}px` }}>
        {/* Grid lines */}
        {[0, 0.5, 1].map(r => (
          <line key={r} x1={padL} y1={padT + r * (chartH - padT - padB)} x2={chartW - padR} y2={padT + r * (chartH - padT - padB)} stroke="#334155" strokeWidth="0.5" />
        ))}

        {/* Points line (team color) */}
        <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" points={ptsPoints} opacity="0.9" />

        {/* Position line (gray dashed) */}
        <polyline fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3" points={posPoints} opacity="0.4" />

        {/* OVR line (amber) */}
        {hasOvr && ovrPoints && (
          <polyline fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" points={ovrPoints} opacity="0.8" />
        )}

        {/* Data points */}
        {sorted.map((r, i) => {
          const x = getX(i);
          const yPts = padT + (1 - r.leaguePoints / maxPts) * (chartH - padT - padB);
          const lvColor = r.leagueLevel === 1 ? '#f59e0b' : r.leagueLevel === 2 ? '#3b82f6' : '#22c55e';
          const ovr = r.teamOverall ?? 0;
          const yOvr = ovr > 0 ? padT + (1 - (ovr - minOvr + 5) / (ovrRange + 10)) * (chartH - padT - padB) : 0;
          return (
            <g key={r.seasonNumber}>
              {/* Points dot */}
              <circle cx={x} cy={yPts} r="3" fill={color} />
              <text x={x} y={yPts - 6} textAnchor="middle" fill="#94a3b8" fontSize="7">{r.leaguePoints}分</text>

              {/* OVR dot */}
              {ovr > 0 && (
                <>
                  <circle cx={x} cy={yOvr} r="2.5" fill="#f59e0b" />
                  <text x={x} y={yOvr - 5} textAnchor="middle" fill="#f59e0b" fontSize="6.5" opacity="0.8">{ovr}</text>
                </>
              )}

              {/* Season label + league level */}
              <text x={x} y={chartH - 3} textAnchor="middle" fill="#64748b" fontSize="8">S{r.seasonNumber}</text>
              <circle cx={x} cy={chartH - 14} r="3" fill={lvColor} opacity="0.7" />
            </g>
          );
        })}

        {/* Y-axis labels */}
        <text x="2" y={padT + 3} fill="#64748b" fontSize="7">{maxPts}分</text>
        <text x="2" y={chartH - padB} fill="#64748b" fontSize="7">0</text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 rounded" style={{ backgroundColor: color }} /> 积分</span>
        {hasOvr && <span className="flex items-center gap-1"><span className="w-4 h-0.5 rounded bg-amber-500" /> OVR</span>}
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 rounded bg-slate-500 border-t border-dashed border-slate-400" /> 排名</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 顶</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> 甲</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> 乙</span>
      </div>
    </div>
  );
}

function FireCoachButton({ teamId }: { teamId: string }) {
  const favoriteTeamIds = useGameStore(s => s.favoriteTeamIds);
  const fireCoach = useGameStore(s => s.fireCoach);
  const [confirming, setConfirming] = useState(false);

  if (!favoriteTeamIds.includes(teamId)) return null;

  if (confirming) {
    return (
      <span className="flex gap-1 ml-auto">
        <button onClick={() => { fireCoach(teamId); setConfirming(false); }}
          className="px-2 py-0.5 text-[10px] bg-red-600 hover:bg-red-500 text-white rounded cursor-pointer">确认解雇</button>
        <button onClick={() => setConfirming(false)}
          className="px-2 py-0.5 text-[10px] bg-slate-700 text-slate-300 rounded cursor-pointer">取消</button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirming(true)}
      className="ml-auto px-2 py-0.5 text-[10px] bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded cursor-pointer transition-colors">
      解雇教练
    </button>
  );
}

/**
 * Phase H — Team finance panel.
 *
 * Shows the current cash balance with a coloured pill (red if negative,
 * amber if low, green otherwise) and the per-season finance history (last
 * 10 seasons) as a sortable table. The header banner doubles as an alert
 * when cash < 0 — surfaces the fire-sale risk to the player.
 */
function FinancePanel({ teamId }: { teamId: string }) {
  const world = useGameStore((s) => s.world);
  if (!world) return null;
  const fin = world.teamFinances?.[teamId];
  if (!fin) return null;

  const cashTone = fin.cash < 0
    ? 'text-red-300 bg-red-900/40 border-red-700/40'
    : fin.cash < 10
    ? 'text-amber-300 bg-amber-900/30 border-amber-700/40'
    : 'text-emerald-300 bg-emerald-900/30 border-emerald-700/40';

  const reversed = [...fin.history].reverse();

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
        <h3 className="text-sm font-semibold text-slate-200">财政状态</h3>
        <span className={`text-xs px-2 py-0.5 rounded border ${cashTone}`}>
          现金: {formatMoney(fin.cash)}
        </span>
      </div>
      {fin.cash < 0 && (
        <div className="px-4 py-2 text-[11px] text-red-300 bg-red-950/30 border-b border-red-900/40">
          ⚠ 财政告急 — 赛季结束时将以 200% 高溢价被迫甩卖一名身价 €30M+ 球员（若有顶级买家），现金可恢复正值。
        </div>
      )}
      {/* Current season running totals */}
      <div className="px-4 py-2 border-b border-slate-700/60 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div>
          <span className="text-slate-500">本季收入累计:</span>{' '}
          <span className="text-emerald-300">{formatMoney(fin.totalIncome)}</span>
        </div>
        <div>
          <span className="text-slate-500">本季支出累计:</span>{' '}
          <span className="text-red-300">-{formatMoney(fin.totalExpense)}</span>
        </div>
      </div>
      {reversed.length === 0 ? (
        <div className="px-4 py-3 text-xs text-slate-500">
          首个赛季尚未结束，暂无历史数据。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-400 border-b border-slate-700">
                <th className="px-2 py-1.5 text-left">赛季</th>
                <th className="px-2 py-1.5 text-right">期初</th>
                <th className="px-2 py-1.5 text-right">奖金</th>
                <th className="px-2 py-1.5 text-right">转播</th>
                <th className="px-2 py-1.5 text-right">转入</th>
                <th className="px-2 py-1.5 text-right">薪资</th>
                <th className="px-2 py-1.5 text-right">转出</th>
                <th className="px-2 py-1.5 text-right">期末</th>
                <th className="px-2 py-1.5 text-right">变动</th>
              </tr>
            </thead>
            <tbody>
              {reversed.map((rec) => {
                const delta = rec.endCash - rec.startCash;
                const deltaTone = delta >= 0 ? 'text-emerald-400' : 'text-red-400';
                const endTone = rec.endCash < 0 ? 'text-red-300' : 'text-slate-200';
                return (
                  <tr key={rec.season} className="border-t border-slate-700/40">
                    <td className="px-2 py-1.5 text-slate-300">S{rec.season}</td>
                    <td className="px-2 py-1.5 text-right text-slate-400">{formatMoney(rec.startCash)}</td>
                    <td className="px-2 py-1.5 text-right text-amber-300">+{formatMoney(rec.prizeMoney)}</td>
                    <td className="px-2 py-1.5 text-right text-blue-300">+{formatMoney(rec.tvSponsor)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">+{formatMoney(rec.transferIncome)}</td>
                    <td className="px-2 py-1.5 text-right text-rose-300">-{formatMoney(rec.salaries)}</td>
                    <td className="px-2 py-1.5 text-right text-red-400">-{formatMoney(rec.transferExpense)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${endTone}`}>{formatMoney(rec.endCash)}</td>
                    <td className={`px-2 py-1.5 text-right ${deltaTone}`}>
                      {delta >= 0 ? '+' : ''}{formatMoney(delta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
