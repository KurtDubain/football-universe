/**
 * Regression test for the WC prize money bug.
 *
 * Bug: At the season_end window in WC years, world.worldCup.winnerId is
 * still unset (the WC tail hasn't played yet) — applyIncome silently
 * paid €0 to nobody. Then initializeNewSeason nulled worldCup, so the
 * winner was never paid.
 *
 * Fix: finalizeWorldCup (which runs after the WC final, before
 * initializeNewSeason) pays cash directly + patches the just-archived
 * FinanceSeasonRecord so the breakdown shows the prize.
 *
 * This test mocks a minimal world post-WC-final and verifies all the
 * expected prize payments happen.
 */
import { describe, it, expect } from 'vitest';
import { finalizeWorldCup } from './season-end';
import { CUP_PRIZE } from '../economy/finance';
import type { GameWorld } from './season-manager';

function mkBaseWorld(): GameWorld {
  // Minimal world — only what finalizeWorldCup touches.
  // Cast through `unknown` because the full GameWorld type has many
  // fields irrelevant to this regression test (squad, stats, etc.).
  return {
    seasonState: {
      seasonNumber: 17,
      currentWindowIndex: 50,
      worldCupPhase: true,
      calendar: [],
      completed: true,
    },
    teamBases: {
      WIN: { id: 'WIN', name: 'Winner FC', shortName: 'WIN', color: '#fff', overall: 90, attack: 90, midfield: 88, defense: 89, reputation: 90 },
      RU:  { id: 'RU',  name: 'RunnerUp FC', shortName: 'RU', color: '#000', overall: 88, attack: 88, midfield: 86, defense: 87, reputation: 85 },
      S1:  { id: 'S1',  name: 'Semi1 FC', shortName: 'S1', color: '#aaa', overall: 85, attack: 85, midfield: 84, defense: 84, reputation: 80 },
      S2:  { id: 'S2',  name: 'Semi2 FC', shortName: 'S2', color: '#bbb', overall: 84, attack: 84, midfield: 83, defense: 83, reputation: 78 },
    },
    teamStates: {
      WIN: { id: 'WIN', leagueLevel: 1, recentForm: [], coachPressure: 0 },
      RU:  { id: 'RU',  leagueLevel: 1, recentForm: [], coachPressure: 0 },
      S1:  { id: 'S1',  leagueLevel: 1, recentForm: [], coachPressure: 0 },
      S2:  { id: 'S2',  leagueLevel: 1, recentForm: [], coachPressure: 0 },
    },
    coachStates: {},
    coachTrophies: {},
    teamTrophies: {},
    teamSeasonRecords: {},
    honorHistory: [{ seasonNumber: 17, league1Champion: 'OTHER', league2Champion: 'X', league3Champion: 'Y', leagueCupWinner: 'Z', superCupWinner: 'A', worldCupWinner: undefined, promoted: [], relegated: [] }],
    newsLog: [],
    teamFinances: {
      WIN: { cash: 100, totalIncome: 0, totalExpense: 0, history: [{ season: 17, startCash: 150, endCash: 100, prizeMoney: 80, tvSponsor: 40, transferIncome: 0, salaries: 70, transferExpense: 0 }] },
      RU:  { cash: 80,  totalIncome: 0, totalExpense: 0, history: [{ season: 17, startCash: 150, endCash: 80,  prizeMoney: 50, tvSponsor: 40, transferIncome: 0, salaries: 60, transferExpense: 0 }] },
      S1:  { cash: 60,  totalIncome: 0, totalExpense: 0, history: [{ season: 17, startCash: 80,  endCash: 60,  prizeMoney: 30, tvSponsor: 40, transferIncome: 0, salaries: 50, transferExpense: 0 }] },
      S2:  { cash: 50,  totalIncome: 0, totalExpense: 0, history: [{ season: 17, startCash: 80,  endCash: 50,  prizeMoney: 20, tvSponsor: 40, transferIncome: 0, salaries: 50, transferExpense: 0 }] },
    },
    worldCup: {
      groups: [],
      knockoutRounds: [
        { fixtures: [
          { id: 'sf1', round: 3, roundName: '半决赛', homeTeamId: 'WIN', awayTeamId: 'S1', winnerId: 'WIN' },
          { id: 'sf2', round: 3, roundName: '半决赛', homeTeamId: 'RU',  awayTeamId: 'S2', winnerId: 'RU'  },
        ] },
        { fixtures: [
          { id: 'final', round: 4, roundName: '决赛', homeTeamId: 'WIN', awayTeamId: 'RU', winnerId: 'WIN' },
        ] },
      ],
      groupStageCompleted: true,
      completed: true,
      winnerId: 'WIN',
      participantIds: ['WIN', 'RU', 'S1', 'S2'],
    },
  } as unknown as GameWorld;
}

describe('finalizeWorldCup — prize money payout (Phase H regression)', () => {
  it('pays winner / runner-up / semi prizes to teamFinances cash', () => {
    const world = mkBaseWorld();
    const result = finalizeWorldCup(world);
    expect(result.teamFinances.WIN.cash).toBe(100 + CUP_PRIZE.world_cup_winner);   // 100 + 30 = 130
    expect(result.teamFinances.RU.cash).toBe(80 + CUP_PRIZE.world_cup_runner_up);   // 80 + 15 = 95
    expect(result.teamFinances.S1.cash).toBe(60 + CUP_PRIZE.world_cup_semi);        // 60 + 5 = 65
    expect(result.teamFinances.S2.cash).toBe(50 + CUP_PRIZE.world_cup_semi);        // 50 + 5 = 55
  });

  it('patches the just-archived FinanceSeasonRecord (history.tail) so breakdown shows WC prize', () => {
    const world = mkBaseWorld();
    const result = finalizeWorldCup(world);
    const winHist = result.teamFinances.WIN.history;
    const tail = winHist[winHist.length - 1];
    expect(tail.season).toBe(17);
    expect(tail.prizeMoney).toBe(80 + CUP_PRIZE.world_cup_winner);  // was 80 + WC bonus
    expect(tail.endCash).toBe(100 + CUP_PRIZE.world_cup_winner);     // endCash bumped
    // Other archived fields unchanged
    expect(tail.tvSponsor).toBe(40);
    expect(tail.salaries).toBe(70);
    expect(tail.startCash).toBe(150);
  });

  it('emits a prize_money news entry per recipient', () => {
    const world = mkBaseWorld();
    const result = finalizeWorldCup(world);
    const wcNews = result.newsLog.filter(n => n.id?.includes('wc-prize'));
    expect(wcNews.length).toBe(4); // winner + RU + 2 semi
    const winnerNews = wcNews.find(n => n.title?.includes('Winner FC'));
    expect(winnerNews).toBeDefined();
    expect(winnerNews?.type).toBe('prize_money');
    expect(winnerNews?.title).toContain('冠军');
  });

  it('still patches honorHistory + teamTrophies as before', () => {
    const world = mkBaseWorld();
    const result = finalizeWorldCup(world);
    expect(result.honorHistory[0].worldCupWinner).toBe('WIN');
    expect(result.teamTrophies.WIN).toEqual([{ type: 'world_cup', seasonNumber: 17 }]);
  });

  it('handles a degenerate WC with no winnerId (does NOT pay)', () => {
    const world = mkBaseWorld();
    world.worldCup!.winnerId = undefined;
    const result = finalizeWorldCup(world);
    // No cash mutation
    expect(result.teamFinances.WIN.cash).toBe(100);
    expect(result.teamFinances.RU.cash).toBe(80);
    // No news
    expect(result.newsLog.filter(n => n.id?.includes('wc-prize'))).toHaveLength(0);
  });
});
