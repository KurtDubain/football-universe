import { useEffect, useRef, useState } from 'react';
import type { AmbientMusicScene } from '../feedback/ambient-music';
import { unlockGameAudio } from '../feedback/game-feedback';
import type { TournamentMusicTone } from '../feedback/tournament-music-meta';
import {
  holdTournamentMusic,
  pauseTournamentMusic,
  playTournamentMusic,
  selectTournamentMusic,
  useTournamentMusicSession,
} from '../feedback/tournament-music-session';
import { Icon } from './Icon';

let musicOwnerCounter = 0;

export type { TournamentMusicTone } from '../feedback/tournament-music-meta';

const TONE_CLASSES: Readonly<Record<TournamentMusicTone, string>> = {
  amber: 'border-amber-400/35 bg-amber-950/55 text-amber-100 hover:bg-amber-950/75',
  violet: 'border-violet-400/35 bg-violet-950/55 text-violet-100 hover:bg-violet-950/75',
  orange: 'border-orange-400/35 bg-orange-950/55 text-orange-100 hover:bg-orange-950/75',
  cyan: 'border-cyan-400/35 bg-cyan-950/55 text-cyan-100 hover:bg-cyan-950/75',
  rose: 'border-rose-400/35 bg-rose-950/55 text-rose-100 hover:bg-rose-950/75',
  emerald: 'border-emerald-400/35 bg-emerald-950/55 text-emerald-100 hover:bg-emerald-950/75',
};

export default function TournamentMusicControl({
  scene,
  label,
  tone,
  seasonNumber,
  enabled = true,
  testId = 'tournament-music-toggle',
}: {
  scene: AmbientMusicScene;
  label: string;
  tone: TournamentMusicTone;
  seasonNumber: number;
  enabled?: boolean;
  testId?: string;
}) {
  const session = useTournamentMusicSession();
  const [owner] = useState(() => `tournament-music-${++musicOwnerCounter}`);
  const seasonRef = useRef(seasonNumber);
  seasonRef.current = seasonNumber;

  useEffect(() => {
    selectTournamentMusic(scene, seasonRef.current);
  }, [scene]);

  useEffect(() => {
    if (enabled) return;
    return holdTournamentMusic(owner);
  }, [enabled, owner]);

  const selected = session.scene === scene;
  const playing = selected
    && session.effectiveScene === scene
    && session.status === 'playing'
    && !session.backgroundHeld;
  const starting = selected && session.status === 'starting' && !session.backgroundHeld;
  const shouldPause = selected && session.desired && session.status !== 'blocked' && session.status !== 'ended';

  const toggle = () => {
    unlockGameAudio();
    if (shouldPause) {
      pauseTournamentMusic();
    } else {
      playTournamentMusic(scene, seasonRef.current);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={shouldPause ? `暂停${label}` : `播放${label}`}
      aria-pressed={playing}
      data-testid={testId}
      data-music-scene={scene}
      data-playback-state={selected ? session.status : 'idle'}
      className={`press-scale inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      <Icon name={playing || starting ? 'volume' : shouldPause ? 'pause' : 'play'} size={16} />
      <span className="truncate">
        {playing
          ? `${label}播放中`
          : starting
            ? `${label}载入中`
            : session.backgroundHeld
              ? `${label}暂歇`
              : shouldPause
                ? `${label}已暂停`
                : `播放${label}`}
      </span>
    </button>
  );
}
