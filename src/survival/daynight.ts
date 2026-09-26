import { DAYNIGHT } from '../config';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Time of day. `time` runs 0 → 1 over a day: 0 = sunrise, 0.25 = noon, 0.5 = sunset,
 * 0.75 = midnight. Night passes faster than day.
 */
export class DayNight {
  time: number = DAYNIGHT.START_TIME;
  /** Days survived (starts at 1). */
  day = 1;
  /** Freeze the clock (arena). */
  frozen = false;

  update(dt: number): void {
    if (this.frozen) return;
    const speed = this.sunHeight() < 0 ? DAYNIGHT.NIGHT_SPEED : 1;
    this.time += (dt * speed) / DAYNIGHT.DAY_LENGTH;
    while (this.time >= 1) {
      this.time -= 1;
      this.day++;
    }
  }

  /** Sine of the sun's elevation: 1 at noon, −1 at midnight. */
  sunHeight(): number {
    return Math.sin(this.time * Math.PI * 2);
  }

  /** Multiplier on sky light: 1 by day, NIGHT_LIGHT at night. */
  daylight(): number {
    return DAYNIGHT.NIGHT_LIGHT + (1 - DAYNIGHT.NIGHT_LIGHT) * smooth(-0.2, 0.25, this.sunHeight());
  }

  /** 0 by day → 1 in full night. */
  night(): number {
    return 1 - smooth(-0.28, 0.02, this.sunHeight());
  }

  /** 1 while the sun is near the horizon (dawn and dusk). */
  dusk(): number {
    const s = this.sunHeight();
    return Math.exp(-(s * s) / (0.2 * 0.2));
  }

  /** Full daylight weight (0 at dusk/night). */
  dayness(): number {
    return smooth(0.08, 0.45, this.sunHeight());
  }

  isNight(): boolean {
    return this.sunHeight() < -0.05;
  }

  /** Sleep through to the morning. */
  skipToMorning(): void {
    if (this.time > DAYNIGHT.WAKE_TIME) this.day++;
    this.time = DAYNIGHT.WAKE_TIME;
  }

  /** Word for the current part of the day. */
  phaseName(): string {
    const t = this.time;
    if (t < 0.06) return 'Dawn';
    if (t < 0.2) return 'Morning';
    if (t < 0.32) return 'Midday';
    if (t < 0.44) return 'Afternoon';
    if (t < 0.54) return 'Dusk';
    if (t < 0.68) return 'Evening';
    if (t < 0.85) return 'Midnight';
    return 'Before dawn';
  }
}
