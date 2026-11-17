import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { leagueBedScene, shouldYieldToLeagueBed } from '../feedback/league-music-context';
import {
  clearTournamentMusic,
  idlePauseTournamentMusic,
  retryTournamentMusicPlayback,
  selectTournamentMusic,
  useTournamentMusicSession,
  wakeTournamentMusic,
} from '../feedback/tournament-music-session';
import { useGameStore } from '../store/game-store';

/**
 * Ten minutes.
 *
 * Long enough that reading a league table, comparing two players and writing
 * a note all count as being present. A bed that gives up after ninety seconds
 * is not a bed, it is a timer.
 */
const IDLE_MS = 10 * 60 * 1000;
const IDLE_POLL_MS = 30_000;

/**
 * Keeps the league bed on the season desk and nowhere else.
 *
 * Selection is driven by the calendar rather than the URL: a cup window means
 * a cup theme is the honest soundtrack, whatever route the viewer is on. The
 * bed is also the only scene that fades itself out — every other track is
 * tied to something happening, and this one is not.
 */
export default function LeagueMusicDirector() {
  const world = useGameStore(state => state.world);
  const location = useLocation();
  const session = useTournamentMusicSession();
  // Zero until the first effect runs; an idle clock that starts at the epoch
  // would decide the viewer had been silent since 1970.
  const lastActivityRef = useRef(0);
  const seasonNumber = world?.seasonState.seasonNumber ?? 1;
  const bedScene = world ? leagueBedScene(world, location.pathname) : null;
  const yieldToBed = world
    ? shouldYieldToLeagueBed(world, location.pathname, session.scene)
    : false;

  // Advancing the season is the loudest thing a viewer can do.
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [world]);

  useEffect(() => {
    if (!world) return;
    if (yieldToBed) {
      clearTournamentMusic();
      return;
    }
    if (!bedScene) {
      if (session.scene === 'league_season') clearTournamentMusic();
      return;
    }
    if (session.scene === null || session.scene === bedScene) {
      selectTournamentMusic(bedScene, seasonNumber);
    }
  }, [bedScene, seasonNumber, session.scene, world, yieldToBed]);

  // Browsers refuse to start audio before a gesture, so take the first one.
  useEffect(() => {
    if (session.scene !== 'league_season') return;
    const retry = () => retryTournamentMusicPlayback();
    window.addEventListener('pointerdown', retry, { once: true });
    window.addEventListener('keydown', retry, { once: true });
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
    };
  }, [session.scene]);

  // Listening for activity has to outlive the idle pause itself, otherwise
  // fading out would also remove the only thing that can bring the bed back.
  useEffect(() => {
    if (session.scene !== 'league_season') return;
    const markActivity = () => {
      lastActivityRef.current = Date.now();
      wakeTournamentMusic();
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const name of events) {
      window.addEventListener(name, markActivity, { passive: true });
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_MS) idlePauseTournamentMusic();
    }, IDLE_POLL_MS);
    return () => {
      for (const name of events) window.removeEventListener(name, markActivity);
      window.clearInterval(timer);
    };
  }, [session.scene]);

  return null;
}
