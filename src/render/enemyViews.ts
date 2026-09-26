import { Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Scene } from 'three';
import { COMBAT } from '../config';
import { damp, lerp } from '../core/math';
import type { Combatant } from '../combat/combatant';
import type { Crow } from '../enemies/crow';
import type { Husk } from '../enemies/husk';
import { box } from './boxModel';

const YELLOW = new Color(0xffc400);
const RED = new Color(0xff1a1a);

export interface CombatantView {
  update(e: Combatant, alpha: number, dt: number): void;
  dispose(): void;
}

function redDot(parent: Group, y: number, z: number): Mesh {
  const m = new Mesh(new SphereGeometry(0.1, 10, 6), new MeshBasicMaterial({ color: 0xff1010, depthTest: false }));
  m.position.set(0, y, z);
  m.renderOrder = 10;
  parent.add(m);
  return m;
}

function glow(mat: MeshLambertMaterial, tel: 'none' | 'yellow' | 'red', time: number): void {
  if (tel === 'none') mat.emissive.setRGB(0, 0, 0);
  else mat.emissive.copy(tel === 'red' ? RED : YELLOW).multiplyScalar(0.75 + 0.25 * Math.sin(time * 25));
}

/** Hunched revenant: rags over pale flesh, a rusted blade in the right hand. */
export class HuskView implements CombatantView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly arm = new Group();
  private readonly armL = new Group();
  private readonly bladeMat = new MeshLambertMaterial({ color: 0x7a5a48 });
  private readonly skinMat = new MeshLambertMaterial({ color: 0x8e9480 });
  private readonly dot: Mesh;
  private armRx = 0;
  private lean = 0;
  private fall = 0;
  private time = 0;

  constructor(private readonly scene: Scene) {
    scene.add(this.root);
    this.root.add(this.body, this.legL, this.legR);
    const rags = 0x3a2e28, rags2 = 0x2b2437;
    this.legL.position.set(-0.17, 0.85, 0);
    this.legR.position.set(0.17, 0.85, 0);
    box(this.legL, 0.2, 0.85, 0.22, 0, -0.42, 0, rags2);
    box(this.legR, 0.2, 0.85, 0.22, 0, -0.42, 0, rags2);
    this.body.position.set(0, 0.85, 0);
    box(this.body, 0.56, 0.7, 0.34, 0, 0.35, 0, rags);
    box(this.body, 0.36, 0.34, 0.34, 0, 0.86, -0.12, this.skinMat); // drooping head
    box(this.body, 0.08, 0.06, 0.02, -0.08, 0.9, -0.3, 0xffd9a0); // dim eyes
    box(this.body, 0.08, 0.06, 0.02, 0.08, 0.9, -0.3, 0xffd9a0);
    this.arm.position.set(0.36, 0.62, 0);
    this.arm.rotation.order = 'YXZ';
    this.body.add(this.arm);
    box(this.arm, 0.15, 0.62, 0.15, 0, -0.26, 0, this.skinMat);
    const hand = new Group();
    hand.position.set(0, -0.56, 0);
    this.arm.add(hand);
    box(hand, 0.06, 0.18, 0.06, 0, 0, -0.02, 0x2b1d17);
    box(hand, 0.08, 0.95, 0.03, 0, -0.56, -0.02, this.bladeMat);
    this.armL.position.set(-0.36, 0.62, 0);
    this.body.add(this.armL);
    box(this.armL, 0.15, 0.66, 0.15, 0, -0.3, 0, this.skinMat);
    this.dot = redDot(this.body, 0.45, -0.25);
  }

  update(e: Combatant, alpha: number, dt: number): void {
    const h = e as Husk;
    this.time += dt;
    this.root.position.set(lerp(h.prevPos.x, h.pos.x, alpha), lerp(h.prevPos.y, h.pos.y, alpha), lerp(h.prevPos.z, h.pos.z, alpha));
    this.root.rotation.y = h.yaw;
    // Shambling walk.
    const s = Math.sin(h.stride * 2.4);
    this.legL.rotation.x = s * 0.6;
    this.legR.rotation.x = -s * 0.6;
    this.armL.rotation.x = -s * 0.3 + 0.2;
    // Arm: blade points down from the hand; raise it for windups, sweep on active.
    const k = h.phaseLen > 0 ? Math.min(1, h.t / h.phaseLen) : 1;
    const name = h.attack?.name;
    let rx = 0.3, lean = 0.35;
    if (h.phase === 'windup') {
      rx = name === 'overhead' ? 0.3 + 2.6 * k : name === 'lunge' ? -1.2 * k : 0.3 + 1.6 * k;
      lean = name === 'lunge' ? 0.1 : 0.2;
    } else if (h.phase === 'active') {
      rx = name === 'overhead' ? 2.9 - 3.9 * k : name === 'lunge' ? -1.6 : 1.9 - 2.8 * k;
      lean = name === 'lunge' ? 0.8 : 0.6;
    } else if (h.phase === 'recovery') rx = -0.6;
    else if (h.phase === 'recoil') {
      rx = 2.2;
      lean = -0.3;
    }
    this.armRx = damp(this.armRx, rx, h.phase === 'active' ? 40 : 12, dt);
    this.arm.rotation.x = this.armRx;
    const staggered = h.staggered;
    this.lean = damp(this.lean, staggered ? -0.35 + Math.sin(this.time * 9) * 0.05 : lean, 10, dt);
    this.body.rotation.x = this.lean;
    this.fall = h.alive ? 0 : Math.min(1, this.fall + dt * 3);
    this.root.rotation.x = -this.fall * 1.45;
    this.root.visible = !(h.phase === 'dead' && h.t > COMBAT.DEATHBLOW_TIME + 0.8);
    glow(this.bladeMat, h.telegraph(), this.time);
    this.skinMat.emissive.setRGB(0, 0, 0).addScalar(Math.max(0, 1 - h.hurtTime * 8) * 0.8);
    this.dot.visible = staggered;
  }

  dispose(): void {
    this.scene.remove(this.root);
  }
}

/** Carrion crow: ragged black wings, bone beak, ember eyes. */
export class CrowView implements CombatantView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly wingL = new Group();
  private readonly wingR = new Group();
  private readonly bodyMat = new MeshLambertMaterial({ color: 0x1f1a29 });
  private readonly dot: Mesh;
  private time = 0;
  private fall = 0;

  constructor(private readonly scene: Scene) {
    scene.add(this.root);
    this.root.add(this.body);
    this.body.position.set(0, 0.3, 0);
    box(this.body, 0.34, 0.3, 0.7, 0, 0, 0, this.bodyMat);
    box(this.body, 0.26, 0.26, 0.26, 0, 0.12, -0.42, this.bodyMat);
    box(this.body, 0.08, 0.08, 0.22, 0, 0.08, -0.62, 0xc9bfa7); // beak
    box(this.body, 0.05, 0.05, 0.02, -0.09, 0.18, -0.55, 0xfdbe5d);
    box(this.body, 0.05, 0.05, 0.02, 0.09, 0.18, -0.55, 0xfdbe5d);
    box(this.body, 0.3, 0.06, 0.3, 0, 0.02, 0.45, 0x15121d); // tail
    this.wingL.position.set(-0.17, 0.08, 0);
    this.wingR.position.set(0.17, 0.08, 0);
    this.body.add(this.wingL, this.wingR);
    box(this.wingL, 0.8, 0.05, 0.42, -0.4, 0, 0, 0x15121d);
    box(this.wingR, 0.8, 0.05, 0.42, 0.4, 0, 0, 0x15121d);
    this.dot = redDot(this.body, 0.1, -0.2);
  }

  update(e: Combatant, alpha: number, dt: number): void {
    const c = e as Crow;
    this.time += dt;
    this.root.position.set(lerp(c.prevPos.x, c.pos.x, alpha), lerp(c.prevPos.y, c.pos.y, alpha), lerp(c.prevPos.z, c.pos.z, alpha));
    this.root.rotation.y = c.yaw;
    const flying = c.alive && !c.staggered;
    const f = flying ? Math.sin(c.flap) * 0.9 : 0.15;
    this.wingL.rotation.z = f;
    this.wingR.rotation.z = -f;
    this.body.rotation.x = c.phase === 'dive' ? -0.5 : c.phase === 'shootWindup' ? 0.3 : 0;
    this.fall = c.alive ? 0 : Math.min(1, this.fall + dt * 3);
    this.root.rotation.z = this.fall * 1.6;
    this.root.visible = !(c.phase === 'dead' && c.t > COMBAT.DEATHBLOW_TIME + 0.8);
    glow(this.bodyMat, c.telegraph(), this.time);
    if (c.telegraph() === 'none') this.bodyMat.emissive.setRGB(0, 0, 0).addScalar(Math.max(0, 1 - c.hurtTime * 8) * 0.8);
    this.dot.visible = c.staggered;
  }

  dispose(): void {
    this.scene.remove(this.root);
  }
}
