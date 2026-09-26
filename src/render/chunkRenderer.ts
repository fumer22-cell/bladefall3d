import { BufferAttribute, BufferGeometry, Mesh, type Scene, type ShaderMaterial } from 'three';
import { WORLD } from '../config';
import { CS, colKey, decodeChunkId } from '../world/chunk';
import type { WorkerPool } from '../world/workerPool';
import type { World } from '../world/world';
import { greedyMesh, type ChunkMeshes, type MeshData } from './mesher';
import { buildAtlas } from './textures';
import { createVoxelMaterial } from './voxelMaterial';

interface ChunkMesh {
  opaque: Mesh | null;
  water: Mesh | null;
}

/**
 * Keeps chunk meshes in sync with the world: remeshes dirty chunks (nearest first, in workers
 * when a pool is given) once their whole 3×3 column neighborhood is loaded, and disposes meshes
 * of unloaded columns.
 */
export class ChunkRenderer {
  private readonly atlas = buildAtlas();
  readonly opaqueMat: ShaderMaterial = createVoxelMaterial(this.atlas.texture, this.atlas.average, false);
  readonly waterMat: ShaderMaterial = createVoxelMaterial(this.atlas.texture, this.atlas.average, true);
  private readonly meshes = new Map<number, ChunkMesh>();
  private readonly inFlight = new Set<number>();

  constructor(
    private readonly scene: Scene,
    private readonly pool: WorkerPool | null,
  ) {}

  get meshCount(): number {
    return this.meshes.size;
  }

  get pending(): number {
    return this.inFlight.size;
  }

  update(world: World, camX: number, camY: number, camZ: number): void {
    // Drop meshes of unloaded columns.
    for (const id of [...this.meshes.keys()]) {
      const [cx, , cz] = decodeChunkId(id);
      if (!world.column(cx, cz)) this.dispose(id);
    }

    const candidates: [number, number][] = [];
    for (const id of world.dirty) {
      const [cx, cy, cz] = decodeChunkId(id);
      const col = world.column(cx, cz);
      if (!col) {
        world.dirty.delete(id);
        continue;
      }
      if (col.counts[cy] === 0) {
        this.dispose(id);
        world.dirty.delete(id);
        continue;
      }
      if (this.inFlight.has(id) || !world.neighborhoodLoaded(cx, cz)) continue;
      const dx = cx * CS + 8 - camX, dy = cy * CS + 8 - camY, dz = cz * CS + 8 - camZ;
      candidates.push([id, dx * dx + dy * dy + dz * dz]);
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a[1] - b[1]);

    const budget = this.pool ? WORLD.MAX_MESH_IN_FLIGHT - this.inFlight.size : candidates.length;
    for (let k = 0; k < Math.min(budget, candidates.length); k++) {
      const id = candidates[k][0];
      const [cx, cy, cz] = decodeChunkId(id);
      world.dirty.delete(id);
      const { blocks, light } = world.buildPadded(cx, cy, cz);
      if (!this.pool) {
        this.apply(id, greedyMesh(blocks, light));
        continue;
      }
      this.inFlight.add(id);
      void this.pool
        .run<ChunkMeshes>({ type: 'mesh', blocks, light }, [blocks.buffer, light.buffer])
        .then((m) => {
          this.inFlight.delete(id);
          // The column may have unloaded while we were meshing.
          if (world.columns.has(colKey(cx, cz))) this.apply(id, m);
        });
    }
  }

  /** Remove all meshes (e.g. when switching worlds). */
  clear(): void {
    for (const id of [...this.meshes.keys()]) this.dispose(id);
  }

  private apply(id: number, m: ChunkMeshes): void {
    const [cx, cy, cz] = decodeChunkId(id);
    const cur = this.meshes.get(id) ?? { opaque: null, water: null };
    cur.opaque = this.replace(cur.opaque, m.opaque, this.opaqueMat, cx, cy, cz);
    cur.water = this.replace(cur.water, m.water, this.waterMat, cx, cy, cz);
    if (cur.opaque || cur.water) this.meshes.set(id, cur);
    else this.meshes.delete(id);
  }

  private replace(old: Mesh | null, data: MeshData, mat: ShaderMaterial, cx: number, cy: number, cz: number): Mesh | null {
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    if (data.indices.length === 0) return null;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geo.setAttribute('aColor', new BufferAttribute(data.colors, 3));
    geo.setAttribute('aLight', new BufferAttribute(data.light, 2));
    geo.setAttribute('aAO', new BufferAttribute(data.ao, 1));
    geo.setAttribute('aUV', new BufferAttribute(data.uv, 2));
    geo.setAttribute('aTile', new BufferAttribute(data.tile, 1));
    geo.setAttribute('aTileSide', new BufferAttribute(data.tileSide, 1));
    geo.setIndex(new BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, mat);
    mesh.position.set(cx * CS, cy * CS, cz * CS);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // The looming warp moves far geometry, so three's frustum test would be wrong; `cull()` does
    // a horizontal-only test instead (the warp keeps horizontal directions).
    mesh.frustumCulled = false;
    if (mat.transparent) mesh.renderOrder = 1;
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Hide chunks outside the horizontal field of view. The warp only changes distances, never the
   * horizontal direction to a point, so a yaw test stays exact; looking steeply up or down shows
   * everything around.
   */
  cull(camX: number, camZ: number, yaw: number, pitch: number, hfovHalf: number): void {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const all = Math.abs(pitch) > 0.75;
    const cosLimit = Math.cos(Math.min(Math.PI, hfovHalf + 0.15));
    for (const [id, m] of this.meshes) {
      const [cx, , cz] = decodeChunkId(id);
      const dx = cx * CS + 8 - camX, dz = cz * CS + 8 - camZ;
      const d = Math.hypot(dx, dz);
      // A chunk's half-diagonal (~11.3 m) widens the allowed angle up close.
      let visible = all || d < 24;
      if (!visible) {
        const cos = (dx * fx + dz * fz) / d;
        const widen = Math.asin(Math.min(1, 12 / d));
        visible = cos >= Math.cos(Math.min(Math.PI, Math.acos(cosLimit) + widen));
      }
      if (m.opaque) m.opaque.visible = visible;
      if (m.water) m.water.visible = visible;
    }
  }

  private dispose(id: number): void {
    const m = this.meshes.get(id);
    if (!m) return;
    for (const mesh of [m.opaque, m.water]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.delete(id);
  }
}

