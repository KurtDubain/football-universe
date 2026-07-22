import { Link } from 'react-router-dom';
import type { TeamBase } from '../types/team';
import { getTierLabel, getTierColor } from '../utils/format';
import TeamBadge from './TeamBadge';

/**
 * Inline team name display with optional tier badge.
 * Use everywhere a team name appears for consistent styling.
 */
export default function TeamName({
  teamId,
  teamBases,
  showTier = false,
  link = true,
  compact = false,
  badgeSize,
  className = '',
}: {
  teamId: string;
  teamBases: Record<string, TeamBase>;
  showTier?: boolean;
  link?: boolean;
  compact?: boolean;
  badgeSize?: number;
  className?: string;
}) {
  const team = teamBases[teamId];
  if (!team) return <span className={className}>{teamId}</span>;
  const displayName = compact ? team.shortName || team.name : team.name;

  const name = (
    <span className={`inline-flex items-center gap-1 min-w-0 max-w-full ${className}`} title={team.name}>
      {badgeSize ? (
        <TeamBadge teamId={teamId} shortName={team.shortName} color={team.color} size={badgeSize} />
      ) : (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
      )}
      {showTier && (
        <span className={`px-1 py-0.5 text-[11px] font-medium shrink-0 leading-tight ${getTierColor(team.tier)}`}>
          {getTierLabel(team.tier)}
        </span>
      )}
      <span className={compact ? 'whitespace-nowrap' : 'truncate'}>{displayName}</span>
    </span>
  );

  if (link) {
    return <Link to={`/team/${teamId}`} className="hover:text-blue-400 transition-colors">{name}</Link>;
  }
  return name;
}
