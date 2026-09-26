/**
 * BLADEFALL palette: dusky 80s dark fantasy. Every texture is painted from these ramps
 * (dark → light), and the final image is snapped to this set of colors with ordered dithering.
 */
export const RAMPS = {
  ink: ['#0b0a12', '#15121d', '#1f1a29', '#2b2437'],
  stone: ['#262630', '#363643', '#484957', '#5e606f', '#7a7c8a', '#9a9ca7'],
  deep: ['#191923', '#232432', '#303145', '#3f4158'],
  dirt: ['#32200f', '#4a3219', '#644525', '#7f5a32', '#9a7342'],
  wood: ['#37220f', '#523318', '#704624', '#8f5c30', '#ac7743'],
  pale: ['#5f5750', '#827a6f', '#a79d8b', '#c9bfa7', '#e6dcc1'],
  moss: ['#142012', '#1f3217', '#2e461f', '#415e28', '#587a32', '#75963e'],
  gold: ['#46290d', '#6a4011', '#915d17', '#b78021', '#d6a434', '#ecc865', '#f6e3a0'],
  teal: ['#10282a', '#17393a', '#214f4b', '#2e6860', '#3f8475', '#5aa38c', '#86c4a8'],
  heather: ['#211424', '#311d36', '#46294d', '#5e3864', '#784d7c', '#96699a'],
  rose: ['#37131d', '#551c29', '#782834', '#9c3a41', '#bd5751'],
  copper: ['#552712', '#86401d', '#b0602f', '#d68648'],
  iron: ['#6a594d', '#978474', '#bfae9d', '#ddd0bf'],
  sand: ['#66523a', '#86704b', '#a48d60', '#c1aa78', '#dbc696'],
  snow: ['#8e9bb0', '#afbccb', '#cfd9e3', '#ebf1f5'],
  ice: ['#44708c', '#6490ab', '#8cb6cb', '#badbe6'],
  water: ['#0e1f35', '#142d4a', '#1c3f61', '#2a567b', '#3f7294'],
  crystal: ['#28143d', '#402166', '#65369b', '#8f5bcb', '#bf95ec', '#e9d4ff'],
  glow: ['#10304a', '#1b5877', '#378bab', '#66c1d6', '#b1eeee'],
  ember: ['#381108', '#66220f', '#a33f19', '#dc7629', '#fdbe5d'],
  brick: ['#361712', '#55271e', '#74362a', '#924b37', '#ab6448'],
  sky: ['#0c0b1b', '#181633', '#282451', '#3f376c', '#644e82', '#9a6682', '#c98674', '#e8ad76', '#f4d49a'],
} as const;

export type RampName = keyof typeof RAMPS;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Every palette color, deduplicated (used to build the post-process color lookup). */
export const PALETTE: [number, number, number][] = [
  ...new Set(Object.values(RAMPS).flat() as string[]),
].map(hexToRgb);
