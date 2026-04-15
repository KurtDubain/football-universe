import { MatchEvent, CompetitionType } from '../../types';
import { SeededRNG } from './rng';

// ── Goal description pools ─────────────────────────────────────────

const OPEN_PLAY_GOALS = [
  'Low drive into the bottom corner',
  'Curling shot from the edge of the box',
  'Header from a pinpoint cross',
  'Tap-in from close range after a great team move',
  'Powerful strike from 25 yards',
  'Neat finish on the counter-attack',
  'One-on-one with the keeper, slotted home coolly',
  'Volley smashed into the roof of the net',
  'Clinical finish after a defensive mistake',
  'Driven shot through a crowded box',
  'Deflected effort that wrong-footed the keeper',
  'Chip over the advancing goalkeeper',
  'Drilled low finish from a tight angle',
  'Scramble in the six-yard box, poked home',
  'Brilliant individual run finished off in style',
];

const SET_PIECE_GOALS = [
  'Free kick curled over the wall and into the net',
  'Header from a corner kick',
  'Shot from the edge of the area after a short corner',
  'Powerful header from a set-piece delivery',
  'Bundled in after a goalmouth scramble from a corner',
];

const PENALTY_GOALS = [
  'Penalty kick converted, sent the keeper the wrong way',
  'Penalty struck hard down the middle',
  'Penalty placed into the bottom-left corner',
  'Penalty tucked away into the bottom-right corner',
];

const SAVE_DESCRIPTIONS = [
  'Brilliant diving save to tip the shot wide',
  'Reflexive stop from close range',
  'Strong hand to push the shot over the bar',
  'Outstanding one-on-one save',
  'Full-stretch fingertip save to deny the striker',
];

const MISS_DESCRIPTIONS = [
  'Shot blazed over the crossbar from a good position',
  'Effort from the edge of the box goes just wide',
  'One-on-one missed, dragged wide of the far post',
  'Header goes narrowly over the bar',
  'Free header at the back post put wide',
  'Powerful strike rattles the crossbar',
];

const YELLOW_CARD_DESCRIPTIONS = [
  'Booked for a late challenge',
  'Yellow card for a reckless foul',
  'Cautioned for persistent fouling',
  'Booked for a cynical trip to stop the counter',
  'Yellow card for dissent',
  'Cautioned for time-wasting',
  'Booked for pulling back an attacker',
];

const RED_CARD_DESCRIPTIONS = [
  'Sent off for a dangerous tackle',
  'Red card! Second yellow for repeated fouling',
  'Straight red for violent conduct',
  'Dismissed for denying a clear goal-scoring opportunity',
];

const PENALTY_SHOOTOUT_GOAL = [
  'Calmly slots the penalty into the bottom corner',
  'Smashes the penalty into the top corner, no chance for the keeper',
  'Sends the keeper the wrong way with a composed finish',
  'Steps up and buries the penalty down the middle',
];

const PENALTY_SHOOTOUT_MISS = [
  'Penalty saved! The keeper guesses correctly',
  'Blazes the penalty over the crossbar',
  'Penalty strikes the post and goes wide',
  'Weak penalty easily saved by the goalkeeper',
];

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
    if (r < 0.08) return rng.nextInt(1, 10);       // early
    if (r < 0.20) return rng.nextInt(11, 25);       // mid first half
    if (r < 0.35) return rng.nextInt(26, 39);       // late first half
    if (r < 0.50) return rng.nextInt(40, 45);       // just before HT (clustered)
    if (r < 0.58) return rng.nextInt(46, 55);       // early second half
    if (r < 0.75) return rng.nextInt(56, 69);       // mid second half
    if (r < 0.90) return rng.nextInt(70, 84);       // after 70' (clustered)
    return rng.nextInt(85, 90);                      // late drama
  }

  // Extra time distribution (goals in 91-120)
  if (r < 0.55) {
    // 55% of ET goals in first period
    return rng.nextInt(91, 105);
  }
  return rng.nextInt(106, 120);
}

function randomMinuteInRange(min: number, max: number, rng: SeededRNG): number {
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
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const maxNormalMinute = 90;
  const maxMinute = extraTime ? 120 : 90;

  // ── Generate goals ───────────────────────────────────────────────

  const generateGoalEvents = (
    goals: number,
    teamId: string,
    isET: boolean,
  ): void => {
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

      events.push({ minute, type: 'goal', teamId, description });
    }
  };

  // Normal-time goals
  generateGoalEvents(homeGoals, homeTeamId, false);
  generateGoalEvents(awayGoals, awayTeamId, false);

  // If extra time was played but there are extra-time goals encoded
  // in the totals, we already handle them via the ET flag in the
  // caller. The homeGoals/awayGoals passed here represent the
  // regulation-time score; ET goals would come separately.
  // However, to keep the API simple, when extraTime is true and
  // the caller passes combined totals, goals may land in 91-120.

  // ── Yellow cards (2-6 per match) ─────────────────────────────────

  const totalYellows = rng.nextInt(2, 6);
  for (let i = 0; i < totalYellows; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    events.push({
      minute,
      type: 'yellow_card',
      teamId,
      description: rng.pick(YELLOW_CARD_DESCRIPTIONS),
    });
  }

  // ── Red cards (rare, ~6% chance per match, max 1 usually) ───────

  if (rng.next() < 0.06) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(20, maxMinute, rng);
    events.push({
      minute,
      type: 'red_card',
      teamId,
      description: rng.pick(RED_CARD_DESCRIPTIONS),
    });
  }

  // ── Key saves (1-4) ──────────────────────────────────────────────

  const totalSaves = rng.nextInt(1, 4);
  for (let i = 0; i < totalSaves; i++) {
    // Saves are attributed to the defending team (conceding the shot)
    // but in our model we attribute the save to the keeper's team
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    events.push({
      minute,
      type: 'save',
      teamId,
      description: rng.pick(SAVE_DESCRIPTIONS),
    });
  }

  // ── Near misses (1-3) ────────────────────────────────────────────

  const totalMisses = rng.nextInt(1, 3);
  for (let i = 0; i < totalMisses; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    events.push({
      minute,
      type: 'miss',
      teamId,
      description: rng.pick(MISS_DESCRIPTIONS),
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
      if (homeRemaining > 0) {
        events.push({
          minute: penMinute,
          type: 'penalty_goal',
          teamId: homeTeamId,
          description: rng.pick(PENALTY_SHOOTOUT_GOAL),
        });
        homeRemaining--;
      } else {
        events.push({
          minute: penMinute,
          type: 'penalty_miss',
          teamId: homeTeamId,
          description: rng.pick(PENALTY_SHOOTOUT_MISS),
        });
      }
      penMinute++;

      // Away takes
      if (awayRemaining > 0) {
        events.push({
          minute: penMinute,
          type: 'penalty_goal',
          teamId: awayTeamId,
          description: rng.pick(PENALTY_SHOOTOUT_GOAL),
        });
        awayRemaining--;
      } else {
        events.push({
          minute: penMinute,
          type: 'penalty_miss',
          teamId: awayTeamId,
          description: rng.pick(PENALTY_SHOOTOUT_MISS),
        });
      }
      penMinute++;
    }
  }

  // ── Sort all events chronologically ──────────────────────────────

  events.sort((a, b) => a.minute - b.minute);

  return events;
}
