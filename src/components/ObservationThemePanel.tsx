import { Link } from 'react-router-dom';
import {
  buildObservationTheme,
  OBSERVATION_THEME_OPTIONS,
  type ObservationThemePreference,
} from '../engine/observation/observation-theme';
import type { GameWorld } from '../engine/season/season-manager';
import { Icon, type IconName } from './Icon';

const THEME_ICONS: Record<Exclude<ObservationThemePreference, 'auto' | 'disabled'>, IconName> = {
  giant_defense: 'crown',
  dark_horse_challenge: 'trend-up',
  promotion_survival: 'shield',
  player_growth: 'star-glow',
  pure_observation: 'eye',
};

export default function ObservationThemePanel({
  world,
  primaryTeamId,
  preference,
  onPreferenceChange,
}: {
  world: GameWorld;
  primaryTeamId: string | null;
  preference: ObservationThemePreference;
  onPreferenceChange: (preference: ObservationThemePreference) => void;
}) {
  const theme = buildObservationTheme(world, primaryTeamId, preference);

  return (
    <section
      data-testid="observation-theme"
      className="overflow-hidden rounded-lg border border-emerald-800/50 bg-slate-900/55"
    >
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-700/60 px-3 py-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-emerald-300">
          <Icon name={theme ? THEME_ICONS[theme.type] : 'eye'} size={15} />
          <span>本赛季观察主题</span>
        </h3>
        <select
          aria-label="选择本赛季观察主题"
          value={preference}
          onChange={event => onPreferenceChange(event.target.value as ObservationThemePreference)}
          className="min-h-9 max-w-32 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 focus:border-emerald-600 focus:outline-none sm:max-w-none"
        >
          {OBSERVATION_THEME_OPTIONS.map(option => (
            <option
              key={option.value}
              value={option.value}
              disabled={!primaryTeamId && !['auto', 'pure_observation', 'disabled'].includes(option.value)}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {theme ? (
        <div className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {theme.playerId ? (
              <Link to={`/player/${theme.playerId}`} className="text-sm font-semibold text-slate-100 hover:text-emerald-300">
                {theme.title}
              </Link>
            ) : theme.teamId ? (
              <Link to={`/team/${theme.teamId}`} className="text-sm font-semibold text-slate-100 hover:text-emerald-300">
                {theme.title}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-slate-100">{theme.title}</span>
            )}
            <span className="text-[11px] text-emerald-400">{theme.label}</span>
            <span className="ml-auto text-[11px] tabular-nums text-slate-500">
              {theme.seasonPhase} · {theme.played}/{theme.totalMatches}轮
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{theme.summary}</p>

          <div className="mt-2 h-1 overflow-hidden rounded bg-slate-800" aria-label={`赛季进度 ${Math.round(theme.progress * 100)}%`}>
            <div
              className="h-full rounded bg-emerald-500 transition-[width] motion-reduce:transition-none"
              style={{ width: `${Math.round(theme.progress * 100)}%` }}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {theme.evidence.map(item => <span key={item}>{item}</span>)}
          </div>
          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-300">
            <Icon name="target" size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <span>下一观察：{theme.nextWatch}</span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2.5 text-xs text-slate-500">
          主题已关闭；比赛、故事与历史仍按同一规则继续演化。
        </div>
      )}
    </section>
  );
}
