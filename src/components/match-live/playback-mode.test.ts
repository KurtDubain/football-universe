import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import {
  nextPlaybackStep,
  playbackBreakDelay,
  playbackTickDelay,
} from './playback-mode';

const events: MatchEvent[] = [
  { minute: 8, type: 'yellow_card', teamId: 'home', description: '黄牌' },
  { minute: 20, type: 'goal', teamId: 'home', description: '进球' },
  { minute: 34, type: 'gk_save', teamId: 'away', description: '扑救' },
];

describe('match live playback modes', () => {
  it('skips quiet minutes but approaches every highlight one minute at a time', () => {
    expect(nextPlaybackStep(0, 90, events, 'highlights')).toBe(5);
    expect(nextPlaybackStep(15, 90, events, 'highlights')).toBe(3);
    expect(nextPlaybackStep(18, 90, events, 'highlights')).toBe(1);
    expect(nextPlaybackStep(19, 90, events, 'highlights')).toBe(1);
    expect(nextPlaybackStep(20, 90, events, 'highlights')).toBe(5);
  });

  it('keeps fixed modes at one simulated minute per tick', () => {
    expect(nextPlaybackStep(0, 90, events, 'normal')).toBe(1);
    expect(nextPlaybackStep(0, 90, events, 'fast')).toBe(1);
  });

  it('holds important events in highlights and shortens nonessential motion when requested', () => {
    expect(playbackTickDelay('highlights', 20, events[1], false)).toBe(900);
    expect(playbackTickDelay('highlights', 20, events[1], true)).toBe(300);
    expect(playbackTickDelay('highlights', 20, events[0], false)).toBe(120);
    expect(playbackTickDelay('normal', 20, events[1], false)).toBe(280);
    expect(playbackTickDelay('fast', 20, events[1], false)).toBeCloseTo(280 / 3);
  });

  it('uses mode-aware breaks and the shortest reduced-motion break', () => {
    expect(playbackBreakDelay('normal', false)).toBe(2000);
    expect(playbackBreakDelay('fast', false)).toBe(800);
    expect(playbackBreakDelay('highlights', false)).toBe(650);
    expect(playbackBreakDelay('normal', true)).toBe(250);
  });
});
