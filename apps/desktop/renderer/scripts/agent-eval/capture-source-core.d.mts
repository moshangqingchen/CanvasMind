import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
export function selectedConnectionFromSnapshot(raw: string, connectionId: string): {
  record: ProviderConnectionRecord;
  supplier?: SupplierRecord;
};
export function writeCaptureJsonOnce(path: string, value: unknown): void;
export function reserveAdditionalCapture(directory: string, identity: {
  connectionId: string; modelId: string; selectionSource?: string;
}, at?: string): string;
export function sourceFromCapturedSnapshots(directory: string, decrypt: (encrypted: Buffer) => string, identity: {
  connectionId: string; modelId: string; selectionSource?: string;
}, checkpoint?: (stage: string) => void): import("./selection").ReadonlyConnectionSource;
