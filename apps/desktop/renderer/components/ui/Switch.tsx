"use client";

import { useId, type ReactNode } from "react";
import styles from "./parameter-ui.module.css";

export function Switch({ id, label, checked, onChange, disabled = false, description, className = "", ariaLabel }: {
  id?: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const generatedId = useId(), controlId = id ?? `parameter-switch-${generatedId}`;
  return <div className={`${styles.switch} ${className}`}>
    <label htmlFor={controlId}>
      <span>{label}</span>
      <input id={controlId} type="checkbox" role="switch" checked={checked} disabled={disabled}
        aria-label={ariaLabel} aria-describedby={description ? `${controlId}-description` : undefined}
        onChange={event => onChange(event.target.checked)} />
    </label>
    {description && <small id={`${controlId}-description`} className={styles.description}>{description}</small>}
  </div>;
}
