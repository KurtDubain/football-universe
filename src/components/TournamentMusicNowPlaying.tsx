import { useLocation } from 'react-router-dom';
import { unlockGameAudio } from '../feedback/game-feedback';
import { TOURNAMENT_MUSIC_META, type TournamentMusicTone } from '../feedback/tournament-music-meta';
import {
  clearTournamentMusic,
  pauseTournamentMusic,
  playTournamentMusic,
  useTournamentMusicSession,
} from '../feedback/tournament-music-session';
import { Icon } from './Icon';

const TONE_CLASSES: Readonly<Record<TournamentMusicTone, string>> = {
  amber: 'border-amber-500/35 bg-amber-950/55 text-amber-100',
  violet: 'border-violet-500/35 bg-violet-950/55 text-violet-100',
  orange: 'border-orange-500/35 bg-orange-950/55 text-orange-100',
  cyan: 'border-cyan-500/35 bg-cyan-950/55 text-cyan-100',
  rose: 'border-rose-500/35 bg-rose-950/55 text-rose-100',
  emerald: 'border-emerald-500/35 bg-emerald-950/55 text-emerald-100',
};

const OWNER_ROUTES = {
  league_cup: '/cup/league_cup',
  super_cup: '/cup/super_cup',
  mainland_cup: '/cup/mainland_cup',
  southern_cup: '/cup/southern_cup',
  eastern_cup: '/cup/eastern_cup',
  world_cup: '/cup/world_cup',
  world_cup_final: '/cup/world_cup',
  world_cup_champion: '/cup/world_cup',
} as const;

function playbackLabel(
  status: ReturnType<typeof useTournamentMusicSession>['status'],
  backgroundHeld: boolean,
  overrideActive: boolean,
): string {
  if (overrideActive) return '直播音乐接管';
  if (backgroundHeld) return '比赛期间暂歇';
  if (status === 'playing') return '正在播放';
  if (status === 'starting') return '正在切换';
  if (status === 'blocked') return '等待播放';
  if (status === 'ended') return '播放完毕';
  return '已暂停';
}

export default function TournamentMusicNowPlaying() {
  const location = useLocation();
  const session = useTournamentMusicSession();
  if (!session.scene) return null;
  if (location.pathname === OWNER_ROUTES[session.scene]) return null;

  const baseMeta = TOURNAMENT_MUSIC_META[session.scene];
  const effectiveMeta = session.effectiveScene ? TOURNAMENT_MUSIC_META[session.effectiveScene] : baseMeta;
  const statusLabel = playbackLabel(session.status, session.backgroundHeld, session.overrideActive);
  const retryable = session.status === 'blocked' || session.status === 'ended';
  const shouldPause = session.desired && !retryable;
  const toggle = () => {
    unlockGameAudio();
    if (shouldPause) {
      pauseTournamentMusic();
    } else {
      playTournamentMusic(session.scene!, session.originSeason ?? undefined);
    }
  };

  return (
    <div
      data-testid="tournament-music-now-playing"
      data-music-scene={session.scene}
      data-playback-state={session.status}
      className={`min-h-11 shrink-0 border-b ${TONE_CLASSES[baseMeta.tone]}`}
    >
      <div className="flex min-h-11 w-full items-center gap-2 px-3 sm:px-5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full bg-current ${session.status === 'playing' ? 'animate-pulse motion-reduce:animate-none' : 'opacity-45'}`}
        />
        <Icon name="volume" size={15} className="shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {statusLabel} · {session.overrideActive ? effectiveMeta.label : baseMeta.label}
        </span>
        <button
          type="button"
          data-testid="tournament-music-global-toggle"
          onClick={toggle}
          disabled={session.overrideActive}
          aria-label={shouldPause ? `暂停${baseMeta.label}` : `播放${baseMeta.label}`}
          aria-pressed={session.status === 'playing' && !session.backgroundHeld}
          title={session.overrideActive ? '直播中请使用比赛声音控制' : shouldPause ? `暂停${baseMeta.label}` : `播放${baseMeta.label}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-current transition-colors hover:bg-white/10 disabled:cursor-default disabled:opacity-50"
        >
          <Icon name={shouldPause ? 'pause' : 'play'} size={16} />
        </button>
        <button
          type="button"
          data-testid="tournament-music-global-close"
          onClick={clearTournamentMusic}
          aria-label="关闭赛事音乐"
          title="关闭赛事音乐"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-current opacity-75 transition-colors hover:bg-white/10 hover:opacity-100"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
