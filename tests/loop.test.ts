import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/core/loop';

describe('FixedLoop', () => {
  it('runs a fixed number of steps regardless of frame rate', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {});
    for (let i = 0; i < 144; i++) loop.advance(1 / 144);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it('freezes the sim during hitstop', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {});
    loop.requestHitstop(0.1);
    loop.advance(0.05);
    expect(steps).toBe(0);
    loop.advance(0.1);
    expect(steps).toBe(3);
  });

  it('respects timeScale', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {});
    loop.timeScale = 0.5;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(steps).toBe(30);
  });
});
