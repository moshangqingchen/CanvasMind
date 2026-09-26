"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SettingsDraftRegistry,
  type SettingsDraftState,
  type SettingsLeaveOptions,
} from "../lib/settings-draft-guard";

const SettingsDraftContext = createContext<SettingsDraftRegistry | null>(null);
const browserDialogs = {
  confirm: (message: string) => window.confirm(message),
  notify: (message: string) => window.alert(message),
};

export function SettingsDraftGuardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [registry] = useState(() => new SettingsDraftRegistry(browserDialogs));
  return (
    <SettingsDraftContext.Provider value={registry}>
      {children}
    </SettingsDraftContext.Provider>
  );
}

/** Register one mounted form; successful saves should make dirty=false in its owner. */
export function useSettingsDraft(state: SettingsDraftState & { id?: string }) {
  const shared = useContext(SettingsDraftContext);
  const [standalone] = useState(
    () => new SettingsDraftRegistry(browserDialogs),
  );
  const registry = shared ?? standalone;
  const generatedId = useId();
  const id = state.id ?? generatedId;
  const latest = useRef<SettingsDraftState>(state);
  useLayoutEffect(() => {
    latest.current = state;
  });
  useLayoutEffect(
    () => registry.register(id, () => latest.current),
    [registry, id],
  );
  const confirmDiscard = useCallback(
    (options?: Omit<SettingsLeaveOptions, "ids">) =>
      registry.confirmDiscard({ ...options, ids: [id] }),
    [registry, id],
  );
  return useMemo(() => ({ confirmDiscard }), [confirmDiscard]);
}

/** Protect a navigation that can discard multiple forms, including tabs and dialog dismissal. */
export function useSettingsLeaveGuard() {
  const registry = useContext(SettingsDraftContext);
  const confirmDiscard = useCallback(
    (options?: SettingsLeaveOptions) =>
      registry?.confirmDiscard(options) ?? true,
    [registry],
  );
  const requestLeave = useCallback(
    (action: () => void, options?: SettingsLeaveOptions) => {
      if (!confirmDiscard(options)) return false;
      action();
      return true;
    },
    [confirmDiscard],
  );
  return useMemo(
    () => ({ confirmDiscard, requestLeave }),
    [confirmDiscard, requestLeave],
  );
}
