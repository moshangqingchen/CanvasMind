"use client";
import { useCallback, useState } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import {
  SettingsDraftGuardProvider,
  useSettingsLeaveGuard,
} from "./settings-draft-guard";
import type { ProviderConnectionView } from "../lib/client-api";
import { SupplierManager } from "./supplier-manager";
import { PersonalAiSettings } from "./personal-ai-settings";
import { ReferenceChannelSettings } from "./reference-channel-settings";
import { CloudGenerationSettings } from "./cloud-generation-settings";
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
  const [tab, setTab] = useState<
    "suppliers" | "reference" | "personal-ai" | "cloud"
  >("suppliers");

  const [, setConnections] = useState<ProviderConnectionView[]>([]);
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
            <button
              type="button"
              role="tab"
              aria-selected={tab === "suppliers"}
              aria-controls="sm-suppliers-panel"
              onClick={() => changeTab("suppliers")}
            >
              供应商与模型
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "personal-ai"}
              aria-controls="sm-personal-ai-panel"
              onClick={() => changeTab("personal-ai")}
            >
              个人 AI 网站
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "reference"}
              aria-controls="sm-reference-panel"
              onClick={() => changeTab("reference")}
            >
              素材通道
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "cloud"}
              aria-controls="sm-cloud-panel"
              onClick={() => changeTab("cloud")}
            >
              云端生图
            </button>
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
            onConnectionsChanged={setConnections}
          />
        ) : tab === "personal-ai" ? (
          <PersonalAiSettings onConnectionsChanged={setConnections} />
        ) : tab === "cloud" ? (
          <CloudGenerationSettings />
        ) : (
          <ReferenceChannelSettings />
        )}
      </section>
    </div>
  );
}
