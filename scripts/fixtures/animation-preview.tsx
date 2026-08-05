import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MatchLive from '../../src/components/MatchLive';
import type { MatchdaySnapshot, MatchEvent, MatchResult } from '../../src/types/match';
import type { TeamBase } from '../../src/types/team';
import '../../src/index.css';

const positions = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'] as const;

function snapshot(prefix: string, dismissedSlot?: number, duration: 90 | 120 = 90): MatchdaySnapshot {
  const players: MatchdaySnapshot['players'] = positions.map((position, index) => ({
    playerId: `${prefix}-${index + 1}`,
    playerNumber: index + 1,
    playerName: `${prefix.toUpperCase()} ${index + 1}`,
    position,
    role: 'starter',
    enteredMinute: 0,
    exitedMinute: index === dismissedSlot ? 45 : index === 8 && prefix === 'home' ? 48 : duration,
    minutesPlayed: index === dismissedSlot ? 45 : index === 8 && prefix === 'home' ? 48 : duration,
  }));
  if (prefix === 'home') {
    players.push({
      playerId: 'home-12',
      playerNumber: 19,
      playerName: 'HOME 12',
      position: 'FW',
      role: 'bench',
      enteredMinute: 48,
      exitedMinute: duration,
      minutesPlayed: duration - 48,
    });
  }
  return {
    players,
    substitutions: prefix === 'home'
      ? [{ minute: 48, playerInId: 'home-12', playerOutId: 'home-9' }]
      : [],
    durationMinutes: duration,
    emergencyFloor: false,
    availableCount: players.length,
  };
}

const events: MatchEvent[] = [
  { minute: 25, type: 'miss', teamId: 'home', playerId: 'home-9', playerNumber: 9, playerName: 'HOME 9', description: '远射擦柱偏出' },
  { minute: 30, type: 'gk_save', teamId: 'home', playerId: 'home-1', playerNumber: 1, playerName: 'HOME 1', description: '门将飞身将单刀拒之门外' },
  { minute: 35, type: 'df_block', teamId: 'away', playerId: 'away-2', playerNumber: 2, playerName: 'AWAY 2', description: '后卫在门线上完成封堵' },
  { minute: 40, type: 'goal', teamId: 'home', playerId: 'home-10', playerNumber: 10, playerName: 'HOME 10', description: '禁区内低射破门' },
  { minute: 45, type: 'red_card', teamId: 'away', playerId: 'away-2', playerNumber: 2, playerName: 'AWAY 2', description: '危险动作被直接罚下' },
  { minute: 48, type: 'substitution', teamId: 'home', playerInId: 'home-12', playerOutId: 'home-9', playerInName: 'HOME 12', playerOutName: 'HOME 9', description: 'HOME 12 换下 HOME 9' },
];

const regularResult = {
  fixtureId: 'animation-preview',
  homeTeamId: 'home',
  awayTeamId: 'away',
  homeGoals: 1,
  awayGoals: 0,
  extraTime: false,
  penalties: false,
  events,
  stats: {
    possession: [54, 46], shots: [9, 7], shotsOnTarget: [4, 3], corners: [5, 4],
    fouls: [10, 13], yellowCards: [1, 2], redCards: [0, 1],
  },
  competitionType: 'league',
  competitionName: '动画回归赛',
  roundLabel: '事件驱动预览',
  homeMatchday: snapshot('home'),
  awayMatchday: snapshot('away', 1),
} satisfies MatchResult;

const shootoutEvents: MatchEvent[] = [
  { minute: 18, type: 'goal', teamId: 'home', playerId: 'home-9', playerName: 'HOME 9', description: 'HOME 9 禁区内低射破门' },
  { minute: 74, type: 'goal', teamId: 'away', playerId: 'away-9', playerName: 'AWAY 9', description: 'AWAY 9 反击中扳平比分' },
  ...[
    ['home', 'home-10', 'HOME 10', 'scored'],
    ['away', 'away-9', 'AWAY 9', 'scored'],
    ['home', 'home-11', 'HOME 11', 'saved'],
    ['away', 'away-10', 'AWAY 10', 'scored'],
    ['home', 'home-6', 'HOME 6', 'scored'],
    ['away', 'away-11', 'AWAY 11', 'off_target'],
    ['home', 'home-7', 'HOME 7', 'scored'],
    ['away', 'away-6', 'AWAY 6', 'saved'],
    ['home', 'home-8', 'HOME 8', 'scored'],
  ].map(([team, playerId, playerName, outcome], index): MatchEvent => {
    const isHome = team === 'home';
    const teamKickNumber = Math.floor(index / 2) + 1;
    const scored = outcome === 'scored';
    return {
      minute: 121 + index,
      type: scored ? 'penalty_goal' : 'penalty_miss',
      teamId: team,
      playerId,
      playerName,
      description: scored
        ? `${playerName} 冷静推射命中球门角落`
        : outcome === 'saved'
          ? `${playerName} 点球被门将扑出！`
          : `${playerName} 点球偏出立柱！`,
      shootout: {
        kickNumber: index + 1,
        round: teamKickNumber,
        teamKickNumber,
        suddenDeath: false,
        outcome: outcome as 'scored' | 'saved' | 'off_target',
        goalkeeperId: isHome ? 'away-1' : 'home-1',
        goalkeeperName: isHome ? 'AWAY 1' : 'HOME 1',
      },
    };
  }),
];

const shootoutResult = {
  ...regularResult,
  fixtureId: 'animation-shootout-preview',
  homeGoals: 1,
  awayGoals: 1,
  extraTime: true,
  etHomeGoals: 0,
  etAwayGoals: 0,
  penalties: true,
  penaltyHome: 4,
  penaltyAway: 2,
  events: shootoutEvents,
  competitionType: 'league_cup',
  competitionName: '宇宙冠军杯',
  roundLabel: '决赛',
  homeMatchday: snapshot('home', undefined, 120),
  awayMatchday: snapshot('away', undefined, 120),
} satisfies MatchResult;

const result = new URLSearchParams(window.location.search).has('shootout')
  ? shootoutResult
  : regularResult;

const teamBases = {
  home: { id: 'home', name: '赤焰竞技', shortName: '赤焰', color: '#ef4444' } as TeamBase,
  away: { id: 'away', name: '青岚联队', shortName: '青岚', color: '#22c55e' } as TeamBase,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MatchLive result={result} teamBases={teamBases} onClose={() => undefined} />
  </StrictMode>,
);
