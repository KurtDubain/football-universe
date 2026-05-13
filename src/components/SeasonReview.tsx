import { Link } from 'react-router-dom';
import type { GameWorld } from '../engine/season/season-manager';
import type { SeasonRecord } from '../types/team';
import { getTeamName, getTierLabel, getTierColor } from '../utils/format';
import { getTopScorers, getTopAssists } from '../engine/players/stats';
import { AWARD_META } from '../engine/awards/season-awards';

interface Props {
  world: GameWorld;
  seasonNumber: number;
}

type RecordWithTeam = SeasonRecord & { teamId: string };

export default function SeasonReview({ world, seasonNumber }: Props) {
  const honor = world.honorHistory.find(h => h.seasonNumber === seasonNumber);
  if (!honor) return null;

  const tb = world.teamBases;

  const seasonRecords: RecordWithTeam[] = [];
  for (const [teamId, records] of Object.entries(world.teamSeasonRecords)) {
    const rec = records.find(r => r.seasonNumber === seasonNumber);
    if (rec) seasonRecords.push({ ...rec, teamId });
  }

  const l1Records = seasonRecords.filter(r => r.leagueLevel === 1).sort((a, b) => a.leaguePosition - b.leaguePosition);
  const l2Records = seasonRecords.filter(r => r.leagueLevel === 2).sort((a, b) => a.leaguePosition - b.leaguePosition);

  const totalGoals = seasonRecords.reduce((s, r) => s + r.leagueGF, 0);
  const totalMatches = seasonRecords.reduce((s, r) => s + r.leaguePlayed, 0) / 2;

  const bestDefense = l1Records.length > 0 ? l1Records.reduce((b, r) => r.leagueGA < b.leagueGA ? r : b) : null;
  const bestAttack = l1Records.length > 0 ? l1Records.reduce((b, r) => r.leagueGF > b.leagueGF ? r : b) : null;
  const mostWins = l1Records.length > 0 ? l1Records.reduce((b, r) => r.leagueWon > b.leagueWon ? r : b) : null;
  const mostLosses = l1Records.length > 0 ? l1Records.reduce((b, r) => r.leagueLost > b.leagueLost ? r : b) : null;

  const scorers = getTopScorers(world.playerStats, 5);
  const assisters = getTopAssists(world.playerStats, 3);

  // Season buffs for this season
  const buffs = world.seasonBuffs ?? [];

  // Prediction
  const prediction = world.prediction;

  return (
    <div className="space-y-4">
      {/* Narrative Header */}
      <div className="py-5 bg-gradient-to-r from-amber-900/20 via-slate-800 to-amber-900/20 rounded-xl border border-amber-700/30 px-4 sm:px-6">
        <h2 className="text-2xl font-black text-slate-100 text-center">第{seasonNumber}赛季 回顾</h2>
        <p className="text-xs text-slate-500 mt-1 text-center">{Math.round(totalMatches)}场比赛 · {totalGoals}粒进球 · 场均{totalMatches > 0 ? (totalGoals / totalMatches).toFixed(1) : '0'}球</p>
        {l1Records.length > 0 && (() => {
          const champ = getTeamName(honor.league1Champion, tb);
          const runner = l1Records[1] ? getTeamName(l1Records[1].teamId, tb) : '';
          const champRec = l1Records[0];
          const runnerRec = l1Records[1];
          const gap = champRec && runnerRec ? champRec.leaguePoints - runnerRec.leaguePoints : 0;
          const scorer = scorers[0];
          // playerId is now a uuid — fetch the actual player to get the
          // shirt number (legacy code parsed it out of the id string).
          const scorerPlayer = scorer ? world.squads[scorer.teamId]?.find(p => p.uuid === scorer.playerId) : undefined;
          const scorerNum = scorerPlayer?.number ?? '';
          const scorerTeam = scorer ? getTeamName(scorer.teamId, tb) : '';

          const sentences: string[] = [];

          if (gap >= 10) {
            sentences.push(`本赛季毫无悬念，${champ}以${gap}分的断崖式优势横扫联赛，将所有对手远远甩在身后。`);
          } else if (gap <= 3 && gap >= 0 && runner) {
            sentences.push(`一个赛季的漫长征途最终在${champ}和${runner}之间的巅峰对决中走到终章。${champ}仅凭${gap}分的微弱优势惊险捧杯，过程跌宕起伏。`);
          } else {
            sentences.push(`经过${champRec?.leaguePlayed ?? 30}轮激烈角逐，${champ}以${champRec?.leaguePoints}分的成绩加冕赛季王者。`);
          }

          if (scorer && scorer.goals >= 15) {
            sentences.push(`${scorerTeam}的${scorerNum}号以${scorer.goals}球的惊人数据独霸射手榜，成为万千球迷心中的英雄。`);
          } else if (scorer && scorer.goals > 0) {
            sentences.push(`射手榜上，${scorerTeam}${scorerNum}号以${scorer.goals}球领跑，书写了属于自己的赛季篇章。`);
          }

          // Buff-driven storyline
          const championBuff = buffs.find(b => b.teamId === honor.league1Champion);
          if (championBuff) {
            const isPos = championBuff.effects.some(e => e.delta > 0);
            sentences.push(isPos
              ? `回望赛季初的「${championBuff.label}」剧情，似乎正是${champ}走向冠军的关键序章。`
              : `而${champ}更是克服了赛季初「${championBuff.label}」的不利剧情，展现了真正的冠军底蕴。`);
          }

          if (bestDefense && bestDefense.leagueGA <= 15) {
            sentences.push(`防守端，${getTeamName(bestDefense.teamId, tb)}铸就钢铁防线，全赛季仅失${bestDefense.leagueGA}球，令对手闻风丧胆。`);
          }

          if (honor.coachChanges.length >= 4) {
            sentences.push(`教练席上风波不断，全赛季${honor.coachChanges.length}次换帅让人目不暇接。`);
          }

          const cupWins = [honor.leagueCupWinner, honor.superCupWinner, honor.worldCupWinner].filter(Boolean);
          const uniqueCupTeams = new Set(cupWins);
          if (uniqueCupTeams.size === 1 && cupWins.length >= 2 && cupWins[0] === honor.league1Champion) {
            sentences.push(`${champ}不仅称霸联赛，更横扫杯赛赛场，成就令人艳羡的多冠伟业。`);
          }

          if (honor.promoted.length > 0) {
            const promoNames = honor.promoted.map(p => getTeamName(p.teamId, tb)).join('和');
            sentences.push(`${promoNames}凭借出色表现成功升级，新的征程就此开启。`);
          }

          if (honor.relegated.length > 0) {
            const relegNames = honor.relegated.map(r => getTeamName(r.teamId, tb)).join('和');
            sentences.push(`而${relegNames}则未能抵挡降级的命运，挥别了这个级别的舞台。`);
          }

          return (
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mt-3 text-center max-w-2xl mx-auto italic">
              {sentences.slice(0, 4).join('')}
            </p>
          );
        })()}
      </div>

      {/* Champions grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <ChampionCard title="顶级联赛冠军" teamId={honor.league1Champion} runnerUp={l1Records[1]?.teamId} tb={tb} accent="amber" />
        <ChampionCard title="甲级联赛冠军" teamId={honor.league2Champion} tb={tb} accent="blue" />
        <ChampionCard title="乙级联赛冠军" teamId={honor.league3Champion} tb={tb} accent="emerald" />
        <ChampionCard title="联赛杯冠军" teamId={honor.leagueCupWinner} tb={tb} accent="amber" />
        <ChampionCard title="超级杯冠军" teamId={honor.superCupWinner} tb={tb} accent="purple" />
        {honor.worldCupWinner && <ChampionCard title="环球冠军杯" teamId={honor.worldCupWinner} tb={tb} accent="sky" />}
      </div>

      {/* Prediction result */}
      {prediction?.settled && (
        <div className={`rounded-xl border p-3 ${prediction.correctCount && prediction.correctCount > 0 ? 'bg-emerald-900/15 border-emerald-700/30' : 'bg-slate-800 border-slate-700'}`}>
          <h3 className="text-xs font-semibold text-slate-400 mb-2">赛季竞猜结果</h3>
          <div className="flex flex-wrap gap-4 text-xs">
            <div>
              <span className="text-slate-500">冠军预测: </span>
              <span className="text-slate-200">{getTeamName(prediction.champion, tb)}</span>
              <span className="ml-1">{prediction.champion === honor.league1Champion ? '✅' : '❌'}</span>
            </div>
            <div>
              <span className="text-slate-500">降级预测: </span>
              <span className="text-slate-200">{getTeamName(prediction.relegated, tb)}</span>
              <span className="ml-1">{honor.relegated.some(r => r.teamId === prediction.relegated) ? '✅' : '❌'}</span>
            </div>
          </div>
        </div>
      )}

      {/* L1 final standings */}
      {l1Records.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-700/60">
            <h3 className="text-xs font-semibold text-slate-400">顶级联赛最终积分榜</h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {l1Records.map((r, i) => {
              const team = tb[r.teamId];
              const isChampion = i === 0;
              const isRelegated = r.relegated;
              return (
                <div key={r.teamId} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${isChampion ? 'bg-amber-900/10' : isRelegated ? 'bg-red-900/10' : ''}`}>
                  <span className={`w-4 text-center font-bold ${isChampion ? 'text-amber-400' : isRelegated ? 'text-red-400' : 'text-slate-500'}`}>{i + 1}</span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team?.color ?? '#666' }} />
                  <Link to={`/team/${r.teamId}`} className="flex-1 truncate text-slate-200 hover:text-blue-400">{getTeamName(r.teamId, tb)}</Link>
                  <span className="text-slate-500 w-6 text-center">{r.leagueWon}</span>
                  <span className="text-slate-500 w-6 text-center">{r.leagueDrawn}</span>
                  <span className="text-slate-500 w-6 text-center">{r.leagueLost}</span>
                  <span className="text-slate-400 w-6 text-center">{r.leagueGF - r.leagueGA > 0 ? '+' : ''}{r.leagueGF - r.leagueGA}</span>
                  <span className="font-bold text-slate-200 w-8 text-center">{r.leaguePoints}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Season awards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {bestAttack && (
          <StatCard label="最强火力" value={getTeamName(bestAttack.teamId, tb)} sub={`${bestAttack.leagueGF}球`} />
        )}
        {bestDefense && (
          <StatCard label="最佳防守" value={getTeamName(bestDefense.teamId, tb)} sub={`仅失${bestDefense.leagueGA}球`} />
        )}
        {mostWins && (
          <StatCard label="最多胜场" value={getTeamName(mostWins.teamId, tb)} sub={`${mostWins.leagueWon}胜`} />
        )}
        <StatCard label="换帅次数" value={`${honor.coachChanges.length}次`} sub={honor.coachChanges.length > 0 ? honor.coachChanges.map(c => tb[c.teamId]?.name).slice(0, 2).join('、') : '无'} />
      </div>

      {/* Player awards (颁奖典礼) */}
      {(() => {
        const awards = (world.playerAwardsHistory ?? []).filter(a => a.season === seasonNumber);
        if (awards.length === 0) return null;
        return (
          <div className="bg-gradient-to-br from-amber-900/15 via-slate-800 to-slate-800 rounded-xl border border-amber-800/30 p-4">
            <h3 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-1.5">
              <span>🏆</span><span>颁奖典礼</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {awards.map(a => {
                const meta = AWARD_META[a.type];
                return (
                  <Link
                    key={a.type}
                    to={`/player/${a.playerId}`}
                    className="bg-slate-900/40 rounded-lg border border-slate-700/40 p-2.5 hover:border-amber-600/50 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base">{meta.emoji}</span>
                      <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                    </div>
                    <div className="text-sm font-bold text-slate-100 truncate">{a.playerName}</div>
                    <div className="text-[10px] text-slate-400 truncate">{a.teamName}</div>
                    <div className={`text-[10px] mt-0.5 font-semibold ${meta.color}`}>{a.statLabel}</div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Top scorer + assist provider */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {scorers.length > 0 && (() => {
          const king = scorers[0];
          const kingPlayer = world.squads[king.teamId]?.find(p => p.uuid === king.playerId);
          const kingNum = kingPlayer?.number ?? '';
          const kingTeam = tb[king.teamId];
          const kingName = kingPlayer?.name ?? `${kingNum}号`;
          return (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="p-3 bg-gradient-to-r from-amber-900/20 to-slate-800 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <Link to={`/player/${king.playerId}`} className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-black text-white shrink-0 hover:opacity-80" style={{ backgroundColor: kingTeam?.color ?? '#f59e0b' }}>
                    {kingNum}
                  </Link>
                  <div>
                    <div className="text-[10px] text-amber-400 font-semibold">赛季射手王</div>
                    <Link to={`/player/${king.playerId}`} className="text-sm font-bold text-slate-100 hover:text-blue-400">{getTeamName(king.teamId, tb)} {kingName}</Link>
                    <div className="text-xs text-amber-400 font-bold">{king.goals}球 {king.assists > 0 ? `${king.assists}助` : ''}</div>
                  </div>
                </div>
              </div>
              {scorers.length > 1 && (
                <div className="p-2 space-y-0.5">
                  {scorers.slice(1).map((s, i) => {
                    const p = world.squads[s.teamId]?.find(pp => pp.uuid === s.playerId);
                    const nm = p?.name ?? (p ? `${p.number}号` : '球员');
                    return (
                      <div key={s.playerId} className="flex items-center gap-2 text-[11px]">
                        <span className="w-4 text-center text-slate-500">{i + 2}</span>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tb[s.teamId]?.color ?? '#666' }} />
                        <span className="flex-1 truncate text-slate-300">{getTeamName(s.teamId, tb)} {nm}</span>
                        <span className="text-slate-200 font-bold">{s.goals}球</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {assisters.length > 0 && (() => {
          const king = assisters[0];
          const kingPlayer = world.squads[king.teamId]?.find(p => p.uuid === king.playerId);
          const kingNum = kingPlayer?.number ?? '';
          const kingTeam = tb[king.teamId];
          const kingName = kingPlayer?.name ?? `${kingNum}号`;
          return (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="p-3 bg-gradient-to-r from-emerald-900/20 to-slate-800 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <Link to={`/player/${king.playerId}`} className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-black text-white shrink-0 hover:opacity-80" style={{ backgroundColor: kingTeam?.color ?? '#10b981' }}>
                    {kingNum}
                  </Link>
                  <div>
                    <div className="text-[10px] text-emerald-400 font-semibold">赛季助攻王</div>
                    <Link to={`/player/${king.playerId}`} className="text-sm font-bold text-slate-100 hover:text-blue-400">{getTeamName(king.teamId, tb)} {kingName}</Link>
                    <div className="text-xs text-emerald-400 font-bold">{king.assists}助 {king.goals > 0 ? `${king.goals}球` : ''}</div>
                  </div>
                </div>
              </div>
              {assisters.length > 1 && (
                <div className="p-2 space-y-0.5">
                  {assisters.slice(1).map((s, i) => {
                    const p = world.squads[s.teamId]?.find(pp => pp.uuid === s.playerId);
                    const nm = p?.name ?? (p ? `${p.number}号` : '球员');
                    return (
                      <div key={s.playerId} className="flex items-center gap-2 text-[11px]">
                        <span className="w-4 text-center text-slate-500">{i + 2}</span>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tb[s.teamId]?.color ?? '#666' }} />
                        <span className="flex-1 truncate text-slate-300">{getTeamName(s.teamId, tb)} {nm}</span>
                        <span className="text-slate-200 font-bold">{s.assists}助</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Season Awards */}
      <div className="bg-gradient-to-r from-purple-900/15 via-slate-800 to-purple-900/15 rounded-xl border border-purple-700/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-purple-700/20">
          <h3 className="text-sm font-bold text-purple-300">赛季颁奖典礼</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-700/30">
          {/* MVP — best goals+assists combined */}
          {scorers.length > 0 && (() => {
            const allStats = [...scorers, ...assisters].reduce((map, s) => {
              const key = s.playerId;
              const existing = map.get(key);
              if (existing) { existing.goals = Math.max(existing.goals, s.goals); existing.assists = Math.max(existing.assists, s.assists); }
              else map.set(key, { ...s });
              return map;
            }, new Map<string, typeof scorers[0]>());
            const mvp = [...allStats.values()].sort((a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists))[0];
            if (!mvp) return null;
            const mvpPlayer = world.squads[mvp.teamId]?.find(p => p.uuid === mvp.playerId);
            const num = mvpPlayer?.number ?? '';
            return (
              <AwardCard emoji="🏆" title="赛季MVP" value={`${getTeamName(mvp.teamId, tb)} ${num}号`} sub={`${mvp.goals}球 ${mvp.assists}助`} />
            );
          })()}
          {/* Best Coach — team with highest position vs expectation */}
          {l1Records.length > 0 && (() => {
            const bestCoach = l1Records.reduce((best, r) => {
              const exp = tb[r.teamId]?.expectation ?? 3;
              const expectedPos = Math.round(l1Records.length * (1 - (exp - 1) / 4));
              const overperformance = expectedPos - r.leaguePosition;
              const bestExp = tb[best.teamId]?.expectation ?? 3;
              const bestExpPos = Math.round(l1Records.length * (1 - (bestExp - 1) / 4));
              const bestOver = bestExpPos - best.leaguePosition;
              return overperformance > bestOver ? r : best;
            });
            const coachName = world.coachBases[bestCoach.coachId]?.name ?? '未知';
            return (
              <AwardCard emoji="👔" title="最佳教练" value={coachName} sub={`${getTeamName(bestCoach.teamId, tb)} 第${bestCoach.leaguePosition}名`} />
            );
          })()}
          {/* Best Newcomer — top scorer from non-L1 team, or lowest-OVR team's scorer */}
          {scorers.length > 0 && (() => {
            const nonEliteScorer = scorers.find(s => (tb[s.teamId]?.overall ?? 99) < 75);
            if (!nonEliteScorer) return null;
            const player = world.squads[nonEliteScorer.teamId]?.find(p => p.uuid === nonEliteScorer.playerId);
            const num = player?.number ?? '';
            return (
              <AwardCard emoji="⭐" title="最佳新星" value={`${getTeamName(nonEliteScorer.teamId, tb)} ${num}号`} sub={`${nonEliteScorer.goals}球`} />
            );
          })()}
          {/* Most Improved — team that climbed the most positions vs last season */}
          {l1Records.length > 0 && (() => {
            const prev = world.honorHistory.find(h => h.seasonNumber === seasonNumber - 1);
            if (!prev) return null;
            const prevRecords: RecordWithTeam[] = [];
            for (const [tid, recs] of Object.entries(world.teamSeasonRecords)) {
              const r = recs.find(r => r.seasonNumber === seasonNumber - 1 && r.leagueLevel === 1);
              if (r) prevRecords.push({ ...r, teamId: tid });
            }
            let bestClimb = { teamId: '', climb: 0 };
            for (const r of l1Records) {
              const prevR = prevRecords.find(p => p.teamId === r.teamId);
              if (prevR) {
                const climb = prevR.leaguePosition - r.leaguePosition;
                if (climb > bestClimb.climb) bestClimb = { teamId: r.teamId, climb };
              }
            }
            if (bestClimb.climb <= 0) return null;
            return (
              <AwardCard emoji="📈" title="最大黑马" value={getTeamName(bestClimb.teamId, tb)} sub={`排名提升${bestClimb.climb}位`} />
            );
          })()}
        </div>
      </div>

      {/* World Cup */}
      {honor.worldCupWinner && (
        <div className="bg-sky-900/15 rounded-xl border border-sky-800/30 p-3">
          <h3 className="text-xs font-semibold text-sky-400 mb-2">环球冠军杯</h3>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="text-amber-400 font-semibold">冠军:</span>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tb[honor.worldCupWinner]?.color ?? '#666' }} />
            <Link to={`/team/${honor.worldCupWinner}`} className="hover:text-blue-400 font-medium">{getTeamName(honor.worldCupWinner, tb)}</Link>
          </div>
        </div>
      )}

      {/* Season buffs recap */}
      {buffs.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
          <h3 className="text-xs font-semibold text-slate-400 mb-2">赛季剧情回顾</h3>
          <div className="space-y-1.5">
            {buffs.map(buff => {
              const isPositive = buff.effects.some(e => e.delta > 0);
              return (
                <div key={buff.teamId} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isPositive ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                    {buff.label}
                  </span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tb[buff.teamId]?.color ?? '#666' }} />
                  <span className="text-slate-300">{getTeamName(buff.teamId, tb)}</span>
                  <span className="text-slate-600 text-[10px] truncate flex-1">{buff.description}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Promotions & Relegations */}
      {(honor.promoted.length > 0 || honor.relegated.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {honor.promoted.length > 0 && (
            <div className="bg-green-900/15 rounded-xl border border-green-800/30 p-3">
              <h3 className="text-xs font-semibold text-green-400 mb-2">升级球队</h3>
              {honor.promoted.map(p => (
                <div key={p.teamId} className="text-xs text-slate-300 flex items-center gap-1.5 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tb[p.teamId]?.color ?? '#666' }} />
                  <Link to={`/team/${p.teamId}`} className="hover:text-blue-400">{getTeamName(p.teamId, tb)}</Link>
                  <span className="text-slate-500">{p.from}级→{p.to}级</span>
                </div>
              ))}
            </div>
          )}
          {honor.relegated.length > 0 && (
            <div className="bg-red-900/15 rounded-xl border border-red-800/30 p-3">
              <h3 className="text-xs font-semibold text-red-400 mb-2">降级球队</h3>
              {honor.relegated.map(r => (
                <div key={r.teamId} className="text-xs text-slate-300 flex items-center gap-1.5 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tb[r.teamId]?.color ?? '#666' }} />
                  <Link to={`/team/${r.teamId}`} className="hover:text-blue-400">{getTeamName(r.teamId, tb)}</Link>
                  <span className="text-slate-500">{r.from}级→{r.to}级</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Season Timeline */}
      {(() => {
        const seasonNews = world.newsLog.filter(n => n.seasonNumber === seasonNumber);
        const highlights = seasonNews.filter(n =>
          n.type === 'trophy' || n.type === 'upset' || n.type === 'coach_fired' ||
          n.type === 'coach_hired' || n.type === 'promotion' || n.type === 'relegation' ||
          (n.type === 'streak' && (n.title.includes('连胜') || n.title.includes('连败')))
        ).slice(0, 12);
        if (highlights.length === 0) return null;
        return (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-700/60">
              <h3 className="text-xs font-semibold text-slate-400">赛季大事记</h3>
            </div>
            <div className="relative px-4 py-3">
              <div className="absolute left-6 top-3 bottom-3 w-px bg-slate-700" />
              <div className="space-y-2">
                {highlights.map((n, i) => {
                  const icon = n.type === 'trophy' ? '🏆' : n.type === 'upset' ? '💥' : n.type === 'coach_fired' ? '📋' : n.type === 'promotion' ? '⬆️' : n.type === 'relegation' ? '⬇️' : '📰';
                  return (
                    <div key={n.id ?? i} className="flex items-start gap-3 pl-3 relative">
                      <span className="text-sm shrink-0 relative z-10 bg-slate-800">{icon}</span>
                      <div className="min-w-0">
                        <div className="text-xs text-slate-200 font-medium leading-tight">{n.title}</div>
                        {n.description && <div className="text-[10px] text-slate-500 mt-0.5 truncate">{n.description}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Continental Season Report */}
      {(() => {
        const contStats: Record<string, { wins: number; draws: number; losses: number; goals: number; champion?: string }> = {};
        // Scan current season results for cross-continent matches
        for (const w of world.seasonState.calendar) {
          if (!w.completed || !w.results) continue;
          for (const r of w.results) {
            const hCont = tb[r.homeTeamId]?.region?.split('+')[0];
            const aCont = tb[r.awayTeamId]?.region?.split('+')[0];
            if (!hCont || !aCont || hCont === aCont) continue;
            const totalH = r.homeGoals + (r.etHomeGoals ?? 0);
            const totalA = r.awayGoals + (r.etAwayGoals ?? 0);
            for (const cont of [hCont, aCont]) {
              if (!contStats[cont]) contStats[cont] = { wins: 0, draws: 0, losses: 0, goals: 0 };
            }
            if (totalH > totalA) { contStats[hCont].wins++; contStats[aCont].losses++; }
            else if (totalA > totalH) { contStats[aCont].wins++; contStats[hCont].losses++; }
            else { contStats[hCont].draws++; contStats[aCont].draws++; }
            contStats[hCont].goals += totalH;
            contStats[aCont].goals += totalA;
          }
        }
        // Find champion continent
        const l1ChampCont = tb[honor.league1Champion]?.region?.split('+')[0];
        if (l1ChampCont && contStats[l1ChampCont]) contStats[l1ChampCont].champion = honor.league1Champion;

        const entries = Object.entries(contStats);
        if (entries.length === 0) return null;
        const dominant = entries.sort((a, b) => b[1].wins - a[1].wins)[0];

        return (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
            <h3 className="text-xs font-semibold text-slate-400 mb-2">大洲赛季对抗</h3>
            <div className="grid grid-cols-3 gap-2">
              {entries.map(([name, data]) => {
                const total = data.wins + data.draws + data.losses;
                const isDominant = name === dominant[0];
                return (
                  <div key={name} className={`text-center p-2 rounded-lg ${isDominant ? 'bg-amber-900/15 border border-amber-700/30' : 'bg-slate-700/20'}`}>
                    <div className={`text-xs font-bold ${isDominant ? 'text-amber-400' : 'text-slate-300'}`}>{name}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{data.wins}胜 {data.draws}平 {data.losses}负</div>
                    <div className="text-[10px] text-slate-500">{data.goals}球</div>
                    {isDominant && <div className="text-[11px] sm:text-[9px] text-amber-400 mt-1">本季最强</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Most losses / bottom note */}
      {mostLosses && mostLosses.leagueLost > 0 && (
        <div className="text-center text-[10px] text-slate-600 py-1">
          本赛季最多败场: {getTeamName(mostLosses.teamId, tb)} ({mostLosses.leagueLost}负)
        </div>
      )}
    </div>
  );
}

function ChampionCard({ title, teamId, runnerUp, tb, accent }: { title: string; teamId: string; runnerUp?: string; tb: Record<string, any>; accent: string }) {
  const team = tb[teamId];
  if (!team) return null;
  const colors: Record<string, string> = {
    amber: 'border-amber-700/40 bg-amber-900/15',
    blue: 'border-blue-700/40 bg-blue-900/15',
    emerald: 'border-emerald-700/40 bg-emerald-900/15',
    purple: 'border-purple-700/40 bg-purple-900/15',
    sky: 'border-sky-700/40 bg-sky-900/15',
  };

  return (
    <div className={`rounded-xl border p-3 ${colors[accent] ?? colors.amber}`}>
      <div className="text-[10px] text-slate-500 mb-1">{title}</div>
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: team.color }}>
          {team.shortName?.charAt(0)}
        </span>
        <Link to={`/team/${teamId}`} className="text-sm font-semibold text-slate-100 hover:text-blue-400 truncate">{team.name}</Link>
      </div>
      {runnerUp && tb[runnerUp] && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-500">
          <span>亚军:</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tb[runnerUp]?.color ?? '#666' }} />
          <Link to={`/team/${runnerUp}`} className="text-slate-400 hover:text-blue-400">{getTeamName(runnerUp, tb)}</Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-200 mt-0.5 truncate">{value}</div>
      <div className="text-[10px] text-slate-500 truncate">{sub}</div>
    </div>
  );
}

function AwardCard({ emoji, title, value, sub }: { emoji: string; title: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800 p-3 text-center">
      <div className="text-xl mb-1">{emoji}</div>
      <div className="text-[10px] text-purple-400 font-semibold">{title}</div>
      <div className="text-xs text-slate-200 font-medium mt-1 truncate">{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}
