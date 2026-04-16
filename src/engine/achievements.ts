export interface Achievement {
  id: string;
  title: string;
  description: string;
  seasonNumber: number;
  teamId?: string;
}

const ACHIEVEMENT_DEFS = [
  { id: 'unbeaten', title: '不败赛季', check: (s: any) => s && s.leagueLost === 0 && (s.leaguePlayed ?? 0) >= 10, desc: (t: string) => `${t}以全赛季不败战绩完成联赛` },
  { id: 'dominant', title: '统治级表现', check: (s: any) => s && (s.leagueWon ?? 0) >= (s.leaguePlayed ?? 1) * 0.8, desc: (t: string) => `${t}以超过80%的胜率统治联赛` },
  { id: 'centurion', title: '百分赛季', check: (s: any) => s && (s.leaguePoints ?? 0) >= 80, desc: (t: string) => `${t}联赛积分突破80大关` },
  { id: 'promotion_streak', title: '连级跳', check: (_: any, rec: any[]) => { if (!rec || rec.length < 2) return false; const last2 = rec.slice(-2); return last2.length === 2 && last2[0]?.promoted && last2[1]?.promoted; }, desc: (t: string) => `${t}连续两个赛季升级` },
  { id: 'goal_machine', title: '进球机器', check: (s: any) => s && (s.leagueGF ?? 0) >= 60, desc: (t: string) => `${t}联赛进球突破60大关` },
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
