import { describe, expect, it } from 'vitest';
import type { CoachBase } from '../types/coach';
import type { TeamBase, TeamState } from '../types/team';
import { calculateMatchModel } from './match/model';
import type { PlayerBoosts } from './players/player-boosts';
import { deriveTeamOverall } from './team-overall';

function team(over: Partial<TeamBase> = {}): TeamBase {
  return {
    id: 't1',
    name: '测试队',
    shortName: '测试',
    color: '#000000',
    tier: 'mid',
    overall: 70,
    attack: 70,
    midfield: 70,
    defense: 70,
    stability: 70,
    depth: 70,
    reputation: 70,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
    ...over,
  };
}

function coach(over: Partial<CoachBase> = {}): CoachBase {
  return {
    id: 'c1',
    name: '测试教练',
    rating: 70,
    style: 'balanced',
    attackBuff: 0,
    defenseBuff: 0,
    moraleBuff: 0,
    leagueBuff: 0,
    cupBuff: 0,
    pressureResistance: 50,
    riskBias: 0,
    stabilityBuff: 0,
    age: 45,
    ...over,
  };
}

function neutralState(id: string): TeamState {
  return {
    id,
    leagueLevel: 1,
    morale: 60,
    fatigue: 0,
    momentum: 0,
    squadHealth: 100,
    coachPressure: 0,
    recentForm: [],
  };
}

const NO_BOOSTS: PlayerBoosts = { attack: 0, midfield: 0, defense: 0 };

/** region 独立于所有真实球队，overall 50 让德比门槛永不满足。 */
const DUMMY = team({
  id: 'dummy',
  name: '基准队',
  shortName: '基准',
  overall: 50,
  attack: 50,
  midfield: 50,
  defense: 50,
  stability: 50,
  region: '审计+虚拟',
});

describe('deriveTeamOverall', () => {
  it('averages the three effective lines', () => {
    const t = team({ attack: 80, midfield: 70, defense: 60, stability: 0 });
    expect(deriveTeamOverall(t, null, NO_BOOSTS)).toBe(70);
  });

  it('adds coach buffs to attack and defense but not midfield', () => {
    const t = team({ attack: 70, midfield: 70, defense: 70, stability: 0 });
    const c = coach({ attackBuff: 9, defenseBuff: 3 });
    // attack 79 · midfield 70 · defense 73 → 222 / 3 = 74
    expect(deriveTeamOverall(t, c, NO_BOOSTS)).toBe(74);
  });

  it('folds stability into defense at a tenth of its value', () => {
    const t = team({ attack: 70, midfield: 70, defense: 70, stability: 90 });
    // defense 70 + 9 = 79 → (70 + 70 + 79) / 3 = 73
    expect(deriveTeamOverall(t, null, NO_BOOSTS)).toBe(73);
  });

  it('adds each player boost to its own line', () => {
    const t = team({ attack: 70, midfield: 70, defense: 70, stability: 0 });
    const boosts: PlayerBoosts = { attack: 6, midfield: 3, defense: 0 };
    // (76 + 73 + 70) / 3 = 73
    expect(deriveTeamOverall(t, null, boosts)).toBe(73);
  });

  it('floors at 30 and keeps the very top inside [96, 99]', () => {
    const floor = team({ attack: 20, midfield: 20, defense: 20, stability: 0 });
    const drain: PlayerBoosts = { attack: -15, midfield: -15, defense: -15 };
    expect(deriveTeamOverall(floor, null, drain)).toBe(30);

    // raw = (126 + 111 + 135.6) / 3 = 124.2，远超显示上限。压缩之后仍落在
    // 顶级区间，但不再是硬夹出来的 99 —— 硬夹会让所有 raw > 99 的球队并列。
    const ceiling = team({ attack: 96, midfield: 96, defense: 96, stability: 96 });
    const stacked: PlayerBoosts = { attack: 15, midfield: 15, defense: 15 };
    const elite = coach({ attackBuff: 15, defenseBuff: 15 });
    const top = deriveTeamOverall(ceiling, elite, stacked);
    expect(top).toBeGreaterThanOrEqual(96);
    expect(top).toBeLessThanOrEqual(99);
  });

  it('compresses above the knee instead of collapsing onto the ceiling', () => {
    const at = (raw: number): number => deriveTeamOverall(
      team({ attack: raw, midfield: raw, defense: raw, stability: 0 }),
      null,
      NO_BOOSTS,
    );

    // 拐点以下是恒等映射。
    expect(at(70)).toBe(70);
    expect(at(82)).toBe(82);

    // 拐点以上保序且严格单调。硬夹会让 100 和 116 都变成 99，压缩之后
    // 必须仍然区分得开 —— 顶级球队之间的可分辨度是这次改动的目标之一。
    expect(at(90)).toBeGreaterThan(at(82));
    expect(at(96)).toBeGreaterThan(at(90));
    expect(at(104)).toBeGreaterThan(at(96));
    expect(at(116)).toBeGreaterThan(at(104));
    expect(at(116)).toBeGreaterThan(at(100));
    expect(at(116)).toBeLessThanOrEqual(99);
  });

  it('tracks the match model under neutral conditions', () => {
    // 回归护栏：派生值必须等于 adjustedStrengths 在中立场 / 中性 state /
    // 无战术调整下的三条线均值。如果哪天 adjustedStrengths 的构成变了而这里
    // 没跟着改，OVR 会重新跟比赛真正使用的强度脱节 —— 那正是本次改动要修的
    // 问题，所以这条断言必须一直绿。
    //
    // 这条用例的 raw 落在压缩拐点以下，所以是精确相等；拐点以上只保证保序
    // （见上一条用例）。
    const t = team({ attack: 72, midfield: 65, defense: 77, stability: 58 });
    const c = coach({ attackBuff: 7, defenseBuff: 4 });
    const boosts: PlayerBoosts = { attack: 5.2, midfield: -1.4, defense: 3.3 };

    const model = calculateMatchModel({
      homeTeam: t,
      awayTeam: DUMMY,
      homeState: neutralState(t.id),
      awayState: neutralState(DUMMY.id),
      homeCoach: c,
      awayCoach: null,
      fixture: {
        homeTeamId: t.id,
        awayTeamId: DUMMY.id,
        competitionType: 'league',
        isNeutralVenue: true,
        tournamentHostTeamId: undefined,
      },
      homeBoosts: boosts,
      awayBoosts: NO_BOOSTS,
    });

    const fromModel = Math.round(
      (model.home.attack + model.home.midfield + model.home.defense) / 3,
    );
    expect(deriveTeamOverall(t, c, boosts)).toBe(fromModel);
  });

  it('ignores overall itself, so a stale stored value cannot leak back in', () => {
    const weak = team({ overall: 97, attack: 50, midfield: 50, defense: 50, stability: 0 });
    const strong = team({ overall: 38, attack: 80, midfield: 80, defense: 80, stability: 0 });
    expect(deriveTeamOverall(weak, null, NO_BOOSTS)).toBe(50);
    expect(deriveTeamOverall(strong, null, NO_BOOSTS)).toBe(80);
  });
});
