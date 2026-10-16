"use client";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import {
  SettingsDraftGuardProvider,
  useSettingsLeaveGuard,
} from "./settings-draft-guard";
import { DeferredPanelContent } from "./deferred-panel-content";
import { PanelBodySkeleton } from "./panel-loading";
import { ThemeControl } from "./theme-control";

function SettingsBodyLoading() { return <PanelBodySkeleton label="正在打开设置" />; }
// Keep the dialog and draft guard in the small shell. Only the active settings
// section downloads its implementation; SupplierManager already defers details.
const SupplierManager = dynamic(
  () => import("./supplier-manager").then(module => module.SupplierManager),
  { ssr: false, loading: SettingsBodyLoading },
);
const PersonalAiSettings = dynamic(
  () => import("./personal-ai-settings").then(module => module.PersonalAiSettings),
  { ssr: false, loading: SettingsBodyLoading },
);
const ReferenceChannelSettings = dynamic(
  () => import("./reference-channel-settings").then(module => module.ReferenceChannelSettings),
  { ssr: false, loading: SettingsBodyLoading },
);
const CloudGenerationSettings = dynamic(
  () => import("./cloud-generation-settings").then(module => module.CloudGenerationSettings),
  { ssr: false, loading: SettingsBodyLoading },
);
const SETTINGS_TABS = [
  { id: "suppliers", label: "供应商与模型" },
  { id: "personal-ai", label: "个人 AI 网站" },
  { id: "reference", label: "素材通道" },
  { id: "cloud", label: "云端生图" },
  { id: "appearance", label: "外观" },
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
        onKeyDown={event => {
          if (event.defaultPrevented) return;
          const editing = (event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
          if ((!editing && event.key === "/") || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f")) {
            const input = event.currentTarget.querySelector<HTMLInputElement>('input[aria-label="搜索供应商"]');
            if (input) { event.preventDefault(); event.stopPropagation(); input.focus(); input.select(); }
          }
        }}
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
            title="关闭设置（Esc）"
            onClick={requestClose}
          >
            <X size={19} />
          </button>
        </header>
        {tab === "appearance" ? (
          <section id="sm-appearance-panel" role="tabpanel" aria-labelledby="sm-appearance-tab" className="sm-appearance-panel">
            <div className="sm-appearance-card">
              <h3 className="sm-appearance-heading">让工作室合你心意</h3>
              <p className="sm-appearance-description">选择清新的浅色或沉静的深色，也可以跟随系统自动切换。</p>
              <ThemeControl />
              <p className="sm-appearance-description">外观会自动记住，下次打开继续使用。</p>
            </div>
          </section>
        ) : tab === "suppliers" ? (
          <SupplierManager
            initialCangyuanGroup={initialCangyuanGroup}
          />
        ) : <DeferredPanelContent key={tab}>{tab === "personal-ai" ? (
          <PersonalAiSettings />
        ) : tab === "cloud" ? (
          <CloudGenerationSettings />
        ) : (
          <ReferenceChannelSettings />
        )}</DeferredPanelContent>}
      </section>
    </div>
  );
}
