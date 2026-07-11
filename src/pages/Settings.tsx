import { lazy, Suspense, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../store/game-store';
import { getTeamName } from '../utils/format';
import { defaultTeams } from '../config/teams';
import { APP_VERSION } from '../version';
import { setLanguage } from '../i18n';
import { BALANCE } from '../config/balance';

const DevDataHealthPanel = import.meta.env.DEV
  ? lazy(() => import('../components/DataHealthPanel'))
  : null;

export default function Settings() {
  const { i18n } = useTranslation();
  const world = useGameStore((s) => s.world);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const setFavoriteTeams = useGameStore((s) => s.setFavoriteTeams);
  const toggleFavoriteTeam = useGameStore((s) => s.toggleFavoriteTeam);
  const resetGame = useGameStore((s) => s.resetGame);
  const [showConfirm, setShowConfirm] = useState(false);
  const [guideOpen, setGuideOpen] = useState<string | null>(null);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const saveKey = 'football-universe-save';
  let saveSize = '未知';
  try {
    const raw = localStorage.getItem(saveKey);
    if (raw) saveSize = `${(raw.length / 1024).toFixed(0)} KB`;
  } catch {}

  // Runtime statistics
  const stats = useMemo(() => {
    const allRecords = Object.entries(world.teamSeasonRecords).flatMap(([, recs]) => recs);
    const totalGoals = allRecords.reduce((s, r) => s + r.leagueGF, 0);
    const totalMatches = allRecords.reduce((s, r) => s + r.leaguePlayed, 0) / 2;
    const avgGoals = totalMatches > 0 ? (totalGoals / totalMatches).toFixed(2) : '0';

    const totalCoachChanges = world.honorHistory.reduce((s, h) => s + h.coachChanges.length, 0);

    let topTrophy = { name: '-', count: 0 };
    for (const [tid, trophies] of Object.entries(world.teamTrophies)) {
      if (trophies.length > topTrophy.count) {
        topTrophy = { name: getTeamName(tid, world.teamBases), count: trophies.length };
      }
    }

    const currentChampion = world.honorHistory.length > 0
      ? getTeamName(world.honorHistory[world.honorHistory.length - 1].league1Champion, world.teamBases)
      : '-';

    const isWorldCupYear = world.seasonState.seasonNumber % BALANCE.WORLD_CUP_INTERVAL === 0;

    return { totalGoals, totalMatches: Math.round(totalMatches), avgGoals, totalCoachChanges, topTrophy, currentChampion, isWorldCupYear };
  }, [world.teamSeasonRecords, world.honorHistory, world.teamTrophies, world.teamBases, world.seasonState.seasonNumber]);

  const guideItems: { key: string; title: string; icon: string; content: string }[] = [
    {
      key: 'core', title: '核心玩法', icon: '🎮',
      content: '这是一个「观赛型」足球模拟器 — 你不操控比赛，而是观看整个足球宇宙自动演化。每次点击「推进」，日历向前一步：联赛轮次、杯赛回合、赛季结算依次发生。升降级、教练解雇、杯赛冷门、王朝崛起……一切自然涌现。你可以设定关注球队，追踪它的命运。',
    },
    {
      key: 'league', title: '联赛体系', icon: '🏟️',
      content: '三级联赛：顶级(16队)、甲级(8队)、乙级(8队)。顶级双循环30轮，甲乙双循环14轮。赛季末：顶级后3名降入甲级，甲级前2名直升，甲级第3 vs 顶级倒数第3打保级附加赛(主客两回合)。甲级后2名降入乙级，乙级前2名升入甲级。积分相同比净胜球，再同比进球数。',
    },
    {
      key: 'cups', title: '杯赛赛制', icon: '🏆',
      content: '联赛杯：32队单场淘汰，5轮(R32→R16→QF→SF→决赛)。超级杯：16队(10顶+4甲+2乙)，4组循环赛取前2名进入淘汰赛(主客两回合)，决赛单场。环球冠军杯：每4个赛季举办一次，全部32队参赛，8组4队循环赛+淘汰赛，最高荣誉。',
    },
    {
      key: 'match', title: '比赛模拟', icon: '⚽',
      content: `影响比赛结果的因素：球队OVR、教练加成、主场优势(${(BALANCE.HOME_ADVANTAGE * 100).toFixed(0)}%)、士气(${(BALANCE.MORALE_WEIGHT * 100).toFixed(0)}%)、体能(${(BALANCE.FATIGUE_WEIGHT * 100).toFixed(0)}%)、动量(${(BALANCE.MOMENTUM_WEIGHT * 100).toFixed(0)}%)、弱队补正(${(BALANCE.UNDERDOG_BOOST * 100).toFixed(0)}%)。杯赛比联赛更不确定(波动${(BALANCE.CUP_RANDOMNESS * 100).toFixed(0)}% vs ${(BALANCE.LEAGUE_RANDOMNESS * 100).toFixed(0)}%)。进球数基于泊松分布采样。`,
    },
    {
      key: 'coach', title: '教练系统', icon: '👔',
      content: `每位教练有评分、风格(进攻/防守/均衡/控球/反击)和6项加成。连续输球会累积压力，压力超过${BALANCE.FIRING_THRESHOLD}即被解雇。豪门压力增速×${BALANCE.ELITE_TEAM_PRESSURE_MULT}。被解雇的教练进入待业状态，等待下家。少数教练在巅峰时期会选择急流勇退。`,
    },
    {
      key: 'growth', title: '球队变化', icon: '📈',
      content: '赛季结束时球队OVR会根据战绩变化：冠军和升级队伍成长，降级和垫底队伍下滑。长期来看豪门有底蕴优势，但弱队也能通过连续好成绩逐步崛起。世界杯冠军的所在联赛也会有微小加成。',
    },
    {
      key: 'state', title: '球队状态', icon: '💪',
      content: '士气(Morale)：胜利提升、失败下降，影响比赛发挥。体能(Fatigue)：每场比赛消耗体能，休息时恢复，密集赛程是隐形杀手。动量(Momentum)：连胜/连败会形成正/负动量惯性。阵容健康(SquadHealth)：伤病和红牌会削弱阵容厚度。',
    },
    {
      key: 'derby', title: '德比与成就', icon: '🔥',
      content: '游戏内设有11组经典德比(国家德比、同城德比等)，德比战双方都会获得额外战意加成。赛季中还会触发随机事件(伤病潮、妖星涌现、资金注入等)。达成特殊条件(不败赛季、百分赛季等)会解锁成就。',
    },
  ];

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-xl font-bold text-slate-100">设置</h2>

      {/* Language switcher */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">语言 / Language</h3>
        <div className="flex gap-2">
          <button onClick={() => setLanguage('zh')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors ${i18n.language === 'zh' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}>
            🇨🇳 中文
          </button>
          <button onClick={() => setLanguage('en')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors ${i18n.language === 'en' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}>
            🇺🇸 English
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">部分内容（球队名称、新闻文案）暂时仅支持中文</p>
      </div>

      {/* Favorite teams (up to 3) */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">关注球队</h3>
          <span className="text-[10px] text-slate-500">已选 {favoriteTeamIds.length}/3</span>
        </div>

        {/* Selected slots */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[0, 1, 2].map((slot) => {
            const tid = favoriteTeamIds[slot];
            const team = tid ? world.teamBases[tid] : null;
            return (
              <div
                key={slot}
                className={`rounded-lg border-2 border-dashed p-2 text-center ${
                  team ? 'border-blue-500/40 bg-blue-900/10' : 'border-slate-700 bg-slate-900/30'
                }`}
              >
                {team ? (
                  <div className="flex flex-col items-center gap-1">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                    <div className="text-xs text-slate-100 font-medium truncate max-w-full">{team.name}</div>
                    <button
                      onClick={() => toggleFavoriteTeam(tid)}
                      className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-600 py-3">空槽位</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Picker dropdown */}
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (favoriteTeamIds.includes(v)) {
              toggleFavoriteTeam(v);
            } else {
              toggleFavoriteTeam(v);
            }
            // Reset select
            e.target.value = '';
          }}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="">+ 添加 / 切换关注球队</option>
          {defaultTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {favoriteTeamIds.includes(t.id) ? '✓ ' : ''}
              {t.name}
            </option>
          ))}
        </select>

        {favoriteTeamIds.length > 0 && (
          <button
            onClick={() => setFavoriteTeams([])}
            className="text-[10px] text-slate-500 hover:text-red-400 mt-2 cursor-pointer"
          >
            清空全部关注
          </button>
        )}
        <p className="text-[10px] text-slate-500 mt-2">关注球队的比赛会有特殊高亮，仪表盘显示卡片，可手动解雇教练</p>
      </div>

      {/* Game info */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">游戏信息</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-slate-500">当前赛季</span>
          <span className="text-slate-200">第 {world.seasonState.seasonNumber} 赛季{stats.isWorldCupYear ? ' ⭐ 世界杯年' : ''}</span>
          <span className="text-slate-500">随机种子</span>
          <span className="text-slate-200 font-mono">{world.seed}</span>
          <span className="text-slate-500">历史赛季</span>
          <span className="text-slate-200">{world.honorHistory.length} 个</span>
          <span className="text-slate-500">球队数量</span>
          <span className="text-slate-200">{Object.keys(world.teamBases).length} 支</span>
          <span className="text-slate-500">教练数量</span>
          <span className="text-slate-200">{Object.keys(world.coachBases).length} 名</span>
          <span className="text-slate-500">球员总数</span>
          <span className="text-slate-200">{Object.values(world.squads).reduce((s, sq) => s + sq.length, 0)} 名</span>
          <span className="text-slate-500">存档大小</span>
          <span className="text-slate-200">{saveSize}</span>
          <span className="text-slate-500">版本</span>
          <span className="text-slate-200">v{APP_VERSION}</span>
        </div>
      </div>

      {/* Runtime stats */}
      {world.honorHistory.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">历史统计</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="总进球" value={`${stats.totalGoals}`} />
            <StatCard label="总场次" value={`${stats.totalMatches}`} />
            <StatCard label="场均进球" value={stats.avgGoals} />
            <StatCard label="换帅次数" value={`${stats.totalCoachChanges}`} />
            <StatCard label="奖杯王" value={stats.topTrophy.count > 0 ? `${stats.topTrophy.name} (${stats.topTrophy.count})` : '-'} small />
            <StatCard label="卫冕冠军" value={stats.currentChampion} small />
          </div>
        </div>
      )}

      {DevDataHealthPanel && (
        <Suspense fallback={null}>
          <DevDataHealthPanel world={world} />
        </Suspense>
      )}

      {/* Game Guide */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">游戏指南</h3>
        </div>
        <div className="divide-y divide-slate-700/40">
          {guideItems.map((item) => (
            <div key={item.key}>
              <button
                onClick={() => setGuideOpen(guideOpen === item.key ? null : item.key)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{item.icon}</span>
                  <span className="text-sm text-slate-200">{item.title}</span>
                </div>
                <span className="text-slate-500 text-xs">{guideOpen === item.key ? '▲' : '▼'}</span>
              </button>
              {guideOpen === item.key && (
                <div className="px-4 pb-3 pl-11">
                  <p className="text-xs text-slate-400 leading-relaxed">{item.content}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Save management */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">存档管理</h3>
        <div className="space-y-2">
          <button
            onClick={() => {
              try {
                const data = localStorage.getItem(saveKey);
                if (data) {
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `football-universe-s${world.seasonState.seasonNumber}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }
              } catch {}
            }}
            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors cursor-pointer text-left"
          >
            导出存档
            <span className="block text-[10px] text-slate-500 mt-0.5">下载当前存档为 JSON 文件</span>
          </button>

          <label className="block w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors cursor-pointer text-left">
            导入存档
            <span className="block text-[10px] text-slate-500 mt-0.5">从 JSON 文件恢复存档</span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  try {
                    const text = ev.target?.result as string;
                    localStorage.setItem(saveKey, text);
                    window.location.reload();
                  } catch {}
                };
                reader.readAsText(file);
              }}
            />
          </label>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-slate-800 rounded-xl border border-red-900/30 p-4">
        <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">危险操作</h3>
        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="w-full px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm rounded-lg transition-colors cursor-pointer"
          >
            重置游戏
            <span className="block text-[10px] text-red-500/60 mt-0.5">删除所有存档数据，重新开始</span>
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-red-400">确定要删除所有数据吗？此操作不可撤销。</p>
            <div className="flex gap-2">
              <button
                onClick={() => { resetGame(); setShowConfirm(false); }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors cursor-pointer"
              >
                确认删除
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Credits */}
      <div className="text-center text-xs text-slate-600 py-4">
        <p>足球联赛宇宙 · 电子斗蛐蛐模拟器</p>
        <p className="mt-1">v{APP_VERSION} · by KurtDubain</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-slate-700/30 rounded-lg p-2.5 text-center">
      <div className={`font-bold text-slate-100 truncate ${small ? 'text-xs' : 'text-lg'}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
