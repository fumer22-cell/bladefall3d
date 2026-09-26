import { Vector3 } from 'three';
import { COMBAT, MOVE, PLAYER, PROJECTILE, type EnemyAttackDef } from '../config';
import { Emitter } from '../core/events';
import { DEG } from '../core/math';
import type { Player } from '../player/player';
import type { VoxelQuery } from '../world/world';
import { resolveDefense } from './defense';
import { swingHits, inCone } from './melee';
import { PlayerCombat, type CombatIntent } from './playerCombat';
import { Projectiles, type Projectile } from './projectiles';
import type { Combatant } from './combatant';

type V3 = { x: number; y: number; z: number };

export interface CombatEventMap extends Record<string, unknown> {
  swing: { heavy: boolean; riposte: boolean };
  feint: Record<string, never>;
  telegraph: { unblockable: boolean };
  hit: { pos: V3; damage: number; heavy: boolean; crit: boolean };
  /** An enemy parried the player's swing. */
  playerParried: { pos: V3 };
  parry: { pos: V3; projectile: boolean };
  guard: { pos: V3; damage: number };
  dodge: Record<string, never>;
  playerHit: { damage: number; from: V3 };
  postureBreak: { pos: V3; player: boolean };
  deathblow: { pos: V3 };
  kill: { pos: V3; target: Combatant };
  aggro: { kind: string };
  heal: { amount: number };
  shoot: { pos: V3 };
  projectileBurst: { pos: V3 };
  playerDeath: Record<string, never>;
}

interface Deathblow {
  target: Combatant;
  t: number;
  struck: boolean;
}

export class CombatSystem {
  readonly events = new Emitter<CombatEventMap>();
  readonly combat = new PlayerCombat();
  readonly projectiles = new Projectiles();
  /** Everything the player can fight: the dummy and wild enemies. */
  readonly enemies: Combatant[] = [];
  deathblow: Deathblow | null = null;
  /** Multiplier on damage enemies deal to the player (armor). */
  damageTakenMult = 1;
  /** Seconds until respawn while dead (0 = alive). */
  deadTimer = 0;

  constructor(
    private readonly player: Player,
    private readonly world: VoxelQuery,
    private readonly onRespawn: () => void,
  ) {}

  eye(): Vector3 {
    const p = this.player;
    return new Vector3(p.pos.x, p.pos.y + (p.crouched ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT), p.pos.z);
  }

  lookDir(): Vector3 {
    const { yaw, pitch } = this.player;
    return new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  /** A staggered target the player can deathblow right now, if any. */
  deathblowTarget(): Combatant | null {
    const eye = this.eye();
    const look = this.lookDir();
    for (const d of this.enemies) {
      if (!d.staggered) continue;
      const to = d.center().sub(eye);
      const dist = to.length();
      if (dist > COMBAT.DEATHBLOW_RANGE + 0.5) continue;
      if (to.normalize().dot(look) < Math.cos(60 * DEG)) continue;
      return d;
    }
    return null;
  }

  isDead(): boolean {
    return this.deadTimer > 0;
  }

  /** Input intents are ignored while dead/deathblowing; the caller checks `inputLocked()`. */
  inputLocked(): boolean {
    return this.isDead() || this.deathblow !== null || this.combat.phase === 'staggered';
  }

  step(dt: number, intent: CombatIntent, interactPressed: boolean): void {
    const { combat, player } = this;

    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) {
        this.deadTimer = 0;
        combat.reset();
        this.onRespawn();
      }
      intent = { ...intent, attackPressed: false, attackHeld: false, blockPressed: false, blockHeld: false };
    }

    // Deathblow: attack or interact on a staggered target in range.
    if (!this.deathblow && combat.canAct() && (intent.attackPressed || interactPressed)) {
      const target = this.deathblowTarget();
      if (target) {
        this.deathblow = { target, t: 0, struck: false };
        combat.startDeathblow();
        intent = { ...intent, attackPressed: false };
      }
    }

    combat.update(dt, intent);
    player.speedMult = combat.moveSpeedMult();
    for (const e of combat.events) {
      if (e.type === 'swingStart') this.events.emit('swing', { heavy: e.heavy, riposte: e.riposte });
      else if (e.type === 'feint') this.events.emit('feint', {});
    }
    combat.events.length = 0;

    if (this.deathblow) this.updateDeathblow(dt);

    // Dummies.
    const windupSwingId = combat.phase === 'windup' && combat.swing ? combat.swing.id : 0;
    for (const d of this.enemies) {
      d.update(dt, this.world, { pos: player.pos, windupSwingId });
      for (const e of d.events) {
        if (e.type === 'attack') this.resolveEnemyMelee(d, e.attack);
        else if (e.type === 'telegraph') this.events.emit('telegraph', { unblockable: e.unblockable });
        else if (e.type === 'shoot') this.fireAtPlayer(d);
        else if (e.type === 'aggro') this.events.emit('aggro', { kind: d.kind });
      }
      d.events.length = 0;
    }

    // Player swing hits.
    if (combat.phase === 'active' && combat.swing) this.resolvePlayerSwing();

    this.updateProjectiles(dt);
  }

  private resolvePlayerSwing(): void {
    const { combat, player } = this;
    const s = combat.swing!;
    const w = combat.weapon;
    const eye = this.eye();
    const dirMod = COMBAT.DIR[s.dir];
    for (const d of this.enemies) {
      if (!d.alive || d.lastHitSwing === s.id) continue;
      if (!swingHits(eye, player.yaw, player.pitch, s.dir, w.reach, d.hurtbox())) continue;
      d.lastHitSwing = s.id;
      const pos = d.center();

      if (d.isParrying() && !s.riposte) {
        combat.onParried();
        d.onParriedPlayer();
        this.events.emit('playerParried', { pos });
        return;
      }

      let damage = s.def.damage * dirMod.damage * combat.materialMult;
      let posture = s.def.posture * dirMod.posture * combat.materialMult;
      const crit = s.riposte;
      if (crit) {
        damage *= w.riposteMult;
        posture *= COMBAT.RIPOSTE_POSTURE_MULT;
      }
      if (d.staggered) damage *= COMBAT.STAGGERED_DAMAGE_MULT;

      const kx = pos.x - player.pos.x, kz = pos.z - player.pos.z;
      const kl = Math.hypot(kx, kz) || 1;
      const kb = COMBAT.KNOCKBACK * w.knockback * (s.heavy ? 1.6 : 1);
      const res = d.takeHit(damage, posture, (kx / kl) * kb, (kz / kl) * kb);
      combat.onLandedHit();
      this.events.emit('hit', { pos, damage, heavy: s.heavy, crit });
      this.bloodHeal(pos, damage);
      if (res.broke) this.events.emit('postureBreak', { pos, player: false });
      if (res.died) this.onKill(d);
    }
  }

  private resolveEnemyMelee(d: Combatant, a: EnemyAttackDef): void {
    const { combat, player } = this;
    if (this.isDead() || this.deathblow) return;
    const dy = player.pos.y - d.pos.y;
    if (dy > (a.maxHitHeight ?? 2.2) || dy < -1.5) return;
    if (!inCone(d.pos, d.yaw, player.pos, a.reach, a.arc)) return;

    const pos = this.eye().lerp(d.center(), 0.4);
    const result = resolveDefense(
      { iframes: player.iframes, perfectParry: combat.isPerfectParry(), guarding: combat.isGuarding() },
      a.unblockable,
    );
    switch (result) {
      case 'dodged':
        this.events.emit('dodge', {});
        return;
      case 'perfect': {
        combat.onPerfectParry();
        player.dashPips = Math.min(MOVE.DASH_PIPS, player.dashPips + COMBAT.PARRY_DASH_REFUND);
        const broke = d.onParried(a.posture * COMBAT.PARRY_POSTURE_MULT + COMBAT.PARRY_POSTURE_BASE);
        this.events.emit('parry', { pos, projectile: false });
        if (broke) this.events.emit('postureBreak', { pos: d.center(), player: false });
        return;
      }
      case 'guarded': {
        const damage = a.damage * (d.damageMult ?? 1) * COMBAT.GUARD_DAMAGE_MULT;
        this.damagePlayer(damage, d.pos, false);
        combat.takePosture(a.posture * COMBAT.GUARD_POSTURE_MULT);
        this.events.emit('guard', { pos, damage });
        if (combat.phase === 'staggered') this.events.emit('postureBreak', { pos: this.eye(), player: true });
        return;
      }
      case 'hit':
        this.damagePlayer(a.damage * (d.damageMult ?? 1), d.pos, true);
        combat.takePosture(a.posture * COMBAT.HIT_POSTURE_MULT);
        return;
    }
  }

  /** Damage from the world (hunger, cold, falls): no knockback, not reduced by armor. */
  hurtPlayer(damage: number): void {
    if (this.isDead()) return;
    this.applyDamage(damage, this.player.pos, false);
  }

  private damagePlayer(damage: number, from: V3, knock: boolean): void {
    this.applyDamage(damage * this.damageTakenMult, from, knock);
  }

  private applyDamage(damage: number, from: V3, knock: boolean): void {
    const { combat, player } = this;
    combat.health -= damage;
    if (knock) {
      const kx = player.pos.x - from.x, kz = player.pos.z - from.z;
      const kl = Math.hypot(kx, kz) || 1;
      player.vel.x += (kx / kl) * COMBAT.PLAYER_KNOCKBACK;
      player.vel.z += (kz / kl) * COMBAT.PLAYER_KNOCKBACK;
      player.vel.y = Math.max(player.vel.y, 4);
      this.events.emit('playerHit', { damage, from });
    }
    if (combat.health <= 0) {
      combat.health = 0;
      this.deadTimer = COMBAT.RESPAWN_DELAY;
      this.deathblow = null;
      this.events.emit('playerDeath', {});
    }
  }

  private bloodHeal(pos: V3, damage: number): void {
    const eye = this.eye();
    if (Math.hypot(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z) > COMBAT.BLOOD_HEAL_RADIUS) return;
    this.heal(damage * COMBAT.BLOOD_HEAL_PER_DAMAGE);
  }

  private heal(amount: number): void {
    const c = this.combat;
    const before = c.health;
    c.health = Math.min(COMBAT.PLAYER_MAX_HEALTH, c.health + amount);
    if (c.health > before) this.events.emit('heal', { amount: c.health - before });
  }

  private onKill(d: Combatant): void {
    const pos = d.center();
    this.events.emit('kill', { pos, target: d });
    const eye = this.eye();
    if (eye.distanceTo(pos) <= COMBAT.BLOOD_HEAL_RADIUS) this.heal(COMBAT.BLOOD_KILL_HEAL);
  }

  private updateDeathblow(dt: number): void {
    const db = this.deathblow!;
    const { player } = this;
    db.t += dt;
    const target = db.target;

    // Lunge toward the target and face it.
    const to = new Vector3(target.pos.x - player.pos.x, 0, target.pos.z - player.pos.z);
    const dist = to.length();
    const remaining = Math.max(0.05, COMBAT.DEATHBLOW_TIME * 0.45 - db.t);
    if (!db.struck && dist > COMBAT.DEATHBLOW_LUNGE_DIST) {
      const speed = Math.min(30, (dist - COMBAT.DEATHBLOW_LUNGE_DIST) / remaining);
      to.normalize();
      player.vel.x = to.x * speed;
      player.vel.z = to.z * speed;
    } else {
      player.vel.x = 0;
      player.vel.z = 0;
    }
    const wantYaw = Math.atan2(-(target.pos.x - player.pos.x), -(target.pos.z - player.pos.z));
    let dYaw = wantYaw - player.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    player.yaw += dYaw * Math.min(1, dt * 14);
    player.pitch += (-0.12 - player.pitch) * Math.min(1, dt * 10);

    if (!db.struck && db.t >= COMBAT.DEATHBLOW_TIME * 0.45) {
      db.struck = true;
      const pos = target.center();
      target.kill();
      this.events.emit('deathblow', { pos });
      this.onKill(target);
    }
    if (db.t >= COMBAT.DEATHBLOW_TIME) {
      this.deathblow = null;
      this.combat.endDeathblow();
    }
  }

  private fireAtPlayer(d: Combatant): void {
    const from = d.center();
    from.y += 0.3;
    const eye = this.eye();
    eye.y -= 0.3; // aim at the chest
    const dir = eye.sub(from);
    // Spawn a little in front of the dummy so it doesn't start inside it.
    const p = this.projectiles.spawn(from.addScaledVector(dir.clone().normalize(), 0.7), dir, 'enemy');
    this.events.emit('shoot', { pos: p.pos });
  }

  private updateProjectiles(dt: number): void {
    const { player, combat } = this;
    const eye = this.eye();
    for (const p of this.projectiles.update(dt, this.world)) this.events.emit('projectileBurst', { pos: p.pos });

    const pbox = player.box();
    for (const p of this.projectiles.list) {
      if (p.dead) continue;
      if (p.faction === 'enemy') {
        if (this.isDead()) continue;
        // Perfect parry catches projectiles early, within PARRY_REACH.
        if (combat.isPerfectParry() && p.pos.distanceTo(eye) <= PROJECTILE.PARRY_REACH) {
          this.reflectProjectile(p);
          continue;
        }
        if (!sphereHitsBox(p.pos, PROJECTILE.RADIUS, pbox)) continue;
        const result = resolveDefense(
          { iframes: player.iframes, perfectParry: combat.isPerfectParry(), guarding: combat.isGuarding() },
          false,
        );
        if (result === 'dodged') continue; // passes through while dashing
        p.dead = true;
        if (result === 'perfect') this.reflectProjectile(p);
        else if (result === 'guarded') {
          const damage = p.damage * COMBAT.GUARD_DAMAGE_MULT;
          this.damagePlayer(damage, p.prevPos, false);
          combat.takePosture(p.posture * COMBAT.GUARD_POSTURE_MULT);
          this.events.emit('guard', { pos: p.pos, damage });
        } else {
          this.damagePlayer(p.damage, p.prevPos, true);
          combat.takePosture(p.posture * COMBAT.HIT_POSTURE_MULT);
          this.events.emit('projectileBurst', { pos: p.pos });
        }
      } else {
        for (const d of this.enemies) {
          if (!d.alive || !sphereHitsBox(p.pos, PROJECTILE.RADIUS, d.hurtbox())) continue;
          p.dead = true;
          const pos = p.pos.clone();
          const vx = p.vel.x, vz = p.vel.z, vl = Math.hypot(vx, vz) || 1;
          const res = d.takeHit(p.damage, p.posture, (vx / vl) * COMBAT.KNOCKBACK, (vz / vl) * COMBAT.KNOCKBACK);
          combat.onLandedHit();
          this.events.emit('hit', { pos, damage: p.damage, heavy: true, crit: true });
          this.bloodHeal(pos, p.damage);
          if (res.broke) this.events.emit('postureBreak', { pos, player: false });
          if (res.died) this.onKill(d);
          break;
        }
      }
    }
    this.projectiles.sweep();
  }

  private reflectProjectile(p: Projectile): void {
    const { combat, player } = this;
    p.dead = false;
    // Send it where the crosshair points: aim at whatever the look ray would reach.
    const eye = this.eye();
    const target = eye.clone().addScaledVector(this.lookDir(), 60);
    p.pos.copy(eye).addScaledVector(this.lookDir(), 1.0);
    this.projectiles.reflect(p, target.sub(p.pos));
    combat.onPerfectParry();
    player.dashPips = Math.min(MOVE.DASH_PIPS, player.dashPips + COMBAT.PARRY_DASH_REFUND);
    this.events.emit('parry', { pos: p.pos.clone(), projectile: true });
  }
}

function sphereHitsBox(c: V3, r: number, b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): boolean {
  const x = Math.max(b.minX, Math.min(c.x, b.maxX));
  const y = Math.max(b.minY, Math.min(c.y, b.maxY));
  const z = Math.max(b.minZ, Math.min(c.z, b.maxZ));
  return (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2 <= r * r;
}

