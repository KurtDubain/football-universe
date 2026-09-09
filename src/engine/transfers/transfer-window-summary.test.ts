import { describe, expect, it } from 'vitest';
import { describeTransferWindowHandoff, type TransferWindowHandoffSummary } from './transfer-window-summary';

function summary(overrides: Partial<TransferWindowHandoffSummary> = {}): TransferWindowHandoffSummary {
  return {
    season: 1,
    mode: 'auto',
    autoRejectedOffers: 0,
    autoSkippedTargets: 4,
    acceptedOffers: 0,
    rejectedOffers: 0,
    completedTargets: 0,
    uncompletedTargets: 4,
    signedPlayerNames: [],
    cashChanges: [{ teamId: 'datong', teamName: '大同队', delta: 0 }],
    ...overrides,
  };
}

describe('transfer window handoff presentation', () => {
  it('summarizes a no-action automatic handoff without repeating zero counts', () => {
    const presentation = describeTransferWindowHandoff(summary());
    expect(presentation.conclusion).toBe('球队跳过4个引援目标，本窗口无人加盟或离队。');
    expect(presentation.cashChanged).toBe(false);
    expect(presentation.details).toEqual(['未完成4个引援目标']);
    expect(presentation.conclusion).not.toContain('0');
  });

  it('leads with actual arrivals and departures', () => {
    const presentation = describeTransferWindowHandoff(summary({
      signedPlayerNames: ['九号'],
      acceptedOffers: 1,
      rejectedOffers: 2,
      cashChanges: [{ teamId: 'datong', teamName: '大同队', delta: -3.5 }],
    }));
    expect(presentation.conclusion).toBe('球队签下九号，同意1份离队报价。');
    expect(presentation.details).toContain('拒绝2份报价');
    expect(presentation.cashChanged).toBe(true);
  });
});
