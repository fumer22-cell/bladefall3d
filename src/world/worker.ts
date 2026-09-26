/// <reference lib="webworker" />
import { greedyMesh, type MeshData } from '../render/mesher';
import { WorldGen } from './worldgen';

export type WorkerRequest =
  | { type: 'gen'; id: number; seed: number; cx: number; cz: number; edits: Int32Array | null }
  | { type: 'mesh'; id: number; blocks: Uint16Array; light: Uint8Array };

let gen: WorldGen | null = null;

function buffers(m: MeshData): ArrayBuffer[] {
  return [m.positions, m.normals, m.colors, m.light, m.ao, m.indices].map((a) => a.buffer as ArrayBuffer);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'gen') {
    if (!gen || gen.seed !== msg.seed) gen = new WorldGen(msg.seed);
    const col = gen.generate(msg.cx, msg.cz, msg.edits ?? undefined);
    self.postMessage({ id: msg.id, result: col }, [col.blocks.buffer, col.light.buffer]);
  } else {
    const meshes = greedyMesh(msg.blocks, msg.light);
    self.postMessage({ id: msg.id, result: meshes }, [...buffers(meshes.opaque), ...buffers(meshes.water)]);
  }
};
