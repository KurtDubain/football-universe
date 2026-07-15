import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MatchLive from '../../src/components/MatchLive';
import type { MatchdaySnapshot, MatchEvent, MatchResult } from '../../src/types/match';
import type { TeamBase } from '../../src/types/team';
import '../../src/index.css';

const positions = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'] as const;

function snapshot(prefix: string, dismissedSlot?: number): MatchdaySnapshot {
  const players: MatchdaySnapshot['players'] = positions.map((position, index) => ({
    playerId: `${prefix}-${index + 1}`,
    playerNumber: index + 1,
    playerName: `${prefix.toUpperCase()} ${index + 1}`,
    position,
    role: 'starter',
    enteredMinute: 0,
    exitedMinute: index === dismissedSlot ? 45 : index === 8 && prefix === 'home' ? 48 : 90,
    minutesPlayed: index === dismissedSlot ? 45 : index === 8 && prefix === 'home' ? 48 : 90,
  }));
  if (prefix === 'home') {
    players.push({
      playerId: 'home-12',
      playerNumber: 19,
      playerName: 'HOME 12',
      position: 'FW',
      role: 'bench',
      enteredMinute: 48,
      exitedMinute: 90,
      minutesPlayed: 42,
    });
  }
  return {
    players,
    substitutions: prefix === 'home'
      ? [{ minute: 48, playerInId: 'home-12', playerOutId: 'home-9' }]
      : [],
    durationMinutes: 90,
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

const result = {
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

const teamBases = {
  home: { id: 'home', name: '赤焰竞技', shortName: '赤焰', color: '#ef4444' } as TeamBase,
  away: { id: 'away', name: '青岚联队', shortName: '青岚', color: '#22c55e' } as TeamBase,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MatchLive result={result} teamBases={teamBases} onClose={() => undefined} />
  </StrictMode>,
);
