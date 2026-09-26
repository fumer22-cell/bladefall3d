import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  Scene,
  type PerspectiveCamera,
} from 'three';
import { COMBAT, VIEWMODEL, WEAPONS, type AttackDir, type WeaponDef } from '../config';
import { clamp, damp } from '../core/math';
import type { PlayerCombat } from '../combat/playerCombat';
import type { Player } from '../player/player';
import { box } from './boxModel';

/** Position + Euler rotation (order YXZ) of a hand, in camera space. The weapon points along local +Y. */
interface Pose {
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number;
}

const P = (px: number, py: number, pz: number, rx: number, ry: number, rz: number): Pose => ({ px, py, pz, rx, ry, rz });

const REST = P(0.3, -0.34, -0.55, -0.45, 0.25, -0.2);
const PARRY = P(0.02, -0.14, -0.5, -0.25, 0, 1.45);
export type HeldKind = 'weapon' | 'tool' | 'item' | 'empty';
export interface HeldHand {
  kind: HeldKind;
  /** Item color (pickaxe head / held block). */
  color: number;
  mining: boolean;
}

const ITEM_REST = P(0.3, -0.3, -0.5, -0.3, 0.5, 0.2);
const PICK_REST = P(0.34, -0.36, -0.5, -0.2, 0.3, 0.9);
const PICK_HIT = P(0.24, -0.3, -0.62, -1.3, 0.2, 0.9);
const STAGGER = P(0.32, -0.62, -0.5, 0.2, 0.3, -0.6);
const WINDUP: Record<AttackDir, Pose> = {
  slashR: P(-0.05, -0.1, -0.42, -1.25, 1.45, 0.35),
  slashL: P(0.45, -0.1, -0.42, -1.25, -1.45, -0.35),
  overhead: P(0.24, 0.02, -0.5, 0.15, 0.1, -0.15),
  stab: P(0.28, -0.3, -0.25, -1.4, 0.12, 0),
};
const END: Record<AttackDir, Pose> = {
  slashR: P(0.32, -0.26, -0.5, -1.35, -1.5, -0.3),
  slashL: P(-0.28, -0.26, -0.5, -1.35, 1.5, 0.3),
  overhead: P(0.06, -0.36, -0.62, -1.85, 0.05, 0),
  stab: P(0.16, -0.24, -0.78, -1.42, 0.05, 0),
};

function mirror(p: Pose): Pose {
  return { px: -p.px, py: p.py, pz: p.pz, rx: p.rx, ry: -p.ry, rz: -p.rz };
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    px: a.px + (b.px - a.px) * t, py: a.py + (b.py - a.py) * t, pz: a.pz + (b.pz - a.pz) * t,
    rx: a.rx + (b.rx - a.rx) * t, ry: a.ry + (b.ry - a.ry) * t, rz: a.rz + (b.rz - a.rz) * t,
  };
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface Hand {
  group: Group;
  pose: Pose;
}

interface WeaponModel {
  right: Group;
  left: Group | null;
  bladeMats: MeshLambertMaterial[];
}

const STEEL = 0xc9ced6;
const GRIP = 0x3b2a1c;
const GUARD = 0x8a6d3b;

function buildModel(w: WeaponDef): WeaponModel {
  const bladeMats: MeshLambertMaterial[] = [];
  const steel = () => {
    const m = new MeshLambertMaterial({ color: STEEL });
    bladeMats.push(m);
    return m;
  };
  const make = (): Group => {
    const g = new Group();
    switch (w.model) {
      case 'sword':
        box(g, 0.04, 0.17, 0.04, 0, -0.02, 0, GRIP);
        box(g, 0.2, 0.035, 0.05, 0, 0.075, 0, GUARD);
        box(g, 0.055, 0.78, 0.016, 0, 0.48, 0, steel());
        break;
      case 'greatsword':
        box(g, 0.05, 0.3, 0.05, 0, 0.0, 0, GRIP);
        box(g, 0.34, 0.05, 0.07, 0, 0.16, 0, GUARD);
        box(g, 0.095, 1.25, 0.022, 0, 0.8, 0, steel());
        break;
      case 'daggers':
        box(g, 0.035, 0.11, 0.035, 0, -0.01, 0, GRIP);
        box(g, 0.1, 0.025, 0.04, 0, 0.05, 0, GUARD);
        box(g, 0.04, 0.3, 0.012, 0, 0.21, 0, steel());
        break;
      case 'spear':
        box(g, 0.038, 1.9, 0.038, 0, 0.25, 0, 0x6b4a2b);
        box(g, 0.07, 0.26, 0.016, 0, 1.33, 0, steel());
        break;
      case 'gauntlets':
        box(g, 0.13, 0.2, 0.13, 0, -0.06, 0, 0x5a5f66);
        box(g, 0.15, 0.1, 0.15, 0, 0.08, 0, steel());
        break;
    }
    return g;
  };
  return { right: make(), left: w.dualWield ? make() : null, bladeMats };
}

/**
 * First-person weapon: poses driven by the combat state (windup → active → recovery, parry,
 * recoil, stagger), plus mouse sway, walk bob and hit recoil. Rendered in its own scene on top
 * of the world so it never clips into walls.
 */
export class Viewmodel {
  readonly scene = new Scene();
  private readonly root = new Group();
  private readonly right: Hand = { group: new Group(), pose: { ...REST } };
  private readonly left: Hand = { group: new Group(), pose: mirror(REST) };
  private readonly models: WeaponModel[] = [];
  private current = -1;
  private swayX = 0;
  private swayY = 0;
  private recoil = 0;
  private bob = 0;
  private time = 0;
  private readonly glow = new Color();
  private readonly pickaxe = new Group();
  private readonly pickHeadMat = new MeshLambertMaterial({ color: 0x8d949e });
  private readonly heldCube: Mesh;
  private readonly heldCubeMat = new MeshLambertMaterial({ color: 0xffffff });
  private readonly fist: Mesh;
  private handKind: HeldKind | null = null;
  private pickSwing = 0;
  private placePulse = 0;

  constructor() {
    this.scene.add(this.root);
    this.root.add(this.right.group, this.left.group);
    this.right.group.rotation.order = 'YXZ';
    this.left.group.rotation.order = 'YXZ';
    this.scene.add(new HemisphereLight(0xe8dcff, 0x5a4030, 1.8));
    const sun = new DirectionalLight(0xffe2b0, 1.8);
    sun.position.set(0.4, 1, 0.3);
    this.scene.add(sun);
    for (const w of WEAPONS) this.models.push(buildModel(w));
    box(this.pickaxe, 0.045, 0.62, 0.045, 0, 0.2, 0, 0x6b4a2b);
    box(this.pickaxe, 0.5, 0.07, 0.07, 0, 0.5, 0, this.pickHeadMat);
    box(this.pickaxe, 0.08, 0.1, 0.08, 0.22, 0.47, 0, this.pickHeadMat);
    box(this.pickaxe, 0.08, 0.1, 0.08, -0.22, 0.47, 0, this.pickHeadMat);
    this.heldCube = box(this.right.group, 0.16, 0.16, 0.16, 0, 0.12, 0, this.heldCubeMat);
    this.fist = box(this.right.group, 0.11, 0.13, 0.16, 0, 0.02, 0, 0xc8956d);
    this.pickaxe.visible = this.heldCube.visible = this.fist.visible = false;
    this.right.group.add(this.pickaxe);
  }

  /** Quick jab when a block is placed. */
  pulse(): void {
    this.placePulse = 1;
  }

  kick(amount: number = VIEWMODEL.RECOIL_HIT): void {
    this.recoil = Math.max(this.recoil, amount);
  }

  update(
    dt: number,
    camera: PerspectiveCamera,
    c: PlayerCombat,
    p: Player,
    mouseDx: number,
    mouseDy: number,
    hand: HeldHand = { kind: 'weapon', color: 0, mining: false },
  ): void {
    this.time += dt;
    if (c.weaponIndex !== this.current) this.setWeapon(c.weaponIndex);
    this.setHeld(hand);
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);

    // Sway lags behind mouse movement; bob follows running.
    const sx = clamp(-mouseDx * VIEWMODEL.SWAY_AMOUNT, -VIEWMODEL.SWAY_MAX, VIEWMODEL.SWAY_MAX);
    const sy = clamp(mouseDy * VIEWMODEL.SWAY_AMOUNT, -VIEWMODEL.SWAY_MAX, VIEWMODEL.SWAY_MAX);
    this.swayX = damp(this.swayX + sx, 0, VIEWMODEL.SWAY_RETURN, dt);
    this.swayY = damp(this.swayY + sy, 0, VIEWMODEL.SWAY_RETURN, dt);
    this.recoil = damp(this.recoil, 0, VIEWMODEL.RECOIL_RETURN, dt);
    const hs = p.grounded && p.state === 'ground' ? p.horizontalSpeed() : 0;
    this.bob += hs * dt * 1.6;
    const bobAmt = Math.min(hs / 10, 1) * VIEWMODEL.BOB_AMOUNT;

    if (hand.kind !== 'weapon') {
      // Tools, blocks and fists: chop while mining, jab on place.
      this.pickSwing = hand.mining ? this.pickSwing + dt * 11 : 0;
      this.placePulse = Math.max(0, this.placePulse - dt * 7);
      const chop = hand.mining ? Math.max(0, Math.sin(this.pickSwing)) : 0;
      const pose = lerpPose(hand.kind === 'tool' ? PICK_REST : ITEM_REST, PICK_HIT, chop);
      pose.pz -= this.placePulse * 0.15;
      this.applyHand(this.right, pose, dt, bobAmt, 1);
      return;
    }

    const w = c.weapon;
    const swingHand = c.swing?.hand ?? 1;
    const target = this.targetPose(c);
    const rightTarget = swingHand === 1 || !w.dualWield ? target : REST;
    const leftTarget = swingHand === -1 ? mirror(target) : mirror(c.phase === 'parry' ? PARRY : REST);

    this.applyHand(this.right, rightTarget, dt, bobAmt, 1);
    if (w.dualWield) this.applyHand(this.left, leftTarget, dt, bobAmt, -1);

    // Blade glow: riposte ready pulses cold white-blue; charged heavy glows warm.
    const m = this.models[this.current];
    let g = 0;
    this.glow.setRGB(0, 0, 0);
    if (c.riposteTimer > 0) {
      g = 0.5 + 0.5 * Math.sin(this.time * 30);
      this.glow.setRGB(0.5 * g, 0.75 * g, 1.0 * g);
    } else if (c.phase === 'windup' && c.swing?.heavy) {
      g = Math.min(1, c.t / c.swing.def.windup);
      this.glow.setRGB(0.7 * g, 0.35 * g, 0.05 * g);
    }
    for (const mat of m.bladeMats) mat.emissive.copy(this.glow);
  }

  private applyHand(h: Hand, target: Pose, dt: number, bobAmt: number, side: 1 | -1): void {
    const k = 1 - Math.exp(-40 * dt);
    h.pose = lerpPose(h.pose, target, k);
    const bobX = Math.cos(this.bob) * bobAmt * side;
    const bobY = -Math.abs(Math.sin(this.bob)) * bobAmt;
    h.group.position.set(h.pose.px + this.swayX + bobX, h.pose.py + this.swayY + bobY, h.pose.pz + this.recoil);
    h.group.rotation.set(h.pose.rx + this.recoil * 2, h.pose.ry + this.swayX * 2, h.pose.rz);
  }

  private targetPose(c: PlayerCombat): Pose {
    const s = c.swing;
    switch (c.phase) {
      case 'windup': {
        if (!s) return REST;
        const windup = s.def.windup * (s.riposte ? COMBAT.RIPOSTE_WINDUP_MULT : 1);
        const t = easeOut(Math.min(1, c.t / windup));
        const pose = lerpPose(REST, WINDUP[c.currentDir()], t);
        if (s.heavy) {
          // Draw back further and tremble while charging a heavy.
          pose.pz += 0.08 * t;
          pose.px += Math.sin(this.time * 55) * 0.006 * t;
        }
        return pose;
      }
      case 'active':
        if (!s) return REST;
        return lerpPose(WINDUP[s.dir], END[s.dir], easeOut(Math.min(1, c.t / c.phaseLen)));
      case 'recovery':
        if (!s) return REST; // feint
        return lerpPose(END[s.dir], REST, easeInOut(Math.min(1, c.t / c.phaseLen)));
      case 'parry':
        return PARRY;
      case 'recoil': {
        const t = Math.min(1, c.t / c.phaseLen);
        return lerpPose(P(0.35, 0.05, -0.35, 0.7, 0.6, -0.5), REST, easeInOut(t));
      }
      case 'staggered':
        return STAGGER;
      case 'deathblow': {
        const t = c.t / COMBAT.DEATHBLOW_TIME;
        if (t < 0.4) return lerpPose(REST, WINDUP.stab, easeOut(t / 0.4));
        if (t < 0.55) return lerpPose(WINDUP.stab, END.stab, easeOut((t - 0.4) / 0.15));
        return lerpPose(END.stab, REST, easeInOut((t - 0.55) / 0.45));
      }
      default:
        return REST;
    }
  }

  private setHeld(hand: HeldHand): void {
    this.pickHeadMat.color.setHex(hand.color);
    this.heldCubeMat.color.setHex(hand.color);
    if (this.handKind === hand.kind) return;
    this.handKind = hand.kind;
    const weapon = hand.kind === 'weapon';
    const m = this.models[this.current];
    m.right.visible = weapon;
    this.left.group.visible = weapon && m.left !== null;
    this.pickaxe.visible = hand.kind === 'tool';
    this.heldCube.visible = hand.kind === 'item';
    this.fist.visible = hand.kind === 'empty';
    this.right.pose = { ...STAGGER };
  }

  private setWeapon(i: number): void {
    if (this.current >= 0) {
      const old = this.models[this.current];
      this.right.group.remove(old.right);
      if (old.left) this.left.group.remove(old.left);
    }
    const m = this.models[i];
    this.right.group.add(m.right);
    if (m.left) this.left.group.add(m.left);
    this.left.group.visible = m.left !== null;
    this.right.pose = { ...STAGGER };
    this.left.pose = mirror(STAGGER);
    this.current = i;
    this.handKind = null; // re-apply visibility for the new model
  }
}
