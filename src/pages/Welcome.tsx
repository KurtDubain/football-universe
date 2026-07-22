import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import Logo from '../components/Logo';
import { ParticleBackground } from '../components/CanvasEffects';
import { Icon, type IconName } from '../components/Icon';
import { SegmentedControl } from '../components/ui';
import { APP_VERSION } from '../version';
import { defaultTeams } from '../config/teams';
import { GAME_MODES, type GameMode } from '../types/game-mode';
import { consumeSaveRecoveryMessage } from '../store/save-schema';
import {
  getObserverLensOptions,
  RECOMMENDED_EXPERIENCE_SEED,
  type ObserverLens,
} from '../config/observer-experience';

type StartPath = 'recommended' | 'custom';

const LENS_ICONS: Record<ObserverLens, IconName> = {
  giant: 'crown',
  challenger: 'target',
  underdog: 'leaf',
  neutral: 'eye',
};

export default function Welcome() {
  const navigate = useNavigate();
  const newGame = useGameStore(state => state.newGame);
  const setFavoriteTeam = useGameStore(state => state.setFavoriteTeam);
  const lensOptions = useMemo(() => getObserverLensOptions(defaultTeams), []);
  const [startPath, setStartPath] = useState<StartPath>('recommended');
  const [lens, setLens] = useState<ObserverLens>('challenger');
  const [seed, setSeed] = useState('');
  const [favoriteTeam, setFavoriteTeamChoice] = useState('');
  const [mode, setMode] = useState<GameMode>('free');
  const [starting, setStarting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recoveryMessage] = useState(consumeSaveRecoveryMessage);

  const selectedLens = lensOptions.find(option => option.id === lens) ?? lensOptions[0];
  const selectedLensTeam = selectedLens.teamId
    ? defaultTeams.find(team => team.id === selectedLens.teamId)
    : null;

  function handleStart() {
    setStarting(true);
    const selectedTeamId = startPath === 'recommended'
      ? selectedLens.teamId
      : favoriteTeam || null;
    const seedNumber = startPath === 'recommended'
      ? RECOMMENDED_EXPERIENCE_SEED
      : seed.trim() ? Number.parseInt(seed.trim(), 10) : undefined;

    setFavoriteTeam(selectedTeamId);
    newGame(typeof seedNumber === 'number' && Number.isFinite(seedNumber) ? seedNumber : undefined, {
      gameMode: startPath === 'recommended' ? 'free' : mode,
    });
    navigate('/');
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <ParticleBackground />
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size={48} />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black text-slate-50 sm:text-2xl">足球联赛宇宙</h1>
              <p className="text-xs text-slate-500">Football Universe Simulator</p>
            </div>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-slate-600">v{APP_VERSION}</span>
        </header>

        <div className="grid flex-1 items-start gap-6 py-5 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10 lg:py-10">
          <section className="space-y-4 lg:pt-4">
            <div className="inline-flex items-center gap-2 rounded border border-emerald-800/60 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              <Icon name="eye" size={14} />
              上帝视角观察者
            </div>
            <div>
              <h2 className="text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">
                不执教一支球队，见证整个足球世界。
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
                选择一条关注线索，做出赛前判断，然后让球队、球员与王朝在同一种子下自然演化。
              </p>
            </div>
            <div className="hidden grid-cols-3 gap-3 border-t border-slate-800 pt-4 text-xs lg:grid">
              <UniverseFact icon="stadium" value="三级联赛" label="持续升降级" />
              <UniverseFact icon="trophy" value="多项赛事" label="冠军写入历史" />
              <UniverseFact icon="refresh" value="无限赛季" label="同种子可复现" />
            </div>
          </section>

          <section className="rounded-lg border border-slate-700 bg-slate-900/90 p-4 shadow-2xl shadow-black/30 sm:p-5" aria-labelledby="start-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id="start-heading" className="text-base font-bold text-slate-100">开始观察</h2>
                <p className="mt-0.5 text-xs text-slate-500">推荐体验可直接进入，自选宇宙保留完整设置。</p>
              </div>
              <Icon name="ball" size={24} className="text-blue-400" />
            </div>

            <SegmentedControl
              value={startPath}
              onChange={setStartPath}
              ariaLabel="开局方式"
              stretch
              options={[
                { value: 'recommended', label: '推荐体验' },
                { value: 'custom', label: '自选宇宙' },
              ]}
            />

            {recoveryMessage && (
              <div role="alert" className="mt-4 rounded border border-amber-700 bg-amber-950/80 px-3 py-2 text-xs text-amber-100">
                {recoveryMessage}
              </div>
            )}

            {startPath === 'recommended' ? (
              <div className="mt-4 space-y-3" data-testid="recommended-start">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-300">选择观察视角</span>
                  <span className="text-[11px] tabular-nums text-slate-600">种子 {RECOMMENDED_EXPERIENCE_SEED}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {lensOptions.map(option => {
                    const team = option.teamId ? defaultTeams.find(item => item.id === option.teamId) : null;
                    const selected = lens === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setLens(option.id)}
                        className={`min-h-[76px] rounded border p-2.5 text-left transition-colors ${selected
                          ? 'border-blue-500 bg-blue-950/60 text-slate-100'
                          : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-bold">
                          <Icon name={LENS_ICONS[option.id]} size={15} className={selected ? 'text-blue-300' : 'text-slate-500'} />
                          <span>{option.label}</span>
                          {team && <span className="ml-auto truncate text-[11px] font-normal text-slate-500">{team.shortName}</span>}
                        </div>
                        <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="flex min-h-9 items-center gap-2 border-y border-slate-800 py-2 text-xs text-slate-400" aria-live="polite">
                  <Icon name={selectedLensTeam ? 'target' : 'eye'} size={15} className="text-emerald-400" />
                  {selectedLensTeam
                    ? <span>主要观察：<strong className="font-semibold text-slate-200">{selectedLensTeam.name}</strong></span>
                    : <span>纯观察模式：所有球队保持同等信息权重</span>}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4" data-testid="custom-start">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-400" htmlFor="favorite-team">主要观察球队（可选）</label>
                  <select
                    id="favorite-team"
                    value={favoriteTeam}
                    onChange={event => setFavoriteTeamChoice(event.target.value)}
                    className="min-h-11 w-full rounded border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">纯观察，不绑定球队</option>
                    {defaultTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced(value => !value)}
                  aria-expanded={showAdvanced}
                  className="flex min-h-11 w-full items-center justify-between border-y border-slate-800 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  <span>规则与种子</span>
                  <Icon name={showAdvanced ? 'arrow-up' : 'arrow-down'} size={14} />
                </button>

                {showAdvanced && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {GAME_MODES.map(gameMode => (
                        <button
                          key={gameMode.id}
                          type="button"
                          onClick={() => setMode(gameMode.id)}
                          aria-pressed={mode === gameMode.id}
                          className={`rounded border px-2.5 py-2 text-left text-xs ${mode === gameMode.id
                            ? 'border-blue-500 bg-blue-950/60 text-slate-100'
                            : 'border-slate-700 bg-slate-800 text-slate-400'
                          }`}
                        >
                          <span className="font-semibold">{gameMode.label}</span>
                          <span className="mt-1 block text-[11px] leading-snug text-slate-500">{gameMode.description}</span>
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs text-slate-500" htmlFor="universe-seed">随机种子</label>
                      <input
                        id="universe-seed"
                        inputMode="numeric"
                        value={seed}
                        onChange={event => setSeed(event.target.value)}
                        placeholder="留空则自动生成"
                        className="min-h-11 w-full rounded border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={handleStart}
                disabled={starting}
                className="press-scale flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-950/50 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                <Icon name={starting ? 'refresh' : 'play'} size={17} />
                {starting ? '正在构建宇宙...' : '开始观察'}
              </button>
              {startPath === 'custom' && (
                <a href="/team-editor" className="flex min-h-11 items-center justify-center gap-2 text-xs text-slate-500 transition-colors hover:text-slate-300">
                  <Icon name="building" size={14} />
                  自定义球队
                </a>
              )}
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-900 py-3 text-[11px] text-slate-700">
          <span>纯前端 · 离线可玩 · 同种子同宇宙</span>
          <a href="https://github.com/KurtDubain/football-universe" target="_blank" rel="noreferrer" className="hover:text-slate-500">GitHub</a>
        </footer>
      </main>
    </div>
  );
}

function UniverseFact({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-semibold text-slate-300">
        <Icon name={icon} size={14} className="text-blue-400" />
        {value}
      </div>
      <div className="mt-1 text-slate-600">{label}</div>
    </div>
  );
}
