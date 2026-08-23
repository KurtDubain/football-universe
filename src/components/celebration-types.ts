export type CelebrationType = 'streamers' | 'confetti' | 'fireworks' | 'trophy';

export function celebrationDuration(type: CelebrationType): number {
  if (type === 'trophy') return 5000;
  if (type === 'fireworks') return 3600;
  if (type === 'confetti') return 3200;
  return 2200;
}
