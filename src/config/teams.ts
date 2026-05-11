import { TeamBase, TeamState } from '../types/team';

export const defaultTeams: TeamBase[] = [
  // ============================================================
  // 顶级联赛 (16 teams)
  // ============================================================
  {
    id: 'gz_hengda', name: '广州恒大', shortName: '恒大', color: '#CF1322',
    tier: 'elite', overall: 92, attack: 94, midfield: 91, defense: 88,
    stability: 90, depth: 93, reputation: 98, initialLeagueLevel: 1, expectation: 5,
    region: '南洲+广东',
  },
  {
    id: 'shimazu', name: '岛津众城', shortName: '岛津', color: '#6B2D75',
    tier: 'elite', overall: 90, attack: 90, midfield: 93, defense: 86,
    stability: 88, depth: 92, reputation: 95, initialLeagueLevel: 1, expectation: 5,
    region: '东洲+九州',
  },
  {
    id: 'xibei_wolf', name: '西北狼', shortName: '狼', color: '#8B8B83',
    tier: 'elite', overall: 89, attack: 88, midfield: 88, defense: 90,
    stability: 87, depth: 90, reputation: 96, initialLeagueLevel: 1, expectation: 5,
    region: '大陆+陕西',
  },
  {
    id: 'fj_hakka', name: '福建客家', shortName: '客家', color: '#D4652F',
    tier: 'elite', overall: 87, attack: 91, midfield: 86, defense: 84,
    stability: 85, depth: 86, reputation: 92, initialLeagueLevel: 1, expectation: 4,
    region: '南洲+福建',
  },
  {
    id: 'honshu_maru', name: '本州丸', shortName: '本州', color: '#B71C1C',
    tier: 'elite', overall: 86, attack: 89, midfield: 90, defense: 78,
    stability: 80, depth: 84, reputation: 95, initialLeagueLevel: 1, expectation: 4,
    region: '东洲+本州',
  },
  {
    id: 'bj_guoan', name: '北京国安', shortName: '国安', color: '#00A651',
    tier: 'elite', overall: 85, attack: 86, midfield: 85, defense: 84,
    stability: 84, depth: 83, reputation: 88, initialLeagueLevel: 1, expectation: 4,
    region: '大陆+北京',
  },
  {
    id: 'sd_taishan', name: '山东泰山', shortName: '泰山', color: '#FF6B00',
    tier: 'strong', overall: 84, attack: 80, midfield: 84, defense: 90,
    stability: 86, depth: 82, reputation: 87, initialLeagueLevel: 1, expectation: 4,
    region: '大陆+山东',
  },
  {
    id: 'zhili_victory', name: '直隶胜利', shortName: '直隶', color: '#1B5E20',
    tier: 'strong', overall: 83, attack: 90, midfield: 82, defense: 76,
    stability: 72, depth: 85, reputation: 90, initialLeagueLevel: 1, expectation: 4,
    region: '大陆+河北',
  },
  {
    id: 'chumen_world', name: '楚门世界', shortName: '楚门', color: '#0097A7',
    tier: 'strong', overall: 80, attack: 76, midfield: 80, defense: 86,
    stability: 84, depth: 78, reputation: 88, initialLeagueLevel: 1, expectation: 3,
    region: '大陆+天津',
  },
  {
    id: 'jeonbuk', name: '全北现代', shortName: '全北', color: '#2E7D32',
    tier: 'strong', overall: 79, attack: 72, midfield: 78, defense: 90,
    stability: 88, depth: 76, reputation: 82, initialLeagueLevel: 1, expectation: 3,
    region: '大陆+南朝鲜',
  },
  {
    id: 'liaoning', name: '辽宁队', shortName: '辽宁', color: '#E65100',
    tier: 'strong', overall: 78, attack: 84, midfield: 78, defense: 72,
    stability: 68, depth: 75, reputation: 80, initialLeagueLevel: 1, expectation: 3,
    region: '大陆+吉林',
  },
  {
    id: 'osaka_ippei', name: '大阪一平', shortName: '大阪', color: '#E91E63',
    tier: 'strong', overall: 77, attack: 78, midfield: 76, defense: 78,
    stability: 74, depth: 76, reputation: 86, initialLeagueLevel: 1, expectation: 3,
    region: '东洲+本州',
  },
  {
    id: 'hn_happy', name: '河南幸福', shortName: '河南', color: '#FFC107',
    tier: 'mid', overall: 76, attack: 78, midfield: 76, defense: 74,
    stability: 62, depth: 82, reputation: 85, initialLeagueLevel: 1, expectation: 3,
    region: '大陆+河南',
  },
  {
    id: 'gz_yongkang', name: '广州永康', shortName: '广州', color: '#F57F17',
    tier: 'mid', overall: 75, attack: 80, midfield: 76, defense: 70,
    stability: 66, depth: 72, reputation: 78, initialLeagueLevel: 1, expectation: 3,
    region: '南洲+广东',
  },
  {
    id: 'datong', name: '大同队', shortName: '大同', color: '#455A64',
    tier: 'mid', overall: 73, attack: 76, midfield: 72, defense: 70,
    stability: 72, depth: 70, reputation: 65, initialLeagueLevel: 1, expectation: 2,
    region: '大陆+山西',
  },
  {
    id: 'jiaozhou', name: '胶州港湾', shortName: '胶州', color: '#0277BD',
    tier: 'mid', overall: 72, attack: 78, midfield: 74, defense: 66,
    stability: 58, depth: 74, reputation: 80, initialLeagueLevel: 1, expectation: 3,
    region: '大陆+山东',
  },

  // ============================================================
  // 甲级联赛 (8 teams)
  // ============================================================
  {
    id: 'sy_street', name: '沈阳大街', shortName: '沈阳', color: '#C62828',
    tier: 'mid', overall: 68, attack: 72, midfield: 68, defense: 66,
    stability: 70, depth: 64, reputation: 72, initialLeagueLevel: 2, expectation: 4,
    region: '大陆+吉林',
  },
  {
    id: 'cs_dragon', name: '常山龙', shortName: '常山', color: '#4E342E',
    tier: 'mid', overall: 66, attack: 68, midfield: 66, defense: 64,
    stability: 66, depth: 62, reputation: 65, initialLeagueLevel: 2, expectation: 3,
    region: '大陆+石家庄',
  },
  {
    id: 'red_sun', name: '红太阳', shortName: '朝鲜', color: '#D50000',
    tier: 'lower', overall: 64, attack: 66, midfield: 64, defense: 64,
    stability: 60, depth: 62, reputation: 76, initialLeagueLevel: 2, expectation: 3,
    region: '大陆+北朝鲜',
  },
  {
    id: 'sanya', name: '三亚海口', shortName: '三亚', color: '#00BFA5',
    tier: 'lower', overall: 62, attack: 64, midfield: 62, defense: 60,
    stability: 58, depth: 58, reputation: 68, initialLeagueLevel: 2, expectation: 3,
    region: '南洲+海南',
  },
  {
    id: 'taipei_fc', name: '小台北', shortName: '台北', color: '#1A237E',
    tier: 'lower', overall: 60, attack: 62, midfield: 60, defense: 58,
    stability: 62, depth: 56, reputation: 55, initialLeagueLevel: 2, expectation: 2,
    region: '南洲+台湾',
  },
  {
    id: 'shikoku', name: '四国火枪', shortName: '四国', color: '#F4511E',
    tier: 'lower', overall: 58, attack: 60, midfield: 58, defense: 56,
    stability: 56, depth: 54, reputation: 58, initialLeagueLevel: 2, expectation: 2,
    region: '东洲+四国',
  },
  {
    id: 'omi_eagle', name: '近江鹰', shortName: '近江', color: '#5D4037',
    tier: 'lower', overall: 56, attack: 54, midfield: 58, defense: 56,
    stability: 60, depth: 52, reputation: 72, initialLeagueLevel: 2, expectation: 2,
    region: '东洲+本州',
  },
  {
    id: 'xian_bingma', name: '西安兵马', shortName: '西安', color: '#795548',
    tier: 'lower', overall: 55, attack: 58, midfield: 54, defense: 52,
    stability: 52, depth: 50, reputation: 64, initialLeagueLevel: 2, expectation: 2,
    region: '大陆+陕西',
  },

  // ============================================================
  // 乙级联赛 (8 teams)
  // ============================================================
  {
    id: 'hokkaido', name: '北海道', shortName: '北海', color: '#90CAF9',
    tier: 'underdog', overall: 53, attack: 54, midfield: 52, defense: 52,
    stability: 54, depth: 48, reputation: 42, initialLeagueLevel: 3, expectation: 3,
    region: '东洲+北海道',
  },
  {
    id: 'yongfu', name: '永福临门', shortName: '永福', color: '#A1887F',
    tier: 'underdog', overall: 51, attack: 56, midfield: 50, defense: 48,
    stability: 46, depth: 46, reputation: 44, initialLeagueLevel: 3, expectation: 3,
    region: '南洲+福建',
  },
  {
    id: 'ty_taiping', name: '太原太平', shortName: '太原', color: '#78909C',
    tier: 'underdog', overall: 49, attack: 50, midfield: 48, defense: 48,
    stability: 50, depth: 44, reputation: 40, initialLeagueLevel: 3, expectation: 2,
    region: '大陆+山西',
  },
  {
    id: 'taipei_dome', name: '大巨蛋', shortName: '巨蛋', color: '#9C27B0',
    tier: 'underdog', overall: 47, attack: 46, midfield: 48, defense: 48,
    stability: 46, depth: 44, reputation: 55, initialLeagueLevel: 3, expectation: 2,
    region: '南洲+台湾',
  },
  {
    id: 'suwon', name: '水原三星', shortName: '三星', color: '#034EA2',
    tier: 'underdog', overall: 45, attack: 42, midfield: 44, defense: 50,
    stability: 52, depth: 40, reputation: 48, initialLeagueLevel: 3, expectation: 2,
    region: '大陆+南朝鲜',
  },
  {
    id: 'bj_oppo', name: '北京欧珀', shortName: '欧珀', color: '#7B1FA2',
    tier: 'underdog', overall: 43, attack: 44, midfield: 42, defense: 44,
    stability: 44, depth: 38, reputation: 36, initialLeagueLevel: 3, expectation: 1,
    region: '大陆+北京',
  },
  {
    id: 'nissan_fc', name: '东风日产', shortName: '日产', color: '#37474F',
    tier: 'underdog', overall: 41, attack: 40, midfield: 42, defense: 42,
    stability: 40, depth: 36, reputation: 38, initialLeagueLevel: 3, expectation: 1,
    region: '东洲+本州',
  },
  {
    id: 'tsmc_fc', name: '台积电', shortName: 'Env', color: '#1565C0',
    tier: 'underdog', overall: 40, attack: 38, midfield: 40, defense: 42,
    stability: 42, depth: 35, reputation: 34, initialLeagueLevel: 3, expectation: 1,
    region: '南洲+台湾',
  },
];

export function createInitialTeamStates(teams: TeamBase[]): Record<string, TeamState> {
  const states: Record<string, TeamState> = {};
  for (const team of teams) {
    states[team.id] = {
      id: team.id,
      leagueLevel: team.initialLeagueLevel,
      morale: 70,
      fatigue: 5,
      momentum: 0,
      squadHealth: 92,
      coachPressure: 5,
      currentCoachId: null,
      recentForm: [],
    };
  }
  return states;
}
