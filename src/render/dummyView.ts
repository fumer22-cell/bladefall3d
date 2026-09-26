import { Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Scene } from 'three';
import { DUMMY } from '../config';
import { damp, lerp } from '../core/math';
import type { Dummy } from '../combat/trainingDummy';
import { box } from './boxModel';

const YELLOW = new Color(0xffc400);
const RED = new Color(0xff1a1a);

/** Box-model training dummy: straw body on a post, one arm holding a sword. */
export class DummyView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly arm = new Group();
  private readonly swordMat = new MeshLambertMaterial({ color: 0xb8bec8 });
  private readonly orb: Mesh;
  private readonly redDot: Mesh;
  private readonly flashMat: MeshLambertMaterial;
  private armRx = -0.3;
  private armRy = 0;
  private armRz = 0;
  private tilt = 0;
  private fall = 0;
  private hurtFlash = 0;
  private lastHealth: number = DUMMY.MAX_HEALTH;
  private time = 0;

  constructor(scene: Scene) {
    scene.add(this.root);
    this.root.add(this.body);
    this.flashMat = new MeshLambertMaterial({ color: 0xc8a45a });
    box(this.body, 0.16, 0.9, 0.16, 0, 0.45, 0, 0x6b4a2b);
    box(this.body, 0.7, 0.85, 0.42, 0, 1.3, 0, this.flashMat);
    box(this.body, 0.42, 0.42, 0.42, 0, 1.95, 0, 0xd9bd7a);
    box(this.body, 0.3, 0.3, 0.02, 0, 1.35, -0.22, 0xe8e8e8);
    box(this.body, 0.16, 0.16, 0.025, 0, 1.35, -0.225, 0xc03030);
    // Arm pivots at the right shoulder; sword points along +Y of the arm group.
    this.arm.position.set(0.45, 1.6, 0);
    this.arm.rotation.order = 'YXZ';
    this.body.add(this.arm);
    box(this.arm, 0.14, 0.14, 0.5, 0, 0, -0.2, 0xc8a45a);
    const hand = new Group();
    hand.position.set(0, 0, -0.45);
    this.arm.add(hand);
    box(hand, 0.05, 0.2, 0.05, 0, 0, 0, 0x3b2a1c);
    box(hand, 0.22, 0.04, 0.06, 0, 0.1, 0, 0x8a6d3b);
    box(hand, 0.07, 1.0, 0.02, 0, 0.62, 0, this.swordMat);
    this.orb = new Mesh(new SphereGeometry(0.2, 12, 8), new MeshBasicMaterial({ color: 0xffd23a }));
    this.orb.position.set(0, 0.2, 0);
    hand.add(this.orb);
    this.redDot = new Mesh(new SphereGeometry(0.11, 12, 8), new MeshBasicMaterial({ color: 0xff1010, depthTest: false }));
    this.redDot.position.set(0, 1.45, -0.3);
    this.redDot.renderOrder = 10;
    this.body.add(this.redDot);
  }

  update(d: Dummy, alpha: number, dt: number): void {
    this.time += dt;
    this.root.position.set(lerp(d.prevPos.x, d.pos.x, alpha), lerp(d.prevPos.y, d.pos.y, alpha), lerp(d.prevPos.z, d.pos.z, alpha));
    this.root.rotation.y = d.yaw;

    // Arm pose targets per phase.
    let rx = -0.3, ry = 0, rz = 0;
    const k = d.phaseLen > 0 ? Math.min(1, d.t / d.phaseLen) : 1;
    const sweep = d.attack?.unblockable === true;
    switch (d.phase) {
      case 'windup':
        if (sweep) { rx = -1.45; ry = 1.6 * k; rz = 0; }
        else { rx = -0.3 + 1.7 * k; }
        break;
      case 'active':
        if (sweep) { rx = -1.45; ry = 1.6 - 3.4 * k; }
        else { rx = 1.4 - 3.3 * k; }
        break;
      case 'recovery':
        if (d.attack) { rx = sweep ? -1.45 : -1.9; ry = sweep ? -1.8 : 0; }
        break;
      case 'shootWindup':
        rx = -1.2;
        break;
      case 'parry':
        rx = -0.9; ry = 0.6; rz = 1.5;
        break;
      case 'parryWhiff':
        rx = -0.4; ry = 0.6; rz = 1.9;
        break;
      case 'recoil':
        rx = 1.3; ry = -0.8;
        break;
      case 'staggered':
        rx = -1.0; rz = -0.5;
        break;
    }
    const rate = d.phase === 'active' || d.phase === 'parry' ? 40 : 14;
    this.armRx = damp(this.armRx, rx, rate, dt);
    this.armRy = damp(this.armRy, ry, rate, dt);
    this.armRz = damp(this.armRz, rz, rate, dt);
    this.arm.rotation.set(this.armRx, this.armRy, this.armRz);

    // Stagger wobble, death topple.
    this.tilt = damp(this.tilt, d.staggered ? 0.3 + Math.sin(this.time * 9) * 0.05 : d.phase === 'recoil' ? 0.2 : 0, 10, dt);
    this.fall = d.phase === 'dead' ? Math.min(1, this.fall + dt * 3) : 0;
    this.body.rotation.x = this.tilt + this.fall * 1.45;
    this.body.visible = !(d.phase === 'dead' && d.t > DUMMY.RESPAWN_TIME - 0.2);

    // Telegraph glow on the sword.
    const tel = d.telegraph();
    if (tel === 'none') this.swordMat.emissive.setRGB(0, 0, 0);
    else {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 25);
      this.swordMat.emissive.copy(tel === 'red' ? RED : YELLOW).multiplyScalar(pulse);
    }
    this.orb.visible = d.phase === 'shootWindup';
    if (this.orb.visible) this.orb.scale.setScalar(0.3 + 0.7 * k);
    this.redDot.visible = d.staggered;

    // Flash the body white when hit.
    if (d.health < this.lastHealth) this.hurtFlash = 1;
    this.lastHealth = d.health;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 8);
    this.flashMat.emissive.setRGB(this.hurtFlash, this.hurtFlash * 0.9, this.hurtFlash * 0.8);
  }
}
