import WorldWorker from './worker?worker&inline';
import type { WorkerRequest } from './worker';

type Pending = { resolve: (v: unknown) => void; worker: number };
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** A small pool of workers running world generation and meshing off the main thread. */
export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly load: number[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new WorldWorker();
      w.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        this.load[p.worker]--;
        p.resolve(e.data.result);
      };
      this.workers.push(w);
      this.load.push(0);
    }
  }

  run<T>(msg: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.load[i] < this.load[best]) best = i;
    const id = this.nextId++;
    this.load[best]++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, worker: best });
      this.workers[best].postMessage({ ...msg, id }, transfer);
    });
  }
}
