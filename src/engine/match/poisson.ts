import { SeededRNG } from './rng';

/**
 * Sample from a Poisson distribution with the given mean (lambda)
 * using Knuth's algorithm.
 *
 * For lambda <= 30 this uses the classic multiplicative method.
 * Returns a non-negative integer.
 */
export function poissonSample(lambda: number, rng: SeededRNG): number {
  if (lambda <= 0) return 0;

  // Knuth algorithm for small-to-moderate lambda
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= rng.next();
  } while (p > L);

  return k - 1;
}

/**
 * Calculate the probability of observing exactly k events
 * from a Poisson distribution with the given mean (lambda).
 *
 * P(X = k) = (lambda^k * e^-lambda) / k!
 */
export function poissonProbability(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;

  // Use log-space to avoid overflow for larger k/lambda values
  const logP = k * Math.log(lambda) - lambda - logFactorial(k);
  return Math.exp(logP);
}

/** Natural log of k! computed iteratively. */
function logFactorial(k: number): number {
  let result = 0;
  for (let i = 2; i <= k; i++) {
    result += Math.log(i);
  }
  return result;
}
