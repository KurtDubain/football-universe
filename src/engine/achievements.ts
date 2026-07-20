export interface Achievement {
  id: string;
  title: string;
  description: string;
  seasonNumber: number;
  teamId?: string;
}

interface SeasonRec {
  leaguePlayed: number;
  leagueWon: number;
  leagueDrawn?: number;
  leagueLost: number;
  leaguePoints: number;
  leagueGF?: number;
  leagueGA?: number;
  leaguePosition?: number;
  promoted: boolean;
  relegated?: boolean;
  cupResult?: string;
  superCupResult?: string;
  worldCupResult?: string;
  continentalCupResult?: string;
}

function titleCount(record: SeasonRec): number {
  return Number(record.leaguePosition === 1)
    + Number(record.cupResult === '冠军')
    + Number(record.superCupResult === '冠军')
    + Number(record.worldCupResult === '冠军')
    + Number(record.continentalCupResult === '冠军');
}

const ACHIEVEMENT_DEFS = [
  // ──── Statistical (数据类) ────
  { id: 'unbeaten', title: '不败赛季', check: (s: SeasonRec) => s && s.leagueLost === 0 && (s.leaguePlayed ?? 0) >= 10, desc: (t: string) => `${t}以全赛季不败战绩完成联赛` },
  { id: 'dominant', title: '统治级表现', check: (s: SeasonRec) => s && (s.leagueWon ?? 0) >= (s.leaguePlayed ?? 1) * 0.8, desc: (t: string) => `${t}以超过80%的胜率统治联赛` },
  { id: 'centurion', title: '百分赛季', check: (s: SeasonRec) => s && (s.leaguePoints ?? 0) >= 80, desc: (t: string) => `${t}联赛积分突破80大关` },
  { id: 'goal_machine', title: '进球机器', check: (s: SeasonRec) => s && (s.leagueGF ?? 0) >= 60, desc: (t: string) => `${t}联赛进球突破60大关` },
  { id: 'iron_wall', title: '钢铁防线', check: (s: SeasonRec) => s && (s.leagueGA ?? 999) <= 15 && s.leaguePlayed >= 10, desc: (t: string) => `${t}全赛季只丢极少进球，钢铁防线名不虚传` },
  { id: 'avalanche', title: '进球如麻', check: (s: SeasonRec) => s && (s.leagueGF ?? 0) >= 90, desc: (t: string) => `${t}单赛季打入90+球，火力凶猛` },
  { id: 'massacre', title: '大屠杀', check: (s: SeasonRec) => s && ((s.leagueGF ?? 0) - (s.leagueGA ?? 0)) >= 50, desc: (t: string) => `${t}净胜球突破+50大关` },

  // ──── First-time / Milestone (首次类) ────
  { id: 'promotion_streak', title: '连级跳', check: (_: SeasonRec, rec: SeasonRec[]) => { if (!rec || rec.length < 2) return false; const last2 = rec.slice(-2); return last2.length === 2 && last2[0]?.promoted && last2[1]?.promoted; }, desc: (t: string) => `${t}连续两个赛季升级` },
  { id: 'first_promotion', title: '冲级成功', check: (s: SeasonRec, rec: SeasonRec[]) => s.promoted && rec.filter(r => r.promoted).length === 1, desc: (t: string) => `${t}首次升级成功` },
  { id: 'first_relegation', title: '降级深渊', check: (s: SeasonRec, rec: SeasonRec[]) => !!s.relegated && rec.filter(r => r.relegated).length === 1, desc: (t: string) => `${t}首次降级，球迷心碎` },
  { id: 'first_league_title', title: '首夺联赛', check: (s: SeasonRec, rec: SeasonRec[]) => s.leaguePosition === 1 && rec.filter(r => r.leaguePosition === 1).length === 1, desc: (t: string) => `${t}首次加冕联赛冠军` },
  { id: 'first_cup', title: '首夺杯赛', check: (s: SeasonRec, rec: SeasonRec[]) => s.cupResult === '冠军' && rec.filter(r => r.cupResult === '冠军').length === 1, desc: (t: string) => `${t}首次捧得联赛杯` },
  { id: 'first_super_cup', title: '首夺超级杯', check: (s: SeasonRec, rec: SeasonRec[]) => s.superCupResult === '冠军' && rec.filter(r => r.superCupResult === '冠军').length === 1, desc: (t: string) => `${t}首次捧得超级杯` },
  { id: 'first_world_cup', title: '首夺世界杯', check: (s: SeasonRec, rec: SeasonRec[]) => s.worldCupResult === '冠军' && rec.filter(r => r.worldCupResult === '冠军').length === 1, desc: (t: string) => `${t}首次问鼎环球冠军杯，登顶世界之巅` },

  // ──── Streak / Dynasty (王朝类) ────
  { id: 'back_to_back', title: '蝉联霸主', check: (s: SeasonRec, rec: SeasonRec[]) => { if (rec.length < 2) return false; const last2 = rec.slice(-2); return last2[0]?.leaguePosition === 1 && last2[1]?.leaguePosition === 1; }, desc: (t: string) => `${t}成功蝉联联赛冠军` },
  { id: 'three_peat', title: '三连冠王朝', check: (s: SeasonRec, rec: SeasonRec[]) => { if (rec.length < 3) return false; const last3 = rec.slice(-3); return last3.every(r => r?.leaguePosition === 1); }, desc: (t: string) => `${t}成就联赛三连冠伟业` },
  { id: 'five_peat', title: '王朝霸主', check: (s: SeasonRec, rec: SeasonRec[]) => { if (rec.length < 5) return false; const last5 = rec.slice(-5); return last5.every(r => r?.leaguePosition === 1); }, desc: (t: string) => `${t}建立横跨五个赛季的王朝` },
  { id: 'cup_dynasty', title: '杯赛之王', check: (s: SeasonRec, rec: SeasonRec[]) => rec.filter(r => r.cupResult === '冠军').length >= 5, desc: (t: string) => `${t}5+次捧起联赛杯，杯赛专家` },

  // ──── Multi-crown (多冠类) ────
  { id: 'double_crown', title: '双冠王', check: (s: SeasonRec) => titleCount(s) >= 2, desc: (t: string) => `${t}单赛季夺得双冠` },
  { id: 'triple_crown', title: '三冠王', check: (s: SeasonRec) => titleCount(s) >= 3, desc: (t: string) => `${t}单赛季夺得三冠，名垂青史` },
  { id: 'quadruple', title: '四冠王', check: (s: SeasonRec) => titleCount(s) >= 4, desc: (t: string) => `${t}单赛季夺得四座冠军，写下传奇` },

  // ──── Underdog (黑马类) ────
  { id: 'underdog_promo_to_top', title: '冲入顶级', check: (_: SeasonRec, rec: SeasonRec[]) => { const promos = rec.filter(r => r.promoted); return promos.length >= 1 && rec[rec.length - 1]?.leaguePosition !== undefined; }, desc: (t: string) => `${t}从底层杀入顶级联赛` },
  { id: 'rookie_champion', title: '升班马夺冠', check: (s: SeasonRec, rec: SeasonRec[]) => { if (rec.length < 2) return false; const prev = rec[rec.length - 2]; return prev?.promoted && s.leaguePosition === 1; }, desc: (t: string) => `${t}升班马赛季直接夺冠，神迹！` },
  { id: 'comeback', title: '王者归来', check: (s: SeasonRec, rec: SeasonRec[]) => { if (rec.length < 3) return false; const recent = rec.slice(-3); return recent[0]?.relegated && s.leaguePosition === 1; }, desc: (t: string) => `${t}从降级谷底重返巅峰` },

  // ──── Heartbreak (心碎类) ────
  { id: 'almost_perfect', title: '一步之遥', check: (s: SeasonRec) => s.leaguePosition === 2 && s.leaguePlayed >= 10, desc: (t: string) => `${t}惜居亚军，与冠军失之交臂` },
  { id: 'rock_bottom', title: '深渊垫底', check: (s: SeasonRec) => s.leagueLost >= s.leaguePlayed * 0.7 && s.leaguePlayed >= 10, desc: (t: string) => `${t}赛季惨淡，输球率超过70%` },
  { id: 'no_wins', title: '无胜赛季', check: (s: SeasonRec) => s.leaguePlayed >= 10 && s.leagueWon === 0, desc: (t: string) => `${t}全赛季未尝胜绩，惨不忍睹` },

  // ──── Long-term (长期类，需多季统计) ────
  { id: 'survivor_5', title: '常青树', check: (_: SeasonRec, rec: SeasonRec[]) => rec.length >= 5 && rec.slice(-5).every(r => !r.relegated), desc: (t: string) => `${t}连续5个赛季屹立不倒` },
  { id: 'collector_3', title: '奖杯收藏家', check: (_: SeasonRec, rec: SeasonRec[]) => {
    let cups = 0;
    for (const r of rec) {
      cups += titleCount(r);
    }
    return cups >= 5;
  }, desc: (t: string) => `${t}累计夺得5座以上奖杯` },
  { id: 'legend_team', title: '传奇队伍', check: (_: SeasonRec, rec: SeasonRec[]) => {
    let cups = 0;
    for (const r of rec) {
      cups += titleCount(r);
    }
    return cups >= 15;
  }, desc: (t: string) => `${t}累计15+奖杯，传奇地位无可撼动` },
];

export function checkAchievements(
  teamId: string,
  teamName: string,
  seasonNumber: number,
  currentRecord: SeasonRec,
  allRecords: SeasonRec[],
  existingAchievements: Achievement[],
): Achievement[] {
  const newAchievements: Achievement[] = [];

  for (const def of ACHIEVEMENT_DEFS) {
    const alreadyHas = existingAchievements.some(a => a.id === `${def.id}-${teamId}-S${seasonNumber}`);
    // For dynasty achievements, also check if any past season had it (one-time only)
    const isDynastyType = def.id === 'three_peat' || def.id === 'five_peat' || def.id === 'comeback' || def.id === 'rookie_champion' || def.id === 'first_promotion' || def.id === 'first_relegation' || def.id === 'first_league_title' || def.id === 'first_cup' || def.id === 'first_super_cup' || def.id === 'first_world_cup';
    if (isDynastyType) {
      const hasAnyPast = existingAchievements.some(a => a.id.startsWith(`${def.id}-${teamId}-`));
      if (hasAnyPast) continue;
    }
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
