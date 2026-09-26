/**
 * Placeholder sound effects synthesized with WebAudio. Every game sound goes through `play(name)`,
 * so real samples can replace these later without touching gameplay code.
 */
export type SfxName =
  | 'swing'
  | 'swingHeavy'
  | 'hit'
  | 'hitHeavy'
  | 'crit'
  | 'clang'
  | 'guard'
  | 'parried'
  | 'feint'
  | 'telegraph'
  | 'telegraphRed'
  | 'hurt'
  | 'postureBreak'
  | 'deathblow'
  | 'shoot'
  | 'dash'
  | 'death'
  | 'dig'
  | 'break'
  | 'place'
  | 'pickup'
  | 'groan'
  | 'caw'
  | 'eat'
  | 'memory'
  | 'sleep'
  | 'fell'
  | 'treeLand'
  | 'grapple'
  | 'airJump'
  | 'equip';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

/** Must be called from a user gesture (click) before sounds can play. */
export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function env(g: GainNode, t0: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone(type: OscillatorType, freq: number, peak: number, decay: number, freqEnd?: number, delay = 0): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + decay);
  env(g, t0, peak, 0.004, decay);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + decay + 0.05);
}

function noise(filter: BiquadFilterType, freq: number, q: number, peak: number, decay: number, freqEnd?: number): void {
  if (!ctx || !master || !noiseBuf) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + decay);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t0, peak, 0.005, decay);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + decay + 0.05);
}

/** Metallic ring: inharmonic partials with fast decay. */
function metal(base: number, peak: number, decay: number): void {
  for (const [ratio, amp] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]] as const) {
    tone('sine', base * ratio, peak * amp, decay * (1.2 - ratio * 0.08));
  }
  noise('highpass', 3000, 0.7, peak * 0.6, 0.05);
}

export function play(name: SfxName): void {
  if (!ctx) return;
  switch (name) {
    case 'swing':
      noise('bandpass', 900, 1.2, 0.25, 0.12, 2500);
      break;
    case 'swingHeavy':
      noise('bandpass', 500, 1.0, 0.35, 0.22, 1600);
      break;
    case 'hit':
      tone('sine', 140, 0.6, 0.12, 60);
      noise('lowpass', 1800, 0.8, 0.4, 0.09);
      break;
    case 'hitHeavy':
      tone('sine', 110, 0.8, 0.2, 45);
      noise('lowpass', 1400, 0.8, 0.6, 0.15);
      break;
    case 'crit':
      tone('sine', 90, 0.9, 0.3, 40);
      noise('lowpass', 2500, 0.8, 0.7, 0.2);
      metal(900, 0.25, 0.4);
      break;
    case 'clang':
      metal(1250, 0.35, 0.55);
      break;
    case 'guard':
      metal(520, 0.25, 0.22);
      tone('sine', 180, 0.3, 0.1, 90);
      break;
    case 'parried':
      metal(700, 0.35, 0.45);
      tone('square', 160, 0.12, 0.25, 70);
      break;
    case 'feint':
      noise('bandpass', 700, 2, 0.12, 0.08, 400);
      break;
    case 'telegraph':
      tone('triangle', 880, 0.08, 0.12);
      break;
    case 'telegraphRed':
      tone('sawtooth', 220, 0.12, 0.3, 180);
      tone('sawtooth', 233, 0.1, 0.3, 190);
      break;
    case 'hurt':
      tone('square', 220, 0.18, 0.18, 90);
      noise('lowpass', 900, 0.8, 0.35, 0.12);
      break;
    case 'postureBreak':
      metal(400, 0.4, 0.8);
      tone('sine', 80, 0.6, 0.6, 40);
      break;
    case 'deathblow':
      tone('sine', 70, 1.0, 0.7, 30);
      noise('lowpass', 1200, 0.8, 0.8, 0.5, 200);
      break;
    case 'shoot':
      tone('triangle', 600, 0.15, 0.15, 300);
      break;
    case 'dash':
      noise('bandpass', 1200, 0.9, 0.18, 0.15, 400);
      break;
    case 'death':
      tone('sawtooth', 200, 0.3, 1.2, 40);
      break;
    case 'dig':
      noise('bandpass', 600 + Math.random() * 300, 1.5, 0.22, 0.06);
      break;
    case 'break':
      noise('lowpass', 900, 0.8, 0.45, 0.14);
      tone('sine', 120, 0.25, 0.1, 70);
      break;
    case 'groan':
      tone('sawtooth', 70, 0.18, 0.7, 52);
      noise('lowpass', 300, 1.2, 0.2, 0.6, 180);
      break;
    case 'caw':
      tone('sawtooth', 620, 0.12, 0.16, 420);
      tone('square', 540, 0.06, 0.2, 380, 0.18);
      break;
    case 'pickup':
      tone('sine', 880, 0.1, 0.06, 1320);
      break;
    case 'eat':
      noise('bandpass', 900, 2, 0.12, 0.08);
      noise('bandpass', 700, 2, 0.1, 0.1);
      break;
    case 'memory':
      tone('sine', 523, 0.12, 0.5, 784);
      tone('sine', 784, 0.08, 0.7, 1046, 0.12);
      break;
    case 'fell':
      noise('lowpass', 500, 1, 0.25, 0.5, 120);
      tone('triangle', 110, 0.12, 0.6, 70);
      break;
    case 'treeLand':
      noise('lowpass', 300, 1, 0.45, 0.6, 60);
      noise('bandpass', 1800, 1, 0.12, 0.4);
      break;
    case 'grapple':
      noise('highpass', 2500, 1, 0.12, 0.12);
      tone('square', 900, 0.05, 0.1, 500);
      break;
    case 'airJump':
      noise('bandpass', 1200, 1.5, 0.12, 0.18, 400);
      break;
    case 'equip':
      tone('triangle', 660, 0.08, 0.15, 990);
      break;
    case 'sleep':
      tone('sine', 330, 0.08, 1.2, 220);
      break;
    case 'place':
      tone('sine', 220, 0.25, 0.07, 140);
      noise('lowpass', 1200, 0.8, 0.2, 0.05);
      break;
  }
}
