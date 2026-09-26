export type DefenseResult = 'dodged' | 'perfect' | 'guarded' | 'hit';

export interface DefenderState {
  /** Invulnerability time left (dash i-frames). */
  iframes: number;
  perfectParry: boolean;
  guarding: boolean;
}

/** How an incoming attack resolves against a defender. Unblockables ignore parry and guard. */
export function resolveDefense(d: DefenderState, unblockable: boolean): DefenseResult {
  if (d.iframes > 0) return 'dodged';
  if (unblockable) return 'hit';
  if (d.perfectParry) return 'perfect';
  if (d.guarding) return 'guarded';
  return 'hit';
}
