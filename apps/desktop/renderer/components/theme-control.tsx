"use client";

import { useId, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { getThemeStore } from "../lib/theme-store";
import type { ThemePreference } from "../lib/ui-preferences";

export function ThemeControl({ compact = false, onChange }: { compact?: boolean; onChange?: () => void }) {
  const id = useId();
  const store = getThemeStore();
  const preference = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const Icon = preference === "system" ? Monitor : preference === "light" ? Sun : Moon;
  return <label className={`theme-control${compact ? " theme-control-compact" : ""}`} htmlFor={id}>
    <span className="theme-control-label"><Icon size={16} strokeWidth={1.75} aria-hidden="true" />外观</span>
    <select id={id} aria-label="外观主题" value={preference} onChange={event => {
      store.setPreference(event.target.value as ThemePreference);
      onChange?.();
    }}>
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  </label>;
}
