import { describe, expect, it } from 'vitest';
import type { TeamBase } from '../../types/team';
import type { WorldCupState } from '../../types/cup';
import {
  completeWorldCupEdition,
  ensureWorldCupEdition,
  selectWorldCupHost,
  worldCupHostResult,
} from './world-cup-host';

function team(id: string, continent: string, overall = 70): TeamBase {
  return {
    id,
    name: id,
    shortName: id,
    color: '#123456',
    tier: 'mid',
    overall,
    attack: overall,
    midfield: overall,
    defense: overall,
    stability: overall,
    depth: overall,
    reputation: overall,
    initialLeagueLevel: 1,
    expectation: 3,
    region: `${continent}+${id}`,
  };
}

const teams = Object.fromEntries([
  team('a1', '大陆', 95), team('a2', '大陆', 45),
  team('b1', '南洲', 92), team('b2', '南洲', 48),
  team('c1', '东洲', 90), team('c2', '东洲', 50),
].map(item => [item.id, item]));
const teamIds = Object.keys(teams);

describe('World Cup host selection', () => {
  it('is deterministic and does not consult club strength', () => {
    const selected = selectWorldCupHost(teamIds, teams, [], 4, 20260715);
    const rerated = Object.fromEntries(Object.values(teams).map(item => [
      item.id,
      { ...item, overall: 140 - item.overall, reputation: 140 - item.reputation },
    ]));
    expect(selectWorldCupHost(teamIds, teams, [], 4, 20260715)).toBe(selected);
    expect(selectWorldCupHost(teamIds, rerated, [], 4, 20260715)).toBe(selected);
  });

  it('uses season chronology rather than persisted array order', () => {
    const history = [
      { seasonNumber: 4, announcedSeasonNumber: 4, hostTeamId: 'a1' },
      { seasonNumber: 8, announcedSeasonNumber: 8, hostTeamId: 'b1' },
    ];
    expect(selectWorldCupHost(teamIds, teams, [...history].reverse(), 12, 88))
      .toBe(selectWorldCupHost(teamIds, teams, history, 12, 88));
  });

  it('rotates continents and excludes each recent host', () => {
    let editions = ensureWorldCupEdition([], teamIds, teams, 4, 44).editions;
    editions = ensureWorldCupEdition(editions, teamIds, teams, 8, 44).editions;
    editions = ensureWorldCupEdition(editions, teamIds, teams, 12, 44).editions;

    const continents = editions.map(edition => teams[edition.hostTeamId].region.split('+')[0]);
    expect(new Set(continents).size).toBe(3);
    expect(new Set(editions.map(edition => edition.hostTeamId)).size).toBe(3);
  });

  it('keeps long-running hosts rotating without strength-based exclusion', () => {
    let editions = [] as ReturnType<typeof ensureWorldCupEdition>['editions'];
    for (let season = 4; season <= 80; season += 4) {
      editions = ensureWorldCupEdition(editions, teamIds, teams, season, 20260715).editions;
    }

    const continents = editions.map(edition => teams[edition.hostTeamId].region.split('+')[0]);
    expect(editions).toHaveLength(20);
    expect(continents.every((continent, index) => index === 0 || continent !== continents[index - 1])).toBe(true);
    expect(new Set(editions.map(edition => edition.hostTeamId))).toEqual(new Set(teamIds));
    for (let index = 3; index < editions.length; index++) {
      expect(editions.slice(index - 3, index).map(edition => edition.hostTeamId))
        .not.toContain(editions[index].hostTeamId);
    }
  });

  it('keeps only the latest fifty edition rows', () => {
    let editions = [] as ReturnType<typeof ensureWorldCupEdition>['editions'];
    for (let season = 4; season <= 240; season += 4) {
      editions = ensureWorldCupEdition(editions, teamIds, teams, season, 77).editions;
    }

    expect(editions).toHaveLength(50);
    expect(editions[0].seasonNumber).toBe(44);
    expect(editions.at(-1)?.seasonNumber).toBe(240);
  });

  it('records the champion, runner-up, and host finish', () => {
    const state = {
      hostTeamId: 'a1',
      participantIds: teamIds,
      groups: [],
      groupStageCompleted: true,
      completed: true,
      winnerId: 'b1',
      knockoutRounds: [
        {
          roundNumber: 1,
          roundName: 'R16',
          completed: true,
          fixtures: [{ id: 'r16', round: 1, roundName: 'R16', homeTeamId: 'a1', awayTeamId: 'b2', winnerId: 'a1' }],
        },
        {
          roundNumber: 2,
          roundName: 'QF',
          completed: true,
          fixtures: [{ id: 'qf', round: 2, roundName: 'QF', homeTeamId: 'a1', awayTeamId: 'c1', winnerId: 'c1' }],
        },
      ],
    } satisfies WorldCupState;

    expect(worldCupHostResult(state, 'a1')).toBe('八强');
    const completed = completeWorldCupEdition(
      [{ seasonNumber: 4, hostTeamId: 'a1', announcedSeasonNumber: 4 }],
      state,
      4,
      'b1',
      'c1',
    );
    expect(completed[0]).toMatchObject({
      seasonNumber: 4,
      hostTeamId: 'a1',
      winnerId: 'b1',
      runnerUpId: 'c1',
      hostResult: '八强',
    });
  });
});
