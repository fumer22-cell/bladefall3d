/** Minimal typed event emitter. */
export class Emitter<E extends Record<string, unknown>> {
  private handlers: { [K in keyof E]?: ((e: E[K]) => void)[] } = {};

  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }

  emit<K extends keyof E>(type: K, e: E[K]): void {
    const list = this.handlers[type];
    if (list) for (const fn of list) fn(e);
  }
}
