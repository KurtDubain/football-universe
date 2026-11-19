import type { ContinentalCupState, CupFixture } from '../../types/cup';
import type { MatchFixture } from '../../types/match';
import type { CalendarWindow } from '../../types/season';
import { applyVenuePolicy } from '../competitions/venue-policy';

/** The three regional cups, as stored on `GameWorld.continentalCups`. */
export interface ContinentalCupRegistry {
  mainland_cup: ContinentalCupState | null;
  southern_cup: ContinentalCupState | null;
  eastern_cup: ContinentalCupState | null;
}

const REGISTRY_KEYS = ['mainland_cup', 'southern_cup', 'eastern_cup'] as const;

/**
 * The fixtures a cup will play in its current round.
 *
 * This lives apart from the cup engine on purpose: a reader that only needs to
 * know what is being played — the save loader, the matchday view — must not
 * pull the draw and the advancement machinery into the first-paint bundle.
 */
export function getContinentalCupCurrentFixtures(cup: ContinentalCupState): CupFixture[] {
  if (!cup.groupStageCompleted) {
    for (let round = 1; round <= 3; round++) {
      const fixtures = cup.groups.flatMap(group =>
        group.fixtures.filter(fixture => fixture.round === round),
      );
      if (fixtures.some(fixture => !fixture.result)) return fixtures;
    }
    return [];
  }
  const round = cup.rounds.find(item => item.roundNumber === cup.currentRound);
  return round?.fixtures ?? [];
}

/**
 * The fixtures every still-active continental cup will play in its current
 * round, flattened into one neutral-venue match list.
 *
 * Completed cups are skipped: a finished cup leaves `currentRound` pointing at
 * its final round, so its already-played fixtures would otherwise be offered
 * again.
 */
export function collectContinentalCupMatchFixtures(
  cups: ContinentalCupRegistry | undefined,
): MatchFixture[] {
  if (!cups) return [];
  const matchFixtures: MatchFixture[] = [];
  for (const key of REGISTRY_KEYS) {
    const cup = cups[key];
    if (!cup || cup.completed) continue;
    for (const fixture of getContinentalCupCurrentFixtures(cup)) {
      matchFixtures.push(applyVenuePolicy({
        id: fixture.id,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        competitionType: 'continental_cup',
        competitionName: cup.name,
        roundLabel: fixture.roundName,
      }));
    }
  }
  return matchFixtures;
}

/**
 * Fill the next unplayed continental window with the fixtures it will play.
 *
 * The calendar only reserves continental slots — pairings are drawn from cup
 * state as rounds settle — so an unfilled window reads as an empty stage: the
 * dashboard reports "本阶段无比赛安排", the calendar shows no fixture count,
 * and no focus match can be locked for the broadcast. Every other cup handler
 * pre-fills its next window for the same reason; this keeps the continental
 * windows consistent with them.
 *
 * Simulation reads its fixtures from cup state and never from the window, so
 * pre-filling is display-only and leaves every seeded result unchanged.
 *
 * Windows advance in id order, so the first incomplete continental window is
 * always the next one to be played. Pass `afterWindowId` to exclude the window
 * just played, or -1 to fill the first unplayed window of a fresh calendar.
 */
export function prefillContinentalCupWindow(
  calendar: CalendarWindow[],
  cups: ContinentalCupRegistry | undefined,
  afterWindowId: number,
): void {
  const nextWindow = calendar.find(window =>
    window.type === 'continental_cup'
    && !window.completed
    && window.id > afterWindowId
    && window.fixtures.length === 0,
  );
  if (!nextWindow) return;
  const fixtures = collectContinentalCupMatchFixtures(cups);
  if (fixtures.length > 0) nextWindow.fixtures = fixtures;
}
