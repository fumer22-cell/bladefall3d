import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type ShaderMaterial,
} from 'three';
import { CAMERA, WORLD } from '../config';
import { CS } from '../world/chunk';
import type { World } from '../world/world';
import { greedyMesh } from './mesher';
import { createVoxelMaterial } from './voxelMaterial';

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly material: ShaderMaterial;
  private readonly chunkMeshes = new Map<string, Mesh>();
  private readonly padded = new Uint16Array((CS + 2) ** 3);

  constructor(container: HTMLElement) {
    this.gl = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.gl.domElement);

    this.scene.background = new Color(WORLD.SKY_COLOR);
    this.scene.fog = new FogExp2(WORLD.SKY_COLOR, WORLD.FOG_DENSITY);
    // Lights for box-model entities (voxels use their own shader).
    this.scene.add(new HemisphereLight(0xdfe8ff, 0x4a3f2e, 1.8));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);
    this.gl.autoClear = false;
    this.camera = new PerspectiveCamera(CAMERA.BASE_FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.camera.rotation.order = 'YXZ';
    this.material = createVoxelMaterial();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(window.innerWidth, window.innerHeight);
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** Rebuild meshes for chunks the world marked dirty. */
  syncChunks(world: World): void {
    for (const key of world.dirty) {
      const chunk = world.chunks.get(key);
      const old = this.chunkMeshes.get(key);
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        this.chunkMeshes.delete(key);
      }
      if (!chunk || chunk.count === 0) continue;
      const data = greedyMesh(world.buildPadded(chunk.cx, chunk.cy, chunk.cz, this.padded));
      if (data.indices.length === 0) continue;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new BufferAttribute(data.normals, 3));
      geo.setAttribute('aColor', new BufferAttribute(data.colors, 3));
      geo.setIndex(new BufferAttribute(data.indices, 1));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, this.material);
      mesh.position.set(chunk.cx * CS, chunk.cy * CS, chunk.cz * CS);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.chunkMeshes.set(key, mesh);
    }
    world.dirty.clear();
  }

  /** Render the world, then `overlay` (the first-person viewmodel) on top with a fresh depth buffer. */
  render(overlay?: Scene): void {
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (overlay) {
      this.gl.clearDepth();
      this.gl.render(overlay, this.camera);
    }
  }
}
