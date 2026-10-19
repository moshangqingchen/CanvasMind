"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import { isNodeConfigRunChord } from "../../lib/node-config-interaction";
import { appendTypeahead, nextEnabledIndex, typeaheadIndex, type TypeaheadState } from "./interactions";
import { useAnchoredSurface } from "./useAnchoredSurface";
import styles from "./parameter-ui.module.css";

export interface DropdownOption {
  value: string;
  label: string;
  detail?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

export interface DropdownProps {
  id?: string;
  label: string;
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  active?: boolean;
  description?: ReactNode;
  title?: string;
  className?: string;
  ariaInvalid?: boolean;
  required?: boolean;
  describedBy?: string;
  /** Only the opting-in surface may replace an already valid sole choice. */
  singleOptionDisplay?: "static";
  singleOptionDescription?: ReactNode;
}

/** Option values are opaque: domain adapters retain validation and mapping. */
export function Dropdown({ id, label, value, options, onChange, disabled = false, active = true,
  description, title, className = "", ariaInvalid, required, describedBy, singleOptionDisplay, singleOptionDescription }: DropdownProps) {
  const generatedId = useId();
  const controlId = id ?? `parameter-dropdown-${generatedId}`;
  const listId = `${controlId}-list`, selectedId = `${controlId}-selected`, descriptionId = `${controlId}-description`;
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), surface = useRef<HTMLDivElement>(null);
  const typeahead = useRef<TypeaheadState>({ text: "", at: 0 });
  const legalOptions = singleOptionDisplay === "static" ? options.filter(option => !option.disabled) : [];
  const staticOption = value && !ariaInvalid && legalOptions.length === 1 && legalOptions[0]!.value === value ? legalOptions[0] : undefined;
  if ((!active || disabled || staticOption) && open) setOpen(false);
  const entries = useMemo<readonly DropdownOption[]>(() => value && !options.some(option => option.value === value)
    ? [{ value, label: value, detail: "已保存值" }, ...options] : options, [options, value]);
  const selected = entries.find(option => option.value === value);
  const candidateIndex = entries.findIndex(option => option.value === activeValue && !option.disabled);
  const activeIndex = candidateIndex >= 0 ? candidateIndex : nextEnabledIndex(entries, -1, "Home");
  const close = () => { setOpen(false); typeahead.current = { text: "", at: 0 }; };
  useAnchoredSurface({ open, active, onClose: close, hostRef: host, triggerRef: trigger, surfaceRef: surface });
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    surface.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);
  const choose = (index: number) => {
    const option = entries[index];
    if (!option || option.disabled) return;
    close(); trigger.current?.focus({ preventScroll: true });
    onChange(option.value);
  };
  const show = (key = "Home") => {
    const current = entries.findIndex(option => option.value === value && !option.disabled);
    const index = current < 0 ? nextEnabledIndex(entries, -1, key) : current;
    if (index >= 0) setActiveValue(entries[index]!.value);
    setOpen(true);
  };
  if (staticOption) {
    const singleDescriptionId = `${controlId}-single-description`, reasonsId = `${controlId}-restrictions`;
    const restrictions = options.filter(option => option.disabled);
    const selectedReason = staticOption.disabledReason !== description && staticOption.disabledReason !== singleOptionDescription
      ? staticOption.disabledReason : undefined;
    return <div ref={host} className={`${styles.dropdown} ${className}`} data-ui="dropdown" data-display="static">
      <div id={controlId} role="textbox" aria-readonly="true" tabIndex={-1} className={styles.staticValue} data-value={value}
        aria-label={label} aria-required={required || undefined} aria-disabled={disabled || undefined}
        aria-describedby={[selectedId, description ? descriptionId : null, singleOptionDescription ? singleDescriptionId : null,
          restrictions.length || selectedReason ? reasonsId : null, describedBy].filter(Boolean).join(" ")}
        title={title ?? `${staticOption.label}${typeof staticOption.detail === "string" ? ` · ${staticOption.detail}` : ""}`}>
        <span id={selectedId} className={styles.dropdownValue}>
          {staticOption.icon && <span className={styles.optionIcon}>{staticOption.icon}</span>}
          <span className={styles.optionLabel}>{staticOption.label}</span>
          {staticOption.detail != null && <span className={styles.optionDetail}>{staticOption.detail}</span>}
        </span>
      </div>
      {description && <small id={descriptionId} className={styles.description}>{description}</small>}
      {singleOptionDescription && <small id={singleDescriptionId} className={styles.description}>{singleOptionDescription}</small>}
      {(restrictions.length > 0 || selectedReason) && <details id={reasonsId} className={styles.staticRestrictions}>
        <summary>选项限制</summary>
        <ul>{restrictions.map((option, index) => <li key={`${option.value}:${index}`}>
          <span>{option.label}</span>{option.disabledReason && <> · <span>{option.disabledReason}</span></>}
        </li>)}{selectedReason && <li>{staticOption.label} · {selectedReason}</li>}</ul>
      </details>}
    </div>;
  }
  return <div ref={host} className={`${styles.dropdown} ${className}`} data-ui="dropdown" data-node-config-layer-open={open ? "true" : undefined}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (isNodeConfigRunChord(event.nativeEvent)) {
        if (open) { event.preventDefault(); event.stopPropagation(); }
        return;
      }
      if (event.key === "Tab") { if (open) close(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus({ preventScroll: true }); return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!open) { show(event.key === "ArrowUp" || event.key === "End" ? "End" : "Home"); return; }
        const index = nextEnabledIndex(entries, activeIndex, event.key);
        if (index >= 0) setActiveValue(entries[index]!.value);
      } else if (event.key === "Enter" || event.key === " " && (!typeahead.current.text || event.timeStamp - typeahead.current.at >= 700)) {
        event.preventDefault(); event.stopPropagation();
        if (open) choose(activeIndex); else show();
      } else if (event.key.length === 1) {
        event.preventDefault(); event.stopPropagation();
        typeahead.current = appendTypeahead(typeahead.current, event.key, event.timeStamp);
        const index = typeaheadIndex(entries, activeIndex, typeahead.current.text);
        if (index >= 0) setActiveValue(entries[index]!.value);
        setOpen(true);
      }
    }}>
    <button ref={trigger} id={controlId} type="button" role="combobox" className={styles.dropdownTrigger}
      data-value={value}
      aria-label={label} aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox"
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      aria-describedby={[selectedId, description ? descriptionId : null, describedBy].filter(Boolean).join(" ")}
      aria-invalid={ariaInvalid || undefined} aria-required={required || undefined} disabled={disabled}
      title={title ?? (selected ? `${selected.label}${typeof selected.detail === "string" ? ` · ${selected.detail}` : ""}` : value)}
      onClick={() => { if (open) close(); else show(); }}>
      <span id={selectedId} className={styles.dropdownValue}>
        {selected?.icon && <span className={styles.optionIcon}>{selected.icon}</span>}
        <span className={styles.optionLabel}>{selected?.label ?? (value || "—")}</span>
        {selected?.detail != null && <span className={styles.optionDetail}>{selected.detail}</span>}
      </span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {description && <small id={descriptionId} className={styles.description}>{description}</small>}
    {open && <div ref={surface} popover="manual" className={styles.dropdownSurface}>
      <div id={listId} role="listbox" aria-label={`${label}选项`} className={styles.dropdownList}>
        {entries.map((option, index) => <div key={`${option.value}:${index}`} role="option" id={`${listId}-${index}`}
          data-option-index={index} data-active={activeIndex === index || undefined}
          data-value={option.value} aria-posinset={index + 1} aria-setsize={entries.length}
          aria-selected={value === option.value} aria-disabled={option.disabled || undefined}
          title={option.disabledReason} className={styles.option}
          onPointerDown={event => event.preventDefault()}
          onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }}
          onClick={() => choose(index)}>
          <span className={styles.optionIcon}>{option.icon}</span>
          <span className={styles.optionLabel}>{option.label}{option.disabledReason && <small>{option.disabledReason}</small>}</span>
          {option.detail != null && <span className={styles.optionDetail}>{option.detail}</span>}
          {value === option.value && <Check size={13} aria-hidden="true" />}
        </div>)}
      </div>
    </div>}
  </div>;
}
