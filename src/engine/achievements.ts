export interface Achievement {
  id: string;
  title: string;
  description: string;
  seasonNumber: number;
  teamId?: string;
}

const ACHIEVEMENT_DEFS = [
  { id: 'unbeaten', title: '不败赛季', check: (s: any) => s.leagueLost === 0 && s.leaguePlayed >= 10, desc: (t: string) => `${t}以全赛季不败战绩完成联赛` },
  { id: 'perfect_home', title: '主场全胜', check: (s: any) => s.leagueWon >= s.leaguePlayed * 0.85, desc: (t: string) => `${t}主场表现近乎完美` },
  { id: 'centurion', title: '百分赛季', check: (s: any) => s.leaguePoints >= 80, desc: (t: string) => `${t}联赛积分突破80大关` },
  { id: 'promotion_streak', title: '连级跳', check: (_: any, rec: any[]) => { const last2 = rec.slice(-2); return last2.length === 2 && last2[0].promoted && last2[1].promoted; }, desc: (t: string) => `${t}连续两个赛季升级` },
];

export function checkAchievements(
  teamId: string,
  teamName: string,
  seasonNumber: number,
  currentRecord: { leaguePlayed: number; leagueWon: number; leagueLost: number; leaguePoints: number; promoted: boolean },
  allRecords: any[],
  existingAchievements: Achievement[],
): Achievement[] {
  const newAchievements: Achievement[] = [];

  for (const def of ACHIEVEMENT_DEFS) {
    const alreadyHas = existingAchievements.some(a => a.id === `${def.id}-${teamId}-S${seasonNumber}`);
    if (alreadyHas) continue;

    const unlocked = def.check(currentRecord, allRecords);
    if (unlocked) {
      newAchievements.push({
        id: `${def.id}-${teamId}-S${seasonNumber}`,
        title: def.title,
        description: def.desc(teamName),
        seasonNumber,
        teamId,
      });
    }
  }

  return newAchievements;
}
