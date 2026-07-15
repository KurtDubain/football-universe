// Pass-sequence generator. Pure: same seed → same output; no canvas / refs.
import { seededRand } from './math';
import type { PassPhase } from './types';

interface SequenceOptions {
  attackingHome?: boolean;
  forceShot?: boolean;
}

/**
 * Generate a possession sequence with realistic flow and occasional interceptions.
 */
export function generateSequence(seed: number, options: SequenceOptions = {}): { phases: PassPhase[]; endsInShot: boolean } {
  const r = (n: number) => seededRand(seed * 7 + n);
  const isHome = options.attackingHome ?? r(0) > 0.5;
  const playStyle = r(1);
  const endsInShot = options.forceShot ?? r(2) < 0.30;
  const willIntercept = !endsInShot && r(3) < 0.18; // pass gets stolen

  let route: number[];
  if (options.forceShot) {
    const directedRoutes = [[5, 8], [6, 9], [7, 10]];
    route = directedRoutes[Math.floor(r(4) * directedRoutes.length)];
  } else if (playStyle < 0.18) {
    route = isHome ? [0, 2, 6, 9, 10] : [0, 3, 7, 10, 9];
  } else if (playStyle < 0.36) {
    route = isHome ? [3, 7, 10] : [2, 6, 9];
  } else if (playStyle < 0.54) {
    route = isHome ? [1, 5, 8, 9] : [4, 8, 5, 10];
  } else if (playStyle < 0.72) {
    route = isHome ? [6, 7, 5, 9] : [7, 6, 8, 10];
  } else if (playStyle < 0.88) {
    route = isHome ? [3, 2, 6, 5, 7] : [2, 3, 7, 6, 8];
  } else {
    // Long ball forward
    route = isHome ? [0, 9] : [0, 10];
  }

  const phases: PassPhase[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const distance = Math.abs(route[i + 1] - route[i]);
    const longBall = distance >= 4 || r(i + 5) < 0.15;
    const isLastPass = i === route.length - 2;
    phases.push({
      passerIdx: route[i],
      receiverIdx: route[i + 1],
      attackingHome: isHome,
      kind: 'pass',
      duration: options.forceShot
        ? (longBall ? 11 + r(i + 10) * 4 : 8 + r(i + 11) * 4)
        : longBall ? 70 + r(i + 10) * 25 : 42 + r(i + 11) * 20,
      hold: options.forceShot
        ? 2 + r(i + 12) * 2
        : isLastPass ? 18 + r(i + 12) * 18 : 26 + r(i + 12) * 30,
      arc: longBall ? 0.55 + r(i + 13) * 0.4 : r(i + 13) * 0.18,
      intercepted: willIntercept && i === route.length - 2, // last pass gets stolen
    });
  }

  if (endsInShot) {
    const shooterIdx = route[route.length - 1];
    phases.push({
      passerIdx: shooterIdx,
      receiverIdx: shooterIdx,
      attackingHome: isHome,
      kind: 'shot',
      duration: options.forceShot ? 10 + r(31) * 4 : 26 + r(31) * 12,
      hold: 12 + r(32) * 8,
      arc: 0.04 + r(33) * 0.16,
      intercepted: false,
    });
  }
  return { phases, endsInShot };
}
