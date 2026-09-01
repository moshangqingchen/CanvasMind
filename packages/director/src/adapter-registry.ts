import type { DirectorModelAdapter, DirectorProtocol } from "./types.js";

export class DirectorAdapterRegistry {
  readonly #adapters = new Map<DirectorProtocol, DirectorModelAdapter>();

  constructor(adapters: readonly DirectorModelAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: DirectorModelAdapter): void {
    if (this.#adapters.has(adapter.protocol)) {
      throw new Error(
        `A director adapter is already registered for ${adapter.protocol}`,
      );
    }
    this.#adapters.set(adapter.protocol, adapter);
  }

  replace(adapter: DirectorModelAdapter): void {
    this.#adapters.set(adapter.protocol, adapter);
  }

  has(protocol: DirectorProtocol): boolean {
    return this.#adapters.has(protocol);
  }

  get(protocol: DirectorProtocol): DirectorModelAdapter {
    const adapter = this.#adapters.get(protocol);
    if (!adapter)
      throw new Error(`No director adapter registered for ${protocol}`);
    return adapter;
  }

  protocols(): readonly DirectorProtocol[] {
    return [...this.#adapters.keys()].sort();
  }
}
