export const BALANCE = {
  // match simulation
  HOME_ADVANTAGE: 0.08,
  BASE_GOAL_RATE: 1.3,
  CUP_RANDOMNESS: 0.25,       // cups are more volatile
  LEAGUE_RANDOMNESS: 0.10,
  MORALE_WEIGHT: 0.12,
  FATIGUE_WEIGHT: 0.15,
  MOMENTUM_WEIGHT: 0.05,
  COACH_BUFF_WEIGHT: 1.0,
  UNDERDOG_BOOST: 0.06,       // weaker teams get a slight boost to make upsets possible

  // post-match effects
  WIN_MORALE_BOOST: 6,
  LOSS_MORALE_DROP: 4,
  DRAW_MORALE: 2,
  MATCH_FATIGUE: 4,
  FATIGUE_RECOVERY: 6,
  BIG_WIN_MOMENTUM: 2,
  BIG_LOSS_MOMENTUM: -2,
  CUP_WIN_MORALE_BONUS: 3,    // extra morale for cup wins
  FINAL_WIN_MORALE_BONUS: 8,  // big boost for winning a final

  // coach pressure
  LOSS_PRESSURE_INCREASE: 5,
  WIN_PRESSURE_DECREASE: 4,
  DRAW_PRESSURE_INCREASE: 1,
  FIRING_THRESHOLD: 80,
  ELITE_TEAM_PRESSURE_MULT: 1.2,

  // world cup cycle
  WORLD_CUP_INTERVAL: 4,
} as const;
