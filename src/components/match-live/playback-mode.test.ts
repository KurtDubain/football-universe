import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import {
  nextPlaybackStep,
  playbackBreakDelay,
  playbackTickDelay,
} from './playback-mode';

const events: MatchEvent[] = [
  { minute: 8, type: 'yellow_card', teamId: 'home', description: '黄牌' },
  { minute: 14, type: 'corner', teamId: 'away', description: '角球' },
  { minute: 20, type: 'goal', teamId: 'home', description: '进球' },
  { minute: 34, type: 'gk_save', teamId: 'away', description: '扑救' },
];

describe('match live playback modes', () => {
  it('skips quiet minutes but approaches every highlight one minute at a time', () => {
    expect(nextPlaybackStep(0, 90, events, 'highlights')).toBe(5);
    expect(nextPlaybackStep(10, 90, events, 'highlights')).toBe(1);
    expect(nextPlaybackStep(15, 90, events, 'highlights')).toBe(1);
    expect(nextPlaybackStep(18, 90, events, 'highlights')).toBe(1);
    expect(nextPlaybackStep(19, 90, events, 'highlights')).toBe(1);
    expect(nextPlaybackStep(20, 90, events, 'highlights')).toBe(5);
  });

  it('keeps live modes at one simulated minute per tick', () => {
    expect(nextPlaybackStep(0, 90, events, 'live')).toBe(1);
    expect(nextPlaybackStep(0, 90, events, 'immersive')).toBe(1);
  });

  it('holds important events in highlights and shortens nonessential motion when requested', () => {
    expect(playbackTickDelay('highlights', 20, events[2], false)).toBe(1200);
    expect(playbackTickDelay('highlights', 20, events[2], true)).toBe(300);
    expect(playbackTickDelay('highlights', 20, events[0], false)).toBe(120);
    expect(playbackTickDelay('highlights', 16, events[1], false)).toBe(1800);
    expect(playbackTickDelay('live', 20, events[2], false)).toBe(1200);
    expect(playbackTickDelay('live', 21, events[2], false)).toBe(380);
    expect(playbackTickDelay('immersive', 20, events[2], false)).toBe(1800);
    expect(playbackTickDelay('immersive', 21, events[2], false)).toBe(620);
  });

  it('slows the highlights timeline while a set piece is being prepared', () => {
    expect(playbackTickDelay('highlights', 10, null, false, events[1])).toBe(320);
    expect(playbackTickDelay('highlights', 9, null, false, events[1])).toBe(320);
    expect(playbackTickDelay('highlights', 8, null, false, events[1])).toBe(120);
  });

  it('reserves enough real time for an open-play chance to reach its shot', () => {
    expect(playbackTickDelay('highlights', 15, null, false, events[2])).toBe(520);
    expect(playbackTickDelay('highlights', 17, null, false, events[2])).toBe(520);
    expect(playbackTickDelay('live', 18, null, false, events[2])).toBe(480);
    expect(playbackTickDelay('immersive', 19, null, false, events[2])).toBe(680);
  });

  it('uses mode-aware breaks and the shortest reduced-motion break', () => {
    expect(playbackBreakDelay('live', false)).toBe(1800);
    expect(playbackBreakDelay('immersive', false)).toBe(2800);
    expect(playbackBreakDelay('highlights', false)).toBe(650);
    expect(playbackBreakDelay('live', true)).toBe(250);
  });
});
