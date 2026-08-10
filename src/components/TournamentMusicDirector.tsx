import { useEffect } from 'react';
import { startAmbientMusic, type AmbientMusicScene } from '../feedback/ambient-music';
import { useFeedbackPreferences } from '../feedback/preferences';
import {
  expireTournamentMusicForSeason,
  resetTournamentMusicSession,
  retryTournamentMusicPlayback,
  setTournamentMusicPlaybackStatus,
  useTournamentMusicSession,
} from '../feedback/tournament-music-session';

const DIRECTOR_OWNER = 'tournament-music-director';

/** Keeps the selected tournament soundtrack alive while routed pages come and go. */
export default function TournamentMusicDirector({ seasonNumber }: { seasonNumber: number }) {
  const session = useTournamentMusicSession();
  const preferences = useFeedbackPreferences();
  const scene = session.effectiveScene;
  const requested = session.overrideActive || session.desired;
  const canPlay = Boolean(
    scene
    && requested
    && !session.backgroundHeld
    && preferences.soundEnabled
    && preferences.musicVolume > 0
  );

  useEffect(() => {
    expireTournamentMusicForSeason(seasonNumber);
  }, [seasonNumber]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') return;
      retryTournamentMusicPlayback();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    const handleMusicState = (event: Event) => {
      const detail = (event as CustomEvent<{
        owner: string;
        scene: AmbientMusicScene;
        state: 'started' | 'blocked' | 'stopped' | 'ended';
      }>).detail;
      if (detail.owner !== DIRECTOR_OWNER || detail.state !== 'ended') return;
      setTournamentMusicPlaybackStatus(detail.scene, 'ended');
    };
    window.addEventListener('football-ambient-music', handleMusicState);
    return () => window.removeEventListener('football-ambient-music', handleMusicState);
  }, []);

  useEffect(() => {
    if (!scene || !canPlay) return;

    setTournamentMusicPlaybackStatus(scene, 'starting');
    const lease = startAmbientMusic(scene, DIRECTOR_OWNER, {
      fadeInMs: 360,
      transitionMs: 320,
    });
    let alive = true;
    void lease.started.then(started => {
      if (alive) setTournamentMusicPlaybackStatus(scene, started ? 'playing' : 'blocked');
    });
    return () => {
      alive = false;
      lease.stop(280);
    };
  }, [canPlay, preferences.musicVolume, scene, session.revision]);

  useEffect(() => {
    if (!scene || canPlay || session.status === 'paused' || session.status === 'ended') return;
    setTournamentMusicPlaybackStatus(scene, 'paused');
  }, [canPlay, scene, session.status]);

  useEffect(() => () => resetTournamentMusicSession(), []);

  return null;
}
