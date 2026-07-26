import { EventEmitter } from "node:events";

export interface RuntimeEvent {
  type: "run" | "node" | "asset";
  runId?: string;
  nodeRunId?: string;
  payload: Record<string, unknown>;
  at: string;
}

export class RuntimeEventBus {
  private readonly emitter = new EventEmitter();

  publish(event: RuntimeEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

const key = "__superCanvasEventBus";
export function getEventBus(): RuntimeEventBus {
  const scope = globalThis as typeof globalThis & { [key]?: RuntimeEventBus };
  scope[key] ??= new RuntimeEventBus();
  return scope[key];
}
