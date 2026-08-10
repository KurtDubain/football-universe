import type { AmbientMusicScene } from './ambient-music';

export type TournamentMusicTone = 'amber' | 'violet' | 'orange' | 'cyan' | 'rose' | 'emerald';

export interface TournamentMusicMeta {
  label: string;
  tone: TournamentMusicTone;
}

export const TOURNAMENT_MUSIC_META: Readonly<Record<AmbientMusicScene, TournamentMusicMeta>> = {
  league_cup: { label: '联赛杯主题', tone: 'amber' },
  super_cup: { label: '超级杯主题', tone: 'violet' },
  mainland_cup: { label: '大陆杯主题', tone: 'orange' },
  southern_cup: { label: '南洲杯主题', tone: 'cyan' },
  eastern_cup: { label: '东洲杯主题', tone: 'rose' },
  world_cup: { label: '世界杯主题', tone: 'emerald' },
  world_cup_final: { label: '世界杯决赛主题', tone: 'emerald' },
  world_cup_champion: { label: '世界杯冠军主题', tone: 'emerald' },
};
