import { useState } from 'react';
import { useGameStore } from '../store/game-store';
import Logo from '../components/Logo';
import { ParticleBackground } from '../components/CanvasEffects';
import { APP_VERSION } from '../version';
import { defaultTeams } from '../config/teams';
import { GAME_MODES, type GameMode } from '../types/game-mode';

export default function Welcome() {
  const newGame = useGameStore((s) => s.newGame);
  const setFavoriteTeam = useGameStore((s) => s.setFavoriteTeam);
  const [seed, setSeed] = useState('');
  const [favTeam, setFavTeam] = useState('');
  const [mode, setMode] = useState<GameMode>('free');
  const [starting, setStarting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleStart() {
    setStarting(true);
    if (favTeam) setFavoriteTeam(favTeam);
    const seedNum = seed.trim() ? parseInt(seed.trim(), 10) : undefined;
    newGame(seedNum === undefined || isNaN(seedNum) ? undefined : seedNum, { gameMode: mode });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 relative overflow-x-hidden overflow-y-auto">
      <ParticleBackground />

      <div className="absolute top-20 left-20 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 right-20 w-80 h-80 bg-emerald-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-4xl mx-auto px-5 py-10 sm:py-16 space-y-12">

        {/* Hero */}
        <section className="text-center space-y-5">
          <div className="flex justify-center">
            <Logo size={80} />
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-slate-100 to-emerald-400 tracking-tight leading-tight">
            足球联赛宇宙
          </h1>
          <p className="text-lg sm:text-xl text-slate-400 font-light">
            Football Universe — 电子斗蛐蛐模拟器
          </p>
          <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto leading-relaxed">
            你不操控比赛 — 你看整个足球世界自动演化。<br />
            <span className="text-slate-500">No controls. No tactics. Just fate.</span>
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap pt-2">
            <a href="https://github.com/KurtDubain/football-universe" target="_blank" rel="noreferrer"
              className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors">
              ⭐ GitHub
            </a>
            <span className="text-xs text-slate-600">·</span>
            <span className="text-xs text-slate-500">v{APP_VERSION} · MIT 开源</span>
          </div>
        </section>

        {/* Feature highlights */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FeatureCard emoji="🏟️" label="3 级联赛" sub="顶/甲/乙级 · 升降级" />
          <FeatureCard emoji="🏆" label="4 项赛事" sub="联赛杯·超级杯·世界杯" />
          <FeatureCard emoji="♾️" label="无限赛季" sub="王朝兴衰自然演化" />
          <FeatureCard emoji="🎲" label="种子可复现" sub="同种子=同宇宙" />
        </section>

        {/* Setup form */}
        <section className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4 max-w-xl mx-auto">
          <h2 className="text-lg font-semibold text-slate-200">开局设置</h2>

          {/* Game mode */}
          <div>
            <label className="block text-xs text-slate-500 mb-2">玩法模式</label>
            <div className="grid grid-cols-2 gap-2">
              {GAME_MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={`text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer ${
                    mode === m.id
                      ? 'bg-blue-600/20 border-blue-500/50 ring-1 ring-blue-500/30'
                      : 'bg-slate-800/60 border-slate-700 hover:border-slate-600'
                  }`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">{m.emoji}</span>
                    <span className="text-sm font-semibold text-slate-200">{m.label}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 leading-tight">{m.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Favorite team */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">关注球队 (可选)</label>
            <select value={favTeam} onChange={(e) => setFavTeam(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer">
              <option value="">不选择</option>
              {defaultTeams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Advanced toggle */}
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer transition-colors">
            {showAdvanced ? '▲' : '▼'} 高级选项
          </button>

          {showAdvanced && (
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">随机种子</label>
              <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)}
                placeholder="留空自动生成 — 同种子产生相同赛果"
                className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
          )}

          {/* CTA */}
          <div className="space-y-2">
            <button onClick={handleStart} disabled={starting}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-slate-700 disabled:to-slate-600 disabled:cursor-not-allowed text-white text-base font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-blue-900/40 press-scale">
              {starting ? '正在构建宇宙...' : '🚀 开始新游戏'}
            </button>
            <a href="/team-editor"
              className="block w-full px-6 py-2 text-center text-xs text-slate-500 hover:text-slate-300 cursor-pointer transition-colors">
              🛠️ 自定义球队 →
            </a>
          </div>
        </section>

        {/* Footer */}
        <p className="text-center text-[10px] text-slate-700">
          by <a href="https://github.com/KurtDubain" target="_blank" rel="noreferrer" className="hover:text-slate-500 transition-colors">KurtDubain</a> · 纯前端 · 离线可玩
        </p>
      </div>
    </div>
  );
}

function FeatureCard({ emoji, label, sub }: { emoji: string; label: string; sub: string }) {
  return (
    <div className="bg-slate-800/40 backdrop-blur border border-slate-700/50 rounded-xl p-3 text-center">
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="text-sm font-semibold text-slate-200">{label}</div>
      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{sub}</div>
    </div>
  );
}
