// Pass-sequence generator. Pure: same seed → same output; no canvas / refs.
import { seededRand } from './math';
import type { PassPhase } from './types';

/**
 * Generate a possession sequence with realistic flow and occasional interceptions.
 */
export function generateSequence(seed: number): { phases: PassPhase[]; endsInShot: boolean } {
  const r = (n: number) => seededRand(seed * 7 + n);
  const isHome = r(0) > 0.5;
  const playStyle = r(1);
  const endsInShot = r(2) < 0.30;
  const willIntercept = !endsInShot && r(3) < 0.18; // pass gets stolen

  let route: number[];
  if (playStyle < 0.18) {
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
      duration: longBall ? 70 + r(i + 10) * 25 : 42 + r(i + 11) * 20,
      hold: isLastPass ? 18 + r(i + 12) * 18 : 26 + r(i + 12) * 30,
      arc: longBall ? 0.55 + r(i + 13) * 0.4 : r(i + 13) * 0.18,
      intercepted: willIntercept && i === route.length - 2, // last pass gets stolen
    });
  }
  return { phases, endsInShot };
}
