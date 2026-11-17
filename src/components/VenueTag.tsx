import { Icon } from './Icon';
import { venueLabel } from './venue-label';

/**
 * Where a match is played, rendered one way everywhere.
 *
 * Five surfaces used to answer this five different ways: a stadium mark and
 * 中立 on the dashboard, bare 中立场 in the match modal, 东道主 · 中立场 in the
 * live header, 中立场 · 预测 → in the calendar, and nothing at all on the
 * league fixture card. That last one is how a neutral promotion playoff kept
 * printing (主) and (客) beside two clubs that were both away from home.
 *
 * `MatchFixture.isNeutralVenue` is the only input, and it is authoritative:
 * the simulator turns home advantage off on exactly the fixtures that carry
 * it, and the save schema refuses a fixture whose flag disagrees with policy.
 */
interface VenueTagProps {
  isNeutralVenue?: boolean;
  /** World Cup host. Buys atmosphere, not a home match. */
  hostTeamId?: string;
  /** The club this tag sits beside, so only the host gets the host wording. */
  teamId?: string;
  /** Rendered when the match is not neutral. Omit to render nothing. */
  fallback?: string;
  /** Show the stadium mark. Off where the tag sits inside a dense text run. */
  icon?: boolean;
  className?: string;
}

export function VenueTag({
  isNeutralVenue,
  hostTeamId,
  teamId,
  fallback,
  icon = false,
  className = '',
}: VenueTagProps) {
  const label = venueLabel(isNeutralVenue, hostTeamId, teamId) ?? fallback ?? null;
  if (!label) return null;
  return (
    <span
      data-testid="venue-tag"
      className={`inline-flex items-center gap-0.5 font-medium text-amber-400 ${className}`}
    >
      {icon && <Icon name="stadium" size={11} />}
      {label}
    </span>
  );
}
