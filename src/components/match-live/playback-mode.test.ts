import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../../types/match';
import type { RoutineBeat } from './routine-timeline';
import {
  nextPlaybackStep,
  playbackBreakDelay,
  playbackMotionRate,
  playbackTickDelay,
  readPlaybackModePreference,
  writePlaybackModePreference,
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

  it('lands on a card or a substitution instead of stepping over it', () => {
    // A beat is committed without a presentation, so the only way the canvas
    // ever shows one is the clock reaching its minute. A five-minute step
    // used to walk straight over them: the player was replaced, the shape on
    // the pitch changed, and nothing was ever shown.
    const withSubstitution: MatchEvent[] = [
      { minute: 3, type: 'substitution', teamId: 'home', description: '换人' },
      { minute: 20, type: 'goal', teamId: 'home', description: '进球' },
    ];
    expect(nextPlaybackStep(0, 90, withSubstitution, 'highlights')).toBe(3);
    expect(nextPlaybackStep(3, 90, withSubstitution, 'highlights')).toBe(5);

    const withCard: MatchEvent[] = [
      { minute: 2, type: 'yellow_card', teamId: 'away', description: '黄牌' },
      { minute: 40, type: 'goal', teamId: 'home', description: '进球' },
    ];
    expect(nextPlaybackStep(0, 90, withCard, 'highlights')).toBe(2);
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
    expect(playbackTickDelay('live', 20, events[2], false)).toBe(2400);
    expect(playbackTickDelay('live', 21, events[2], false)).toBe(1150);
    expect(playbackTickDelay('immersive', 20, events[2], false)).toBe(3200);
    expect(playbackTickDelay('immersive', 21, events[2], false)).toBe(1780);
  });

  it('slows the highlights timeline while a set piece is being prepared', () => {
    expect(playbackTickDelay('highlights', 10, null, false, events[1])).toBe(320);
    expect(playbackTickDelay('highlights', 9, null, false, events[1])).toBe(320);
    expect(playbackTickDelay('highlights', 8, null, false, events[1])).toBe(120);
  });

  it('reserves enough real time for an open-play chance to reach its shot', () => {
    expect(playbackTickDelay('highlights', 15, null, false, events[2])).toBe(520);
    expect(playbackTickDelay('highlights', 17, null, false, events[2])).toBe(520);
    // The live modes no longer slow down for an approaching shot. The scene
    // is prepared on the event minute and holds the clock for as long as the
    // move runs, so the minute before a goal is an ordinary minute again —
    // and it is a routine beat again, which the old slowdown was suppressing
    // for a third of the match.
    expect(playbackTickDelay('live', 18, null, false, events[2])).toBe(1150);
    expect(playbackTickDelay('immersive', 19, null, false, events[2])).toBe(1780);
  });

  it('slows physical action without slowing the concise highlights cut', () => {
    expect(playbackMotionRate('highlights')).toBe(1);
    expect(playbackMotionRate('live')).toBe(0.72);
    expect(playbackMotionRate('immersive')).toBe(0.58);
  });

  it('uses mode-aware breaks and the shortest reduced-motion break', () => {
    expect(playbackBreakDelay('live', false)).toBe(2400);
    expect(playbackBreakDelay('immersive', false)).toBe(3600);
    expect(playbackBreakDelay('highlights', false)).toBe(650);
    expect(playbackBreakDelay('live', true)).toBe(250);
  });

  it('recommends highlights without overwriting a saved playback choice', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readPlaybackModePreference(storage)).toBe('highlights');
    writePlaybackModePreference('immersive', storage);
    expect(readPlaybackModePreference(storage)).toBe('immersive');
    values.set('football-universe:match-playback-mode', 'invalid');
    expect(readPlaybackModePreference(storage)).toBe('highlights');
  });
});

const routineBeats: Record<RoutineBeat["kind"], RoutineBeat> = {
  foul: { id: 'routine:31:foul:home', minute: 31, kind: 'foul', teamId: 'home' },
  corner: { id: 'routine:31:corner:home', minute: 31, kind: 'corner', teamId: 'home' },
  save: { id: 'routine:31:save:home', minute: 31, kind: 'save', teamId: 'home' },
  shot_off_target: { id: 'routine:31:shot_off_target:home', minute: 31, kind: 'shot_off_target', teamId: 'home' },
};

describe('routine beat pacing', () => {
  it('gives every kind of quiet minute its own length', () => {
    const lengths = (['foul', 'corner', 'save', 'shot_off_target'] as const)
      .map(kind => playbackTickDelay('live', 31, null, false, undefined, routineBeats[kind]));
    expect(new Set(lengths).size).toBe(4);
    // A corner needs the most setup; a shot already on its way needs the least.
    expect(lengths[1]).toBeGreaterThan(lengths[0]);
    expect(lengths[0]).toBeGreaterThan(lengths[3]);
  });

  it('makes a beat minute longer than a silent one', () => {
    const quiet = playbackTickDelay('live', 31, null, false);
    for (const kind of ['foul', 'corner', 'save', 'shot_off_target'] as const) {
      expect(playbackTickDelay('live', 31, null, false, undefined, routineBeats[kind]))
        .toBeGreaterThan(quiet);
    }
  });

  it('stretches every beat in immersive mode', () => {
    for (const kind of ['foul', 'corner', 'save', 'shot_off_target'] as const) {
      const live = playbackTickDelay('live', 31, null, false, undefined, routineBeats[kind]);
      const immersive = playbackTickDelay('immersive', 31, null, false, undefined, routineBeats[kind]);
      expect(immersive).toBeGreaterThan(live);
    }
  });

  it('never lets a beat outrank the moment it is approaching', () => {
    // A corner beat owns its minute; what it must never outrank is the
    // minute the event itself is on screen.
    expect(playbackTickDelay('live', 15, null, false, events[2], routineBeats.corner)).toBe(1580);
    expect(playbackTickDelay('live', 20, events[2], false, undefined, routineBeats.corner)).toBe(2400);
  });

  it('leaves highlights alone', () => {
    const withoutBeat = playbackTickDelay('highlights', 31, null, false);
    expect(playbackTickDelay('highlights', 31, null, false, undefined, routineBeats.foul))
      .toBe(withoutBeat);
  });

  it('shortens every beat under reduced motion', () => {
    for (const kind of ['foul', 'corner', 'save', 'shot_off_target'] as const) {
      const normal = playbackTickDelay('live', 31, null, false, undefined, routineBeats[kind]);
      const reduced = playbackTickDelay('live', 31, null, true, undefined, routineBeats[kind]);
      expect(reduced).toBeLessThan(normal);
      expect(reduced).toBeGreaterThan(0);
    }
  });
});
