import type { PenaltyShootoutKick, PenaltyShootoutResult } from '../../types/match';
import { SeededRNG } from './rng';

function missOutcome(rng: SeededRNG): PenaltyShootoutKick['outcome'] {
  const roll = rng.next();
  if (roll < 0.55) return 'saved';
  if (roll < 0.8) return 'off_target';
  return 'woodwork';
}

function takeKick(
  team: PenaltyShootoutKick['team'],
  round: number,
  suddenDeath: boolean,
  teamKickNumber: number,
  kicks: PenaltyShootoutKick[],
  rng: SeededRNG,
): PenaltyShootoutKick {
  const scored = rng.next() < 0.75;
  const kick: PenaltyShootoutKick = {
    team,
    kickNumber: kicks.length + 1,
    round,
    teamKickNumber,
    suddenDeath,
    outcome: scored ? 'scored' : missOutcome(rng),
  };
  kicks.push(kick);
  return kick;
}

/** Simulate a legal alternating shootout, including early wins and sudden death. */
export function simulatePenaltyShootout(rng: SeededRNG): PenaltyShootoutResult {
  const kicks: PenaltyShootoutKick[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let homeTaken = 0;
  let awayTaken = 0;

  for (let round = 1; round <= 5; round++) {
    homeTaken++;
    if (takeKick('home', round, false, homeTaken, kicks, rng).outcome === 'scored') homeScore++;
    if (homeScore > awayScore + (5 - awayTaken)) break;

    awayTaken++;
    if (takeKick('away', round, false, awayTaken, kicks, rng).outcome === 'scored') awayScore++;
    if (awayScore > homeScore + (5 - homeTaken)) break;
  }

  for (let suddenRound = 1; homeScore === awayScore; suddenRound++) {
    const round = 5 + suddenRound;
    homeTaken++;
    const homeKick = takeKick('home', round, true, homeTaken, kicks, rng);
    if (homeKick.outcome === 'scored') homeScore++;

    awayTaken++;
    const awayKick = takeKick('away', round, true, awayTaken, kicks, rng);
    if (awayKick.outcome === 'scored') awayScore++;

    // The loop is almost surely finite; retain a deterministic emergency exit.
    if (suddenRound >= 20 && homeScore === awayScore) {
      homeTaken++;
      kicks.push({
        team: 'home',
        kickNumber: kicks.length + 1,
        round: round + 1,
        teamKickNumber: homeTaken,
        suddenDeath: true,
        outcome: 'scored',
      });
      homeScore++;
      awayTaken++;
      kicks.push({
        team: 'away',
        kickNumber: kicks.length + 1,
        round: round + 1,
        teamKickNumber: awayTaken,
        suddenDeath: true,
        outcome: 'saved',
      });
    }
  }

  return { homeScore, awayScore, kicks };
}
