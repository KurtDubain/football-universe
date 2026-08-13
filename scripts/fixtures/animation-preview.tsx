import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MatchLive from '../../src/components/MatchLive';
import type { CoachFormation } from '../../src/types/coach';
import type { MatchdaySnapshot, MatchEvent, MatchResult } from '../../src/types/match';
import type { TeamBase } from '../../src/types/team';
import '../../src/index.css';

const formationPositions: Record<CoachFormation, MatchdaySnapshot['players'][number]['position'][]> = {
  '4-3-3': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
  '4-2-3-1': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '4-4-2': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '5-4-1': ['GK', 'DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW'],
};

function snapshot(
  prefix: string,
  formation: CoachFormation,
  dismissedSlot?: number,
  duration: 90 | 120 = 90,
): MatchdaySnapshot {
  const players: MatchdaySnapshot['players'] = formationPositions[formation].map((position, index) => ({
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
    formation,
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
  {
    minute: 12, type: 'corner', teamId: 'away', playerId: 'away-7', playerNumber: 7, playerName: 'AWAY 7',
    description: 'AWAY 7 角球开向前点，防守球员抢先解围', playOrigin: 'corner',
    setPiece: { side: 'left', delivery: 'near_post', resolution: 'cleared' },
  },
  { minute: 25, type: 'miss', teamId: 'home', playerId: 'home-9', playerNumber: 9, playerName: 'HOME 9', description: '远射擦柱偏出' },
  { minute: 30, type: 'gk_save', teamId: 'home', playerId: 'home-1', playerNumber: 1, playerName: 'HOME 1', deniedScorerId: 'away-9', deniedAssisterId: 'away-7', description: '门将飞身将单刀拒之门外' },
  { minute: 35, type: 'df_block', teamId: 'away', playerId: 'away-2', playerNumber: 2, playerName: 'AWAY 2', deniedScorerId: 'home-10', deniedAssisterId: 'home-7', description: '后卫在门线上完成封堵' },
  { minute: 40, type: 'goal', teamId: 'home', playerId: 'home-10', playerNumber: 10, playerName: 'HOME 10', description: '禁区内低射破门' },
  { minute: 40, type: 'assist', teamId: 'home', playerId: 'home-7', playerNumber: 7, playerName: 'HOME 7', description: 'HOME 7 送出助攻' },
  { minute: 45, type: 'red_card', teamId: 'away', playerId: 'away-2', playerNumber: 2, playerName: 'AWAY 2', description: '危险动作被直接罚下' },
  { minute: 48, type: 'substitution', teamId: 'home', playerInId: 'home-12', playerOutId: 'home-9', playerInName: 'HOME 12', playerOutName: 'HOME 9', description: 'HOME 12 换下 HOME 9' },
  {
    minute: 58, type: 'free_kick', teamId: 'home', playerId: 'home-7', playerNumber: 7, playerName: 'HOME 7',
    description: 'HOME 7 直接任意球被人墙挡出', playOrigin: 'direct_free_kick',
    setPiece: { side: 'central', delivery: 'direct', resolution: 'cleared' },
  },
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
  homeMatchday: snapshot('home', '4-3-3'),
  awayMatchday: snapshot('away', '5-4-1', 1),
  homeTactics: {
    formation: '4-3-3',
    approach: 'pressing',
    reason: 'control_favorite',
    execution: 'elite',
    attackDelta: 1.9,
    midfieldDelta: 0.8,
    defenseDelta: -0.7,
    tags: ['主动争夺球权', '边路保持宽度'],
  },
  awayTactics: {
    formation: '5-4-1',
    approach: 'low_block',
    reason: 'underdog_response',
    execution: 'coherent',
    attackDelta: -1.8,
    midfieldDelta: -0.7,
    defenseDelta: 2.4,
    tags: ['压缩禁区空间', '等待反击机会'],
  },
  featuredPlayers: [
    {
      playerId: 'home-10',
      playerName: 'HOME 10',
      teamId: 'home',
      position: 'FW',
      ratingAtKickoff: 92,
      seasonScoreAtKickoff: 87,
      marginalUnitImpact: 3.1,
      impactUnit: 'attack',
      reason: 'finisher',
    },
    {
      playerId: 'away-2',
      playerName: 'AWAY 2',
      teamId: 'away',
      position: 'DF',
      ratingAtKickoff: 90,
      seasonScoreAtKickoff: 84,
      marginalUnitImpact: 2.8,
      impactUnit: 'defense',
      reason: 'defensive_anchor',
    },
    {
      playerId: 'home-1',
      playerName: 'HOME 1',
      teamId: 'home',
      position: 'GK',
      ratingAtKickoff: 90,
      marginalUnitImpact: 2.5,
      impactUnit: 'defense',
      reason: 'defensive_anchor',
    },
  ],
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
  homeMatchday: snapshot('home', '4-3-3', undefined, 120),
  awayMatchday: snapshot('away', '5-4-1', undefined, 120),
} satisfies MatchResult;

const sameMinuteResult = {
  ...regularResult,
  fixtureId: 'animation-same-minute-preview',
  homeGoals: 2,
  events: [
    ...events.slice(0, 6),
    {
      minute: 40,
      type: 'goal' as const,
      teamId: 'home',
      playerId: 'home-11',
      playerNumber: 11,
      playerName: 'HOME 11',
      description: '连续进攻中补射破门',
    },
    ...events.slice(6),
  ],
} satisfies MatchResult;

const params = new URLSearchParams(window.location.search);
const competition = params.get('competition');
const competitionResult = competition === 'world'
  ? { ...regularResult, competitionType: 'world_cup' as const, competitionName: '环球冠军杯', roundLabel: '小组赛第 2 轮', isNeutralVenue: true }
  : competition === 'continental'
    ? { ...regularResult, competitionType: 'continental_cup' as const, competitionName: '洲际杯', roundLabel: '半决赛', isNeutralVenue: true }
    : competition === 'domestic'
      ? { ...regularResult, competitionType: 'league_cup' as const, competitionName: '联赛杯', roundLabel: '1/4 决赛', isNeutralVenue: true }
      : regularResult;
const selectedResult = params.has('shootout')
  ? shootoutResult
  : params.has('sameMinute')
    ? sameMinuteResult
    : competitionResult;
const result = params.get('shape') === 'alternate'
  ? {
      ...selectedResult,
      homeMatchday: snapshot('home', '4-2-3-1', undefined, selectedResult.extraTime ? 120 : 90),
      awayMatchday: snapshot('away', '4-4-2', undefined, selectedResult.extraTime ? 120 : 90),
      homeTactics: {
        ...selectedResult.homeTactics!,
        formation: '4-2-3-1' as const,
        approach: 'control' as const,
      },
      awayTactics: {
        ...selectedResult.awayTactics!,
        formation: '4-4-2' as const,
        approach: 'counter' as const,
      },
    }
  : selectedResult;

const teamBases = {
  home: { id: 'home', name: '赤焰竞技', shortName: '赤焰', color: '#ef4444' } as TeamBase,
  away: { id: 'away', name: '青岚联队', shortName: '青岚', color: '#22c55e' } as TeamBase,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MatchLive result={result} teamBases={teamBases} onClose={() => undefined} featured={params.has('featured')} />
  </StrictMode>,
);
