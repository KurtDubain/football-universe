import { Suspense, lazy, useEffect, useMemo } from 'react';
import { playGameFeedback, playUiFeedback } from '../feedback/game-feedback';
import { useGameStore } from '../store/game-store';
import { countCeremonyLines, ceremonyScope, deriveCeremonies } from './ceremony/ceremony-content';
import { ceremonySettle, ceremonyTiming } from './ceremony/ceremony-motion';
import {
  dismissCeremony,
  requestCeremony,
  setCeremonyScope,
  useCeremonySession,
} from './ceremony/ceremony-session';
import { CEREMONY_HOLDS, ceremonyKey, type CeremonyRequest } from './ceremony/ceremony-types';
import { usePrefersReducedMotion } from './ceremony/use-reduced-motion';

/**
 * The overlay is a page of the annual, and most sessions never turn one.
 *
 * Keeping it out of the initial graph is what pays for it: the ceremony
 * stylesheet rides along with the chunk instead of competing for the CSS
 * budget that every screen shares.
 */
const CeremonyOverlay = lazy(() => import('./ceremony/CeremonyOverlay'));

/**
 * The one sound each page is allowed.
 *
 * Existing cues only. A ceremony is a page of the annual, not a new event in
 * the simulation, so it borrows the season cues rather than adding a voice.
 */
const PAGE_SOUND: Readonly<Record<CeremonyRequest['kind'], () => void>> = {
  season_opening: () => playGameFeedback('start'),
  season_closing: () => playGameFeedback('season_champion'),
  cup_stamp: () => playUiFeedback('confirm'),
  world_cup_opening: () => playGameFeedback('start'),
  world_cup_closing: () => playGameFeedback('season_champion'),
};

/**
 * Decides when a page turns.
 *
 * Mounted once, at the shell, so a ceremony can fire from any route. It reads
 * world state and asks the session for what that state has earned; the session
 * is what stops the same page from turning twice.
 *
 * The timing is resolved here rather than inside the overlay, so the lazy
 * chunk needs nothing from the initial graph at runtime.
 */
export default function CeremonyDirector() {
  const world = useGameStore(state => state.world);
  const favoriteTeamIds = useGameStore(state => state.favoriteTeamIds);
  const session = useCeremonySession();
  const reducedMotion = usePrefersReducedMotion();
  const current = session.current;

  useEffect(() => {
    if (!world) return;
    setCeremonyScope(ceremonyScope(world));
  }, [world]);

  useEffect(() => {
    if (!world) return;
    const requests = deriveCeremonies(world, { favoriteTeamIds });
    // One page turns at a time. The rarest holding ceremony leads; stamps,
    // which cost no click, follow it out.
    const holding = requests.find(request => CEREMONY_HOLDS[request.kind]);
    if (holding) requestCeremony(holding);
    for (const request of requests) {
      if (CEREMONY_HOLDS[request.kind]) continue;
      requestCeremony(request);
    }
  }, [favoriteTeamIds, world]);

  useEffect(() => {
    if (!current) return;
    PAGE_SOUND[current.kind]();
  }, [current]);

  const timing = useMemo(
    () => (current ? ceremonyTiming(current.kind, reducedMotion) : null),
    [current, reducedMotion],
  );

  const dismissAfter = useMemo(() => {
    if (!current || !timing || timing.autoDismiss === null) return null;
    return ceremonySettle(timing, countCeremonyLines(current)) + timing.autoDismiss;
  }, [current, timing]);

  if (!current || !timing) return null;

  return (
    <Suspense fallback={null}>
      <CeremonyOverlay
        key={ceremonyKey(current)}
        request={current}
        timing={timing}
        dismissAfter={dismissAfter}
        onDismiss={dismissCeremony}
      />
    </Suspense>
  );
}
