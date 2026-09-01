import type {
  FetchImplementation,
  ProviderAdapter,
  ProviderConnectionResolver,
  ProviderName,
} from "./contracts.js";
import { FakeProviderAdapter, type FakeProviderOptions } from "./fake.js";
import {
  OpenAIImageAdapter,
  type OpenAIImageAdapterOptions,
  WeAIImageAdapter,
  type WeAIImageAdapterOptions,
} from "./openai.js";
import { GenericRestAdapter, type GenericRestAdapterOptions } from "./rest.js";
import { RunwayAdapter, type RunwayAdapterOptions } from "./runway.js";

export interface ProviderRegistryOptions {
  fetch?: FetchImplementation;
  openai?: Omit<OpenAIImageAdapterOptions, "fetch">;
  weai?: Omit<WeAIImageAdapterOptions, "fetch">;
  runway?: Omit<RunwayAdapterOptions, "fetch">;
  rest?: Omit<GenericRestAdapterOptions, "fetch">;
  fake?: FakeProviderOptions;
  adapters?: Readonly<
    Partial<Record<ProviderName | (string & {}), ProviderAdapter>>
  >;
}

/** A small connection-provider lookup used by the worker execution loop. */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  public constructor(
    private readonly connections: ProviderConnectionResolver,
    adapters: Readonly<Partial<Record<string, ProviderAdapter>>> = {},
  ) {
    for (const [name, adapter] of Object.entries(adapters)) {
      if (adapter) this.register(name, adapter);
    }
  }

  public register(name: string, adapter: ProviderAdapter): this {
    if (name.trim().length === 0)
      throw new Error("Provider name cannot be empty");
    this.adapters.set(name, adapter);
    return this;
  }

  public get(name: string): ProviderAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter)
      throw new Error(`No adapter registered for provider: ${name}`);
    return adapter;
  }

  public async forConnection(connectionId: string): Promise<ProviderAdapter> {
    const connection = await this.connections.resolve(connectionId);
    return this.get(connection.provider);
  }
}

export function createDefaultProviderRegistry(
  connections: ProviderConnectionResolver,
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  const registry = new ProviderRegistry(connections, options.adapters ?? {});
  const fetchImpl = options.fetch;
  if (!options.adapters?.openai) {
    registry.register(
      "openai",
      new OpenAIImageAdapter(connections, {
        ...options.openai,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }
  if (!options.adapters?.weai) {
    registry.register(
      "weai",
      new WeAIImageAdapter(connections, {
        ...options.weai,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }
  if (!options.adapters?.runway) {
    registry.register(
      "runway",
      new RunwayAdapter(connections, {
        ...options.runway,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }
  if (!options.adapters?.rest) {
    registry.register(
      "rest",
      new GenericRestAdapter(connections, {
        ...options.rest,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    );
  }
  if (!options.adapters?.fake) {
    registry.register(
      "fake",
      new FakeProviderAdapter(connections, options.fake),
    );
  }
  return registry;
}
