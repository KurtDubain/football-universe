import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import Logo from '../components/Logo';
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
import type { ObservationThemePreference } from '../engine/observation/observation-theme';
import { playGameFeedback } from '../feedback/game-feedback';
import welcomeUniverseArtwork from '../assets/visual/welcome-annual-v2.webp';
import { DecorativeImage } from '../components/DecorativeImage';

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
  const lensOptions = useMemo(() => getObserverLensOptions(defaultTeams), []);
  const [startPath, setStartPath] = useState<StartPath>('recommended');
  const [lens, setLens] = useState<ObserverLens>('challenger');
  const [seed, setSeed] = useState('');
  const [favoriteTeam, setFavoriteTeamChoice] = useState('');
  const [mode, setMode] = useState<GameMode>('free');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recoveryMessage] = useState(consumeSaveRecoveryMessage);

  const selectedLens = lensOptions.find(option => option.id === lens) ?? lensOptions[0];
  const selectedLensTeam = selectedLens.teamId
    ? defaultTeams.find(team => team.id === selectedLens.teamId)
    : null;

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

    const selectedTeamId = startPath === 'recommended'
      ? selectedLens.teamId
      : favoriteTeam || null;
    const seedNumber = startPath === 'recommended'
      ? RECOMMENDED_EXPERIENCE_SEED
      : seed.trim() ? Number.parseInt(seed.trim(), 10) : undefined;

    const recommendedTheme: Record<ObserverLens, ObservationThemePreference> = {
      giant: 'giant_defense',
      challenger: 'dark_horse_challenge',
      underdog: 'promotion_survival',
      neutral: 'pure_observation',
    };
    try {
      playGameFeedback('start');
      await newGame(typeof seedNumber === 'number' && Number.isFinite(seedNumber) ? seedNumber : undefined, {
        gameMode: startPath === 'recommended' ? 'free' : mode,
        favoriteTeamIds: selectedTeamId ? [selectedTeamId] : [],
        observationThemePreference: startPath === 'recommended' ? recommendedTheme[lens] : 'auto',
      });
      navigate('/');
    } catch (error) {
      console.error('[welcome] Failed to initialize game world.', error);
      setStarting(false);
      setStartError(error instanceof Error
        ? `宇宙初始化失败：${error.message}`
        : '宇宙初始化失败，请重试或刷新应用。');
    }
  }

  return (
    <div className="welcome-stage relative min-h-screen overflow-x-hidden text-slate-100" data-art-direction="football-annual">
      <DecorativeImage
        src={welcomeUniverseArtwork}
        eager
        testId="welcome-universe-art"
        className="welcome-universe-art absolute inset-0 h-full w-full object-cover"
      />
      <div className="welcome-art-shade absolute inset-0" aria-hidden="true" />
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-8 sm:py-6">
        <header className="welcome-masthead flex items-center justify-between gap-4 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size={44} />
            <div className="min-w-0">
              <p className="welcome-masthead-label">FOOTBALL UNIVERSE</p>
              <p className="welcome-masthead-subtitle">赛季观察档案</p>
            </div>
          </div>
          <div className="welcome-issue-index" aria-label={`版本 ${APP_VERSION}`}>
            <span>ISSUE</span>
            <strong>{APP_VERSION}</strong>
          </div>
        </header>

        <div className="grid flex-1 items-start gap-5 py-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(25rem,1.1fr)] lg:gap-12 lg:py-8">
          <section className="welcome-editorial-copy space-y-4 lg:pt-5">
            <div className="welcome-kicker inline-flex items-center gap-2 text-xs font-semibold text-emerald-200">
              <Icon name="eye" size={14} />
              上帝视角 · 长期演化
            </div>
            <div>
              <h1 className="welcome-title max-w-xl text-3xl font-black leading-none text-[#f3efe2] sm:text-5xl" title="足球联赛宇宙">
                足球联赛宇宙
              </h1>
              <h2 className="welcome-tagline mt-3 max-w-xl text-xl font-bold leading-tight text-slate-100 sm:text-2xl">
                不执教一支球队，见证整个足球世界。
              </h2>
              <p className="welcome-intro mt-3 max-w-lg text-sm leading-relaxed text-slate-300">
                选择一条关注线索，做出赛前判断，然后让球队、球员与王朝在同一种子下自然演化。
              </p>
            </div>
            <div className="welcome-fact-rail hidden grid-cols-3 gap-3 pt-4 text-xs lg:grid">
              <UniverseFact icon="stadium" value="三级联赛" label="持续升降级" />
              <UniverseFact icon="trophy" value="多项赛事" label="冠军写入历史" />
              <UniverseFact icon="refresh" value="无限赛季" label="同种子可复现" />
            </div>
          </section>

          <section className="welcome-start-panel border border-white/15 p-4 shadow-2xl shadow-black/40 sm:p-5" aria-labelledby="start-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="welcome-panel-index">01 / NEW UNIVERSE</div>
                <h2 id="start-heading" className="mt-1 text-base font-bold text-slate-100">开始观察</h2>
                <p className="welcome-panel-description mt-0.5 text-xs text-slate-500">推荐体验可直接进入，自选宇宙保留完整设置。</p>
              </div>
              <Icon name="ball" size={24} className="text-amber-300" />
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
                        className={`welcome-lens-option min-h-[76px] rounded border p-2.5 text-left transition-colors ${selected
                          ? 'border-emerald-500 bg-emerald-950/70 text-slate-100'
                          : 'border-slate-700 bg-slate-900/65 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-bold">
                          <Icon name={LENS_ICONS[option.id]} size={15} className={selected ? 'text-emerald-300' : 'text-slate-500'} />
                          <span>{option.label}</span>
                          {team && <span className="ml-auto truncate text-[11px] font-normal text-slate-500" title={team.name}>{team.shortName}</span>}
                        </div>
                        <p className="welcome-lens-description mt-1.5 text-[11px] leading-snug text-slate-500">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="welcome-selected-lens flex min-h-9 items-center gap-2 border-y border-slate-800 py-2 text-xs text-slate-400" aria-live="polite">
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
                            ? 'border-emerald-500 bg-emerald-950/70 text-slate-100'
                            : 'border-slate-700 bg-slate-900/70 text-slate-400'
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
                    className="min-h-11 w-full rounded border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {startError && (
                <div role="alert" className="rounded border border-red-800/70 bg-red-950/65 px-3 py-2 text-xs leading-5 text-red-100">
                  {startError} 当前设置和已有存档均未被清除。
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={starting}
                className="press-scale flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-black/30 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
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

        <footer className="welcome-footer flex flex-wrap items-center justify-between gap-2 py-3 text-[11px] text-slate-400">
          <span>纯前端 · 离线可玩 · 同种子同宇宙</span>
          <a href="https://github.com/KurtDubain/football-universe" target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-slate-500 sm:min-h-0">GitHub</a>
        </footer>
      </main>
    </div>
  );
}

function UniverseFact({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-semibold text-slate-300">
        <Icon name={icon} size={14} className="text-amber-300" />
        {value}
      </div>
      <div className="mt-1 text-slate-400">{label}</div>
    </div>
  );
}
