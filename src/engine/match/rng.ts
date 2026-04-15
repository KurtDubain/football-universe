/**
 * Seeded pseudo-random number generator using the mulberry32 algorithm.
 * Deterministic: same seed always produces the same sequence.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] (inclusive on both ends). */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns a float in [min, max). */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Shuffle an array in place (Fisher-Yates) and return it. */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  /** Pick a uniformly random element from a non-empty array. */
  pick<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /** Returns the current internal state (useful for save/restore). */
  getState(): number {
    return this.state;
  }

  /**
   * Create an independent sub-RNG seeded from the current state.
   * The child's sequence is isolated from the parent's.
   */
  fork(): SeededRNG {
    const childSeed = (this.next() * 4294967296) | 0;
    return new SeededRNG(childSeed);
  }
}
