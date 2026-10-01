"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { SupplierBillingSnapshot } from "@super-canvas/db";
import { fetchSuppliers, type SupplierRecord } from "./client-suppliers";

type Entry = { id: string; sourceId?: string; revision?: number; supplierKey: string; name: string; configured: boolean; billing?: SupplierBillingSnapshot };
const empty: readonly Entry[] = [];
let entries: readonly Entry[] = empty;
let loadedAt = 0;
let loading: Promise<void> | undefined;
let seedGeneration = 0;
const pending = new Map<string, Promise<SupplierBillingSnapshot>>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => listeners.forEach(listener => listener());
export function seedSupplierBilling(suppliers: SupplierRecord[]) {
  seedGeneration++;
  entries = suppliers.filter(s => s.state?.visibility !== "deleted").map(s => ({ id: s.id, sourceId: s.state?.sourceId, revision: s.state?.revision, supplierKey: s.supplierKey,
    name: s.name, configured: s.siteLogin?.configured === true,
    billing: s.state?.billing?.sourceId === s.state?.sourceId ? s.state?.billing : undefined }));
  loadedAt = Date.now(); publish();
}
export async function loadSupplierBilling() {
  if (Date.now() - loadedAt < 60_000) return;
  if (!loading) {
    const generation = seedGeneration;
    loading = fetchSuppliers().then(suppliers => {
      // An explicit scan/edit seed is newer than a list request that started before it.
      if (seedGeneration === generation) seedSupplierBilling(suppliers);
    }).finally(() => { loading = undefined; });
  }
  return loading;
}
export function useSupplierBillingOverview() {
  const value = useSyncExternalStore(subscribe, () => entries, () => empty);
  useEffect(() => { void loadSupplierBilling().catch(() => undefined); }, []);
  return value;
}
export function refreshSupplierAccount(id: string): Promise<SupplierBillingSnapshot> {
  const active = pending.get(id);
  if (active) return active;
  const task = (async () => {
    const revision = entries.find(entry => entry.id === id)?.revision;
    const response = await fetch(`/api/suppliers/${encodeURIComponent(id)}/billing`, { method: "POST" });
    if (!response.ok) throw Error("账务刷新未完成，请重试");
    const billing = await response.json() as SupplierBillingSnapshot;
    let applied = false;
    entries = entries.map(entry => {
      if (entry.id !== id || entry.sourceId !== billing.sourceId || entry.revision !== revision) return entry;
      applied = true; return { ...entry, billing };
    });
    if (applied) seedGeneration++;
    publish();
    window.dispatchEvent(new CustomEvent("supplier-billing-updated", { detail: { supplierId: id } }));
    return billing;
  })().finally(() => { pending.delete(id); });
  pending.set(id, task); return task;
}
export async function refreshAllSupplierAccounts() {
  await loadSupplierBilling();
  const queue = [...entries];
  const results: Array<{ id: string; status: string }> = [];
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const entry = queue.shift()!;
      try { results.push({ id: entry.id, status: (await refreshSupplierAccount(entry.id)).status }); }
      catch { results.push({ id: entry.id, status: "failed" }); }
    }
  }));
  return results;
}
const recent = new Map<string, number>();
const completed = new Set<string>();
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
export function refreshSupplierAccountAfterRun(id: string, runId: string) {
  const key = `${id}:${runId}`;
  if (completed.has(key)) return;
  completed.add(key);
  if (completed.size > 2000) completed.delete(completed.values().next().value!);
  if (scheduled.has(id)) return;
  const delay = Math.max(1000, 15_000 - (Date.now() - (recent.get(id) ?? 0)));
  scheduled.set(id, setTimeout(() => {
    scheduled.delete(id);
    recent.set(id, Date.now());
    void refreshSupplierAccount(id).catch(() => undefined);
  }, delay));
}
