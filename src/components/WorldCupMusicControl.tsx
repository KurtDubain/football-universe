import { useEffect, useState } from 'react';
import { useFeedbackPreferences } from '../feedback/preferences';
import { startAmbientMusic, type AmbientMusicScene } from '../feedback/ambient-music';
import { unlockGameAudio } from '../feedback/game-feedback';
import { Icon } from './Icon';

let musicOwnerCounter = 0;

export default function WorldCupMusicControl({ scene = 'world_cup', enabled = true }: {
  scene?: AmbientMusicScene;
  enabled?: boolean;
}) {
  const preferences = useFeedbackPreferences();
  const [owner] = useState(() => `world-cup-music-${++musicOwnerCounter}`);
  const [desired, setDesired] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    if (!enabled || !desired || !preferences.soundEnabled || preferences.musicVolume <= 0) return;
    const lease = startAmbientMusic(scene, owner);
    let alive = true;
    void lease.started.then(started => {
      if (alive) setPlaying(started);
    });
    return () => {
      alive = false;
      lease.stop();
    };
  }, [attempt, desired, enabled, owner, preferences.musicVolume, preferences.soundEnabled, scene]);

  const toggle = () => {
    unlockGameAudio();
    if (playing) {
      setDesired(false);
      setPlaying(false);
      return;
    }
    setDesired(true);
    setAttempt(value => value + 1);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? '暂停世界杯主题音乐' : '播放世界杯主题音乐'}
      aria-pressed={playing}
      data-testid="world-cup-music-toggle"
      className="press-scale inline-flex min-h-11 items-center gap-2 rounded-md border border-white/20 bg-black/45 px-3 text-xs font-semibold text-white hover:bg-black/65"
    >
      <Icon name={playing ? 'volume' : 'volume-off'} size={16} />
      <span>{playing ? '主题播放中' : '播放世界杯主题'}</span>
    </button>
  );
}
