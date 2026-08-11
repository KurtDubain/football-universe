import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchdaySnapshot } from '../../types/match';
import type { Player } from '../../types/player';
import { computeMatchPlayerImpacts, selectMatchMotm } from './match-player-impact';

function player(id: string, teamId: string, position: Player['position']): Player {
  return {
    uuid: id, teamId, name: id, number: 1, position, rating: 82,
    peakRating: 84, peakAge: 27, goalScoring: position === 'FW' ? 80 : 20,
    marketValue: 20, age: 26,
  };
}

function event(type: MatchEvent['type'], teamId: string, playerId: string, minute = 30): MatchEvent {
  return { minute, type, teamId, playerId, playerName: playerId, description: type };
}

function snapshot(entries: Array<{ player: Player; entered?: number; exited?: number }>): MatchdaySnapshot {
  return {
    durationMinutes: 90,
    emergencyFloor: false,
    availableCount: entries.length,
    players: entries.map(({ player: item, entered = 0, exited = 90 }) => ({
      playerId: item.uuid,
      playerName: item.name,
      playerNumber: item.number,
      position: item.position,
      role: entered === 0 ? 'starter' : 'bench',
      enteredMinute: entered,
      exitedMinute: exited,
      minutesPlayed: exited - entered,
    })),
  };
}

describe('match player impact', () => {
  it('ignores decorative save events and reads ordinary saves only from authoritative totals', () => {
    const keeper = player('keeper', 'home', 'GK');
    const players = new Map([[keeper.uuid, keeper]]);
    const impacts = computeMatchPlayerImpacts({
      events: [event('save', 'home', keeper.uuid)],
      defensiveContributions: {
        keeper: {
          playerId: keeper.uuid,
          teamId: 'home',
          interceptions: 0,
          clearances: 0,
          routineSaves: 3,
        },
      },
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeMatchday: snapshot([{ player: keeper }]),
      winnerTeamId: null,
    }, players);

    expect(impacts[0].routineSaves).toBe(3);
    expect(impacts[0].keySaves).toBe(0);
  });

  it('does not double count a key save as an ordinary save', () => {
    const keeper = player('keeper', 'home', 'GK');
    const impact = computeMatchPlayerImpacts({
      events: [event('gk_save', 'home', keeper.uuid)],
      defensiveContributions: {
        keeper: {
          playerId: keeper.uuid,
          teamId: 'home',
          interceptions: 0,
          clearances: 0,
          routineSaves: 2,
        },
      },
      winnerTeamId: 'home',
    }, new Map([[keeper.uuid, keeper]]))[0];

    expect(impact.keySaves).toBe(1);
    expect(impact.routineSaves).toBe(2);
  });

  it('gives goalkeepers and defenders a real MOTM path through decisive defense', () => {
    const keeper = player('keeper', 'home', 'GK');
    const defender = player('defender', 'away', 'DF');
    const players = new Map([[keeper.uuid, keeper], [defender.uuid, defender]]);

    expect(selectMatchMotm({
      events: [event('gk_save', 'home', keeper.uuid)],
      defensiveContributions: {
        keeper: { playerId: keeper.uuid, teamId: 'home', interceptions: 0, clearances: 0, routineSaves: 4 },
      },
      winnerTeamId: 'home',
    }, players)).toMatchObject({ playerId: keeper.uuid });

    expect(selectMatchMotm({
      events: [event('df_block', 'away', defender.uuid)],
      defensiveContributions: {
        defender: { playerId: defender.uuid, teamId: 'away', interceptions: 4, clearances: 6 },
      },
      winnerTeamId: null,
    }, players)).toMatchObject({ playerId: defender.uuid });
  });

  it('credits clean-sheet context only to players who completed meaningful minutes', () => {
    const starter = player('starter', 'home', 'DF');
    const lateSub = player('late-sub', 'home', 'DF');
    const impacts = computeMatchPlayerImpacts({
      events: [],
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeMatchday: snapshot([
        { player: starter },
        { player: lateSub, entered: 82 },
      ]),
      winnerTeamId: 'home',
    }, new Map([[starter.uuid, starter], [lateSub.uuid, lateSub]]));

    expect(impacts.find(entry => entry.playerId === starter.uuid)?.score).toBeGreaterThan(0);
    expect(impacts.find(entry => entry.playerId === lateSub.uuid)?.score).toBe(0);
  });

  it('tracks goals conceded only while the player is actually on the pitch', () => {
    const starter = player('starter', 'home', 'DF');
    const lateSub = player('late-sub', 'home', 'DF');
    const impacts = computeMatchPlayerImpacts({
      events: [event('goal', 'away', 'striker', 30)],
      homeTeamId: 'home',
      awayTeamId: 'away',
      homeMatchday: snapshot([
        { player: starter, exited: 70 },
        { player: lateSub, entered: 70 },
      ]),
      winnerTeamId: 'away',
    }, new Map([[starter.uuid, starter], [lateSub.uuid, lateSub]]));

    expect(impacts.find(entry => entry.playerId === starter.uuid)?.goalsConcededWhileOnPitch).toBe(1);
    expect(impacts.find(entry => entry.playerId === lateSub.uuid)?.goalsConcededWhileOnPitch).toBe(0);
  });
});
