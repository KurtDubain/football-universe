import type { MatchEvent } from './match';

export type PresentationSetPiece = 'corner' | 'direct_free_kick' | 'crossed_free_kick' | 'penalty';
export type PresentationPlayStage = 'build' | 'progress' | 'create' | 'finish' | 'transition';
export type PresentationChanceStyle = 'central' | 'through_ball' | 'cutback' | 'cross';
/**
 * How the ball came back into play.
 *
 * `throw_in` is presentation texture, not a counted fact: the simulator does
 * not tally throw-ins, so the renderer may use one to explain how possession
 * restarted but may never report it as something that happened.
 */
export type PresentationRestart =
  | 'kickoff'
  | 'goal_kick'
  | 'keeper_release'
  | 'second_ball'
  | 'clearance'
  | 'throw_in';

export interface MatchPresentationCue {
  id: string;
  moment: 'setup' | 'contact' | 'outcome';
  event: MatchEvent;
  attackingHome: boolean;
  /** `beat` is a card or a substitution: a stoppage with no ball path. */
  action?: 'delivery' | 'shot' | 'beat';
  outcome?: 'goal' | 'save' | 'block' | 'miss' | 'delivery';
}

export interface MatchPresentationAtmosphere {
  danger: number;
  attackingHome: boolean;
  stage?: PresentationPlayStage;
  setPiece?: PresentationSetPiece;
  inFlight: boolean;
}
