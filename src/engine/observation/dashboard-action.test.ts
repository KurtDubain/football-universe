import { describe, expect, it } from 'vitest';
import { describeDashboardAction } from './dashboard-action';

describe('dashboard action vocabulary', () => {
  it('describes ordinary reveal and post-result continuation', () => {
    expect(describeDashboardAction({ phase: 'matchday' }).label).toBe('揭晓本轮');
    expect(describeDashboardAction({ phase: 'results' }).label).toBe('继续观察');
  });

  it('gives the first reveal a distinct opening label', () => {
    expect(describeDashboardAction({
      phase: 'matchday',
      isOpeningObservation: true,
    })).toEqual({ label: '揭晓首轮', ariaLabel: '揭晓首轮比赛结果' });
  });

  it('distinguishes pending judgments and starred live viewing', () => {
    expect(describeDashboardAction({
      phase: 'matchday',
      hasPendingJudgment: true,
    }).label).toBe('揭晓判断');
    expect(describeDashboardAction({
      phase: 'matchday',
      hasStarredFocus: true,
    }).label).toBe('进入焦点直播');
    expect(describeDashboardAction({
      phase: 'matchday',
      hasPendingJudgment: true,
      hasStarredFocus: true,
    }).label).toBe('观战并揭晓');
  });

  it('uses one busy state regardless of the pending action', () => {
    expect(describeDashboardAction({
      phase: 'matchday',
      hasPendingJudgment: true,
      hasStarredFocus: true,
      isAdvancing: true,
    })).toEqual({ label: '模拟中...', ariaLabel: '正在模拟' });
  });
});
