import { useState } from 'react';
import type { GameWorld } from '../engine/season/season-manager';
import type { MatchFixture } from '../types/match';
import { useGameStore } from '../store/game-store';
import { getTeamCoachId } from '../engine/coaches/coach-lookup';
import { calculateMarketOdds, predictMatch } from '../engine/match/prediction';

export default function BettingPanel({ world, fixtures }: { world: GameWorld; fixtures: MatchFixture[] }) {
  const placeBet = useGameStore(state => state.placeBet);
  const [expanded, setExpanded] = useState(false);
  const coins = world.coins ?? 1000;
  const existingBets = world.bets ?? [];

  if (fixtures.length === 0) return null;
  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)}
        className="w-full min-h-11 bg-slate-800 hover:bg-slate-700 border border-dashed border-amber-700/30 rounded-lg p-2 text-xs text-amber-400/60 hover:text-amber-400 transition-colors cursor-pointer">
        竞猜下注 — {coins} 金币可用 {existingBets.length > 0 ? `· 已下${existingBets.length}注` : ''}
      </button>
    );
  }

  const leagueFixtures = fixtures.filter(fixture => fixture.competitionType === 'league').slice(0, 4);
  const betFixtures = leagueFixtures.length > 0 ? leagueFixtures : fixtures.slice(0, 4);

  return (
    <div className="bg-slate-800 rounded-xl border border-amber-700/30 p-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-amber-400">竞猜下注</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-amber-300 font-medium">{coins} 金币</span>
          <button onClick={() => setExpanded(false)} className="min-w-11 min-h-11 sm:min-h-0 text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">收起</button>
        </div>
      </div>
      <div className="space-y-2">
        {betFixtures.map(fixture => {
          const homeTeam = world.teamBases[fixture.homeTeamId];
          const awayTeam = world.teamBases[fixture.awayTeamId];
          const homeState = world.teamStates[fixture.homeTeamId];
          const awayState = world.teamStates[fixture.awayTeamId];
          if (!homeTeam || !awayTeam || !homeState || !awayState) return null;
          const homeCoachId = getTeamCoachId(world.coachStates, fixture.homeTeamId);
          const awayCoachId = getTeamCoachId(world.coachStates, fixture.awayTeamId);
          const prediction = predictMatch(
            homeTeam,
            awayTeam,
            homeState,
            awayState,
            homeCoachId ? world.coachBases[homeCoachId] ?? null : null,
            awayCoachId ? world.coachBases[awayCoachId] ?? null : null,
            {
              fixture,
              homeSquad: world.squads[fixture.homeTeamId],
              awaySquad: world.squads[fixture.awayTeamId],
              globalWindowIdx: world.totalElapsedWindows,
            },
          );
          const odds = calculateMarketOdds(prediction);
          const existing = existingBets.find(bet => bet.fixtureId === fixture.id);
          return (
            <div key={fixture.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="flex-1 min-w-28 truncate text-slate-300">{homeTeam.shortName} vs {awayTeam.shortName}</span>
              {existing ? (
                <span className="text-[10px] text-amber-400">已押 {existing.outcome === 'home' ? '主胜' : existing.outcome === 'away' ? '客胜' : '平局'} {existing.amount}币 @{existing.odds}</span>
              ) : (
                <div className="flex gap-1">
                  {(['home', 'draw', 'away'] as const).map(outcome => (
                    <button key={outcome} onClick={() => placeBet(fixture.id, outcome, 50, odds[outcome])}
                      disabled={coins < 50}
                      className="min-w-11 min-h-11 sm:min-h-0 px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-slate-300 rounded text-[10px] cursor-pointer transition-colors">
                      {outcome === 'home' ? '主' : outcome === 'away' ? '客' : '平'} {odds[outcome]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] sm:text-[9px] text-slate-600 mt-2">每注50金币 · 赔率基于赛前胜率 · 推进后自动结算</p>
    </div>
  );
}
