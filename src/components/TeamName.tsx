import { Link } from 'react-router-dom';
import type { TeamBase } from '../types/team';
import { getTierLabel, getTierColor } from '../utils/format';

/**
 * Inline team name display with optional tier badge.
 * Use everywhere a team name appears for consistent styling.
 */
export default function TeamName({
  teamId,
  teamBases,
  showTier = false,
  link = true,
  className = '',
}: {
  teamId: string;
  teamBases: Record<string, TeamBase>;
  showTier?: boolean;
  link?: boolean;
  className?: string;
}) {
  const team = teamBases[teamId];
  if (!team) return <span className={className}>{teamId}</span>;

  const name = (
    <span className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
      {showTier && (
        <span className={`text-[8px] px-1 py-0 rounded font-medium shrink-0 leading-tight ${getTierColor(team.tier)}`}>
          {getTierLabel(team.tier)}
        </span>
      )}
      <span className="truncate">{team.name}</span>
    </span>
  );

  if (link) {
    return <Link to={`/team/${teamId}`} className="hover:text-blue-400 transition-colors">{name}</Link>;
  }
  return name;
}
