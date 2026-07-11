import { describe, expect, it } from 'vitest';
import { applyOfferTransfer, signFreeAgent } from './transfer-window-actions';
import type { GameWorld } from '../engine/season/season-manager';
import type { Player, PlayerSeasonStats } from '../types/player';
import type { FinanceState, TeamBase } from '../types/team';
import type { IncomingOffer } from '../types/transfer';

function makeTeam(id: string, overall: number): TeamBase {
  return {
    id,
    name: id,
    shortName: id.slice(0, 3),
    color: '#000',
    tier: overall >= 82 ? 'elite' : 'mid',
    overall,
    attack: overall,
    midfield: overall,
    defense: overall,
    stability: overall,
    depth: overall,
    reputation: overall,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

function makePlayer(uuid: string, teamId: string, number: number, rating: number): Player {
  return {
    uuid,
    teamId,
    name: uuid,
    number,
    position: 'FW',
    rating,
    goalScoring: 70,
    marketValue: 10,
    age: 25,
    peakRating: rating,
    peakAge: 27,
  };
}

function makeStat(uuid: string, teamId: string): PlayerSeasonStats {
  return {
    playerId: uuid,
    teamId,
    goals: 8,
    assists: 2,
    yellowCards: 0,
    redCards: 0,
    appearances: 20,
    cleanSheets: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: 8,
    keyPasses: 2,
  };
}

function makeFinance(cash = 100): FinanceState {
  return {
    cash,
    totalIncome: 0,
    totalExpense: 0,
    history: [{
      season: 3,
      startCash: cash,
      endCash: cash,
      prizeMoney: 0,
      tvSponsor: 0,
      transferIncome: 0,
      salaries: 0,
      transferExpense: 0,
    }],
  };
}

function buildWorld(): GameWorld {
  const seller = makeTeam('seller', 70);
  const buyer = makeTeam('buyer', 90);
  const sellingPlayer = makePlayer('p-sell', 'seller', 9, 84);
  const sellerOther = makePlayer('p-seller-other', 'seller', 10, 68);
  const buyerRelease = makePlayer('p-release', 'buyer', 17, 60);
  const buyerKeep = makePlayer('p-buyer-keep', 'buyer', 11, 88);

  return {
    seasonState: {
      seasonNumber: 4,
      currentWindowIndex: 0,
      calendar: [],
      completed: false,
      isWorldCupYear: false,
      worldCupPhase: false,
    },
    teamBases: { seller, buyer },
    teamStates: {} as never,
    coachBases: {},
    coachStates: {},
    coachCareers: {},
    league1Standings: [],
    league2Standings: [],
    league3Standings: [],
    leagueCup: undefined as never,
    superCup: undefined as never,
    worldCup: null,
    honorHistory: [],
    teamTrophies: {},
    coachTrophies: {},
    teamSeasonRecords: {},
    coachChangesThisSeason: [],
    squads: {
      seller: [sellingPlayer, sellerOther],
      buyer: [buyerRelease, buyerKeep],
    },
    playerStats: {
      'p-sell': makeStat('p-sell', 'seller'),
      'p-release': makeStat('p-release', 'buyer'),
    },
    nextPlayerUuidCounter: 10,
    retirementHistory: [],
    freeAgentPool: [],
    transferRumors: [],
    playerStatsHistory: {},
    transferWindow: {
      season: 3,
      status: 'open',
      incomingOffers: [],
      outgoingTargets: [],
      freeAgentUuids: [],
      signedFromPool: [],
    },
    coachCandidatePool: [],
    coachRetirementHistory: [],
    nextCoachIdCounter: 0,
    activeEvents: [],
    achievements: [],
    newsLog: [],
    seed: 1,
    rngState: 123,
    seasonStartLevels: {},
    seasonBuffs: [],
    prediction: undefined,
    godHandUsed: false,
    coins: 0,
    bets: [],
    matchHistory: [],
    seasonBuffsHistory: [],
    playerAwardsHistory: [],
    transferHistory: [],
    memorableMatches: [],
    gameMode: 'free',
    totalElapsedWindows: 0,
    teamFinances: {
      seller: makeFinance(100),
      buyer: makeFinance(100),
    },
    continentalCups: { mainland_cup: null, southern_cup: null, eastern_cup: null },
  };
}

describe('transfer-window store actions', () => {
  it('keeps manual accepted offers squad-balanced and attributes records to transferWindow.season', () => {
    const world = buildWorld();
    const offer: IncomingOffer = {
      id: 'offer-1',
      playerId: 'p-sell',
      playerName: 'p-sell',
      playerPosition: 'FW',
      playerRating: 84,
      ownerTeamId: 'seller',
      ownerTeamName: 'seller',
      buyerId: 'buyer',
      buyerName: 'buyer',
      fee: 40,
      resolution: 'pending',
    };

    const out = applyOfferTransfer(world, offer, 40);

    expect(out.squads.seller).toHaveLength(world.squads.seller.length);
    expect(out.squads.buyer).toHaveLength(world.squads.buyer.length);
    expect(out.squads.buyer.find((p) => p.uuid === 'p-sell')?.teamId).toBe('buyer');
    expect(out.squads.seller.find((p) => p.uuid === 'p-release')?.teamId).toBe('seller');
    expect(out.playerStats['p-sell'].teamId).toBe('buyer');
    expect(out.playerStats['p-release'].teamId).toBe('seller');

    expect(out.transferHistory).toHaveLength(2);
    expect(out.transferHistory.every((t) => t.season === 3)).toBe(true);
    expect(out.transferHistory[0]).toMatchObject({
      playerId: 'p-sell',
      fromTeamId: 'seller',
      toTeamId: 'buyer',
      type: 'transfer',
      fee: 40,
    });
    expect(out.transferHistory[1]).toMatchObject({
      playerId: 'p-release',
      fromTeamId: 'buyer',
      toTeamId: 'seller',
      type: 'free_agent',
      fee: 5,
    });
    expect(out.newsLog).toHaveLength(2);
    expect(out.newsLog.every((n) => n.seasonNumber === 3)).toBe(true);
    expect(out.newsLog.every((n) => n.windowIndex === world.seasonState.currentWindowIndex)).toBe(true);
    expect(out.newsLog[0]).toMatchObject({
      id: 'manual-transfer:S3:W0:p-sell:buyer',
      type: 'trophy',
    });
    expect(out.newsLog[1]).toMatchObject({
      id: 'manual-transfer:S3:W0:p-release:seller',
      type: 'trophy',
    });

    expect(out.teamFinances.seller.cash).toBe(135);
    expect(out.teamFinances.seller.totalIncome).toBe(0);
    expect(out.teamFinances.seller.totalExpense).toBe(0);
    expect(out.teamFinances.seller.history.at(-1)).toMatchObject({
      season: 3,
      endCash: 135,
      transferIncome: 40,
      transferExpense: 5,
    });
    expect(out.teamFinances.buyer.cash).toBe(65);
    expect(out.teamFinances.buyer.totalIncome).toBe(0);
    expect(out.teamFinances.buyer.totalExpense).toBe(0);
    expect(out.teamFinances.buyer.history.at(-1)).toMatchObject({
      season: 3,
      endCash: 65,
      transferIncome: 5,
      transferExpense: 40,
    });
  });

  it('attributes free-agent signings to transferWindow.season', () => {
    const world = {
      ...buildWorld(),
      freeAgentPool: [makePlayer('p-free', 'seller', 18, 66)],
      playerStats: {
        ...buildWorld().playerStats,
        'p-free': makeStat('p-free', 'seller'),
      },
    };

    const out = signFreeAgent(world, 'p-free', 'buyer');

    expect(out).not.toBeNull();
    expect(out!.freeAgentPool).toHaveLength(0);
    expect(out!.squads.buyer.find((p) => p.uuid === 'p-free')?.teamId).toBe('buyer');
    expect(out!.playerStats['p-free'].teamId).toBe('buyer');
    expect(out!.transferHistory.at(-1)).toMatchObject({
      season: 3,
      playerId: 'p-free',
      toTeamId: 'buyer',
      type: 'free_agent',
    });
    expect(out!.newsLog.at(-1)).toMatchObject({
      id: 'manual-transfer:S3:W0:p-free:buyer',
      seasonNumber: 3,
      windowIndex: world.seasonState.currentWindowIndex,
      type: 'trophy',
    });
    expect(out!.teamFinances.buyer.cash).toBe(95);
    expect(out!.teamFinances.buyer.totalExpense).toBe(0);
    expect(out!.teamFinances.buyer.history.at(-1)).toMatchObject({
      season: 3,
      endCash: 95,
      transferExpense: 5,
    });
  });
});
