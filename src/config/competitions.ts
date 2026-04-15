import { LeagueConfig } from '../types/league';

export const leagueConfigs: LeagueConfig[] = [
  {
    id: 'league1',
    name: '顶级联赛',
    level: 1,
    teamCount: 16,
    rounds: 30,
    directPromotion: 0,
    directRelegation: 2,
    playoffPromotion: 0,
    playoffRelegation: 1,
  },
  {
    id: 'league2',
    name: '甲级联赛',
    level: 2,
    teamCount: 8,
    rounds: 14,
    directPromotion: 2,
    directRelegation: 2,
    playoffPromotion: 1,
    playoffRelegation: 1,
  },
  {
    id: 'league3',
    name: '乙级联赛',
    level: 3,
    teamCount: 8,
    rounds: 14,
    directPromotion: 2,
    directRelegation: 0,
    playoffPromotion: 1,
    playoffRelegation: 0,
  },
];

export const superCupConfig = {
  name: '超级杯',
  totalTeams: 16,
  league1Spots: 10,
  league2Spots: 4,
  league3Spots: 2,
  groupCount: 4,
  teamsPerGroup: 4,
  groupRounds: 6,
  awayGoalRule: true,
} as const;

export const worldCupConfig = {
  name: '环球冠军杯',
  interval: 4,
  participantCount: 16,
  groupCount: 4,
  teamsPerGroup: 4,
  allAdvance: true, // all 16 enter knockout
} as const;

export const leagueCupConfig = {
  name: '联赛杯',
  participantCount: 32,
  rounds: 5, // R32 -> R16 -> QF -> SF -> Final
} as const;
