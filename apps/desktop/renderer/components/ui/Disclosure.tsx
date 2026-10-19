"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./parameter-ui.module.css";

/** Hidden content remains mounted, so partially typed field drafts survive. */
export function Disclosure({ label, children, defaultOpen = false, open: controlledOpen, onOpenChange, className = "" }: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const id = useId();
  return <section className={`${styles.disclosure} ${className}`}>
    <button type="button" className={styles.disclosureTrigger} aria-expanded={open} aria-controls={id}
      onClick={() => { setLocalOpen(!open); onOpenChange?.(!open); }}>
      <span>{label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    <div id={id} hidden={!open} className={styles.disclosureContent}>{children}</div>
  </section>;
}
