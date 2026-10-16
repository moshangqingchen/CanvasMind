"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Cloud, Link2, Palette, Server, UserRound, X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import {
  SettingsDraftGuardProvider,
  useSettingsLeaveGuard,
} from "./settings-draft-guard";
import { DeferredPanelContent } from "./deferred-panel-content";
import { PanelBodySkeleton } from "./panel-loading";
import { ThemeControl } from "./theme-control";
import { initialSettingsSection } from "../lib/settings-target";
import "./supplier-manager.css";
import "./settings-neural.css";

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
  { id: "suppliers", label: "供应商与模型", english: "SUPPLIERS", Icon: Server },
  { id: "personal-ai", label: "个人 AI 网站", english: "ACCOUNTS", Icon: UserRound },
  { id: "reference", label: "素材通道", english: "ASSET CHANNEL", Icon: Link2 },
  { id: "cloud", label: "云端生图", english: "CLOUD", Icon: Cloud },
  { id: "appearance", label: "外观", english: "APPEARANCE", Icon: Palette },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  surface?: "workspace" | "canvas";
  initialCangyuanGroup?: string | null;
  initialTab?: SettingsTab;
  targetSupplierId?: string | null;
  targetConnectionId?: string | null;
  startAddingSupplier?: boolean;
  startAddingAccount?: boolean;
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
  surface = "canvas",
  initialCangyuanGroup,
  initialTab,
  targetSupplierId,
  targetConnectionId,
  startAddingSupplier,
  startAddingAccount,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(() => initialSettingsSection(initialTab, targetConnectionId, startAddingAccount));

  const { requestLeave } = useSettingsLeaveGuard();
  const requestClose = useCallback(() => {
    requestLeave(onClose, { action: "关闭设置" });
  }, [requestLeave, onClose]);
  const changeTab = (next: typeof tab) => {
    if (next !== tab)
      requestLeave(() => setTab(next), { action: "切换设置分类" });
  };
  const dialogRef = useDialogFocus(open, requestClose);
  useEffect(() => {
    if (!open) return;
    // The rail is the entry point for this dialog. Run once per opening, after
    // the shared focus trap has captured the trigger and focused the shell.
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>('.sm-settings-tabs [aria-selected="true"]')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, dialogRef]);
  if (!open) return null;
  return (
    <div
      className="sm-settings-backdrop neural-settings"
      data-settings-context={surface}
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
          <div className="sm-settings-title">
            <span className="sm-settings-orbit" aria-hidden="true" />
            <div>
              <h2>创作设置 <span className="sm-micro-label" aria-hidden="true">STUDIO SETTINGS</span></h2>
              <p>连接你的模型、账号与创作空间。</p>
            </div>
          </div>
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
        <aside className="sm-settings-rail">
          <span className="sm-settings-rail-title">你的工作室 <span className="sm-micro-label" aria-hidden="true">YOUR STUDIO</span></span>
          <nav
            className="sm-settings-tabs"
            aria-label="设置分类"
            role="tablist"
            aria-orientation="vertical"
          >
            {SETTINGS_TABS.map(({ id, label, english, Icon }) => (
              <button
                key={id}
                id={`sm-${id}-tab`}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-label={label}
                aria-controls={tab === id ? `sm-${id}-panel` : undefined}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => changeTab(id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const tabs = Array.from(
                    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                  );
                  const current = tabs.indexOf(event.currentTarget);
                  const next = event.key === "Home" ? 0
                    : event.key === "End" ? tabs.length - 1
                      : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
                  // Manual activation keeps keyboard exploration from discarding drafts.
                  tabs[next]?.focus();
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}<span className="sm-micro-label" aria-hidden="true">{english}</span></span>
                <i className="sm-settings-tab-point" aria-hidden="true" />
              </button>
            ))}
          </nav>
          <div className="sm-settings-rail-brand" aria-hidden="true">SUPER<br />CANVAS<span>PERSONAL CREATIVE SPACE</span></div>
        </aside>
        <div className="sm-settings-body">
        {tab === "appearance" ? (
          <section id="sm-appearance-panel" role="tabpanel" aria-labelledby="sm-appearance-tab" className="sm-appearance-panel">
            <div className="sm-appearance-card">
              <span className="sm-section-label">外观 <span className="sm-micro-label" aria-hidden="true">APPEARANCE</span></span>
              <h3 className="sm-appearance-heading">让工作室合你心意</h3>
              <p className="sm-appearance-description">选择清新的浅色或沉静的深色，也可以跟随系统自动切换。</p>
              <ThemeControl />
              <p className="sm-appearance-description">外观会自动记住，下次打开继续使用。</p>
            </div>
          </section>
        ) : tab === "suppliers" ? (
          <SupplierManager
            initialCangyuanGroup={initialCangyuanGroup}
            targetSupplierId={targetSupplierId}
            startAdding={startAddingSupplier}
          />
        ) : <DeferredPanelContent key={tab}>{tab === "personal-ai" ? (
          <PersonalAiSettings targetConnectionId={targetConnectionId} startAdding={startAddingAccount} />
        ) : tab === "cloud" ? (
          <CloudGenerationSettings />
        ) : (
          <ReferenceChannelSettings />
        )}</DeferredPanelContent>}
        </div>
      </section>
    </div>
  );
}
