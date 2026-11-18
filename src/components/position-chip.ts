import type { PlayerPosition } from '../types/player';

/**
 * 位置标签的唯一色板。
 *
 * 此前 Market / Legends / Transfers / TeamDetail / Players / PlayerDetail
 * 各自抄了一份，底色透明度、文字档位和边框各不相同，同一个「中场」在不同
 * 页面上看起来像两种标签。这里统一成「/40 底 + 300 档文字」，需要描边的
 * 页面自行追加 border-*，不要再复制整张表。
 */
export const POSITION_CHIP: Record<PlayerPosition, string> = {
  GK: 'bg-amber-900/40 text-amber-300',
  DF: 'bg-blue-900/40 text-blue-300',
  MF: 'bg-emerald-900/40 text-emerald-300',
  FW: 'bg-red-900/40 text-red-300',
};

/** 与 POSITION_CHIP 搭配的排版类。尺寸特殊的页面可以只用 POSITION_CHIP。 */
export const POSITION_CHIP_BASE = 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px]';
