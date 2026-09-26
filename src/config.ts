/**
 * BLADEFALL — every tunable number lives here.
 * Units: 1 block = 1 meter, time in seconds, angles in degrees unless noted.
 */

export const SIM = {
  /** Fixed simulation rate. */
  HZ: 60,
  /** Max sim steps per rendered frame (prevents spiral of death after a hitch). */
  MAX_STEPS_PER_FRAME: 5,
  /** Longest frame delta we accept (s); longer frames are clamped. */
  MAX_FRAME_DT: 0.25,
  /** Time scale used by the debug slow-mo toggle (T). */
  DEBUG_SLOWMO_SCALE: 0.25,
} as const;

export const PLAYER = {
  WIDTH: 0.6,
  HEIGHT: 1.8,
  CROUCH_HEIGHT: 0.9,
  EYE_HEIGHT: 1.62,
  CROUCH_EYE_HEIGHT: 0.75,
  /** How fast the eye height blends when crouching/standing (1/s, exponential). */
  EYE_BLEND_RATE: 18,
} as const;

export const MOVE = {
  GRAVITY: 32,
  MAX_FALL_SPEED: 60,

  // --- Ground ---
  RUN_SPEED: 10,
  GROUND_ACCEL: 90,
  /** Decel when there's no input. */
  GROUND_DECEL: 70,
  /** Decel applied to speed above RUN_SPEED while grounded (sheds momentum from slides/dashes). */
  GROUND_OVERSPEED_DECEL: 30,
  /** After landing, overspeed isn't bled off for this long, so a quick re-jump keeps momentum. */
  LANDING_FRICTION_GRACE: 0.1,

  /** Grounded movement automatically climbs ledges up to this tall (0 = off). Keeps slides flowing over 1-block bumps. */
  STEP_HEIGHT: 1,

  // --- Air ---
  /** Air acceleration toward wish direction (strong air control). */
  AIR_ACCEL: 60,
  /** Speed above RUN_SPEED decays by this much per second in the air. */
  AIR_OVERSPEED_DRAG: 1.5,

  // --- Jump ---
  JUMP_VELOCITY: 11,
  COYOTE_TIME: 0.12,
  JUMP_BUFFER: 0.12,

  // --- Dash ---
  DASH_PIPS: 3,
  /** Seconds to regenerate one pip. */
  DASH_REGEN_TIME: 0.9,
  DASH_SPEED: 28,
  DASH_TIME: 0.17,
  DASH_IFRAMES: 0.2,
  /** Horizontal speed kept when a dash ends normally. */
  DASH_EXIT_SPEED: 14,
  /** Jumping out of a grounded dash keeps DASH_SPEED * this horizontally (dash-jump). */
  DASH_JUMP_SPEED_MULT: 0.7,

  // --- Slide ---
  /** Slides never go slower than this. */
  SLIDE_SPEED: 16,
  /** Speed above SLIDE_SPEED bleeds off at this rate (m/s²) while sliding. */
  SLIDE_OVERSPEED_DECEL: 6,
  /** Steering while sliding (rad/s). */
  SLIDE_STEER_RATE: 1.2,
  /** Slide-jump multiplies horizontal speed by this. */
  SLIDE_JUMP_BOOST: 1.1,
  SLIDE_JUMP_VELOCITY: 10,

  // --- Ground slam ---
  SLAM_SPEED: 48,
  /** Fraction of horizontal speed kept when a slam starts. */
  SLAM_HORIZONTAL_KEEP: 0,
  /** Time after landing from a slam in which a jump becomes a slam-bounce. */
  SLAM_BOUNCE_WINDOW: 0.18,
  /** Extra jump velocity per block fallen during the slam. */
  SLAM_BOUNCE_PER_BLOCK: 1.1,
  SLAM_BOUNCE_MAX_BONUS: 16,
  /** Minimum extra velocity for any slam-bounce. */
  SLAM_BOUNCE_MIN_BONUS: 4,

  // --- Wall jump ---
  WALL_JUMPS_MAX: 3,
  /** How far outside the hitbox we look for a wall. */
  WALL_CHECK_DIST: 0.25,
  WALL_JUMP_PUSH: 10,
  WALL_JUMP_UP: 11,
  /** Fraction of along-wall velocity kept on a wall jump. */
  WALL_JUMP_TANGENT_KEEP: 0.9,
  /** Max fall speed while pushing into a wall. */
  WALL_SLIDE_MAX_FALL: 5,
} as const;

export const CAMERA = {
  BASE_FOV: 95,
  NEAR: 0.05,
  FAR: 600,
  /** Mouse sensitivity (radians per pixel). */
  MOUSE_SENSITIVITY: 0.0022,
  PITCH_LIMIT: 89,

  FOV_BLEND_RATE: 10,
  DASH_FOV_KICK: 14,
  SLIDE_FOV_KICK: 7,
  SLAM_FOV_KICK: 10,
  /** Extra FOV from raw speed above RUN_SPEED, up to this much. */
  SPEED_FOV_MAX: 10,
  /** Speed above RUN_SPEED at which SPEED_FOV_MAX is reached. */
  SPEED_FOV_RANGE: 20,

  ROLL_BLEND_RATE: 10,
  SLIDE_TILT: 4,
  STRAFE_TILT: 1.2,
  WALL_JUMP_TILT: 7,
  /** Decay rate (1/s) of wall-jump tilt kick. */
  TILT_KICK_DECAY: 6,

  BOB_FREQ: 1.6,
  BOB_AMOUNT: 0.045,

  LAND_DIP_PER_SPEED: 0.012,
  LAND_DIP_MAX: 0.35,
  LAND_DIP_RECOVER: 12,
  /** How fast the camera catches up after an auto step-up (1/s). */
  STEP_SMOOTH_RATE: 16,

  SHAKE_MAX_OFFSET: 0.12,
  SHAKE_MAX_ROLL: 2.5,
  SHAKE_DECAY: 2.2,
  SHAKE_FREQ: 28,
  SLAM_LAND_TRAUMA_PER_BLOCK: 0.05,
  SLAM_LAND_TRAUMA_MIN: 0.3,
} as const;

export const WORLD = {
  CHUNK_SIZE: 16,
  SKY_COLOR: 0x9cc7e8,
  FOG_DENSITY: 0.008,
  /** Block-edge grid line strength in the voxel shader (0 = off). */
  GRID_LINE_STRENGTH: 0.14,
  /** Per-block brightness jitter so flat colors read as separate blocks. */
  BLOCK_COLOR_JITTER: 0.05,
} as const;

export const TEST_ARENA = {
  SIZE: 160,
  FLOOR_TOP: 4,
  SPAWN: { x: 80.5, y: 4, z: 80.5 },
} as const;

/** Default key bindings (KeyboardEvent.code). */
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  // Ctrl is omitted on purpose: Ctrl+W closes the browser tab.
  crouch: ['KeyC', 'KeyX'],
  reset: ['KeyR'],
  debug: ['F3'],
  slowmo: ['KeyT'],
} as const;

export type Action = keyof typeof KEYS;
