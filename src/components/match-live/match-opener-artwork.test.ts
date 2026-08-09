import { describe, expect, it } from 'vitest';
import {
  matchOpenerArtworkForCompetition,
  matchOpenerKindForCompetition,
  matchOpenerLabel,
} from './match-opener-artwork';

describe('match opener artwork', () => {
  it('gives each competition family a stable visual identity', () => {
    expect(matchOpenerKindForCompetition('league')).toBe('league');
    expect(matchOpenerKindForCompetition('league_cup')).toBe('domestic_cup');
    expect(matchOpenerKindForCompetition('super_cup_group')).toBe('domestic_cup');
    expect(matchOpenerKindForCompetition('continental_cup')).toBe('continental');
    expect(matchOpenerKindForCompetition('world_cup_group')).toBe('world');
  });

  it('selects distinct versioned files and keeps finals explicit', () => {
    expect(matchOpenerArtworkForCompetition('league_cup')).toContain('match-opener-domestic-cup-v1');
    expect(matchOpenerArtworkForCompetition('continental_cup')).toContain('match-opener-continental-v1');
    expect(matchOpenerArtworkForCompetition('world_cup')).toContain('match-opener-world-v1');
    expect(matchOpenerLabel('continental_cup', false)).toBe('洲际之夜 · 比分未揭晓');
    expect(matchOpenerLabel('world_cup', true)).toBe('决赛现场 · 比分未揭晓');
  });
});
