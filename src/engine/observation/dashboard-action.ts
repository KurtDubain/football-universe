export interface DashboardActionPresentation {
  label: string;
  ariaLabel: string;
}

export function describeDashboardAction({
  phase,
  hasPendingJudgment = false,
  hasStarredFocus = false,
  isAdvancing = false,
}: {
  phase: 'matchday' | 'results';
  hasPendingJudgment?: boolean;
  hasStarredFocus?: boolean;
  isAdvancing?: boolean;
}): DashboardActionPresentation {
  if (isAdvancing) {
    return { label: '模拟中...', ariaLabel: '正在模拟' };
  }
  if (phase === 'results') {
    return { label: '继续观察', ariaLabel: '继续观察下一轮' };
  }
  if (hasStarredFocus && hasPendingJudgment) {
    return { label: '观看并揭晓', ariaLabel: '观看焦点比赛并揭晓判断' };
  }
  if (hasStarredFocus) {
    return { label: '观看焦点', ariaLabel: '观看已关注的焦点比赛' };
  }
  if (hasPendingJudgment) {
    return { label: '揭晓判断', ariaLabel: '揭晓本轮观察判断' };
  }
  return { label: '揭晓本轮', ariaLabel: '揭晓本轮比赛结果' };
}
