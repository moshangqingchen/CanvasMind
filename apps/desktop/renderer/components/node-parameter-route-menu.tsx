"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { nodeConfigOwnerElement } from "../lib/node-config-interaction";

/** Only the management action moves here in stage one; selectors stay intact. */
export function NodeParameterRouteMenu({ active, onManage }: { active: boolean; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  if (!active && open) setOpen(false);
  useEffect(() => {
    if (!active || !open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const target = event.target instanceof Element ? event.target : null;
      const owner = nodeConfigOwnerElement(host.current);
      if (nodeConfigOwnerElement(target) !== owner) return;
      // Keyboard navigation can open another child without an outside pointer.
      // That child owns the first Escape, just as it does before this menu exists.
      if (owner?.querySelector("select:open, .node-model-select[data-open]") ||
          [...(owner?.querySelectorAll('[data-node-config-layer-open="true"]') ?? [])]
            .some(layer => layer !== host.current)) return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape);
    };
  }, [active, open]);
  return <details ref={host} className="node-config-route-menu" open={active && open}
    data-node-config-layer-open={active && open ? "true" : undefined}
    onToggle={event => setOpen(active && event.currentTarget.open)}>
    <summary ref={trigger} aria-label="线路菜单" title="线路菜单"><MoreHorizontal size={16} /></summary>
    <div className="node-config-route-menu-content">
      <button type="button" aria-label="管理供应商与密钥" onClick={() => { setOpen(false); onManage(); }}>
        <ExternalLink size={14} />管理供应商与密钥
      </button>
    </div>
  </details>;
}
