import { describe, expect, it } from 'vitest';
import type { Player, PlayerSeasonStats } from '../../types/player';
import {
  applyTransferMove,
  createTransferRecord,
  FREE_MARKET_TEAM_ID,
} from './transfer-application';

function makePlayer(uuid: string, teamId: string, number: number, rating: number): Player {
  return {
    uuid,
    teamId,
    name: uuid,
    number,
    position: 'FW',
    rating,
    goalScoring: 60,
    marketValue: 10,
    age: 25,
    peakRating: rating,
    peakAge: 27,
  };
}

function makeStat(playerId: string, teamId: string): PlayerSeasonStats {
  return {
    playerId,
    teamId,
    goals: 1,
    assists: 1,
    yellowCards: 0,
    redCards: 0,
    appearances: 2,
    cleanSheets: 0,
    saves: 0,
    keyBlocks: 0,
    bigChances: 1,
    keyPasses: 1,
  };
}

describe('shared transfer application pipeline', () => {
  it('moves an incoming player, returns the displaced player, and synchronizes both stat owners', () => {
    const incoming = makePlayer('incoming', 'seller', 9, 85);
    const sellerKeepsNine = makePlayer('seller-nine', 'seller', 10, 60);
    const displaced = makePlayer('displaced', 'buyer', 9, 55);
    const buyerKeepsTen = makePlayer('buyer-ten', 'buyer', 10, 80);

    const result = applyTransferMove({
      squads: {
        seller: [incoming, sellerKeepsNine],
        buyer: [displaced, buyerKeepsTen],
      },
      playerStats: {
        incoming: makeStat('incoming', 'seller'),
        displaced: makeStat('displaced', 'buyer'),
      },
      player: incoming,
      fromTeamId: 'seller',
      toTeamId: 'buyer',
      displacedPlayerId: displaced.uuid,
      displacedToTeamId: 'seller',
    });

    expect(result).not.toBeNull();
    expect(result!.movedPlayer).toMatchObject({ uuid: 'incoming', teamId: 'buyer', number: 9 });
    expect(result!.displacedPlayer).toMatchObject({ uuid: 'displaced', teamId: 'seller', number: 9 });
    expect(result!.squads.seller.map((player) => player.uuid).sort()).toEqual(['displaced', 'seller-nine']);
    expect(result!.squads.buyer.map((player) => player.uuid).sort()).toEqual(['buyer-ten', 'incoming']);
    expect(result!.playerStats.incoming.teamId).toBe('buyer');
    expect(result!.playerStats.displaced.teamId).toBe('seller');
  });

  it('allocates a free shirt number when a free agent joins from the market', () => {
    const freeAgent = makePlayer('free-agent', 'former', 9, 70);
    const result = applyTransferMove({
      squads: { buyer: [makePlayer('existing-nine', 'buyer', 9, 75)] },
      playerStats: { 'free-agent': makeStat('free-agent', 'former') },
      player: freeAgent,
      fromTeamId: FREE_MARKET_TEAM_ID,
      toTeamId: 'buyer',
    });

    expect(result?.movedPlayer).toMatchObject({ teamId: 'buyer', number: 2 });
    expect(result?.playerStats['free-agent'].teamId).toBe('buyer');
  });

  it('rejects a stale move when the player is no longer on the claimed source squad', () => {
    const player = makePlayer('missing', 'seller', 9, 70);
    const result = applyTransferMove({
      squads: { seller: [], buyer: [] },
      playerStats: {},
      player,
      fromTeamId: 'seller',
      toTeamId: 'buyer',
    });

    expect(result).toBeNull();
  });

  it('builds history from the post-allocation player identity', () => {
    const moved = makePlayer('incoming', 'buyer', 22, 85);
    const record = createTransferRecord({
      season: 4,
      windowIndex: 7,
      player: moved,
      fromTeamId: 'seller',
      fromTeamName: 'Seller',
      toTeamId: 'buyer',
      toTeamName: 'Buyer',
      type: 'transfer',
      fee: 30,
      reason: 'test',
    });

    expect(record).toMatchObject({
      playerId: 'incoming',
      playerNumber: 22,
      toTeamId: 'buyer',
      season: 4,
      windowIndex: 7,
    });
  });
});
