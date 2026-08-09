import type { MatchEvent, MatchResult } from '../types/match';
import { eventAttacksForHome } from '../engine/match/event-taxonomy';
import { getUnlockedGameAudioContext } from './game-feedback';
import type { SoundProfile } from './preferences';

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
  | 'corner'
  | 'free_kick'
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
  setProfile: (profile: SoundProfile) => void;
  stop: () => void;
}

interface MatchSoundscapeOptions {
  result: Pick<MatchResult,
    'fixtureId' | 'homeTeamId' | 'awayTeamId' | 'competitionType' | 'roundLabel' | 'isNeutralVenue'
  >;
  featured: boolean;
  muted: boolean;
  profile: SoundProfile;
}

interface SoundProfileMix {
  master: number;
  crowd: number;
  action: number;
  music: number;
}

export const MATCH_SOUND_PROFILE_MIX: Readonly<Record<SoundProfile, SoundProfileMix>> = {
  quiet: { master: 0.58, crowd: 0.55, action: 1, music: 0.65 },
  balanced: { master: 0.72, crowd: 1, action: 1, music: 0.85 },
  stadium: { master: 0.78, crowd: 1.35, action: 1.08, music: 0.95 },
};

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
  if (event.type === 'corner') return 'corner';
  if (event.type === 'free_kick') return 'free_kick';
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

function createPannedOutput(context: AudioContext, destination: AudioNode, pan: number): AudioNode {
  if (typeof context.createStereoPanner !== 'function' || Math.abs(pan) < 0.01) return destination;
  const panner = context.createStereoPanner();
  panner.pan.value = clamp(pan, -1, 1);
  panner.connect(destination);
  return panner;
}

function scheduleKickContact(
  context: AudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  offset = 0,
  strength = 1,
): void {
  scheduleNoiseBurst(context, destination, noise, 0.025 * strength, 0.09, 1550, offset);
  scheduleOscillator(context, destination, 96, offset, 0.075, 0.018 * strength, 'sine', 62);
}

class BrowserMatchSoundscape implements MatchSoundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdReactionGain: GainNode | null = null;
  private actionGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private eventNoise: AudioBuffer | null = null;
  private muted: boolean;
  private profile: SoundProfile;
  private lastCrowdIntensity = 0.24;
  private readonly seed: number;
  private readonly prestige: number;

  constructor(private readonly options: MatchSoundscapeOptions) {
    this.muted = options.muted;
    this.profile = options.profile;
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
    const crowdReactionGain = context.createGain();
    const actionGain = context.createGain();
    const musicGain = context.createGain();
    const mix = MATCH_SOUND_PROFILE_MIX[this.profile];
    master.gain.value = this.muted ? 0.0001 : mix.master;
    crowdGain.gain.value = (0.011 + this.lastCrowdIntensity * 0.031) * mix.crowd;
    crowdReactionGain.gain.value = 0.86 * mix.crowd;
    actionGain.gain.value = 0.96 * mix.action;
    musicGain.gain.value = 0.8 * mix.music;
    crowdGain.connect(master);
    crowdReactionGain.connect(master);
    actionGain.connect(master);
    musicGain.connect(master);

    let compressor: DynamicsCompressorNode | null = null;
    if (typeof context.createDynamicsCompressor === 'function') {
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.24;
      master.connect(compressor).connect(context.destination);
    } else {
      master.connect(context.destination);
    }

    const buffers = getNoiseBuffers(context);
    const createLayer = (
      frequency: number,
      volume: number,
      playbackRate: number,
      filterType: BiquadFilterType = frequency < 400 ? 'lowpass' : 'bandpass',
    ) => {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffers.crowd;
      source.loop = true;
      source.playbackRate.value = playbackRate;
      filter.type = filterType;
      filter.frequency.value = frequency;
      filter.Q.value = 0.55;
      gain.gain.value = volume;
      source.connect(filter).connect(gain).connect(crowdGain);
      source.start(0, (this.seed % 1400) / 1000);
      this.sources.push(source);
    };
    createLayer(980, 0.7, 0.97);
    createLayer(260, 0.42, 0.71);
    createLayer(1680, 0.2, 1.13, 'highpass');

    this.context = context;
    this.master = master;
    this.crowdGain = crowdGain;
    this.crowdReactionGain = crowdReactionGain;
    this.actionGain = actionGain;
    this.musicGain = musicGain;
    this.compressor = compressor;
    this.eventNoise = buffers.event;
    this.playOpeningTheme();
    reportSoundscape({ type: 'start' });
    return true;
  }

  update(snapshot: MatchAtmosphereSnapshot): void {
    if (!this.started && !this.start()) return;
    if (!this.context || !this.crowdGain) return;
    const intensity = computeCrowdIntensity(snapshot, this.prestige);
    const fixturePulse = 0.96 + Math.sin((snapshot.minute + this.seed % 29) * 0.41) * 0.04;
    this.lastCrowdIntensity = intensity;
    setGain(
      this.crowdGain,
      (0.011 + intensity * 0.031) * MATCH_SOUND_PROFILE_MIX[this.profile].crowd * fixturePulse,
      this.context,
      0.45,
    );
  }

  playEvent(event: MatchEvent): void {
    if ((!this.started && !this.start()) || !this.context || !this.actionGain
      || !this.crowdReactionGain || !this.musicGain || !this.eventNoise) return;
    const cue = classifyMatchSoundEvent(
      event,
      this.options.result.homeTeamId,
      Boolean(this.options.result.isNeutralVenue),
    );
    const context = this.context;
    const noise = this.eventNoise;
    const attackingHome = eventAttacksForHome(event, this.options.result.homeTeamId);
    const actionOutput = createPannedOutput(context, this.actionGain, attackingHome ? 0.24 : -0.24);
    const crowdOutput = createPannedOutput(context, this.crowdReactionGain, attackingHome ? 0.12 : -0.12);

    if (cue === 'none') return;
    reportSoundscape({ type: 'event', cue });
    if (cue.startsWith('goal_')) {
      scheduleKickContact(context, actionOutput, noise, 0, 1.15);
      scheduleOscillator(context, actionOutput, 112, 0.02, 0.16, 0.05, 'sine', 72);
      scheduleNoiseBurst(context, actionOutput, noise, 0.032, 0.32, 2450, 0.05);
      const volume = cue === 'goal_home' ? 0.16 : cue === 'goal_neutral' ? 0.125 : 0.075;
      scheduleNoiseBurst(context, crowdOutput, noise, volume, 1.55, cue === 'goal_away' ? 720 : 1040, 0.04);
      scheduleOscillator(context, this.musicGain, 392, 0.14, 0.24, 0.018, 'triangle', 523);
      scheduleOscillator(context, this.musicGain, 523, 0.32, 0.32, 0.017, 'triangle', 659);
      return;
    }
    if (cue === 'woodwork') {
      scheduleKickContact(context, actionOutput, noise, 0, 1.05);
      scheduleOscillator(context, actionOutput, 1480, 0.05, 0.08, 0.04, 'triangle', 890);
      scheduleNoiseBurst(context, crowdOutput, noise, 0.055, 0.55, 760, 0.07);
      return;
    }
    if (cue === 'save' || cue === 'block') {
      scheduleKickContact(context, actionOutput, noise, 0, cue === 'save' ? 0.9 : 1.08);
      scheduleOscillator(context, actionOutput, cue === 'save' ? 130 : 104, 0.03, 0.13, 0.035, 'sine', 70);
      scheduleNoiseBurst(context, crowdOutput, noise, cue === 'save' ? 0.06 : 0.05, 0.62, 820, 0.04);
      return;
    }
    if (cue === 'miss') {
      scheduleKickContact(context, actionOutput, noise);
      scheduleOscillator(context, actionOutput, 118, 0.02, 0.1, 0.025, 'sine', 78);
      scheduleNoiseBurst(context, crowdOutput, noise, 0.048, 0.48, 680, 0.06);
      return;
    }
    if (cue === 'card' || cue === 'red_card') {
      scheduleWhistle(context, actionOutput);
      scheduleNoiseBurst(context, crowdOutput, noise, cue === 'red_card' ? 0.075 : 0.04, 0.72, 620, 0.12);
      return;
    }
    if (cue === 'substitution') {
      scheduleNoiseBurst(context, crowdOutput, noise, 0.032, 0.48, 1320);
      return;
    }
    if (cue === 'corner') {
      scheduleKickContact(context, actionOutput, noise, 0.02, 0.9);
      scheduleNoiseBurst(context, crowdOutput, noise, 0.034, 0.58, 980, 0.05);
      return;
    }
    if (cue === 'free_kick') {
      scheduleWhistle(context, actionOutput, 0.02);
      scheduleKickContact(context, actionOutput, noise, 0.2, 1.05);
      scheduleNoiseBurst(context, crowdOutput, noise, 0.036, 0.62, 900, 0.1);
    }
  }

  playStage(stage: 'halftime' | 'extra_time' | 'shootout' | 'fulltime'): void {
    if ((!this.started && !this.start()) || !this.context || !this.actionGain
      || !this.crowdReactionGain || !this.eventNoise) return;
    scheduleWhistle(this.context, this.actionGain);
    if (stage === 'fulltime') scheduleWhistle(this.context, this.actionGain, 0.28);
    if (stage === 'shootout') {
      scheduleNoiseBurst(this.context, this.crowdReactionGain, this.eventNoise, 0.07, 1.2, 540, 0.12);
    }
    reportSoundscape({ type: 'stage', cue: stage });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.master) {
      if (!muted) this.start();
      return;
    }
    setGain(
      this.master,
      muted ? 0.0001 : MATCH_SOUND_PROFILE_MIX[this.profile].master,
      this.context,
      muted ? 0.1 : 0.25,
    );
  }

  setProfile(profile: SoundProfile): void {
    this.profile = profile;
    if (!this.context || !this.master || !this.crowdGain || !this.crowdReactionGain
      || !this.actionGain || !this.musicGain) return;
    const mix = MATCH_SOUND_PROFILE_MIX[profile];
    setGain(this.master, this.muted ? 0.0001 : mix.master, this.context, 0.2);
    setGain(this.crowdGain, (0.011 + this.lastCrowdIntensity * 0.031) * mix.crowd, this.context, 0.25);
    setGain(this.crowdReactionGain, 0.86 * mix.crowd, this.context, 0.25);
    setGain(this.actionGain, 0.96 * mix.action, this.context, 0.2);
    setGain(this.musicGain, 0.8 * mix.music, this.context, 0.2);
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
    this.crowdReactionGain = null;
    this.actionGain = null;
    this.musicGain = null;
    this.compressor?.disconnect();
    this.compressor = null;
    this.eventNoise = null;
    if (wasStarted) reportSoundscape({ type: 'stop' });
  }

  private playOpeningTheme(): void {
    if (!this.context || !this.actionGain || !this.musicGain) return;
    scheduleWhistle(this.context, this.actionGain, 0.08);
    if (!this.options.featured) return;
    const root = this.options.result.competitionType === 'world_cup' ? 196 : 174.61;
    [root, root * 1.5, root * 2].forEach((frequency, index) => {
      scheduleOscillator(this.context!, this.musicGain!, frequency, 0.24 + index * 0.08, 1.45, 0.012, 'sine', frequency * 1.01);
    });
    scheduleOscillator(this.context, this.musicGain, root * 2, 1.05, 0.72, 0.014, 'triangle', root * 2.5);
  }
}

export function createMatchSoundscape(options: MatchSoundscapeOptions): MatchSoundscape {
  return new BrowserMatchSoundscape(options);
}
