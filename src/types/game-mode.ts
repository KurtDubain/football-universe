import type { TeamBase } from './team';

export type GameMode = 'free' | 'epic' | 'underdog' | 'sandbox';

export interface GameModeConfig {
  id: GameMode;
  label: string;
  description: string;
  emoji: string;
  applyTeamOverrides?: (teams: TeamBase[]) => TeamBase[];
}

export const GAME_MODES: GameModeConfig[] = [
  {
    id: 'free',
    label: '自由模式',
    description: '默认设置，体验最原汁原味的足球宇宙',
    emoji: '⚖️',
  },
  {
    id: 'epic',
    label: '王朝模式',
    description: '顶级豪门更强势，王朝更难被打破',
    emoji: '👑',
    applyTeamOverrides: (teams) => teams.map(t => {
      if (t.tier === 'elite') {
        const boost = 5;
        return {
          ...t,
          overall: Math.min(99, t.overall + boost),
          attack: Math.min(99, t.attack + boost),
          midfield: Math.min(99, t.midfield + boost),
          defense: Math.min(99, t.defense + boost),
          stability: Math.min(99, t.stability + 8),
        };
      }
      return t;
    }),
  },
  {
    id: 'underdog',
    label: '草根逆袭',
    description: '所有球队实力均衡，弱队更易爆冷',
    emoji: '🌱',
    applyTeamOverrides: (teams) => teams.map(t => {
      const targetOvr = 65 + (t.overall - 50) * 0.3;
      const ovrDelta = targetOvr - t.overall;
      return {
        ...t,
        overall: Math.round(targetOvr),
        attack: Math.round(t.attack + ovrDelta),
        midfield: Math.round(t.midfield + ovrDelta),
        defense: Math.round(t.defense + ovrDelta),
        stability: Math.max(40, Math.min(80, t.stability)),
      };
    }),
  },
  {
    id: 'sandbox',
    label: '沙盒模式',
    description: '使用自定义球队配置（需在球队编辑器中修改）',
    emoji: '🛠️',
  },
];

export function getGameModeConfig(id: GameMode | undefined): GameModeConfig {
  return GAME_MODES.find(m => m.id === id) ?? GAME_MODES[0];
}
