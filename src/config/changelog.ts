export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  items: string[];
}

/**
 * User-facing releases, newest first. Every user-visible release must update
 * this list and keep its first version aligned with APP_VERSION/package.json.
 */
export const CHANGELOG: ReleaseNote[] = [
  {
    version: '4.8.0',
    date: '2026-07-20',
    title: '俱乐部脉络',
    items: [
      '重做球员阵容加成，顶级球队不再普遍三线封顶，核心伤停会产生可见损失。',
      '洲际杯改为四年一届并缩小参赛规模，由近五季俱乐部积分决定资格。',
      '历史页新增完整俱乐部积分榜，并整理奖杯、财富与名帅内容归属。',
      '新闻按重要度、关注球队和时效统一排序，合并重复播报。',
      '设置页新增游戏内更新日志与版本一致性检查。',
    ],
  },
  {
    version: '4.7.0',
    date: '2026-07-19',
    title: '球员与球队体验',
    items: [
      '球员详情按位置突出关键指标，数据样本不足时不再展示误导排名。',
      '球队详情加入概览、阵容、历史分区，整行支持进入球员详情。',
      '球队中心改为更紧凑的分组目录，移动端球队名称更清晰。',
    ],
  },
  {
    version: '4.6.0',
    date: '2026-07-18',
    title: '推进与移动端打磨',
    items: [
      '主页只保留一个权威推进入口，关注球队赛果优先展示。',
      '普通比赛批量揭晓更快，关键比赛保留逐场悬念。',
      '重做移动端快捷悬浮按钮的拖动、吸边、安全区和触控尺寸。',
    ],
  },
];
