"use client";
import { useEffect, useState } from "react";

/** Poll only the local ledger; this must never scan or submit to a supplier. */
export function useSupplierVerificationRevision(supplierId?: string) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (!supplierId) return;
    const controller = new AbortController();
    let loading = false;
    const read = async () => {
      if (loading || document.hidden || controller.signal.aborted) return;
      loading = true;
      try {
        const response = await fetch(`/api/suppliers/${encodeURIComponent(supplierId)}/verification?summary=1`,
          { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted && Number.isSafeInteger(result.revision)) setVersion(`${supplierId}:${result.revision}`);
      } catch { /* Preserve the current controls during a local restart. */ }
      finally { loading = false; }
    };
    void read();
    const refresh = () => { void read(); };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [supplierId]);
  return version.startsWith(`${supplierId}:`) ? version : "";
}
