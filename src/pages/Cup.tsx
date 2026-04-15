import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { getTeamName } from '../utils/format';
import type { CupState, SuperCupState, WorldCupState, CupRound, SuperCupGroup, CupFixture } from '../types/cup';
import type { MatchFixture, MatchResult } from '../types/match';
import type { TeamBase } from '../types/team';
import MatchDetailModal from '../components/MatchDetailModal';

export default function Cup() {
  const { type } = useParams<{ type: string }>();
  const world = useGameStore((s) => s.world);
  const [selectedFixture, setSelectedFixture] = useState<MatchFixture | null>(null);
  const [selectedResult, setSelectedResult] = useState<MatchResult | null>(null);

  if (!world) return <div className="text-slate-400">正在加载...</div>;

  const handleCupFixtureClick = (fix: CupFixture, competitionName: string) => {
    const mf: MatchFixture = {
      id: fix.id,
      homeTeamId: fix.homeTeamId,
      awayTeamId: fix.awayTeamId,
      competitionType: type === 'world_cup' ? 'world_cup' : type === 'super_cup' ? 'super_cup' : 'league_cup',
      competitionName,
      roundLabel: fix.roundName,
    };
    setSelectedFixture(mf);
    // Check if we have a stored result for this fixture
    if (fix.result) {
      // Build a minimal MatchResult from CupFixture result
      const mr: MatchResult = {
        fixtureId: fix.id,
        homeTeamId: fix.homeTeamId,
        awayTeamId: fix.awayTeamId,
        homeGoals: fix.result.home,
        awayGoals: fix.result.away,
        extraTime: fix.result.extraTime ?? false,
        penalties: fix.result.penalties ?? false,
        penaltyHome: fix.result.penHome,
        penaltyAway: fix.result.penAway,
        events: [],
        stats: { possession: [50,50], shots: [0,0], shotsOnTarget: [0,0], corners: [0,0], fouls: [0,0], yellowCards: [0,0], redCards: [0,0] },
        competitionType: mf.competitionType,
        competitionName,
        roundLabel: fix.roundName,
      };
      // Try to find the full result from calendar
      for (const win of world.seasonState.calendar) {
        const fullResult = win.results.find(r => r.fixtureId === fix.id);
        if (fullResult) {
          setSelectedResult(fullResult);
          return;
        }
      }
      setSelectedResult(mr);
    } else {
      setSelectedResult(null);
    }
  };

  const closeModal = () => {
    setSelectedFixture(null);
    setSelectedResult(null);
  };

  const teamBases = world.teamBases as Record<string, TeamBase>;

  const renderContent = () => {
    switch (type) {
      case 'league_cup':
        return <LeagueCupView cup={world.leagueCup} teamBases={teamBases} onFixtureClick={(f) => handleCupFixtureClick(f, '联赛杯')} />;
      case 'super_cup':
        return <SuperCupView cup={world.superCup} teamBases={teamBases} onFixtureClick={(f) => handleCupFixtureClick(f, '超级杯')} />;
      case 'world_cup':
        if (!world.worldCup) {
          return <div className="text-center py-12 text-slate-500">本赛季不是环球冠军杯年</div>;
        }
        return <WorldCupView cup={world.worldCup} teamBases={teamBases} onFixtureClick={(f) => handleCupFixtureClick(f, '环球冠军杯')} />;
      default:
        return <div className="text-slate-400">未知赛事</div>;
    }
  };

  return (
    <>
      {renderContent()}
      <MatchDetailModal
        isOpen={!!selectedFixture}
        onClose={closeModal}
        fixture={selectedFixture ?? undefined}
        result={selectedResult ?? undefined}
        world={world}
      />
    </>
  );
}

// ── League Cup ──────────────────────

function LeagueCupView({ cup, teamBases, onFixtureClick }: {
  cup: CupState;
  teamBases: Record<string, TeamBase>;
  onFixtureClick: (f: CupFixture) => void;
}) {
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-slate-100">{cup.name}</h2>
        {cup.completed && cup.winnerId && (
          <span className="text-sm bg-amber-900/60 text-amber-300 px-3 py-1 rounded-full border border-amber-700/50">
            冠军: {getTeamName(cup.winnerId, teamBases)}
          </span>
        )}
      </div>
      <div className="space-y-4">
        {cup.rounds.map((round) => (
          <RoundView key={round.roundNumber} round={round} teamBases={teamBases} onFixtureClick={onFixtureClick} />
        ))}
      </div>
    </div>
  );
}

// ── Super Cup ──────────────────────

function SuperCupView({ cup, teamBases, onFixtureClick }: {
  cup: SuperCupState;
  teamBases: Record<string, TeamBase>;
  onFixtureClick: (f: CupFixture) => void;
}) {
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-slate-100">超级杯</h2>
        {cup.completed && cup.winnerId && (
          <span className="text-sm bg-purple-900/60 text-purple-300 px-3 py-1 rounded-full border border-purple-700/50">
            冠军: {getTeamName(cup.winnerId, teamBases)}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-md font-semibold text-slate-200 mb-3">小组赛</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cup.groups.map((group) => (
            <GroupView key={group.groupName} group={group} teamBases={teamBases} onFixtureClick={onFixtureClick} />
          ))}
        </div>
      </div>
      {cup.knockoutRounds.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-slate-200 mb-3">淘汰赛</h3>
          <div className="space-y-4">
            {cup.knockoutRounds.map((round) => (
              <RoundView key={round.roundNumber} round={round} teamBases={teamBases} onFixtureClick={onFixtureClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── World Cup ──────────────────────

function WorldCupView({ cup, teamBases, onFixtureClick }: {
  cup: WorldCupState;
  teamBases: Record<string, TeamBase>;
  onFixtureClick: (f: CupFixture) => void;
}) {
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-slate-100">环球冠军杯</h2>
        {cup.completed && cup.winnerId && (
          <span className="text-sm bg-sky-900/60 text-sky-300 px-3 py-1 rounded-full border border-sky-700/50">
            冠军: {getTeamName(cup.winnerId, teamBases)}
          </span>
        )}
        <span className="text-xs text-slate-500">{cup.participantIds.length} 队</span>
      </div>
      <div>
        <h3 className="text-md font-semibold text-slate-200 mb-3">小组赛</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cup.groups.map((group) => (
            <GroupView key={group.groupName} group={group} teamBases={teamBases} onFixtureClick={onFixtureClick} />
          ))}
        </div>
      </div>
      {cup.knockoutRounds.length > 0 && (
        <div>
          <h3 className="text-md font-semibold text-slate-200 mb-3">淘汰赛</h3>
          <div className="space-y-4">
            {cup.knockoutRounds.map((round) => (
              <RoundView key={round.roundNumber} round={round} teamBases={teamBases} onFixtureClick={onFixtureClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared ──────────────────────

function GroupView({ group, teamBases, onFixtureClick }: {
  group: SuperCupGroup;
  teamBases: Record<string, TeamBase>;
  onFixtureClick: (f: CupFixture) => void;
}) {
  const [showFixtures, setShowFixtures] = useState(false);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 bg-slate-700/30">
        <h4 className="text-sm font-semibold text-slate-200">{group.groupName} 组</h4>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-400 border-b border-slate-700">
            <th className="text-center px-2 py-1 w-8">#</th>
            <th className="text-left px-2 py-1">球队</th>
            <th className="text-center px-1 py-1">赛</th>
            <th className="text-center px-1 py-1">胜</th>
            <th className="text-center px-1 py-1">平</th>
            <th className="text-center px-1 py-1">负</th>
            <th className="text-center px-1 py-1">净胜</th>
            <th className="text-center px-1 py-1 font-semibold">分</th>
          </tr>
        </thead>
        <tbody>
          {group.standings.map((entry, i) => (
            <tr key={entry.teamId} className={`border-t border-slate-700/50 ${i < 2 ? 'bg-green-900/15' : ''}`}>
              <td className="text-center px-2 py-1.5 text-slate-400">{i + 1}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: teamBases[entry.teamId]?.color ?? '#666' }} />
                  <Link to={`/team/${entry.teamId}`} className="text-slate-200 hover:text-blue-400 text-xs">
                    {getTeamName(entry.teamId, teamBases)}
                  </Link>
                </div>
              </td>
              <td className="text-center px-1 py-1.5 text-slate-400 text-xs">{entry.played}</td>
              <td className="text-center px-1 py-1.5 text-slate-300 text-xs">{entry.won}</td>
              <td className="text-center px-1 py-1.5 text-slate-300 text-xs">{entry.drawn}</td>
              <td className="text-center px-1 py-1.5 text-slate-300 text-xs">{entry.lost}</td>
              <td className="text-center px-1 py-1.5 text-slate-300 text-xs">
                {entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference}
              </td>
              <td className="text-center px-1 py-1.5 font-bold text-slate-100 text-xs">{entry.points}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {group.fixtures.length > 0 && (
        <div className="border-t border-slate-700">
          <button
            onClick={() => setShowFixtures(!showFixtures)}
            className="w-full px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 cursor-pointer transition-colors"
          >
            {showFixtures ? '隐藏赛程 ▲' : `查看赛程 (${group.fixtures.length}场) ▼`}
          </button>
          {showFixtures && (
            <div className="p-2 space-y-0.5">
              {group.fixtures.map((fix) => (
                <FixtureRow key={fix.id} fixture={fix} teamBases={teamBases} onClick={() => onFixtureClick(fix)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RoundView({ round, teamBases, onFixtureClick }: {
  round: CupRound;
  teamBases: Record<string, TeamBase>;
  onFixtureClick: (f: CupFixture) => void;
}) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="px-4 py-2.5 border-b border-slate-700 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-200">{round.roundName}</h4>
        {round.completed ? (
          <span className="text-xs text-green-400">已完成</span>
        ) : (
          <span className="text-xs text-slate-500">{round.fixtures.length}场</span>
        )}
      </div>
      <div className="p-2 space-y-1">
        {round.fixtures.map((fix) => (
          <FixtureRow key={fix.id} fixture={fix} teamBases={teamBases} onClick={() => onFixtureClick(fix)} />
        ))}
      </div>
    </div>
  );
}

function FixtureRow({ fixture, teamBases, onClick }: {
  fixture: CupFixture;
  teamBases: Record<string, TeamBase>;
  onClick: () => void;
}) {
  const hasResult = !!fixture.result;
  const isWinnerHome = fixture.winnerId === fixture.homeTeamId;
  const isWinnerAway = fixture.winnerId === fixture.awayTeamId;
  const homeTeam = teamBases[fixture.homeTeamId];
  const awayTeam = teamBases[fixture.awayTeamId];

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center text-sm py-2 px-3 rounded-lg hover:bg-slate-700/40 cursor-pointer transition-colors text-left"
    >
      <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: homeTeam?.color ?? '#666' }} />
        <span className={`truncate ${isWinnerHome ? 'text-green-400 font-semibold' : 'text-slate-200'}`}>
          {getTeamName(fixture.homeTeamId, teamBases)}
        </span>
      </div>
      {hasResult ? (
        <div className="flex items-center gap-1 px-3 shrink-0">
          <span className="font-bold text-slate-100">
            {fixture.result!.home} - {fixture.result!.away}
          </span>
          {fixture.result!.penalties && (
            <span className="text-[10px] text-amber-400">(P {fixture.result!.penHome}-{fixture.result!.penAway})</span>
          )}
          {fixture.result!.extraTime && !fixture.result!.penalties && (
            <span className="text-[10px] text-amber-400">(ET)</span>
          )}
        </div>
      ) : (
        <span className="text-slate-500 px-3 shrink-0 text-xs">VS</span>
      )}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: awayTeam?.color ?? '#666' }} />
        <span className={`truncate ${isWinnerAway ? 'text-green-400 font-semibold' : 'text-slate-200'}`}>
          {getTeamName(fixture.awayTeamId, teamBases)}
        </span>
      </div>
      <span className="text-[10px] text-slate-600 ml-1 shrink-0">{hasResult ? '详情' : '预测'} →</span>
    </button>
  );
}
