import type { AppUpdateView } from "./client-api";

export interface ReferenceChannelView { enabled: boolean; baseUrl: string; tokenConfigured: boolean; phase: string; message: string; port: number }
export interface DesktopBridgeApi {
  getReferenceChannel(): Promise<ReferenceChannelView>;
  saveReferenceChannel(settings: { enabled: boolean; baseUrl: string; tunnelToken?: string }): Promise<ReferenceChannelView>;
  onReferenceChannel(callback: (state: ReferenceChannelView) => void): () => void;
  getUpdate(): Promise<AppUpdateView>;
  update(action: "check" | "download" | "apply" | "defer"): Promise<void>;
  onPrepareExit(callback: (id: string) => void): () => void;
  completePrepareExit(id: string, error?: string): void;
  onOpenUpdate(callback: () => void): () => void;
  onUpdate(callback: (status: AppUpdateView) => void): () => void;
  onDraining(callback: (draining: boolean) => void): () => void;
  cancelExit(): Promise<void>;
}
declare global { interface Window { superCanvasDesktop?: DesktopBridgeApi } }

const saveHandlers = new Set<() => Promise<void>>();
export function registerDesktopSave(handler: () => Promise<void>): () => void {
  saveHandlers.add(handler);
  return () => { saveHandlers.delete(handler); };
}
export async function saveBeforeDesktopExit(): Promise<void> {
  // Saving may render a panel and replace its registered handler. A live Set
  // iterator would visit those replacements repeatedly during this same exit.
  for (const save of [...saveHandlers]) await save();
}
