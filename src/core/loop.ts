import { SIM } from '../config';

/**
 * Fixed-timestep loop. `step` runs at SIM.HZ scaled by `timeScale`; `render` runs every frame
 * with the interpolation alpha between the previous and current sim state.
 * Hitstop freezes the sim clock (render keeps going).
 */
export class FixedLoop {
  readonly dt = 1 / SIM.HZ;
  timeScale = 1;
  private accumulator = 0;
  private hitstop = 0;
  private last = -1;
  private rafId = 0;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  /** Freeze the simulation for `seconds` of real time. Overlapping requests take the longest. */
  requestHitstop(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  /** Advance by one real frame of `frameDt` seconds. Returns number of sim steps run. */
  advance(frameDt: number): number {
    frameDt = Math.min(Math.max(frameDt, 0), SIM.MAX_FRAME_DT);
    if (this.hitstop > 0) {
      const frozen = Math.min(this.hitstop, frameDt);
      this.hitstop -= frozen;
      frameDt -= frozen;
    }
    this.accumulator += frameDt * this.timeScale;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < SIM.MAX_STEPS_PER_FRAME) {
      this.step(this.dt);
      this.accumulator -= this.dt;
      steps++;
      // A step requested hitstop: freeze now instead of finishing this frame's backlog.
      if (this.hitstop > 0) {
        this.accumulator = 0;
        break;
      }
    }
    // Drop backlog we couldn't process instead of accumulating it forever.
    if (steps === SIM.MAX_STEPS_PER_FRAME) this.accumulator = Math.min(this.accumulator, this.dt);
    this.render(this.accumulator / this.dt, frameDt);
    return steps;
  }

  start(): void {
    const tick = (now: number) => {
      const frameDt = this.last < 0 ? 0 : (now - this.last) / 1000;
      this.last = now;
      this.advance(frameDt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.last = -1;
  }
}
