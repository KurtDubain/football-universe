import { useState } from 'react';
import { useGameStore } from '../store/game-store';

export default function Settings() {
  const world = useGameStore((s) => s.world);
  const resetGame = useGameStore((s) => s.resetGame);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  // Save stats
  const saveKey = 'football-universe-save';
  let saveSize = '未知';
  try {
    const raw = localStorage.getItem(saveKey);
    if (raw) saveSize = `${(raw.length / 1024).toFixed(0)} KB`;
  } catch {}

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-xl font-bold text-slate-100">设置</h2>

      {/* Game info */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">游戏信息</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-slate-500">当前赛季</span>
          <span className="text-slate-200">第 {world.seasonState.seasonNumber} 赛季</span>
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
          <span className="text-slate-200">v0.8.0</span>
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
        <p className="mt-1">by KurtDubain</p>
      </div>
    </div>
  );
}
