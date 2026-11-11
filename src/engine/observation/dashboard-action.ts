import type { CalendarWindow } from '../../types/season';

export interface DashboardActionPresentation {
  label: string;
  ariaLabel: string;
}

export function describeDashboardAction({
  phase,
  hasPendingJudgment = false,
  hasStarredFocus = false,
  isAdvancing = false,
  isOpeningObservation = false,
}: {
  phase: 'matchday' | 'results';
  hasPendingJudgment?: boolean;
  hasStarredFocus?: boolean;
  isAdvancing?: boolean;
  isOpeningObservation?: boolean;
}): DashboardActionPresentation {
  if (isAdvancing) {
    return { label: '模拟中...', ariaLabel: '正在模拟' };
  }
  if (phase === 'results') {
    return { label: '继续观察', ariaLabel: '返回当前未赛比赛日' };
  }
  if (hasStarredFocus && hasPendingJudgment) {
    return { label: '观战并揭晓', ariaLabel: '推进本轮并无剧透观看焦点比赛，同时揭晓判断' };
  }
  if (hasStarredFocus) {
    return { label: '进入焦点直播', ariaLabel: '推进本轮并无剧透观看已锁定的焦点比赛' };
  }
  if (hasPendingJudgment) {
    return { label: '揭晓判断', ariaLabel: '揭晓本轮观察判断' };
  }
  if (isOpeningObservation) {
    return { label: '揭晓首轮', ariaLabel: '揭晓首轮比赛结果' };
  }
  return { label: '揭晓本轮', ariaLabel: '揭晓本轮比赛结果' };
}

/**
 * Whether opening the dashboard should bounce the reader to the transfer market.
 *
 * The season-opening window is exempt. It carries the draw and the pre-season
 * read, which exist in no other view, and advancing past it loses them for
 * good — so a redirect there does not merely hide a fixture list, it strands
 * content the reader can never get back to. Before the opening window existed
 * this only cost a matchday view, which the calendar page still showed.
 */
export function shouldAutoOpenTransferMarket(input: {
  transferWindowStatus: string | undefined;
  pathname: string;
  hasWorldResponse: boolean;
  windowType: CalendarWindow['type'] | undefined;
}): boolean {
  return input.transferWindowStatus === 'open'
    && input.pathname !== '/market'
    && !input.hasWorldResponse
    && input.windowType !== 'pre_season';
}
