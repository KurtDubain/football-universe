import { clamp } from './math';
import type {
  MatchPresentationAtmosphere,
  PassPhase,
  PresentationPlayStage,
} from './types';

const STAGE_DANGER: Readonly<Record<PresentationPlayStage, number>> = {
  build: 0.12,
  progress: 0.28,
  create: 0.66,
  finish: 0.94,
  transition: 0.52,
};

export function presentationAtmosphereForPhase(
  phase: PassPhase,
  ballX: number,
  inFlight: boolean,
): MatchPresentationAtmosphere {
  const attackingProgress = phase.attackingHome ? ballX : 1 - ballX;
  const territoryDanger = clamp((attackingProgress - 0.34) / 0.58, 0, 1);
  const stageDanger = phase.stage ? STAGE_DANGER[phase.stage] : 0.2;
  const setPieceDanger = phase.setPiece === 'penalty'
    ? 1
    : phase.setPiece === 'direct_free_kick'
      ? 0.82
      : phase.setPiece
        ? 0.72
        : 0;
  const actionDanger = phase.kind === 'shot' ? (inFlight ? 1 : 0.9) : 0;

  return {
    danger: clamp(Math.max(
      territoryDanger * 0.72 + stageDanger * 0.28,
      setPieceDanger,
      actionDanger,
    ), 0, 1),
    attackingHome: phase.attackingHome,
    stage: phase.stage,
    setPiece: phase.setPiece,
    inFlight,
  };
}
