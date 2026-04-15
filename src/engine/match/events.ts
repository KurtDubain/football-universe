import { MatchEvent, CompetitionType } from '../../types';
import { Player } from '../../types/player';
import { SeededRNG } from './rng';

// ── Goal description pools (Chinese) ──────────────────────────────

const OPEN_PLAY_GOALS = [
  '底线附近低射破门',
  '禁区外弧线球破门',
  '精准传中头球攻门得手',
  '精妙配合后近距离推射入网',
  '25码外大力抽射破门',
  '反击中冷静推射得手',
  '单刀面对门将轻巧挑射',
  '凌空抽射直挂球门死角',
  '防守失误后果断射门得分',
  '人丛中劲射穿透防线',
  '折射球令门将措手不及',
  '挑射越过出击的门将',
  '小角度低射钻入远角',
  '门前混战中捅射入网',
  '精彩个人突破后射门得分',
  '禁区内转身抽射破门',
  '巧妙跑位后包抄推射',
  '长途奔袭后怒射入网',
  '二过一配合后轻松推射',
  '胸部停球后凌空抽射',
];

const SET_PIECE_GOALS = [
  '任意球绕过人墙直入球门',
  '角球头球攻门得手',
  '战术角球后远射破门',
  '定位球头球力压防守球员破门',
  '角球引发混战后补射入网',
];

const PENALTY_GOALS = [
  '点球命中，骗过门将方向',
  '点球大力轰向球门中路',
  '点球推射左下角入网',
  '点球推射右下角入网',
];

const SAVE_DESCRIPTIONS = [
  '门将飞身扑救将球托出',
  '近距离条件反射式扑救',
  '强有力的掌挡将球击出横梁',
  '精彩的一对一扑救',
  '极限指尖扑救力拒射门',
  '门将神勇鱼跃扑救化解险情',
  '门将双掌将皮球牢牢抱住',
];

const MISS_DESCRIPTIONS = [
  '好位置射门打飞了',
  '禁区外射门偏出立柱',
  '单刀射门拉偏远角',
  '头球顶高了横梁',
  '后点包抄射门偏出',
  '大力射门击中横梁弹出',
];

const YELLOW_CARD_DESCRIPTIONS = [
  '飞铲犯规被黄牌警告',
  '鲁莽犯规领到黄牌',
  '累计犯规被出示黄牌',
  '战术犯规阻止反击吃牌',
  '向裁判抗议被黄牌警告',
  '拖延时间被黄牌警告',
  '拉拽进攻球员被出牌',
  '手球犯规被出示黄牌',
  '背后铲球被警告',
];

const RED_CARD_DESCRIPTIONS = [
  '恶意犯规被直接红牌罚下',
  '两黄变一红被罚下场',
  '暴力行为被直接红牌',
  '阻止明显得分机会被红牌罚下',
];

const PENALTY_SHOOTOUT_GOAL = [
  '冷静推射命中球门角落',
  '大力抽射命中上角，门将毫无办法',
  '骗过门将方向从容罚进',
  '果断推射正中球门中路得手',
];

const PENALTY_SHOOTOUT_MISS = [
  '点球被门将扑出！',
  '点球打飞了横梁！',
  '点球击中立柱弹出！',
  '点球力量不足被门将轻松扑住',
];

// ── Player picking helpers ────────────────────────────────────────

/**
 * Pick a player from the squad weighted by position relevance and goalScoring stat.
 * positionWeights maps position to a base weight multiplier.
 * The goalScoring stat is then used as additional weighting for scoring events.
 */
function pickPlayer(
  squad: Player[],
  positionWeights: Record<string, number>,
  rng: SeededRNG,
  useGoalScoring: boolean = false,
): Player {
  const weights = squad.map((p) => {
    const posWeight = positionWeights[p.position] ?? 1;
    const scoringWeight = useGoalScoring ? Math.max(1, p.goalScoring) : 10;
    return posWeight * scoringWeight;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng.next() * total;

  for (let i = 0; i < squad.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return squad[i];
  }

  return squad[squad.length - 1];
}

/**
 * Pick a goal scorer: heavily weighted toward FW, then MF, rarely DF.
 */
function pickGoalScorer(squad: Player[], rng: SeededRNG): Player {
  return pickPlayer(
    squad,
    { FW: 10, MF: 4, DF: 1, GK: 0.05 },
    rng,
    true,
  );
}

/**
 * Pick a player for yellow/red cards: mostly DF and MF.
 */
function pickCardPlayer(squad: Player[], rng: SeededRNG): Player {
  return pickPlayer(
    squad,
    { DF: 10, MF: 6, FW: 3, GK: 1 },
    rng,
    false,
  );
}

/**
 * Pick a GK from the squad (prefer #1 or lowest-numbered GK).
 */
function pickGoalkeeper(squad: Player[]): Player {
  const gks = squad.filter((p) => p.position === 'GK');
  if (gks.length === 0) return squad[0]; // fallback
  // Prefer #1 if available, otherwise lowest numbered GK
  const gk1 = gks.find((p) => p.number === 1);
  if (gk1) return gk1;
  gks.sort((a, b) => a.number - b.number);
  return gks[0];
}

/**
 * Pick a player for misses: FW and MF mostly.
 */
function pickMissPlayer(squad: Player[], rng: SeededRNG): Player {
  return pickPlayer(
    squad,
    { FW: 8, MF: 5, DF: 1, GK: 0.1 },
    rng,
    true,
  );
}

/**
 * Format a description with optional player number prefix.
 */
function formatDescription(
  description: string,
  playerNumber?: number,
): string {
  if (playerNumber !== undefined) {
    return `${playerNumber}号 ${description}`;
  }
  return description;
}

// ── Minute weighting ───────────────────────────────────────────────

/**
 * Goals tend to cluster in certain periods:
 * - Just before half time (40-45)
 * - After the hour mark (60-75)
 * - Late drama (85-90+)
 * This returns a weighted minute for a goal.
 */
function weightedGoalMinute(maxMinute: number, rng: SeededRNG): number {
  const r = rng.next();

  if (maxMinute <= 90) {
    // Normal time distribution
    if (r < 0.08) return rng.nextInt(1, 10); // early
    if (r < 0.2) return rng.nextInt(11, 25); // mid first half
    if (r < 0.35) return rng.nextInt(26, 39); // late first half
    if (r < 0.5) return rng.nextInt(40, 45); // just before HT (clustered)
    if (r < 0.58) return rng.nextInt(46, 55); // early second half
    if (r < 0.75) return rng.nextInt(56, 69); // mid second half
    if (r < 0.9) return rng.nextInt(70, 84); // after 70' (clustered)
    return rng.nextInt(85, 90); // late drama
  }

  // Extra time distribution (goals in 91-120)
  if (r < 0.55) {
    // 55% of ET goals in first period
    return rng.nextInt(91, 105);
  }
  return rng.nextInt(106, 120);
}

function randomMinuteInRange(
  min: number,
  max: number,
  rng: SeededRNG,
): number {
  return rng.nextInt(min, max);
}

// ── Main export ────────────────────────────────────────────────────

export function generateMatchEvents(
  homeGoals: number,
  awayGoals: number,
  homeTeamId: string,
  awayTeamId: string,
  _competitionType: CompetitionType,
  rng: SeededRNG,
  extraTime: boolean,
  penaltyHome?: number,
  penaltyAway?: number,
  homeSquad?: Player[],
  awaySquad?: Player[],
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const maxNormalMinute = 90;
  const maxMinute = extraTime ? 120 : 90;

  // Helper to get squad for a team (may be undefined for backward compat)
  function getSquad(teamId: string): Player[] | undefined {
    if (teamId === homeTeamId) return homeSquad;
    if (teamId === awayTeamId) return awaySquad;
    return undefined;
  }

  // ── Generate goals ───────────────────────────────────────────────

  const generateGoalEvents = (
    goals: number,
    teamId: string,
    isET: boolean,
  ): void => {
    const squad = getSquad(teamId);

    for (let i = 0; i < goals; i++) {
      const minute = isET
        ? weightedGoalMinute(120, rng)
        : weightedGoalMinute(90, rng);

      // ~10% of goals are from set pieces, ~8% are penalties in open play
      const roll = rng.next();
      let description: string;
      if (roll < 0.08) {
        description = rng.pick(PENALTY_GOALS);
      } else if (roll < 0.18) {
        description = rng.pick(SET_PIECE_GOALS);
      } else {
        description = rng.pick(OPEN_PLAY_GOALS);
      }

      // Pick a scorer if squad is available
      let playerId: string | undefined;
      let playerNumber: number | undefined;
      if (squad) {
        const scorer = pickGoalScorer(squad, rng);
        playerId = scorer.id;
        playerNumber = scorer.number;
      }

      events.push({
        minute,
        type: 'goal',
        teamId,
        playerId,
        playerNumber,
        description: formatDescription(description, playerNumber),
      });
    }
  };

  // Normal-time goals
  generateGoalEvents(homeGoals, homeTeamId, false);
  generateGoalEvents(awayGoals, awayTeamId, false);

  // ── Yellow cards (2-6 per match) ─────────────────────────────────

  const totalYellows = rng.nextInt(2, 6);
  for (let i = 0; i < totalYellows; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    const description = rng.pick(YELLOW_CARD_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    if (squad) {
      const player = pickCardPlayer(squad, rng);
      playerId = player.id;
      playerNumber = player.number;
    }

    events.push({
      minute,
      type: 'yellow_card',
      teamId,
      playerId,
      playerNumber,
      description: formatDescription(description, playerNumber),
    });
  }

  // ── Red cards (rare, ~6% chance per match, max 1 usually) ───────

  if (rng.next() < 0.06) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(20, maxMinute, rng);
    const description = rng.pick(RED_CARD_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    if (squad) {
      const player = pickCardPlayer(squad, rng);
      playerId = player.id;
      playerNumber = player.number;
    }

    events.push({
      minute,
      type: 'red_card',
      teamId,
      playerId,
      playerNumber,
      description: formatDescription(description, playerNumber),
    });
  }

  // ── Key saves (1-4) ──────────────────────────────────────────────

  const totalSaves = rng.nextInt(1, 4);
  for (let i = 0; i < totalSaves; i++) {
    // Saves are attributed to the keeper's team
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    const description = rng.pick(SAVE_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    if (squad) {
      const gk = pickGoalkeeper(squad);
      playerId = gk.id;
      playerNumber = gk.number;
    }

    events.push({
      minute,
      type: 'save',
      teamId,
      playerId,
      playerNumber,
      description: formatDescription(description, playerNumber),
    });
  }

  // ── Near misses (1-3) ────────────────────────────────────────────

  const totalMisses = rng.nextInt(1, 3);
  for (let i = 0; i < totalMisses; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    const description = rng.pick(MISS_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    if (squad) {
      const player = pickMissPlayer(squad, rng);
      playerId = player.id;
      playerNumber = player.number;
    }

    events.push({
      minute,
      type: 'miss',
      teamId,
      playerId,
      playerNumber,
      description: formatDescription(description, playerNumber),
    });
  }

  // ── Penalty shootout events ──────────────────────────────────────

  if (penaltyHome !== undefined && penaltyAway !== undefined) {
    // Simulate a realistic shootout order.
    // Standard: 5 rounds, then sudden death.
    const homeScored = penaltyHome;
    const awayScored = penaltyAway;
    const totalPens = Math.max(homeScored + awayScored, 6); // at least 3 rounds each
    const maxRounds = Math.ceil(totalPens / 2);

    let homeRemaining = homeScored;
    let awayRemaining = awayScored;
    let penMinute = maxNormalMinute + (extraTime ? 30 : 0) + 1; // 121 typically

    for (let round = 0; round < maxRounds; round++) {
      // Home takes
      const homeShooterSquad = homeSquad;
      let homeShooterPlayerId: string | undefined;
      let homeShooterNumber: number | undefined;
      if (homeShooterSquad) {
        // Pick from outfield players for shootout
        const outfield = homeShooterSquad.filter((p) => p.position !== 'GK');
        const shooter =
          outfield.length > 0
            ? pickPlayer(outfield, { FW: 8, MF: 5, DF: 2, GK: 0 }, rng, true)
            : homeShooterSquad[0];
        homeShooterPlayerId = shooter.id;
        homeShooterNumber = shooter.number;
      }

      if (homeRemaining > 0) {
        const desc = rng.pick(PENALTY_SHOOTOUT_GOAL);
        events.push({
          minute: penMinute,
          type: 'penalty_goal',
          teamId: homeTeamId,
          playerId: homeShooterPlayerId,
          playerNumber: homeShooterNumber,
          description: formatDescription(desc, homeShooterNumber),
        });
        homeRemaining--;
      } else {
        const desc = rng.pick(PENALTY_SHOOTOUT_MISS);
        events.push({
          minute: penMinute,
          type: 'penalty_miss',
          teamId: homeTeamId,
          playerId: homeShooterPlayerId,
          playerNumber: homeShooterNumber,
          description: formatDescription(desc, homeShooterNumber),
        });
      }
      penMinute++;

      // Away takes
      const awayShooterSquad = awaySquad;
      let awayShooterPlayerId: string | undefined;
      let awayShooterNumber: number | undefined;
      if (awayShooterSquad) {
        const outfield = awayShooterSquad.filter((p) => p.position !== 'GK');
        const shooter =
          outfield.length > 0
            ? pickPlayer(outfield, { FW: 8, MF: 5, DF: 2, GK: 0 }, rng, true)
            : awayShooterSquad[0];
        awayShooterPlayerId = shooter.id;
        awayShooterNumber = shooter.number;
      }

      if (awayRemaining > 0) {
        const desc = rng.pick(PENALTY_SHOOTOUT_GOAL);
        events.push({
          minute: penMinute,
          type: 'penalty_goal',
          teamId: awayTeamId,
          playerId: awayShooterPlayerId,
          playerNumber: awayShooterNumber,
          description: formatDescription(desc, awayShooterNumber),
        });
        awayRemaining--;
      } else {
        const desc = rng.pick(PENALTY_SHOOTOUT_MISS);
        events.push({
          minute: penMinute,
          type: 'penalty_miss',
          teamId: awayTeamId,
          playerId: awayShooterPlayerId,
          playerNumber: awayShooterNumber,
          description: formatDescription(desc, awayShooterNumber),
        });
      }
      penMinute++;
    }
  }

  // ── Sort all events chronologically ──────────────────────────────

  events.sort((a, b) => a.minute - b.minute);

  return events;
}
