import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { defaultTeams } from '../config/teams';
import type { TeamBase, TeamTier } from '../types/team';

const TIER_LABELS: Record<TeamTier, string> = {
  elite: '豪门', strong: '劲旅', mid: '中游', lower: '平民', underdog: '草根'
};

const STORAGE_KEY = 'custom-teams-template';

export default function TeamEditor() {
  const navigate = useNavigate();
  const newGame = useGameStore(s => s.newGame);

  const [teams, setTeams] = useState<TeamBase[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [...defaultTeams];
  });

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return teams.map((t, i) => ({ team: t, idx: i }))
      .filter(({ team }) => !search || team.name.includes(search) || team.shortName.includes(search));
  }, [teams, search]);

  const updateTeam = (idx: number, patch: Partial<TeamBase>) => {
    setTeams(ts => ts.map((t, i) => i === idx ? { ...t, ...patch } : t));
  };

  const saveTemplate = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
      alert('模板已保存到本地');
    } catch {
      alert('保存失败');
    }
  };

  const resetToDefault = () => {
    if (confirm('确定要重置为默认球队吗？所有自定义将丢失。')) {
      setTeams([...defaultTeams]);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(teams, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `football-universe-teams-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          if (Array.isArray(parsed) && parsed.length === 32) {
            setTeams(parsed);
            alert('导入成功');
          } else {
            alert('导入失败：必须是 32 支球队的数组');
          }
        } catch {
          alert('导入失败：JSON 格式错误');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const startGameWithCustom = () => {
    if (teams.length !== 32) {
      alert('必须有正好 32 支球队才能开始');
      return;
    }
    newGame(undefined, { customTeams: teams, gameMode: 'sandbox' });
    navigate('/');
  };

  const startVanilla = () => {
    newGame();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">球队编辑器</h1>
            <p className="text-xs text-slate-500 mt-1">自定义球队属性，使用「沙盒模式」开局</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={resetToDefault} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer">重置默认</button>
            <button onClick={importJson} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer">导入</button>
            <button onClick={exportJson} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer">导出</button>
            <button onClick={saveTemplate} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer">保存模板</button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索球队..."
            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          <span className="text-xs text-slate-500">{teams.length}/32 支球队</span>
        </div>

        {/* Teams list */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-slate-700/60 text-[10px] text-slate-500 font-semibold uppercase">
            <div className="col-span-3">名称 / 简称</div>
            <div className="col-span-2">联赛 / 档次</div>
            <div className="col-span-1 text-center">OVR</div>
            <div className="col-span-1 text-center">攻</div>
            <div className="col-span-1 text-center">中</div>
            <div className="col-span-1 text-center">防</div>
            <div className="col-span-2">地区</div>
            <div className="col-span-1 text-center">颜色</div>
          </div>
          <div className="divide-y divide-slate-800/60 max-h-[60vh] overflow-y-auto">
            {filtered.map(({ team, idx }) => (
              <div key={idx}>
                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center hover:bg-slate-800/30 cursor-pointer"
                  onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}>
                  <div className="col-span-3">
                    <span className="w-2 h-2 inline-block rounded-full mr-1.5" style={{ backgroundColor: team.color }} />
                    <span className="font-medium">{team.name}</span>
                    <span className="text-slate-500 ml-1.5">{team.shortName}</span>
                  </div>
                  <div className="col-span-2 text-slate-400">L{team.initialLeagueLevel} · {TIER_LABELS[team.tier]}</div>
                  <div className="col-span-1 text-center font-bold">{team.overall}</div>
                  <div className="col-span-1 text-center text-slate-400">{team.attack}</div>
                  <div className="col-span-1 text-center text-slate-400">{team.midfield}</div>
                  <div className="col-span-1 text-center text-slate-400">{team.defense}</div>
                  <div className="col-span-2 text-slate-500 text-[10px] truncate">{team.region}</div>
                  <div className="col-span-1 text-center">
                    <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: team.color }} />
                  </div>
                </div>
                {editingIdx === idx && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 py-3 bg-slate-800/40 border-t border-slate-700/40">
                    <Field label="名称" value={team.name} onChange={v => updateTeam(idx, { name: v })} />
                    <Field label="简称" value={team.shortName} onChange={v => updateTeam(idx, { shortName: v })} />
                    <Field label="颜色 (#hex)" value={team.color} onChange={v => updateTeam(idx, { color: v })} />
                    <Field label="地区 (大洲+地区)" value={team.region} onChange={v => updateTeam(idx, { region: v })} />
                    <NumField label="OVR" value={team.overall} onChange={v => updateTeam(idx, { overall: v })} max={99} />
                    <NumField label="攻击" value={team.attack} onChange={v => updateTeam(idx, { attack: v })} max={99} />
                    <NumField label="中场" value={team.midfield} onChange={v => updateTeam(idx, { midfield: v })} max={99} />
                    <NumField label="防守" value={team.defense} onChange={v => updateTeam(idx, { defense: v })} max={99} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 flex-wrap pt-2">
          <button onClick={startVanilla}
            className="flex-1 px-5 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium rounded-xl cursor-pointer transition-colors">
            ← 返回欢迎页（默认开局）
          </button>
          <button onClick={startGameWithCustom}
            className="flex-1 px-5 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl cursor-pointer shadow-lg shadow-blue-900/40">
            🚀 用自定义球队开局
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs focus:outline-none focus:border-blue-500" />
    </div>
  );
}

function NumField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
      <input type="number" value={value} min={1} max={max} onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs focus:outline-none focus:border-blue-500" />
    </div>
  );
}
