import type { MatchEvent, MatchResult } from '../types/match';
import { getUnlockedGameAudioContext } from './game-feedback';

export type MatchSoundCue =
  | 'goal_home'
  | 'goal_away'
  | 'goal_neutral'
  | 'save'
  | 'block'
  | 'miss'
  | 'woodwork'
  | 'card'
  | 'red_card'
  | 'substitution'
  | 'set_piece'
  | 'none';

export interface MatchAtmosphereSnapshot {
  minute: number;
  maxMinute: number;
  homeScore: number;
  awayScore: number;
  inShootout: boolean;
  paused: boolean;
}

export interface MatchSoundscape {
  readonly started: boolean;
  start: () => boolean;
  update: (snapshot: MatchAtmosphereSnapshot) => void;
  playEvent: (event: MatchEvent) => void;
  playStage: (stage: 'halftime' | 'extra_time' | 'shootout' | 'fulltime') => void;
  setMuted: (muted: boolean) => void;
  stop: () => void;
}

interface MatchSoundscapeOptions {
  result: Pick<MatchResult,
    'fixtureId' | 'homeTeamId' | 'awayTeamId' | 'competitionType' | 'roundLabel' | 'isNeutralVenue'
  >;
  featured: boolean;
  muted: boolean;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededNoise(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function reportSoundscape(detail: { type: 'start' | 'event' | 'stage' | 'stop'; cue?: string }): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('football-match-soundscape', { detail }));
}

export function matchPrestige(
  result: MatchSoundscapeOptions['result'] & { featured?: boolean },
): number {
  const label = result.roundLabel.toLowerCase();
  let prestige = result.featured ? 0.18 : 0;
  if (label === 'final' || result.roundLabel === '决赛') prestige += 0.35;
  else if (label.includes('semi') || result.roundLabel.includes('半决')) prestige += 0.2;
  else if (label.includes('quarter') || result.roundLabel.includes('1/4')) prestige += 0.1;
  if (result.competitionType === 'world_cup' || result.competitionType === 'world_cup_group') prestige += 0.18;
  if (result.competitionType === 'continental_cup') prestige += 0.12;
  return clamp(prestige, 0, 0.7);
}

export function computeCrowdIntensity(
  snapshot: MatchAtmosphereSnapshot,
  prestige: number,
): number {
  if (snapshot.paused) return 0.16;
  if (snapshot.inShootout) return 0.9;
  const progress = clamp(snapshot.minute / Math.max(1, snapshot.maxMinute));
  const closeMatch = Math.abs(snapshot.homeScore - snapshot.awayScore) <= 1;
  const lateTension = closeMatch ? clamp((progress - 0.55) / 0.45) * 0.34 : 0;
  return clamp(0.24 + prestige * 0.42 + progress * 0.12 + lateTension, 0.16, 1);
}

export function classifyMatchSoundEvent(
  event: MatchEvent,
  homeTeamId: string,
  neutralVenue: boolean,
): MatchSoundCue {
  if (event.type === 'goal' || event.type === 'own_goal' || event.type === 'penalty_goal') {
    if (neutralVenue) return 'goal_neutral';
    return event.teamId === homeTeamId ? 'goal_home' : 'goal_away';
  }
  if (event.type === 'penalty_miss' && event.shootout?.outcome === 'woodwork') return 'woodwork';
  if (event.type === 'gk_save' || event.type === 'save'
    || (event.type === 'penalty_miss' && event.shootout?.outcome === 'saved')) return 'save';
  if (event.type === 'df_block') return 'block';
  if (event.type === 'miss' || event.type === 'penalty_miss') return 'miss';
  if (event.type === 'red_card') return 'red_card';
  if (event.type === 'yellow_card') return 'card';
  if (event.type === 'substitution') return 'substitution';
  if (event.type === 'corner' || event.type === 'free_kick') return 'set_piece';
  return 'none';
}

function supportsSoundscape(context: AudioContext): boolean {
  return typeof context.createBuffer === 'function'
    && typeof context.createBufferSource === 'function'
    && typeof context.createBiquadFilter === 'function';
}

function setGain(gain: GainNode, value: number, context: AudioContext, duration = 0.18): void {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, value), now + duration);
}

function scheduleOscillator(
  context: AudioContext,
  destination: AudioNode,
  frequency: number,
  offset: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  endFrequency = frequency,
): void {
  const start = context.currentTime + offset;
  const end = start + duration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.025, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain).connect(destination);
  oscillator.start(start);
  oscillator.stop(end + 0.01);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

function createNoiseBuffer(context: AudioContext, duration: number, seed: number): AudioBuffer {
  // Crowd texture does not need full output-rate fidelity. A compact buffer is
  // resampled by Web Audio and avoids a visible first-open task on slower phones.
  const sampleRate = Math.min(12_000, context.sampleRate);
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededNoise(seed);
  let smoothed = 0;
  for (let index = 0; index < length; index++) {
    const noise = random() * 2 - 1;
    smoothed = smoothed * 0.84 + noise * 0.16;
    const pulse = 0.72 + Math.sin(index / sampleRate * Math.PI * 3.1) * 0.12;
    data[index] = clamp(smoothed * pulse, -1, 1);
  }
  return buffer;
}

const noiseBufferCache = new WeakMap<AudioContext, { crowd: AudioBuffer; event: AudioBuffer }>();

function getNoiseBuffers(context: AudioContext): { crowd: AudioBuffer; event: AudioBuffer } {
  const cached = noiseBufferCache.get(context);
  if (cached) return cached;
  const buffers = {
    crowd: createNoiseBuffer(context, 1.8, 0x51f15e),
    event: createNoiseBuffer(context, 1.8, 0x9e3779b9),
  };
  noiseBufferCache.set(context, buffers);
  return buffers;
}

function scheduleNoiseBurst(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  volume: number,
  duration: number,
  frequency: number,
  offset = 0,
): void {
  const start = context.currentTime + offset;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = 0.65;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(destination);
  source.start(start);
  source.stop(start + duration + 0.02);
  source.addEventListener('ended', () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  }, { once: true });
}

function scheduleWhistle(context: AudioContext, destination: AudioNode, offset = 0): void {
  scheduleOscillator(context, destination, 1880, offset, 0.16, 0.024, 'sine', 2140);
  scheduleOscillator(context, destination, 2310, offset + 0.02, 0.13, 0.014, 'sine', 2050);
}

class BrowserMatchSoundscape implements MatchSoundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private eventNoise: AudioBuffer | null = null;
  private muted: boolean;
  private readonly seed: number;
  private readonly prestige: number;

  constructor(private readonly options: MatchSoundscapeOptions) {
    this.muted = options.muted;
    this.seed = hashSeed(options.result.fixtureId);
    this.prestige = matchPrestige({ ...options.result, featured: options.featured });
  }

  get started(): boolean {
    return this.context !== null && this.master !== null;
  }

  start(): boolean {
    if (this.started) return true;
    const context = getUnlockedGameAudioContext();
    if (!context || !supportsSoundscape(context)) return false;
    const master = context.createGain();
    const crowdGain = context.createGain();
    master.gain.value = this.muted ? 0.0001 : 0.72;
    crowdGain.gain.value = 0.018;
    crowdGain.connect(master).connect(context.destination);

    const buffers = getNoiseBuffers(context);
    const createLayer = (frequency: number, volume: number, playbackRate: number) => {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffers.crowd;
      source.loop = true;
      source.playbackRate.value = playbackRate;
      filter.type = frequency < 400 ? 'lowpass' : 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.55;
      gain.gain.value = volume;
      source.connect(filter).connect(gain).connect(crowdGain);
      source.start(0, (this.seed % 1400) / 1000);
      this.sources.push(source);
    };
    createLayer(980, 0.7, 0.97);
    createLayer(260, 0.42, 0.71);

    this.context = context;
    this.master = master;
    this.crowdGain = crowdGain;
    this.eventNoise = buffers.event;
    this.playOpeningTheme();
    reportSoundscape({ type: 'start' });
    return true;
  }

  update(snapshot: MatchAtmosphereSnapshot): void {
    if (!this.started && !this.start()) return;
    if (!this.context || !this.crowdGain) return;
    const intensity = computeCrowdIntensity(snapshot, this.prestige);
    setGain(this.crowdGain, 0.011 + intensity * 0.031, this.context, 0.45);
  }

  playEvent(event: MatchEvent): void {
    if ((!this.started && !this.start()) || !this.context || !this.master || !this.eventNoise) return;
    const cue = classifyMatchSoundEvent(
      event,
      this.options.result.homeTeamId,
      Boolean(this.options.result.isNeutralVenue),
    );
    const context = this.context;
    const output = this.master;
    const noise = this.eventNoise;

    if (cue === 'none') return;
    reportSoundscape({ type: 'event', cue });
    if (cue.startsWith('goal_')) {
      scheduleOscillator(context, output, 112, 0, 0.16, 0.05, 'sine', 72);
      const volume = cue === 'goal_home' ? 0.16 : cue === 'goal_neutral' ? 0.125 : 0.075;
      scheduleNoiseBurst(context, output, noise, volume, 1.55, cue === 'goal_away' ? 720 : 1040, 0.04);
      scheduleOscillator(context, output, 392, 0.14, 0.24, 0.018, 'triangle', 523);
      scheduleOscillator(context, output, 523, 0.32, 0.32, 0.017, 'triangle', 659);
      return;
    }
    if (cue === 'woodwork') {
      scheduleOscillator(context, output, 1480, 0, 0.08, 0.04, 'triangle', 890);
      scheduleNoiseBurst(context, output, noise, 0.055, 0.55, 760, 0.07);
      return;
    }
    if (cue === 'save' || cue === 'block') {
      scheduleOscillator(context, output, cue === 'save' ? 130 : 104, 0, 0.13, 0.035, 'sine', 70);
      scheduleNoiseBurst(context, output, noise, cue === 'save' ? 0.06 : 0.05, 0.62, 820, 0.04);
      return;
    }
    if (cue === 'miss') {
      scheduleOscillator(context, output, 118, 0, 0.1, 0.025, 'sine', 78);
      scheduleNoiseBurst(context, output, noise, 0.048, 0.48, 680, 0.06);
      return;
    }
    if (cue === 'card' || cue === 'red_card') {
      scheduleWhistle(context, output);
      scheduleNoiseBurst(context, output, noise, cue === 'red_card' ? 0.075 : 0.04, 0.72, 620, 0.12);
      return;
    }
    if (cue === 'substitution') {
      scheduleNoiseBurst(context, output, noise, 0.028, 0.34, 1120);
      return;
    }
    if (cue === 'set_piece') {
      scheduleWhistle(context, output, 0.02);
      scheduleNoiseBurst(context, output, noise, 0.032, 0.5, 920, 0.08);
    }
  }

  playStage(stage: 'halftime' | 'extra_time' | 'shootout' | 'fulltime'): void {
    if ((!this.started && !this.start()) || !this.context || !this.master || !this.eventNoise) return;
    scheduleWhistle(this.context, this.master);
    if (stage === 'fulltime') scheduleWhistle(this.context, this.master, 0.28);
    if (stage === 'shootout') {
      scheduleNoiseBurst(this.context, this.master, this.eventNoise, 0.07, 1.2, 540, 0.12);
    }
    reportSoundscape({ type: 'stage', cue: stage });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.master) {
      if (!muted) this.start();
      return;
    }
    setGain(this.master, muted ? 0.0001 : 0.72, this.context, muted ? 0.1 : 0.25);
  }

  stop(): void {
    const wasStarted = this.started;
    if (this.context && this.master) setGain(this.master, 0.0001, this.context, 0.12);
    for (const source of this.sources) {
      try {
        source.stop((this.context?.currentTime ?? 0) + 0.14);
      } catch {
        // An already-stopped optional source is harmless.
      }
    }
    this.sources = [];
    this.context = null;
    this.master = null;
    this.crowdGain = null;
    this.eventNoise = null;
    if (wasStarted) reportSoundscape({ type: 'stop' });
  }

  private playOpeningTheme(): void {
    if (!this.context || !this.master) return;
    scheduleWhistle(this.context, this.master, 0.08);
    if (!this.options.featured) return;
    const root = this.options.result.competitionType === 'world_cup' ? 196 : 174.61;
    [root, root * 1.5, root * 2].forEach((frequency, index) => {
      scheduleOscillator(this.context!, this.master!, frequency, 0.24 + index * 0.08, 1.45, 0.012, 'sine', frequency * 1.01);
    });
    scheduleOscillator(this.context, this.master, root * 2, 1.05, 0.72, 0.014, 'triangle', root * 2.5);
  }
}

export function createMatchSoundscape(options: MatchSoundscapeOptions): MatchSoundscape {
  return new BrowserMatchSoundscape(options);
}
