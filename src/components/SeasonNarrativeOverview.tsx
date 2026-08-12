import { Link } from 'react-router-dom';
import type { GameWorld } from '../engine/season/season-manager';
import { buildSeasonNarrativeOverview } from '../engine/observation/narrative-world-scan';
import { Icon } from './Icon';

export default function SeasonNarrativeOverview({
  world,
  primaryTeamId,
  favoritePlayerIds,
}: {
  world: GameWorld;
  primaryTeamId: string | null;
  favoritePlayerIds: readonly string[];
}) {
  const overview = buildSeasonNarrativeOverview(world, primaryTeamId, favoritePlayerIds);
  const hasContent = overview.observedTeam
    || overview.landscapes.length > 0
    || overview.arcs.length > 0
    || overview.watchedPlayers.length > 0;
  if (!hasContent) return null;

  return (
    <section data-testid="season-narrative-overview" className="border-y border-slate-700/60 bg-slate-950/20">
      <div className="flex min-h-11 items-center gap-2 px-3 py-2">
        <Icon name="chart" size={16} className="text-emerald-300" />
        <div>
          <h3 className="text-xs font-bold text-slate-100">赛季版图</h3>
          <p className="text-[10px] text-slate-600">持续趋势，不重复本轮信息</p>
        </div>
      </div>

      <div className="grid border-t border-slate-700/45 md:grid-cols-3 md:divide-x md:divide-slate-700/45">
        <div className="px-3 py-3">
          <h4 className="text-[11px] font-semibold text-slate-400">主要观察</h4>
          {overview.observedTeam ? (
            <Link to={`/team/${overview.observedTeam.teamId}`} className="mt-2 block border-l-2 border-emerald-500/50 pl-2 hover:text-white">
              <div className="text-xs font-semibold text-slate-200">{overview.observedTeam.title}</div>
              <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{overview.observedTeam.detail}</p>
            </Link>
          ) : (
            <p className="mt-2 text-[11px] text-slate-600">设置主要观察球队后显示赛季轨迹。</p>
          )}
          {overview.watchedPlayers.length > 0 && (
            <div className="mt-3 divide-y divide-slate-700/35 border-t border-slate-700/45">
              {overview.watchedPlayers.map(player => (
                <Link key={player.playerId} to={`/player/${player.playerId}`} className="block py-2 hover:text-white">
                  <div className="text-[11px] font-semibold text-amber-300">{player.title}</div>
                  <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{player.detail}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-700/45 px-3 py-3 md:border-t-0">
          <h4 className="text-[11px] font-semibold text-slate-400">争夺格局</h4>
          {overview.landscapes.length > 0 ? (
            <div className="mt-1 divide-y divide-slate-700/35">
              {overview.landscapes.map(landscape => (
                <div key={landscape.id} className="py-2">
                  <div className={`text-[11px] font-semibold ${landscape.kind === 'title' ? 'text-amber-300' : landscape.kind === 'promotion' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {landscape.label}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{landscape.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-600">积分差尚未形成值得持续追踪的格局。</p>
          )}
        </div>

        <div className="border-t border-slate-700/45 px-3 py-3 md:border-t-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-semibold text-slate-400">持续故事</h4>
            <span className="text-[10px] text-slate-600">最多3条</span>
          </div>
          {overview.arcs.length > 0 ? (
            <div className="mt-1 divide-y divide-slate-700/35">
              {overview.arcs.map(arc => (
                <Link key={arc.id} to={`/team/${arc.teamId}`} className="block py-2 hover:text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-emerald-400">{arc.phase}</span>
                    <span className="min-w-0 text-xs font-semibold text-slate-200">{arc.title}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-500">{arc.detail}</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-600">当前没有达到持续故事门槛的球队。</p>
          )}
        </div>
      </div>
    </section>
  );
}
