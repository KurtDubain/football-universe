import type { MatchEvent } from './match';

export type PresentationSetPiece = 'corner' | 'direct_free_kick' | 'crossed_free_kick' | 'penalty';
export type PresentationPlayStage = 'build' | 'progress' | 'create' | 'finish' | 'transition';
export type PresentationChanceStyle = 'central' | 'through_ball' | 'cutback' | 'cross';

export interface MatchPresentationCue {
  id: string;
  moment: 'setup' | 'contact' | 'outcome';
  event: MatchEvent;
  attackingHome: boolean;
  action?: 'delivery' | 'shot';
  outcome?: 'goal' | 'save' | 'block' | 'miss' | 'delivery';
}

export interface MatchPresentationAtmosphere {
  danger: number;
  attackingHome: boolean;
  stage?: PresentationPlayStage;
  setPiece?: PresentationSetPiece;
  inFlight: boolean;
}
