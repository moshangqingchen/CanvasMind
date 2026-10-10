"use client";
import { useCallback, useState } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import {
  SettingsDraftGuardProvider,
  useSettingsLeaveGuard,
} from "./settings-draft-guard";
import { SupplierManager } from "./supplier-manager";
import { PersonalAiSettings } from "./personal-ai-settings";
import { ReferenceChannelSettings } from "./reference-channel-settings";
import { CloudGenerationSettings } from "./cloud-generation-settings";
const SETTINGS_TABS = [
  { id: "suppliers", label: "供应商与模型" },
  { id: "personal-ai", label: "个人 AI 网站" },
  { id: "reference", label: "素材通道" },
  { id: "cloud", label: "云端生图" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialCangyuanGroup?: string | null;
}
export function SettingsModal(props: SettingsModalProps) {
  if (!props.open) return null;
  return (
    <SettingsDraftGuardProvider>
      <SettingsModalContent {...props} />
    </SettingsDraftGuardProvider>
  );
}

function SettingsModalContent({
  open,
  onClose,
  initialCangyuanGroup,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("suppliers");

  const { requestLeave } = useSettingsLeaveGuard();
  const requestClose = useCallback(() => {
    requestLeave(onClose, { action: "关闭设置" });
  }, [requestLeave, onClose]);
  const changeTab = (next: typeof tab) => {
    if (next !== tab)
      requestLeave(() => setTab(next), { action: "切换设置分类" });
  };
  const dialogRef = useDialogFocus(open, requestClose);
  if (!open) return null;
  return (
    <div
      className="sm-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        className="sm-settings-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="供应商与模型设置"
        tabIndex={-1}
      >
        <header className="sm-settings-header">
          <div>
            <h2>创作设置</h2>
            <p>连接模型，让灵感自由生长。</p>
          </div>
          <nav
            className="sm-settings-tabs"
            aria-label="设置分类"
            role="tablist"
          >
            {SETTINGS_TABS.map(({ id, label }) => (
              <button
                key={id}
                id={`sm-${id}-tab`}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={tab === id ? `sm-${id}-panel` : undefined}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => changeTab(id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const tabs = Array.from(
                    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                  );
                  const current = tabs.indexOf(event.currentTarget);
                  const next = event.key === "Home" ? 0
                    : event.key === "End" ? tabs.length - 1
                      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                  // Manual activation keeps keyboard exploration from discarding drafts.
                  tabs[next]?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="sm-icon"
            aria-label="关闭设置"
            onClick={requestClose}
          >
            <X size={19} />
          </button>
        </header>
        {tab === "suppliers" ? (
          <SupplierManager
            initialCangyuanGroup={initialCangyuanGroup}
          />
        ) : tab === "personal-ai" ? (
          <PersonalAiSettings />
        ) : tab === "cloud" ? (
          <CloudGenerationSettings />
        ) : (
          <ReferenceChannelSettings />
        )}
      </section>
    </div>
  );
}
