"use client";

import type { ReactNode } from "react";
import { nextEnabledIndex } from "./interactions";
import styles from "./parameter-ui.module.css";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Segmented({ label, value, options, onChange, disabled = false, className = "", describedBy }: {
  label: string;
  value: string;
  options: readonly SegmentedOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  describedBy?: string;
}) {
  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(options, -1, "Home");
  return <div role="group" aria-label={label} aria-describedby={describedBy} className={`${styles.segmented} ${className}`}
    onKeyDown={event => {
      if (disabled || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 ||
          event.ctrlKey || event.metaKey || event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      const index = nextEnabledIndex(options, current, event.key);
      event.preventDefault(); event.stopPropagation();
      if (index >= 0) { buttons[index]?.focus(); onChange(options[index]!.value); }
    }}>
    {options.map((option, index) => <button key={`${option.value}:${index}`} type="button"
      aria-pressed={value === option.value} disabled={disabled || option.disabled} title={option.title}
      data-value={option.value} tabIndex={index === focusIndex && !disabled ? 0 : -1}
      onClick={() => onChange(option.value)}>
      <span>{option.label}</span>{option.detail != null && <small>{option.detail}</small>}
    </button>)}
  </div>;
}
