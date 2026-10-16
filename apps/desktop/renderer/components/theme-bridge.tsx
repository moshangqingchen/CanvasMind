"use client";

import { useEffect } from "react";
import { getThemeStore } from "../lib/theme-store";

/** Synchronizes CSS/native appearance without subscribing the page to theme state. */
export function ThemeBridge() {
  useEffect(() => getThemeStore().subscribe(() => {}), []);
  return null;
}
