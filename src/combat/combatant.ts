import type { Vector3 } from 'three';
import type { EnemyAttackDef } from '../config';
import type { AABB } from '../world/collision';
import type { VoxelQuery } from '../world/world';
import type { Posture } from './posture';

/** Things a combatant reports to the combat system during its update. */
export type CombatantEvent =
  | { type: 'attack'; attack: EnemyAttackDef }
  | { type: 'telegraph'; unblockable: boolean }
  | { type: 'feint' }
  | { type: 'shoot' }
  | { type: 'respawn' }
  | { type: 'aggro' };

/** What an enemy can see of the player each step. */
export interface PlayerView {
  pos: Vector3;
  /** Player is in a melee windup with this swing id (0 if not). */
  windupSwingId: number;
}

/** Anything the player can fight: training dummy, Husks, Crows, later bosses. */
export interface Combatant {
  readonly kind: string;
  readonly pos: Vector3;
  readonly prevPos: Vector3;
  readonly vel: Vector3;
  yaw: number;
  health: number;
  readonly maxHealth: number;
  readonly posture: Posture;
  /** Last player swing id that hit us (each swing hits once). */
  lastHitSwing: number;
  events: CombatantEvent[];
  readonly alive: boolean;
  readonly staggered: boolean;
  /** Dead and finished its death animation: safe to remove. */
  readonly removable: boolean;
  /** Height of the body (for health bars). */
  readonly height: number;
  /** Multiplier on the damage this enemy's attacks deal (nightborn Husks). */
  readonly damageMult?: number;
  /** How well lit the enemy is, 0..1 (set by the game; darkness hides telegraphs). */
  lit?: number;

  update(dt: number, world: VoxelQuery, player: PlayerView): void;
  hurtbox(): AABB;
  center(): Vector3;
  isParrying(): boolean;
  telegraph(): 'none' | 'yellow' | 'red';
  threatening(): boolean;
  takeHit(damage: number, posture: number, knockX: number, knockZ: number): { broke: boolean; died: boolean };
  /** The player perfect-parried us; returns whether our posture broke. */
  onParried(postureDamage: number): boolean;
  /** We parried the player's attack. */
  onParriedPlayer(): void;
  kill(): void;
  /** Items dropped on death. */
  loot(): { item: string; count: number }[];
}
