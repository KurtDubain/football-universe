/**
 * 平衡指数审计 —— OVR 保真度 / 预测力 / 球员可感知度 / 系统健康。
 *
 * 背景：team.overall 是独立漂移的存量字段，而 adjustedStrengths 只读
 * attack / defense / midfield / stability。两者在长周期里单调脱节：
 * 50 赛季实测中 OVR↔三线相关性从 0.978 掉到 0.578，L1 后期 OVR 对排名的
 * 预测力只剩 0.018。本脚本把这些现象固化成可复跑的指数。
 *
 * 用法：
 *   npx tsx scripts/audit-balance-index.ts
 *   BALANCE_AUDIT_SEASONS=60 BALANCE_AUDIT_SEEDS=1,2,3 npx tsx ...
 *   BALANCE_AUDIT_IMPACT_EVERY=5   # 每 N 个赛季采一次球员影响样本
 *
 * 输出：人类可读表格 + 完整 JSON。violations 非空时 exit code = 1。
 */
import {
  executeCurrentWindow,
  initializeGameWorld,
  type GameWorld,
} from '../src/engine/season/season-manager';
import {
  calculateMatchModel,
  computeMatchdayModelReport,
  outcomeProbabilities,
} from '../src/engine/match/model';
import {
  computeSelectedPlayerBoosts,
  type PlayerBoosts,
} from '../src/engine/players/player-boosts';
import type { CoachBase } from '../src/types/coach';
import type { TeamBase, TeamState } from '../src/types/team';
import type { Player } from '../src/types/player';

// ── 配置 ────────────────────────────────────────────────────────

const DEFAULT_SEEDS = [688735950, 877987150, 940963675, 412887330, 705119264];
const seeds = process.env.BALANCE_AUDIT_SEEDS
  ? process.env.BALANCE_AUDIT_SEEDS.split(',').map(part => Number.parseInt(part.trim(), 10))
  : DEFAULT_SEEDS;
const seasons = Number.parseInt(process.env.BALANCE_AUDIT_SEASONS ?? '60', 10);
const impactSampleEvery = Number.parseInt(process.env.BALANCE_AUDIT_IMPACT_EVERY ?? '5', 10);

if (!Number.isInteger(seasons) || seasons < 1 || seeds.some(s => !Number.isInteger(s))) {
  throw new Error('Balance audit needs positive integer seasons and integer seeds.');
}

const ALL_BANDS = [
  { name: 'S1-10', lo: 1, hi: 10 },
  { name: 'S11-25', lo: 11, hi: 25 },
  { name: 'S26-40', lo: 26, hi: 40 },
  { name: 'S41+', lo: 41, hi: Number.POSITIVE_INFINITY },
];
const bands = ALL_BANDS.filter(band => band.lo <= seasons);
const firstBand = bands[0];
const lastBand = bands[bands.length - 1];

// 目标值 —— 改动后的验收线
const TARGETS = {
  F1: 0.75,   // OVR-实力保真度（越大越好）
  F2: 0.85,   // OVR 跨期稳定性（越大越好）
  P1: 0.70,   // OVR 排名预测力（越大越好）
  P2: 0.10,   // OVR 相对真实强度的信息损失（越小越好）
  P3: 0.10,   // OVR 跨期衰减（越小越好）
  I1: [1.5, 4.0] as [number, number],  // 单星 +10 的胜率影响
  I2: [3.0, 6.0] as [number, number],  // 单星缺阵的胜率影响
  I3: [1.8, 3.0] as [number, number],  // 顶级 vs 中游球员的边际比
  I4: 0.55,   // 俱乐部底蕴留存（越大越好）
  S1: 0.30,   // attack 与排名的最小相关性
  S2: 0.12,   // L1/L3 预测力差（越小越好）
  S3: 0.10,   // OVR 撞顶比例（越小越好）
  S4: [0.22, 0.30] as [number, number], // L1 平局率
};
const HARD_GATES = ['P1', 'I1', 'I3', 'S1'];
const WEIGHTS = { F: 0.20, P: 0.30, I: 0.35, S: 0.15 };

// ── 类型 ────────────────────────────────────────────────────────

interface TeamSeasonRow {
  seed: number;
  season: number;
  teamId: string;
  level: 1 | 2 | 3;
  pos: number;
  overall: number;
  attack: number;
  defense: number;
  midfield: number;
  stability: number;
  reputation: number;
  depth: number;
  coachAtk: number;
  coachDef: number;
  boostAtk: number;
  boostMid: number;
  boostDef: number;
  top11: number;
  trueStrength: number;
  clubLines: number;
  played: number;
  drawn: number;
}

interface ImpactSample {
  season: number;
  seed: number;
  starGain: number;
  starLoss: number;
  /** 受控凸性：FW 单元 85→95 的边际 ÷ 70→80 的边际。 */
  unitPremium: number;
}

// ── 工具 ────────────────────────────────────────────────────────

function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return Number.NaN;
  const rank = (values: number[]): number[] => {
    const idx = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
    const out = new Array<number>(values.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].value === idx[i].value) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[idx[k].i] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return Number.NaN;
  return num / Math.sqrt(dx * dy);
}

const mean = (values: number[]): number =>
  (values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN);

function normAtLeast(value: number, target: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / target));
}
function normAtMost(value: number, target: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 1;
  return Math.max(0, Math.min(1, target / value));
}
function normInRange(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= lo && value <= hi) return 1;
  return value < lo ? Math.max(0, value / lo) : Math.max(0, hi / value);
}

// ── 真实强度基准 ────────────────────────────────────────────────
//
// 「真实强度」= 中性 state（morale 60 / fatigue 0 / momentum 0）下，
// 生产模型算出的三条线有效强度均值。用 calculateMatchModel 而不是复制
// adjustedStrengths 的公式，这样源码改动会被审计自动捕捉。
//
// 对手是一个中性 dummy：region 独立于所有真实球队，不会触发任何德比；
// overall 50 让 summit / focus 德比的 minOvr 门槛永不满足。

const AUDIT_DUMMY: TeamBase = {
  id: '__audit_dummy__',
  name: '审计基准队',
  shortName: '基准',
  color: '#000000',
  tier: 'mid',
  overall: 50,
  attack: 50,
  midfield: 50,
  defense: 50,
  stability: 50,
  depth: 50,
  reputation: 50,
  initialLeagueLevel: 3,
  expectation: 3,
  region: '审计+虚拟',
};

const NEUTRAL_STATE: TeamState = {
  id: '__audit_dummy__',
  leagueLevel: 1,
  morale: 60,
  fatigue: 0,
  momentum: 0,
  squadHealth: 100,
  coachPressure: 0,
  recentForm: [],
};

const ZERO_BOOSTS = { attack: 0, midfield: 0, defense: 0 };

function coachOf(world: GameWorld, teamId: string): CoachBase | null {
  for (const [coachId, state] of Object.entries(world.coachStates)) {
    if (state?.currentTeamId === teamId) return world.coachBases[coachId] ?? null;
  }
  return null;
}

function effectiveStrength(team: TeamBase, coach: CoachBase | null, boosts: PlayerBoosts): number {
  const model = calculateMatchModel({
    homeTeam: team,
    awayTeam: AUDIT_DUMMY,
    homeState: { ...NEUTRAL_STATE, id: team.id },
    awayState: NEUTRAL_STATE,
    homeCoach: coach,
    awayCoach: null,
    fixture: {
      homeTeamId: team.id,
      awayTeamId: AUDIT_DUMMY.id,
      competitionType: 'league1',
      isNeutralVenue: true,
      tournamentHostTeamId: undefined,
    },
    homeBoosts: boosts,
    awayBoosts: ZERO_BOOSTS,
  });
  return (model.home.attack + model.home.midfield + model.home.defense) / 3;
}

// ── 球员可感知度测量 ────────────────────────────────────────────
//
// 中立场排除主场加成。对每个 L1 球队取 3 个对手，测三个量：
//   starGain  该队最强 85+ 球员 rating +10 的胜率变化（I1）
//   starLoss  同一球员缺阵的胜率变化（I2）
//   midGain   该队最强 70-77 球员 rating +10 的胜率变化（I3 分母）

/**
 * 把某个位置的首发 slots 人全部钉到指定评分，其余球员不动。
 * 用于受控测量评分区间的边际价值，排除首发竞争的干扰。
 */
function forceUnitRating(
  squad: Player[],
  position: Player['position'],
  slots: number,
  rating: number,
): Player[] | null {
  const same = squad.filter(p => p.position === position).sort((a, b) => b.rating - a.rating);
  if (same.length < slots) return null;
  const targets = new Set(same.slice(0, slots).map(p => p.uuid));
  return squad.map(p => (targets.has(p.uuid) ? { ...p, rating } : p));
}

function measureImpact(world: GameWorld, gw: number, season: number, seed: number): ImpactSample[] {
  const l1Ids: string[] = (world.league1Standings ?? []).map(entry => entry.teamId);
  const teams: TeamBase[] = l1Ids
    .map(id => world.teamBases[id])
    .filter((team): team is TeamBase => Boolean(team));
  if (teams.length < 4) return [];

  const awayBoostsCache = new Map<string, PlayerBoosts>();
  const awayBoostOf = (team: TeamBase) => {
    if (!awayBoostsCache.has(team.id)) {
      awayBoostsCache.set(team.id, computeMatchdayModelReport(world.squads[team.id], gw, '4-3-3').boosts);
    }
    return awayBoostsCache.get(team.id);
  };

  const winPct = (home: TeamBase, away: TeamBase, homeBoosts: PlayerBoosts): number => {
    const model = calculateMatchModel({
      homeTeam: home,
      awayTeam: away,
      homeState: world.teamStates[home.id],
      awayState: world.teamStates[away.id],
      homeCoach: coachOf(world, home.id),
      awayCoach: coachOf(world, away.id),
      fixture: {
        homeTeamId: home.id,
        awayTeamId: away.id,
        competitionType: 'league1',
        isNeutralVenue: true,
        tournamentHostTeamId: undefined,
      },
      homeBoosts,
      awayBoosts: awayBoostOf(away),
    });
    return outcomeProbabilities(model.homeExpectedGoals, model.awayExpectedGoals).homeWinPct;
  };

  const homeBoostOf = (team: TeamBase) =>
    computeMatchdayModelReport(world.squads[team.id], gw, '4-3-3').boosts;

  const samples: ImpactSample[] = [];
  for (let i = 0; i < teams.length; i++) {
    const home = teams[i];
    const squad: Player[] = world.squads[home.id] ?? [];
    if (squad.length === 0) continue;
    const star = squad.filter(p => p.rating >= 85).sort((a, b) => b.rating - a.rating)[0];
    if (!star) continue;
    const opponents = [1, 5, 9]
      .map(offset => teams[(i + offset) % teams.length])
      .filter(team => team && team.id !== home.id);
    if (opponents.length === 0) continue;

    const saved = world.squads[home.id];
    // I3 用受控实验：把整个 FW 单元钉死在固定评分上，比较 85→95 与
    // 70→80 两段的边际。直接测「某个 85+ 球员 +10」会被首发竞争污染 ——
    // 一个 70 分球员 +10 常常是把他从 emergency floor（30 分）换进首发，
    // 边际虚高，反而让中游球员看起来比巨星更值钱（实测 I3 < 1）。
    const u70 = forceUnitRating(saved, 'FW', 3, 70);
    const u80 = forceUnitRating(saved, 'FW', 3, 80);
    const u85 = forceUnitRating(saved, 'FW', 3, 85);
    const u95 = forceUnitRating(saved, 'FW', 3, 95);

    let starGain = 0;
    let starLoss = 0;
    let premiumSum = 0;
    let premiumCount = 0;
    let counted = 0;
    for (const away of opponents) {
      const base = winPct(home, away, homeBoostOf(home));

      world.squads[home.id] = saved.map(p =>
        p.uuid === star.uuid ? { ...p, rating: Math.min(99, p.rating + 10) } : p);
      starGain += winPct(home, away, homeBoostOf(home)) - base;

      world.squads[home.id] = saved.filter(p => p.uuid !== star.uuid);
      starLoss += winPct(home, away, homeBoostOf(home)) - base;

      if (u70 && u80 && u85 && u95) {
        world.squads[home.id] = u70;
        const w70 = winPct(home, away, homeBoostOf(home));
        world.squads[home.id] = u80;
        const w80 = winPct(home, away, homeBoostOf(home));
        world.squads[home.id] = u85;
        const w85 = winPct(home, away, homeBoostOf(home));
        world.squads[home.id] = u95;
        const w95 = winPct(home, away, homeBoostOf(home));
        const low = w80 - w70;
        if (low > 0.01) {
          premiumSum += (w95 - w85) / low;
          premiumCount++;
        }
      }

      world.squads[home.id] = saved;
      counted++;
    }
    samples.push({
      season, seed,
      starGain: starGain / counted,
      starLoss: starLoss / counted,
      unitPremium: premiumCount > 0 ? premiumSum / premiumCount : Number.NaN,
    });
  }
  return samples;
}

// ── 数据收集 ────────────────────────────────────────────────────

const rows: TeamSeasonRow[] = [];
const impactSamples: ImpactSample[] = [];
const startedAt = performance.now();

for (const seed of seeds) {
  let world: GameWorld = initializeGameWorld(seed);
  for (let step = 0; step < seasons; step++) {
    const season = world.seasonState.seasonNumber;
    while (world.seasonState.seasonNumber === season) {
      world = executeCurrentWindow(world).world;
    }
    const gw = world.seasonState.globalWindowIdx ?? 0;

    // 赛季结束后 league*Standings 已被重置为新赛季的空表（played / points
    // 全为 0，数组顺序只是残留）。teamSeasonRecords 才是赛季结束时的真实快照，
    // 带 leaguePosition / leaguePlayed / leagueDrawn。
    for (const [teamId, records] of Object.entries(world.teamSeasonRecords)) {
      const record = records.find(item => item.seasonNumber === season);
      if (!record) continue;
      const base: TeamBase | undefined = world.teamBases[teamId];
      if (!base) continue;
      const squad: Player[] = world.squads[teamId] ?? [];
      const sorted = [...squad].sort((a, b) => b.rating - a.rating);
      const top11 = sorted.slice(0, 11);
      const coach = coachOf(world, teamId);
      // 纸面最强阵容（不做伤停过滤）——代表球队的固有实力，
      // 伤停是短期波动，不应进入「真实强度」基准。
      const boosts = computeSelectedPlayerBoosts(squad, '4-3-3');
      rows.push({
        seed,
        season,
        teamId,
        level: record.leagueLevel,
        pos: record.leaguePosition,
        overall: base.overall,
        attack: base.attack,
        defense: base.defense,
        midfield: base.midfield,
        stability: base.stability,
        reputation: base.reputation,
        depth: base.depth,
        coachAtk: coach?.attackBuff ?? 0,
        coachDef: coach?.defenseBuff ?? 0,
        boostAtk: boosts.attack,
        boostMid: boosts.midfield,
        boostDef: boosts.defense,
        top11: top11.length ? mean(top11.map(p => p.rating)) : 0,
        trueStrength: effectiveStrength(base, coach, boosts),
        clubLines: (base.attack + base.defense + base.midfield) / 3,
        played: record.leaguePlayed ?? 0,
        drawn: record.leagueDrawn ?? 0,
      });
    }

    if (impactSampleEvery > 0 && season % impactSampleEvery === 0) {
      impactSamples.push(...measureImpact(world, gw, season, seed));
    }
  }
  process.stdout.write(`seed ${seed} done\n`);
}

// ── 分箱统计 ────────────────────────────────────────────────────

interface BandStats {
  name: string;
  teamSeasons: number;
  ovrVsStrength: number;
  ovrDeviationMean: number;
  ovrDeviationAbsMean: number;
  predict: Record<string, Record<'L1' | 'L2' | 'L3', number>>;
  drawRateL1: number;
  ovrCapShare: number;
}

const PREDICTORS: Array<[string, (row: TeamSeasonRow) => number]> = [
  ['OVR', row => row.overall],
  ['trueStrength', row => row.trueStrength],
  ['clubLines', row => row.clubLines],
  ['attack', row => row.attack],
  ['defense', row => row.defense],
  ['midfield', row => row.midfield],
  ['top11', row => row.top11],
  ['boostAtk', row => row.boostAtk],
  ['reputation', row => row.reputation],
];

const bandStats: BandStats[] = bands.map(band => {
  const inBand = rows.filter(row => row.season >= band.lo && row.season <= band.hi);
  const predict: BandStats['predict'] = {};
  for (const [name, read] of PREDICTORS) {
    predict[name] = { L1: Number.NaN, L2: Number.NaN, L3: Number.NaN };
    for (const level of [1, 2, 3] as const) {
      const group = inBand.filter(row => row.level === level);
      predict[name][`L${level}` as 'L1' | 'L2' | 'L3'] = group.length >= 8
        ? spearman(group.map(read), group.map(row => -row.pos))
        : Number.NaN;
    }
  }
  const l1 = inBand.filter(row => row.level === 1);
  const playedTotal = l1.reduce((sum, row) => sum + row.played, 0);
  const drawnTotal = l1.reduce((sum, row) => sum + row.drawn, 0);
  return {
    name: band.name,
    teamSeasons: inBand.length,
    ovrVsStrength: spearman(inBand.map(row => row.overall), inBand.map(row => row.trueStrength)),
    ovrDeviationMean: mean(inBand.map(row => row.overall - row.trueStrength)),
    ovrDeviationAbsMean: mean(inBand.map(row => Math.abs(row.overall - row.trueStrength))),
    predict,
    drawRateL1: playedTotal > 0 ? drawnTotal / playedTotal : Number.NaN,
    ovrCapShare: inBand.length ? inBand.filter(row => row.overall >= 96).length / inBand.length : Number.NaN,
  };
});

const statOf = (name: string) => bandStats.find(stat => stat.name === name)!;
const first = statOf(firstBand.name);
const last = statOf(lastBand.name);

/** L1/L2 按样本量加权的预测力均值。 */
function weightedPredict(stat: BandStats, predictor: string): number {
  const inBand = rows.filter(row =>
    row.season >= bands.find(b => b.name === stat.name)!.lo
    && row.season <= bands.find(b => b.name === stat.name)!.hi);
  const l1 = inBand.filter(row => row.level === 1).length;
  const l2 = inBand.filter(row => row.level === 2).length;
  const p1 = stat.predict[predictor].L1;
  const p2 = stat.predict[predictor].L2;
  if (!Number.isFinite(p1) && !Number.isFinite(p2)) return Number.NaN;
  if (!Number.isFinite(p1)) return p2;
  if (!Number.isFinite(p2)) return p1;
  return (p1 * l1 + p2 * l2) / (l1 + l2);
}

// ── 指数 ────────────────────────────────────────────────────────

const F1 = 1 - last.ovrDeviationAbsMean / 10;
const F2 = 1 - Math.abs(first.ovrVsStrength - last.ovrVsStrength);

const P1 = mean(bandStats.map(stat => weightedPredict(stat, 'OVR')));
const P2 = mean(bandStats.map(stat =>
  weightedPredict(stat, 'trueStrength') - weightedPredict(stat, 'OVR')));
const P3 = first.predict.OVR.L1 - last.predict.OVR.L1;

const I1 = mean(impactSamples.map(sample => sample.starGain));
const I2 = Math.abs(mean(impactSamples.map(sample => sample.starLoss)));
const I3 = mean(impactSamples.map(sample => sample.unitPremium).filter(Number.isFinite));
const I4 = mean(bandStats.map(stat => weightedPredict(stat, 'clubLines')));

const S1 = Math.min(...bandStats.flatMap(stat =>
  ([1, 2, 3] as const).map(level => stat.predict.attack[`L${level}` as 'L1' | 'L2' | 'L3'])
    .filter(Number.isFinite)));
const S2 = Math.abs(last.predict.trueStrength.L1 - last.predict.trueStrength.L3);
const S3 = mean(bandStats.map(stat => stat.ovrCapShare));
const S4 = mean(bandStats.map(stat => stat.drawRateL1));

const indices: Record<string, { value: number; target: unknown; score: number; pass: boolean }> = {
  F1: { value: F1, target: `>= ${TARGETS.F1}`, score: normAtLeast(F1, TARGETS.F1), pass: F1 >= TARGETS.F1 },
  F2: { value: F2, target: `>= ${TARGETS.F2}`, score: normAtLeast(F2, TARGETS.F2), pass: F2 >= TARGETS.F2 },
  P1: { value: P1, target: `>= ${TARGETS.P1}`, score: normAtLeast(P1, TARGETS.P1), pass: P1 >= TARGETS.P1 },
  P2: { value: P2, target: `<= ${TARGETS.P2}`, score: normAtMost(P2, TARGETS.P2), pass: P2 <= TARGETS.P2 },
  P3: { value: P3, target: `<= ${TARGETS.P3}`, score: normAtMost(P3, TARGETS.P3), pass: P3 <= TARGETS.P3 },
  I1: { value: I1, target: TARGETS.I1, score: normInRange(I1, ...TARGETS.I1), pass: I1 >= TARGETS.I1[0] && I1 <= TARGETS.I1[1] },
  I2: { value: I2, target: TARGETS.I2, score: normInRange(I2, ...TARGETS.I2), pass: I2 >= TARGETS.I2[0] && I2 <= TARGETS.I2[1] },
  I3: { value: I3, target: TARGETS.I3, score: normInRange(I3, ...TARGETS.I3), pass: I3 >= TARGETS.I3[0] && I3 <= TARGETS.I3[1] },
  I4: { value: I4, target: `>= ${TARGETS.I4}`, score: normAtLeast(I4, TARGETS.I4), pass: I4 >= TARGETS.I4 },
  S1: { value: S1, target: `>= ${TARGETS.S1}`, score: normAtLeast(S1, TARGETS.S1), pass: S1 >= TARGETS.S1 },
  S2: { value: S2, target: `<= ${TARGETS.S2}`, score: normAtMost(S2, TARGETS.S2), pass: S2 <= TARGETS.S2 },
  S3: { value: S3, target: `<= ${TARGETS.S3}`, score: normAtMost(S3, TARGETS.S3), pass: S3 <= TARGETS.S3 },
  S4: { value: S4, target: TARGETS.S4, score: normInRange(S4, ...TARGETS.S4), pass: S4 >= TARGETS.S4[0] && S4 <= TARGETS.S4[1] },
};

const groupScore = (keys: string[]) => mean(keys.map(key => indices[key].score));
const balanceIndex = WEIGHTS.F * groupScore(['F1', 'F2'])
  + WEIGHTS.P * groupScore(['P1', 'P2', 'P3'])
  + WEIGHTS.I * groupScore(['I1', 'I2', 'I3', 'I4'])
  + WEIGHTS.S * groupScore(['S1', 'S2', 'S3', 'S4']);

// ── violations ──────────────────────────────────────────────────

const violations: string[] = [];
for (const [key, entry] of Object.entries(indices)) {
  if (entry.pass) continue;
  const gate = HARD_GATES.includes(key) ? ' [HARD GATE]' : '';
  violations.push(
    `${key}${gate}: ${Number.isFinite(entry.value) ? entry.value.toFixed(3) : 'n/a'} misses target ${JSON.stringify(entry.target)}`,
  );
}
if (balanceIndex < 0.80) {
  violations.push(`Balance index ${balanceIndex.toFixed(3)} is below the 0.80 acceptance line.`);
}

// ── 输出 ────────────────────────────────────────────────────────

const fmt = (value: number, digits = 3): string =>
  (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');

console.log('');
console.log('=== 分箱诊断 ===');
console.log('区间'.padEnd(9) + '队-季'.padStart(7) + 'OVR↔强度'.padStart(10)
  + '偏差'.padStart(8) + '|偏差|'.padStart(8) + '撞顶率'.padStart(8) + 'L1平局率'.padStart(10));
for (const stat of bandStats) {
  console.log(stat.name.padEnd(9) + String(stat.teamSeasons).padStart(7)
    + fmt(stat.ovrVsStrength).padStart(10)
    + fmt(stat.ovrDeviationMean, 1).padStart(8)
    + fmt(stat.ovrDeviationAbsMean, 1).padStart(8)
    + (fmt(stat.ovrCapShare * 100, 1) + '%').padStart(8)
    + (fmt(stat.drawRateL1 * 100, 1) + '%').padStart(10));
}

console.log('');
console.log('=== 排名预测力（Spearman，对最终排名）===');
console.log('区间'.padEnd(9) + '级别'.padStart(5) + PREDICTORS.map(([name]) => name.padStart(14)).join(''));
for (const stat of bandStats) {
  for (const level of ['L1', 'L2', 'L3'] as const) {
    console.log(stat.name.padEnd(9) + level.padStart(5)
      + PREDICTORS.map(([name]) => fmt(stat.predict[name][level]).padStart(14)).join(''));
  }
}

console.log('');
console.log('=== 平衡指数 ===');
console.log('指数'.padEnd(6) + '实测'.padStart(10) + '目标'.padStart(16) + '得分'.padStart(8) + '  状态');
for (const [key, entry] of Object.entries(indices)) {
  const gate = HARD_GATES.includes(key) ? ' *' : '';
  console.log((key + gate).padEnd(6)
    + fmt(entry.value).padStart(10)
    + String(typeof entry.target === 'string' ? entry.target : JSON.stringify(entry.target)).padStart(16)
    + fmt(entry.score, 2).padStart(8)
    + '  ' + (entry.pass ? 'PASS' : 'FAIL'));
}
console.log('');
console.log(`Balance Index = ${balanceIndex.toFixed(3)}  (F ${fmt(groupScore(['F1','F2']), 2)} · P ${fmt(groupScore(['P1','P2','P3']), 2)} · I ${fmt(groupScore(['I1','I2','I3','I4']), 2)} · S ${fmt(groupScore(['S1','S2','S3','S4']), 2)})`);
console.log(`样本：${rows.length} 队-季 · ${impactSamples.length} 球员影响样本 · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);

const report = {
  config: { seeds, seasons, impactSampleEvery, bands: bands.map(band => band.name) },
  samples: { teamSeasons: rows.length, impactSamples: impactSamples.length },
  durationMs: Math.round(performance.now() - startedAt),
  bands: bandStats,
  indices,
  groupScores: {
    F: groupScore(['F1', 'F2']),
    P: groupScore(['P1', 'P2', 'P3']),
    I: groupScore(['I1', 'I2', 'I3', 'I4']),
    S: groupScore(['S1', 'S2', 'S3', 'S4']),
  },
  balanceIndex,
  violations,
};
console.log(JSON.stringify(report, null, 2));
if (violations.length > 0) process.exitCode = 1;
