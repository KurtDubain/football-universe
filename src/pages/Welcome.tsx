import { useState } from 'react';
import { useGameStore } from '../store/game-store';
import Logo from '../components/Logo';
import { ParticleBackground } from '../components/CanvasEffects';
import { APP_VERSION } from '../version';
import { defaultTeams } from '../config/teams';

export default function Welcome() {
  const newGame = useGameStore((s) => s.newGame);
  const setFavoriteTeam = useGameStore((s) => s.setFavoriteTeam);
  const [seed, setSeed] = useState('');
  const [favTeam, setFavTeam] = useState('');
  const [starting, setStarting] = useState(false);

  function handleStart() {
    setStarting(true);
    if (favTeam) setFavoriteTeam(favTeam);
    const seedNum = seed.trim() ? parseInt(seed.trim(), 10) : undefined;
    newGame(isNaN(seedNum as number) ? undefined : seedNum);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 flex items-center justify-center relative overflow-hidden">
      {/* Canvas particle background */}
      <ParticleBackground />

      {/* Decorative elements */}
      <div className="absolute top-20 left-20 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-20 w-80 h-80 bg-emerald-600/5 rounded-full blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-600/3 rounded-full blur-3xl" />

      <div className="relative z-10 text-center space-y-10 p-8 max-w-lg">
        <div className="space-y-3">
          <div className="flex justify-center mb-4">
            <Logo size={80} />
          </div>
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-slate-100 to-emerald-400 tracking-tight leading-tight">
            足球联赛宇宙
          </h1>
          <p className="text-xl text-slate-400 font-light">电子斗蛐蛐模拟器</p>
        </div>

        <div className="space-y-3 text-sm text-slate-500">
          <div className="flex items-center justify-center gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              32 支球队
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              3 级联赛
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-purple-500 rounded-full" />
              4 项赛事
            </span>
          </div>
          <p className="text-slate-600">联赛 · 联赛杯 · 超级杯 · 环球冠军杯</p>
        </div>

        <div className="space-y-4 max-w-sm mx-auto">
          <div>
            <label className="block text-xs text-slate-500 mb-1.5 text-left">
              随机种子 (可选，相同种子产生相同赛果)
            </label>
            <input
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="留空自动生成"
              className="w-full px-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5 text-left">关注球队 (可选)</label>
            <select
              value={favTeam}
              onChange={(e) => setFavTeam(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">不选择</option>
              {defaultTeams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full px-8 py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-slate-700 disabled:to-slate-600 disabled:cursor-not-allowed text-white text-lg font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-blue-900/40 hover:shadow-blue-800/50 press-scale"
          >
            {starting ? '正在构建联赛宇宙...' : '开始新游戏'}
          </button>
        </div>

        <p className="text-xs text-slate-700">
          v{APP_VERSION} · by KurtDubain
        </p>
      </div>
    </div>
  );
}
