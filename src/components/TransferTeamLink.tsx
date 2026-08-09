import { Link } from 'react-router-dom';
import { FREE_MARKET_TEAM_ID } from '../engine/transfers/transfer-application';

interface TransferTeamLinkProps {
  teamId: string;
  teamName: string;
  shortName?: string;
  className?: string;
}

export default function TransferTeamLink({
  teamId,
  teamName,
  shortName,
  className,
}: TransferTeamLinkProps) {
  const label = teamId === FREE_MARKET_TEAM_ID ? '自由市场' : shortName ?? teamName;
  if (teamId === FREE_MARKET_TEAM_ID) {
    return (
      <span data-testid="free-market-endpoint" className={className} title="自由市场">
        {label}
      </span>
    );
  }

  return (
    <Link to={`/team/${teamId}`} className={className} title={teamName}>
      {label}
    </Link>
  );
}
