import { BoxGeometry, Mesh, MeshLambertMaterial, type Material, type Object3D } from 'three';

const geo = new BoxGeometry(1, 1, 1);

/** Add a box part (size w×h×d, centered at x,y,z) to a parent. */
export function box(
  parent: Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: Material | number,
): Mesh {
  const mat = typeof material === 'number' ? new MeshLambertMaterial({ color: material }) : material;
  const m = new Mesh(geo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
