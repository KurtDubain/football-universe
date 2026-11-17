/**
 * What to call the place a match is played, or null when it is a club ground.
 *
 * Lives apart from the component so the live header, the calendar and the
 * league card all read the same words, and so the rule can be tested without
 * rendering anything.
 */
export function venueLabel(
  isNeutralVenue?: boolean,
  hostTeamId?: string,
  teamId?: string,
): string | null {
  if (!isNeutralVenue) return null;
  if (hostTeamId && teamId && hostTeamId === teamId) return '东道主 · 中立场';
  return '中立场';
}
