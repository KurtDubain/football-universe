import { describe, expect, it } from 'vitest';
import { cnRoundLabel } from './helpers';

describe('season helper labels', () => {
  it('hides internal two-leg round codes in archived cup results', () => {
    expect(cnRoundLabel('QF-L2')).toBe('八强');
    expect(cnRoundLabel('SF-L1')).toBe('四强');
    expect(cnRoundLabel('R16')).toBe('16强');
    expect(cnRoundLabel('Final')).toBe('决赛');
    expect(cnRoundLabel('Round 3')).toBe('第3轮');
    expect(cnRoundLabel('SF 次回合')).toBe('四强 次回合');
    expect(cnRoundLabel('custom-round')).toBe('custom-round');
  });
});
