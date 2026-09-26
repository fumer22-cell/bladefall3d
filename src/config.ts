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
  GRAVITY: 46,
  /** Gravity multiplier while falling: snappier arcs, less hang time. */
  FALL_GRAVITY_MULT: 1.35,
  MAX_FALL_SPEED: 72,

  // --- Ground ---
  RUN_SPEED: 10,
  GROUND_ACCEL: 150,
  /** Decel when there's no input. */
  GROUND_DECEL: 130,
  /** Decel applied to speed above RUN_SPEED while grounded (sheds momentum from slides/dashes). */
  GROUND_OVERSPEED_DECEL: 40,
  /** After landing, overspeed isn't bled off for this long, so a quick re-jump keeps momentum. */
  LANDING_FRICTION_GRACE: 0.1,

  /** Grounded movement automatically climbs ledges up to this tall (0 = off). Keeps slides flowing over 1-block bumps. */
  STEP_HEIGHT: 1,

  // --- Air ---
  /** Air acceleration toward wish direction (strong air control). */
  AIR_ACCEL: 80,
  /** Speed above RUN_SPEED decays by this much per second in the air. */
  AIR_OVERSPEED_DRAG: 1.5,

  // --- Jump ---
  JUMP_VELOCITY: 13.2,
  /** Releasing jump while rising multiplies upward speed by this (short hops). */
  JUMP_CUT_MULT: 0.45,
  COYOTE_TIME: 0.1,
  JUMP_BUFFER: 0.12,

  // --- Dash ---
  DASH_PIPS: 3,
  /** Seconds to regenerate one pip. */
  DASH_REGEN_TIME: 0.9,
  DASH_SPEED: 32,
  DASH_TIME: 0.14,
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
  SLIDE_JUMP_VELOCITY: 12,

  // --- Ground slam ---
  SLAM_SPEED: 62,
  /** Fraction of horizontal speed kept when a slam starts. */
  SLAM_HORIZONTAL_KEEP: 0,
  /** Time after landing from a slam in which a jump becomes a slam-bounce. */
  SLAM_BOUNCE_WINDOW: 0.18,
  /** Extra jump velocity per block fallen during the slam. */
  SLAM_BOUNCE_PER_BLOCK: 1.35,
  SLAM_BOUNCE_MAX_BONUS: 19,
  /** Minimum extra velocity for any slam-bounce. */
  SLAM_BOUNCE_MIN_BONUS: 5,

  // --- Wall jump ---
  WALL_JUMPS_MAX: 3,
  /** How far outside the hitbox we look for a wall. */
  WALL_CHECK_DIST: 0.25,
  WALL_JUMP_PUSH: 11,
  WALL_JUMP_UP: 13.5,
  /** Fraction of along-wall velocity kept on a wall jump. */
  WALL_JUMP_TANGENT_KEEP: 0.9,
  /** Max fall speed while pushing into a wall. */
  WALL_SLIDE_MAX_FALL: 5,

  // --- Water ---
  WATER_GRAVITY_MULT: 0.3,
  WATER_MAX_SINK: 3,
  WATER_SPEED_MULT: 0.55,
  /** Vertical speed approached while holding jump in water. */
  SWIM_UP_SPEED: 6,
  /** Upward kick when swimming against a ledge, to climb out. */
  WATER_EXIT_BOOST: 8,
  /** Horizontal drag (1/s) above swim speed. */
  WATER_DRAG: 4,
} as const;

export const CAMERA = {
  BASE_FOV: 95,
  NEAR: 0.05,
  FAR: 600,
  /** Mouse sensitivity (radians per pixel). */
  MOUSE_SENSITIVITY: 0.0022,
  /** A single mouse event moving more than this (px) is treated as a glitch and ignored. */
  MOUSE_SPIKE_PX: 250,
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
  /** World height in blocks (must be a multiple of CHUNK_SIZE). */
  HEIGHT: 256,
  SEA_LEVEL: 62,
  /** World seed. 0 = random each load. */
  SEED: 1337,
  /** Columns loaded around the player (radius, in chunks). */
  RENDER_DISTANCE: 7,
  /** Columns are unloaded this many chunks beyond the render distance. */
  UNLOAD_MARGIN: 2,
  /** Background work limits. */
  MAX_GEN_IN_FLIGHT: 6,
  MAX_MESH_IN_FLIGHT: 8,
  /** Generated columns integrated (light-stitched) per frame. */
  COLUMNS_PER_FRAME: 2,
  SKY_COLOR: 0x7a5e7c,
  /** Fog color when you're somewhere dark (caves). */
  CAVE_FOG_COLOR: 0x07080b,
  FOG_DENSITY: 0.0065,
  /** Directional face shading: [top, bottom, ±x sides, ±z sides]. */
  FACE_SHADE: [1.0, 0.6, 0.9, 0.8],
} as const;

/** Pixel-art presentation: low-res render + palette snapping with ordered dithering. */
export const PIXEL = {
  /** Internal render height in pixels (rounded to an integer upscale of the window). */
  TARGET_HEIGHT: 540,
  /** 0 = true colors, 1 = fully snapped to the palette. */
  PALETTE_STRENGTH: 0.85,
  /** Ordered-dither amplitude before palette snapping. */
  DITHER: 0.03,
  /** Ink outline darkness at depth edges (0 = off). */
  OUTLINE: 0.55,
  /** Relative depth jump that counts as an edge. */
  OUTLINE_THRESHOLD: 0.07,
  VIGNETTE: 0.4,
  /** Cool shadows / warm highlights color grade strength. */
  GRADE: 1,
} as const;

/** Dusk sky: a low sun, a big pixel moon, stars and banded clouds. */
export const SKY = {
  SUN_ELEVATION: 6,
  SUN_AZIMUTH: 215,
  MOON_ELEVATION: 38,
  MOON_AZIMUTH: 40,
  MOON_SIZE: 0.075,
  CLOUD_SPEED: 0.004,
  /** Fog/haze color at the horizon (hex). */
  HAZE: 0x7a5e7c,
} as const;

/** Ambient life: fireflies drifting around the player. */
export const AMBIENT = {
  FIREFLIES: 90,
  RADIUS: 22,
  /** Fireflies glow brighter where it's dark. */
  MIN_ALPHA: 0.35,
} as const;

export const LIGHT = {
  /** Brightness at light level 0 (so pitch-black caves are still barely readable). */
  MIN_BRIGHTNESS: 0.06,
  /** Each light level below 15 multiplies brightness by this. */
  FALLOFF: 0.8,
  /** Warm tint for torch/block light. */
  TORCH_TINT: [1.0, 0.8, 0.55],
  TORCH_LEVEL: 14,
  /** Ambient-occlusion brightness for 0..3 occluding neighbors. */
  AO: [1.0, 0.78, 0.62, 0.48],
  /** Day brightness multiplier for sky light (Phase 6 animates this). */
  DAYLIGHT: 1.0,
  /** Color of sky light: a warm, golden-hour cast. */
  SKY_TINT: [1.0, 0.93, 0.82],
} as const;

export const BUILD = {
  REACH: 6,
  /** Seconds between placements while holding place. */
  PLACE_REPEAT: 0.22,
  /** Mining speed with bare hands (block hardness is in seconds at speed 1). */
  HAND_SPEED: 1,
} as const;

/** Tool/weapon material tiers. `tier` gates which blocks a pickaxe can mine. */
export const TIERS = {
  HAND: { tier: 0, mineSpeed: 1 },
  WOOD: { tier: 1, mineSpeed: 2 },
  COPPER: { tier: 2, mineSpeed: 3 },
  IRON: { tier: 3, mineSpeed: 4.5 },
  /** Weapon damage & posture multipliers per material. */
  WEAPON_MULT: { RUSTY: 0.8, COPPER: 1.0, IRON: 1.35 },
} as const;

export const INVENTORY = {
  SLOTS: 36,
  HOTBAR: 9,
  MAX_STACK: 64,
  /** Crafting stations count if they're within this many blocks of you. */
  STATION_RADIUS: 4,
  /** Dropped items fly to you inside this radius and are picked up inside PICKUP_RADIUS. */
  MAGNET_RADIUS: 3.5,
  PICKUP_RADIUS: 1.2,
  MAGNET_SPEED: 12,
  /** Dropped items despawn after this long (s). */
  DROP_LIFETIME: 300,
} as const;

export const SAVE = {
  DB_NAME: 'bladefall',
  DB_VERSION: 1,
  /** Seconds between autosaves. */
  AUTOSAVE_INTERVAL: 45,
} as const;

export const TEST_ARENA = {
  SIZE: 160,
  FLOOR_TOP: 4,
  SPAWN: { x: 80.5, y: 4, z: 80.5 },
} as const;

export const COMBAT = {
  PLAYER_MAX_HEALTH: 100,
  PLAYER_MAX_POSTURE: 100,

  // --- Attack input ---
  /** Holding attack this long turns the swing into a heavy. A release before this is a light. */
  HEAVY_HOLD_TIME: 0.16,
  /** Mouse movement (px) during windup needed to pick a direction; less uses the combo's default. */
  AIM_DIR_THRESHOLD: 18,
  /** Fraction of recovery after which a new light attack cancels into the next combo step. */
  COMBO_CANCEL_FRACTION: 0.35,
  /** Combo resets if you don't attack again within this time after recovery. */
  COMBO_RESET_TIME: 0.45,
  /** Feinting a heavy costs this much of your own posture. */
  FEINT_POSTURE_COST: 6,
  FEINT_RECOVERY: 0.12,
  /** Horizontal movement speed multiplier while guarding. */
  GUARD_MOVE_MULT: 0.6,
  /** Movement multiplier during a heavy windup. */
  HEAVY_WINDUP_MOVE_MULT: 0.85,

  // --- Direction modifiers (damage / posture multipliers, arc sizes) ---
  DIR: {
    slashL: { damage: 1, posture: 1, arcH: 65, arcV: 45, reachBonus: 0 },
    slashR: { damage: 1, posture: 1, arcH: 65, arcV: 45, reachBonus: 0 },
    overhead: { damage: 1.15, posture: 1.35, arcH: 25, arcV: 70, reachBonus: 0 },
    stab: { damage: 0.9, posture: 0.8, arcH: 16, arcV: 20, reachBonus: 0.6 },
  },

  // --- Parry / guard ---
  /** Perfect-parry window after pressing block (s). Multiplied by the weapon's parryWindowMult. */
  PERFECT_PARRY_WINDOW: 0.15,
  /** A parry press that deflects nothing makes the next press guard-only for this long (anti-mash). */
  PARRY_SPAM_LOCKOUT: 0.35,
  /** Guarded hits: damage taken multiplier. */
  GUARD_DAMAGE_MULT: 0.25,
  /** Guarded hits: posture damage multiplier on YOU. */
  GUARD_POSTURE_MULT: 1.0,
  /** Unguarded hits still hurt your posture a bit. */
  HIT_POSTURE_MULT: 0.4,
  /** Enemy posture damage from your perfect parry = their attack posture × this + base. */
  PARRY_POSTURE_MULT: 1.6,
  PARRY_POSTURE_BASE: 10,
  /** Dash pips refunded by a perfect parry. */
  PARRY_DASH_REFUND: 1,
  /** Window after a perfect parry in which your next attack is a riposte. */
  RIPOSTE_WINDOW: 0.7,
  /** Riposte windup is shortened by this factor. */
  RIPOSTE_WINDUP_MULT: 0.6,
  RIPOSTE_POSTURE_MULT: 2,
  /** Being parried stuns you for this long. */
  PARRIED_RECOIL_TIME: 0.45,
  /** Posture damage you take when an enemy parries you = your attack's posture × this. */
  PARRIED_POSTURE_MULT: 1.2,

  // --- Posture ---
  POSTURE_REGEN_DELAY: 0.9,
  /** Posture recovered per second (fraction of max). */
  POSTURE_REGEN_RATE: 0.12,
  POSTURE_REGEN_GUARD_MULT: 0.3,
  /** Player posture regens faster if you landed a hit recently (aggression rewarded). */
  POSTURE_REGEN_AGGRO_MULT: 1.8,
  AGGRO_WINDOW: 1.5,
  /** Enemy posture regen scales down with lost health: rate × lerp(this, 1, healthFraction). */
  POSTURE_REGEN_LOW_HEALTH_MULT: 0.3,
  PLAYER_STAGGER_TIME: 1.0,
  ENEMY_STAGGER_TIME: 2.6,
  /** Hits on a staggered (non-deathblow) target deal extra damage. */
  STAGGERED_DAMAGE_MULT: 1.5,

  // --- Deathblow ---
  DEATHBLOW_RANGE: 3.2,
  DEATHBLOW_TIME: 0.75,
  DEATHBLOW_TIMESCALE: 0.4,
  DEATHBLOW_HITSTOP: 0.14,
  DEATHBLOW_FOV_ZOOM: 22,
  /** Distance the player lunges to during a deathblow. */
  DEATHBLOW_LUNGE_DIST: 1.4,

  // --- Blood healing ---
  BLOOD_HEAL_RADIUS: 4,
  /** Health healed per point of damage dealt, when within the radius. */
  BLOOD_HEAL_PER_DAMAGE: 0.3,
  BLOOD_KILL_HEAL: 30,

  // --- Game feel ---
  HITSTOP_LIGHT: 0.035,
  HITSTOP_HEAVY: 0.075,
  HITSTOP_CRIT: 0.11,
  HITSTOP_PARRY: 0.09,
  HITSTOP_GUARD: 0.03,
  HITSTOP_PLAYER_HIT: 0.06,
  SHAKE_HIT: 0.12,
  SHAKE_HEAVY: 0.25,
  SHAKE_PARRY: 0.3,
  SHAKE_PLAYER_HIT: 0.45,
  SHAKE_DEATHBLOW: 0.6,
  /** Knockback speed applied to targets you hit (× weapon knockback). */
  KNOCKBACK: 4,
  /** Knockback speed applied to the player when hit. */
  PLAYER_KNOCKBACK: 9,
  /** Off-screen warning shows for attackers more than this many degrees from view center. */
  OFFSCREEN_WARN_ANGLE: 50,
  RESPAWN_DELAY: 2,
} as const;

export type AttackDir = 'slashL' | 'slashR' | 'overhead' | 'stab';

export interface AttackDef {
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  posture: number;
}

export interface WeaponDef {
  name: string;
  model: 'sword' | 'greatsword' | 'daggers' | 'spear' | 'gauntlets';
  reach: number;
  light: AttackDef[];
  /** Default direction for each light combo step when the mouse barely moves. */
  lightDirs: AttackDir[];
  heavy: AttackDef;
  heavyDir: AttackDir;
  parryWindowMult: number;
  /** Damage multiplier on ripostes. */
  riposteMult: number;
  knockback: number;
  /** Two-handed viewmodels (daggers, gauntlets) alternate hands on combo steps. */
  dualWield: boolean;
}

const atk = (windup: number, active: number, recovery: number, damage: number, posture: number): AttackDef => ({
  windup, active, recovery, damage, posture,
});

export const WEAPONS: WeaponDef[] = [
  {
    name: 'Sword', model: 'sword', reach: 2.7,
    light: [atk(0.2, 0.1, 0.26, 12, 10), atk(0.18, 0.1, 0.26, 12, 10), atk(0.24, 0.12, 0.34, 16, 14)],
    lightDirs: ['slashR', 'slashL', 'overhead'],
    heavy: atk(0.5, 0.13, 0.42, 30, 32), heavyDir: 'overhead',
    parryWindowMult: 1, riposteMult: 2.5, knockback: 1, dualWield: false,
  },
  {
    name: 'Greatsword', model: 'greatsword', reach: 3.1,
    light: [atk(0.36, 0.15, 0.42, 22, 26), atk(0.34, 0.15, 0.46, 24, 30)],
    lightDirs: ['slashR', 'slashL'],
    heavy: atk(0.8, 0.17, 0.6, 52, 75), heavyDir: 'overhead',
    parryWindowMult: 0.9, riposteMult: 2.5, knockback: 1.8, dualWield: false,
  },
  {
    name: 'Daggers', model: 'daggers', reach: 2.0,
    light: [atk(0.1, 0.07, 0.13, 6, 3), atk(0.1, 0.07, 0.13, 6, 3), atk(0.1, 0.07, 0.13, 6, 3), atk(0.12, 0.08, 0.2, 9, 5)],
    lightDirs: ['slashR', 'slashL', 'stab', 'stab'],
    heavy: atk(0.3, 0.1, 0.3, 16, 8), heavyDir: 'stab',
    parryWindowMult: 1.15, riposteMult: 3, knockback: 0.4, dualWield: true,
  },
  {
    name: 'Spear', model: 'spear', reach: 3.6,
    light: [atk(0.22, 0.1, 0.3, 11, 8), atk(0.22, 0.1, 0.3, 11, 8), atk(0.26, 0.12, 0.36, 14, 12)],
    lightDirs: ['stab', 'stab', 'slashR'],
    heavy: atk(0.55, 0.13, 0.45, 27, 24), heavyDir: 'stab',
    parryWindowMult: 0.9, riposteMult: 2.2, knockback: 1.2, dualWield: false,
  },
  {
    name: 'Gauntlets', model: 'gauntlets', reach: 1.8,
    light: [atk(0.12, 0.08, 0.15, 7, 9), atk(0.12, 0.08, 0.15, 7, 9), atk(0.16, 0.09, 0.24, 10, 14)],
    lightDirs: ['stab', 'stab', 'overhead'],
    heavy: atk(0.4, 0.11, 0.35, 18, 32), heavyDir: 'overhead',
    parryWindowMult: 0.5, riposteMult: 5, knockback: 1.5, dualWield: true,
  },
];

export interface EnemyAttackDef {
  name: string;
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  posture: number;
  reach: number;
  /** Half-angle of the hit cone in front of the attacker (deg). */
  arc: number;
  /** Red telegraph: can't be parried or guarded. */
  unblockable: boolean;
  /** If set, only hits targets whose feet are below attackerFeet + this (jumpable sweep). */
  maxHitHeight?: number;
}

export const DUMMY = {
  MAX_HEALTH: 300,
  MAX_POSTURE: 100,
  WIDTH: 0.8,
  HEIGHT: 2.0,
  TURN_RATE: 5,
  FRICTION: 30,
  RESPAWN_TIME: 2.2,
  /** Melee modes attack when the player is within this range. */
  AGGRO_RANGE: 4.5,
  ATTACK_COOLDOWN_MIN: 0.7,
  ATTACK_COOLDOWN_MAX: 1.5,
  /** Chance of a follow-up swing after an attack (combo). */
  COMBO_CHANCE: 0.35,
  /** In mixed mode. */
  UNBLOCKABLE_CHANCE: 0.3,
  FEINT_CHANCE: 0.25,
  /** A feint cancels at this fraction of the windup. */
  FEINT_AT: 0.6,
  /** Recoil after being perfect-parried. */
  PARRIED_RECOIL: 0.9,
  /** Parrier mode: reaction time before it raises a parry against your windup. */
  PARRY_REACTION: 0.17,
  PARRY_WINDOW: 0.2,
  /** Vulnerable time after a parry attempt that deflected nothing. */
  PARRY_WHIFF_RECOVERY: 0.55,
  SHOOT_RANGE: 40,
  SHOOT_WINDUP: 0.55,
  SHOOT_COOLDOWN: 1.2,
  ATTACKS: {
    swing: { name: 'swing', windup: 0.55, active: 0.1, recovery: 0.45, damage: 14, posture: 20, reach: 3.3, arc: 70, unblockable: false },
    quick: { name: 'quick', windup: 0.32, active: 0.1, recovery: 0.4, damage: 10, posture: 14, reach: 3.3, arc: 70, unblockable: false },
    sweep: { name: 'sweep', windup: 0.75, active: 0.12, recovery: 0.6, damage: 24, posture: 30, reach: 3.6, arc: 110, unblockable: true, maxHitHeight: 0.9 },
  } satisfies Record<string, EnemyAttackDef>,
} as const;

export const PROJECTILE = {
  SPEED: 16,
  RADIUS: 0.18,
  DAMAGE: 12,
  POSTURE: 15,
  LIFETIME: 5,
  /** Reflected projectiles fly this much faster and deal this damage multiplier. */
  REFLECT_SPEED_MULT: 1.8,
  REFLECT_DAMAGE_MULT: 2,
  /** A perfect parry catches projectiles within this distance of your eyes. */
  PARRY_REACH: 2.2,
} as const;

export const PARTICLES = {
  MAX: 3000,
  GRAVITY: 18,
  BLOOD_PER_DAMAGE: 1.2,
  BLOOD_MAX_BURST: 60,
  SPARKS_PARRY: 40,
  SPARKS_GUARD: 14,
} as const;

export const VIEWMODEL = {
  SWAY_AMOUNT: 0.0009,
  SWAY_MAX: 0.08,
  SWAY_RETURN: 10,
  BOB_AMOUNT: 0.02,
  RECOIL_HIT: 0.07,
  RECOIL_RETURN: 14,
} as const;

/** Default key bindings (KeyboardEvent.code; mouse buttons are Mouse0 = left, Mouse2 = right). */
export const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  // Ctrl is omitted on purpose: Ctrl+W closes the browser tab.
  crouch: ['KeyC', 'KeyX'],
  attack: ['Mouse0'],
  block: ['Mouse2'],
  feint: ['KeyQ'],
  interact: ['KeyF'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  slot6: ['Digit6'],
  slot7: ['Digit7'],
  slot8: ['Digit8'],
  slot9: ['Digit9'],
  inventory: ['KeyE', 'Tab'],
  debugKit: ['KeyK'],
  dummyMode: ['KeyG'],
  dummyReset: ['KeyH'],
  reset: ['KeyR'],
  debug: ['F3'],
  slowmo: ['KeyT'],
} as const;

export type Action = keyof typeof KEYS;
