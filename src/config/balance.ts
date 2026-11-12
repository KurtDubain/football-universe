export const BALANCE = {
  // match simulation
  HOME_ADVANTAGE: 0.08,
  BASE_GOAL_RATE: 1.40,       // was 1.3 against the ratio form, which inflated
                              // goals for weak clubs; see STRENGTH_EDGE_* below
  CUP_RANDOMNESS: 0.25,       // cups are more volatile
  LEAGUE_RANDOMNESS: 0.10,
  MORALE_WEIGHT: 0.12,
  FATIGUE_WEIGHT: 0.15,
  MOMENTUM_WEIGHT: 0.05,
  COACH_BUFF_WEIGHT: 1.0,
  PLAYER_BOOST_WEIGHT: 1.0,   // multiplier on the player-derived squad boost (set to 0 to disable entirely)
  // ± cap per side (attack/midfield/defense). Was 15, which would now flatten
  // exactly the elite-vs-elite differences the star term exists to create.
  // 50 clears the strongest real squad in the game (the dynasty club asks for
  // 47.9 on attack at world creation), so only a fantasy all-90 XI saturates.
  PLAYER_BOOST_CAP: 50,
  // How much a rating gap is worth. The strength term used to be a plain
  // attack/defense ratio, which shrank a fixed gap as teams got stronger: a
  // five-point gap bought 0.130 expected goals at OVR 89 but 0.184 at OVR 63.
  // That made the top flight measurably more random than the third tier
  // (rank correlation 0.15 vs 0.60). tanh is odd, so the average goal rate is
  // unchanged, and it saturates so a mismatch cannot run away.
  // Slope near zero is MAX/SCALE = 0.018 per rating point, level-independent.
  // The ratio form's slope was 1/OVR: 0.0115 at OVR 87 but 0.0139 at OVR 72.
  // SCALE 30 saturated too early for the third tier, whose routine mismatches
  // run to 25 points, and cost it a third of its strength signal.
  STRENGTH_EDGE_SCALE: 45,     // rating points per unit of tanh argument
  STRENGTH_EDGE_MAX: 0.81,     // a gap can move expectancy by at most ±81%

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
  /** Separate neutral-tournament atmosphere boost for the selected host club. */
  WORLD_CUP_HOST_ADVANTAGE: 0.04,
} as const;
