import mechanics from '../edition/coach-mechanics.json';
import coachNames from '../edition/coach-names';
import { CoachBase, CoachState } from '../types/coach';

export const defaultCoaches: CoachBase[] = mechanics.map(coach => ({ ...coach, name: coachNames[coach.id] })) as CoachBase[];
/**
 * Default coach-to-team assignments.
 * Maps teamId -> coachId.
 */
export const defaultCoachAssignments: Record<string, string> = {
  // 顶级联赛
  gz_hengda: 'coach_ancelotti',
  shimazu: 'coach_guardiola',
  xibei_wolf: 'coach_flick',
  fj_hakka: 'coach_slot',
  honshu_maru: 'coach_xabi',
  bj_guoan: 'coach_arteta',
  sd_taishan: 'coach_inzaghi',
  zhili_victory: 'coach_luis_enrique',
  chumen_world: 'coach_motta',
  jeonbuk: 'coach_simeone',
  liaoning: 'coach_klopp',
  osaka_ippei: 'coach_conceicao',
  hn_happy: 'coach_de_zerbi',
  gz_yongkang: 'coach_conte',
  datong: 'coach_xie_hui',
  jiaozhou: 'coach_postecoglou',
  // 甲级联赛
  sy_street: 'coach_gasperini',
  cs_dragon: 'coach_emery',
  red_sun: 'coach_mourinho',
  sanya: 'coach_garcia',
  taipei_fc: 'coach_choi',
  shikoku: 'coach_wu_jingui',
  omi_eagle: 'coach_xavi',
  xian_bingma: 'coach_hasenhuttl',
  // 乙级联赛
  hokkaido: 'coach_li_xiaopeng',
  yongfu: 'coach_hao_wei',
  ty_taiping: 'coach_chen_yang',
  taipei_dome: 'coach_dyche',
  mori_sailor: 'coach_yan_dinghao',
  bj_oppo: 'coach_wang_baoshan',
  nissan_fc: 'coach_jankovic',
  tsmc_fc: 'coach_li_tie',
};

/** IDs of coaches who start as free agents */
export const unemployedCoachIds: string[] = [
  'coach_tuchel',
  'coach_allegri',
  'coach_pochettino',
  'coach_bielsa',
];

/**
 * Create initial coach states from the default data.
 */
export function createInitialCoachStates(
  coaches: CoachBase[],
  assignments: Record<string, string>,
): Record<string, CoachState> {
  const coachToTeam: Record<string, string> = {};
  for (const [teamId, coachId] of Object.entries(assignments)) {
    coachToTeam[coachId] = teamId;
  }

  const states: Record<string, CoachState> = {};
  for (const coach of coaches) {
    const teamId = coachToTeam[coach.id] ?? null;
    states[coach.id] = {
      id: coach.id,
      currentTeamId: teamId,
      isUnemployed: teamId === null,
      unemployedSince: teamId === null ? 0 : null,
    };
  }
  return states;
}
