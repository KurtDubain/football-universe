import { describe, expect, it } from 'vitest';
import {
  getKnockoutRoundRank,
  isGroupStageClosingRound,
} from './stage-semantics';

describe('competition stage semantics', () => {
  it('normalizes the knockout labels emitted by domestic and international cups', () => {
    expect(getKnockoutRoundRank('R16')).toBe(1);
    expect(getKnockoutRoundRank('16强')).toBe(1);
    expect(getKnockoutRoundRank('QF-L2')).toBe(2);
    expect(getKnockoutRoundRank('八强')).toBe(2);
    expect(getKnockoutRoundRank('SF 首回合')).toBe(3);
    expect(getKnockoutRoundRank('四强')).toBe(3);
    expect(getKnockoutRoundRank('Final')).toBe(4);
    expect(getKnockoutRoundRank('决赛')).toBe(4);
  });

  it('does not treat partial or ordinary labels as knockout rounds', () => {
    expect(getKnockoutRoundRank('R3')).toBe(0);
    expect(getKnockoutRoundRank('小组赛淘汰')).toBe(0);
    expect(getKnockoutRoundRank('联赛第16轮')).toBe(0);
  });

  it('uses each competition configured final group round', () => {
    expect(isGroupStageClosingRound('world_cup_group', 'Group A - R3')).toBe(true);
    expect(isGroupStageClosingRound('world_cup_group', '环球冠军杯 小组赛R2')).toBe(false);
    expect(isGroupStageClosingRound('super_cup_group', '超级杯 小组赛第6轮')).toBe(true);
    expect(isGroupStageClosingRound('super_cup_group', 'Group B - R3')).toBe(false);
    expect(isGroupStageClosingRound('continental_cup', 'Group C - R3')).toBe(true);
    expect(isGroupStageClosingRound('continental_cup', '洲际杯 小组赛 R3')).toBe(true);
  });

  it('does not confuse a continental knockout round with its third group round', () => {
    expect(isGroupStageClosingRound('continental_cup', '大陆杯八强 R3')).toBe(false);
    expect(isGroupStageClosingRound('league', '顶级联赛 R3')).toBe(false);
  });
});
