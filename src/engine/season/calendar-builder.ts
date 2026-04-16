import { CalendarWindow } from '../../types/season';
import { MatchFixture } from '../../types/match';
import { CupFixture } from '../../types/cup';

export interface CalendarBuildInput {
  seasonNumber: number;
  league1Fixtures: MatchFixture[][];  // 30 rounds
  league2Fixtures: MatchFixture[][];  // 14 rounds
  league3Fixtures: MatchFixture[][];  // 14 rounds
  leagueCupR1Fixtures: CupFixture[];
  superCupGroupRoundFixtures: CupFixture[][]; // 6 rounds of group fixtures
}

function cupFixturesToMatchFixtures(
  cupFixtures: CupFixture[],
  competitionType: 'league_cup' | 'super_cup' | 'super_cup_group',
  competitionName: string,
): MatchFixture[] {
  return cupFixtures.map(f => ({
    id: f.id,
    homeTeamId: f.homeTeamId,
    awayTeamId: f.awayTeamId,
    competitionType,
    competitionName,
    roundLabel: f.roundName,
  }));
}

/**
 * Build the complete season calendar with ~49 windows.
 *
 * Layout:
 * - 30 top league rounds interleaved with 14 mid/low rounds
 * - 5 league cup rounds inserted between league windows
 * - 6 super cup group rounds inserted between league windows
 * - Super cup knockout windows (QF L1, QF L2, SF L1, SF L2, Final) — fixtures TBD
 * - Relegation playoff + season end
 */
export function buildSeasonCalendar(input: CalendarBuildInput): CalendarWindow[] {
  const { seasonNumber, league1Fixtures, league2Fixtures, league3Fixtures } = input;
  const windows: CalendarWindow[] = [];
  let windowId = 0;

  // Track which round we're on for each
  let topR = 0;   // 0-29
  let midR = 0;   // 0-13
  let lowR = 0;   // 0-13
  let scGroupR = 0; // 0-5 super cup group rounds
  let lcR = 0;    // 0-4 league cup rounds

  // Helper to create a league window
  function addLeagueWindow() {
    const fixtures: MatchFixture[] = [];
    let label = '';
    const parts: string[] = [];

    if (topR < 30) {
      fixtures.push(...league1Fixtures[topR]);
      parts.push(`顶级R${topR + 1}`);
      topR++;
    }

    // Mid/low play every other league window in the first half,
    // then space out. We map 14 rounds across ~30 league windows.
    // Play mid/low when: midR < 14 and topR is odd (every other window)
    const shouldPlayLower = (topR % 2 === 1) || midR >= 14;
    if (midR < 14 && (topR % 2 === 1 || topR >= 27)) {
      fixtures.push(...league2Fixtures[midR]);
      parts.push(`甲级R${midR + 1}`);
      midR++;
    }
    if (lowR < 14 && (topR % 2 === 1 || topR >= 27)) {
      fixtures.push(...league3Fixtures[lowR]);
      parts.push(`乙级R${lowR + 1}`);
      lowR++;
    }

    label = `联赛 ${parts.join(' / ')}`;

    windows.push({
      id: windowId++,
      type: 'league',
      label,
      description: `第${seasonNumber}赛季 ${label}`,
      fixtures,
      completed: false,
      results: [],
    });
  }

  function addSuperCupGroupWindow() {
    if (scGroupR >= 6) return;
    const cupFixtures = input.superCupGroupRoundFixtures[scGroupR];
    const fixtures = cupFixturesToMatchFixtures(cupFixtures, 'super_cup_group', '超级杯');
    windows.push({
      id: windowId++,
      type: 'super_cup_group',
      label: `超级杯小组赛 R${scGroupR + 1}`,
      description: `第${seasonNumber}赛季 超级杯小组赛第${scGroupR + 1}轮`,
      fixtures,
      completed: false,
      results: [],
    });
    scGroupR++;
  }

  function addLeagueCupWindow() {
    const roundNames = ['R32', 'R16', 'QF', 'SF', '决赛'];
    const roundLabel = roundNames[lcR] || `R${lcR + 1}`;

    // Only R1 has fixtures at build time; later rounds populated dynamically
    const fixtures: MatchFixture[] = lcR === 0
      ? cupFixturesToMatchFixtures(input.leagueCupR1Fixtures, 'league_cup', '联赛杯')
      : [];

    windows.push({
      id: windowId++,
      type: 'league_cup',
      label: `联赛杯 ${roundLabel}`,
      description: `第${seasonNumber}赛季 联赛杯${roundLabel}`,
      fixtures,
      completed: false,
      results: [],
    });
    lcR++;
  }

  function addSuperCupKnockoutWindow(roundName: string) {
    windows.push({
      id: windowId++,
      type: 'super_cup',
      label: `超级杯 ${roundName}`,
      description: `第${seasonNumber}赛季 超级杯${roundName}`,
      fixtures: [], // populated when group stage completes
      completed: false,
      results: [],
    });
  }

  // === Build the calendar ===

  // W0: League R1 (all tiers)
  addLeagueWindow(); // topR1 + midR1 + lowR1

  // W1: League R2 (top only)
  addLeagueWindow(); // topR2

  // W2: Super Cup Group R1
  addSuperCupGroupWindow();

  // W3: League R3 (all tiers)
  addLeagueWindow(); // topR3 + midR2 + lowR2

  // W4: League Cup R1
  addLeagueCupWindow();

  // W5: League R4 (top only)
  addLeagueWindow(); // topR4

  // W6: League R5 (all tiers)
  addLeagueWindow(); // topR5 + midR3 + lowR3

  // W7: Super Cup Group R2
  addSuperCupGroupWindow();

  // W8: League R6 (top only)
  addLeagueWindow(); // topR6

  // W9: League R7 (all tiers)
  addLeagueWindow(); // topR7 + midR4 + lowR4

  // W10: League Cup R2
  addLeagueCupWindow();

  // W11: League R8 (top only)
  addLeagueWindow(); // topR8

  // W12: Super Cup Group R3
  addSuperCupGroupWindow();

  // W13: League R9 (all tiers)
  addLeagueWindow(); // topR9 + midR5 + lowR5

  // W14: League R10 (top only)
  addLeagueWindow(); // topR10

  // W15: League R11 (all tiers)
  addLeagueWindow(); // topR11 + midR6 + lowR6

  // W16: Super Cup Group R4
  addSuperCupGroupWindow();

  // W17: League Cup QF
  addLeagueCupWindow();

  // W18: League R12 (top only)
  addLeagueWindow(); // topR12

  // W19: League R13 (all tiers)
  addLeagueWindow(); // topR13 + midR7 + lowR7

  // W20: Super Cup Group R5
  addSuperCupGroupWindow();

  // W21: League R14 (top only)
  addLeagueWindow(); // topR14

  // W22: League R15 (all tiers)
  addLeagueWindow(); // topR15 + midR8 + lowR8

  // W23: Super Cup Group R6
  addSuperCupGroupWindow();

  // W24: League R16 (top only)
  addLeagueWindow(); // topR16

  // W25: League R17 (all tiers)
  addLeagueWindow(); // topR17 + midR9 + lowR9

  // W26: League Cup SF
  addLeagueCupWindow();

  // W27: League R18 (top only)
  addLeagueWindow(); // topR18

  // W28: League R19 (all tiers)
  addLeagueWindow(); // topR19 + midR10 + lowR10

  // W29: Super Cup QF Leg 1
  addSuperCupKnockoutWindow('QF 首回合');

  // W30: League R20 (top only)
  addLeagueWindow(); // topR20

  // W31: Super Cup QF Leg 2
  addSuperCupKnockoutWindow('QF 次回合');

  // W32: League R21 (all tiers)
  addLeagueWindow(); // topR21 + midR11 + lowR11

  // W33: League R22 (top only)
  addLeagueWindow(); // topR22

  // W34: League R23 (all tiers)
  addLeagueWindow(); // topR23 + midR12 + lowR12

  // W35: Super Cup SF Leg 1
  addSuperCupKnockoutWindow('SF 首回合');

  // W36: League R24 (top only)
  addLeagueWindow(); // topR24

  // W37: Super Cup SF Leg 2
  addSuperCupKnockoutWindow('SF 次回合');

  // W38: League R25 (all tiers)
  addLeagueWindow(); // topR25 + midR13 + lowR13

  // W39: League Cup Final
  addLeagueCupWindow();

  // W40: League R26 (top only)
  addLeagueWindow(); // topR26

  // Flush remaining mid/low rounds if any
  // W41: League R27 (may include remaining mid/low)
  addLeagueWindow(); // topR27 + midR14 + lowR14

  // W42: Super Cup Final
  addSuperCupKnockoutWindow('决赛');

  // W43: League R28
  addLeagueWindow();

  // W44: League R29
  addLeagueWindow();

  // W45: League R30
  addLeagueWindow();

  // W46: Relegation Playoffs
  windows.push({
    id: windowId++,
    type: 'relegation_playoff',
    label: '升降级附加赛',
    description: `第${seasonNumber}赛季 升降级附加赛`,
    fixtures: [], // populated at season near-end
    completed: false,
    results: [],
  });

  // W47: Season End
  windows.push({
    id: windowId++,
    type: 'season_end',
    label: '赛季结算',
    description: `第${seasonNumber}赛季 赛季总结与结算`,
    fixtures: [],
    completed: false,
    results: [],
  });

  return windows;
}

/**
 * Append world cup windows to the calendar.
 */
export function appendWorldCupWindows(
  calendar: CalendarWindow[],
  seasonNumber: number,
  groupRoundFixtures: CupFixture[][],
): CalendarWindow[] {
  let windowId = calendar.length;
  const newWindows: CalendarWindow[] = [];

  // 6 group rounds
  for (let i = 0; i < groupRoundFixtures.length; i++) {
    newWindows.push({
      id: windowId++,
      type: 'world_cup_group',
      label: `环球冠军杯 小组赛R${i + 1}`,
      description: `第${seasonNumber}赛季后 环球冠军杯小组赛第${i + 1}轮 (8组×4队)`,
      fixtures: cupFixturesToMatchFixtures(groupRoundFixtures[i], 'super_cup_group', '环球冠军杯'),
      completed: false,
      results: [],
    });
  }

  // Knockout: R16, QF, SF, Final
  const knockoutRounds = ['16强', 'QF', 'SF', '决赛'];
  for (const round of knockoutRounds) {
    newWindows.push({
      id: windowId++,
      type: 'world_cup',
      label: `环球冠军杯 ${round}`,
      description: `第${seasonNumber}赛季后 环球冠军杯${round}`,
      fixtures: [],
      completed: false,
      results: [],
    });
  }

  return [...calendar, ...newWindows];
}
