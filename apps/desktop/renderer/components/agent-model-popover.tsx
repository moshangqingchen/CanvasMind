"use client";
import { useState } from "react";
import { Check, Plug, RefreshCw, Search } from "lucide-react";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { AgentModelOption } from "../lib/agent-models";
import { modelPickerPriceCompact } from "../lib/model-picker-data";
import { groupTk1688Models, tk1688ModelFamily, tk1688RouteLabel, tk1688RouteSummary } from "../lib/tk1688-model-display";
import { tk1688TextModelPrice } from "./tk1688-text-model-select";
import { AgentPopover } from "./agent-popover";
import styles from "./creative-agent-panel.module.css";

const keyOf = (model: AgentModelOption) => `${model.connectionId}\n${model.modelId}`;
const descriptor = (model: AgentModelOption) => ({ id: model.modelId, name: model.modelName, metadata: model.metadata, pricing: model.pricing });
export function AgentModelPopover({ models, selected, busy, reasoning, reasoningNotes, tk1688, onSelect, onReasoning, onRefresh, onManage, onClose }: {
  models: AgentModelOption[]; selected?: AgentModelOption; busy: boolean; reasoning: string; reasoningNotes: string[]; tk1688: boolean;
  onSelect: (model: AgentModelOption) => void; onReasoning: (value: string) => void; onRefresh: () => void; onManage: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const matching = models.filter(model => [model.supplierName, model.group, model.connectionName, model.modelId, model.modelName].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const suppliers = [...new Map(matching.map(model => [model.supplierId, model.supplierName])).entries()];
  const current = selected && descriptor(selected);
  const options = selected?.reasoningOptions ?? [{ value: "auto", label: "自动" }];
  const reasoningDetail = selected?.reasoningSource === "provider-catalog" && selected.reasoningNotice === "由已保存的供应商目录声明，未触发检测。" ? undefined : selected?.reasoningNotice;
  const modelButton = (model: AgentModelOption, route = false) => <button type="button" data-choice data-model-key={keyOf(model)} key={keyOf(model)} disabled={busy || !model.available} aria-pressed={Boolean(selected && keyOf(model) === keyOf(selected))} onClick={() => onSelect(model)} title={model.reason ?? model.modelId}>
    <span><strong>{route ? tk1688RouteLabel(descriptor(model)) ?? "已保存线路" : model.modelName}</strong><code>{model.modelId}</code><small>{!model.available ? model.reason : route ? tk1688RouteSummary(descriptor(model)) : modelPickerPriceCompact(descriptor(model) as ModelDescriptor)}</small></span>{selected && keyOf(model) === keyOf(selected) && <Check size={14} />}
  </button>;
  return <AgentPopover label="选择对话模型" position="bottom" onClose={onClose}>
    <label className={styles.popoverSearch}><Search size={14} /><input type="search" aria-label="搜索对话模型" placeholder="供应商、分组或完整型号…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className={styles.modelTree} aria-label="供应商与模型目录">
      {!suppliers.length && <p>没有匹配的已保存型号。</p>}
      {suppliers.map(([id, name]) => <details key={id} open={query || id === selected?.supplierId ? true : undefined} data-supplier-id={id}>
        <summary>{name}<small>供应商 SUPPLIER</small></summary>
        {[...new Set(matching.filter(model => model.supplierId === id).map(model => model.group))].map(group => <details key={group} open={query || group === selected?.group ? true : undefined} data-model-group={group}>
          <summary>{group}<small>分组 GROUP</small></summary>
          {[...new Map(matching.filter(model => model.supplierId === id && model.group === group).map(model => [model.connectionId, model.connectionName])).entries()].map(([connectionId, connectionName]) => {
            const items = matching.filter(model => model.supplierId === id && model.group === group && model.connectionId === connectionId);
            const isTk = items.some(model => model.supplierKey === "tk1688" || model.metadata?.tk1688Catalog === true) || (tk1688 && connectionId === selected?.connectionId);
            const descriptors = items.map(model => ({ ...descriptor(model), available: model.available }));
            const families = groupTk1688Models(descriptors);
            const assigned = new Set(families.flatMap(family => family.models.map(model => model.id)));
            for (const model of descriptors) if (!assigned.has(model.id)) families.push({ id: model.id, models: [model], merchants: [] });
            const currentFamily = current && (tk1688ModelFamily(current) ?? current.id);
            return <div className={styles.modelConnection} key={connectionId} data-connection-id={connectionId}>
              <small>{connectionName}</small>
              {isTk ? <div className={styles.routeFamilies} aria-label="智能体模型与线路">
                <div className={styles.familyList} aria-label="智能体模型">{families.map(family => <button type="button" data-choice data-model-family={family.id} key={family.id} aria-pressed={currentFamily === family.id} disabled={busy || family.models.every(model => model.available === false)} onClick={() => {
                  const next = (family.smart?.available !== false ? family.smart : undefined) ?? family.models.find(model => model.available !== false);
                  const found = items.find(model => model.modelId === next?.id); if (found) onSelect(found);
                }}>{family.id}</button>)}</div>
                {families.filter(family => family.id === currentFamily).flatMap(family => family.models.map(model => items.find(item => item.modelId === model.id)).filter((model): model is AgentModelOption => Boolean(model)).map(model => modelButton(model, true)))}
              </div> : items.map(model => modelButton(model))}
            </div>;
          })}
        </details>)}
      </details>)}
    </div>
    {selected && <div className={styles.modelFacts}>
      <strong>{selected.supplierName} / {selected.group}</strong><code aria-label="完整模型 ID">{selected.modelId}</code>
      {selected.description && <small>{selected.description}</small>}
      {tk1688 && current && <p aria-label="智能体模型报价">{tk1688TextModelPrice(current)}</p>}
      {!selected.available && <p role="status">{selected.reason}</p>}
      <div role="group" aria-label="思考强度" className={styles.reasoningSegments}><span>思考 <small>REASONING</small></span>{options.map(option => <button type="button" key={option.value} data-choice data-reasoning={option.value} aria-pressed={reasoning === option.value} disabled={busy || !selected.available} onClick={() => onReasoning(option.value)}>{option.label}</button>)}</div>
      {options.length === 1 && <small aria-label="思考档位说明">{selected.reasoningNotice ? "思考强度：自动（资料待补充）" : selected.reasoningSource && selected.reasoningSource !== "unknown" ? "思考强度：自动（无可选档位）" : "思考强度：自动（待识别）"}</small>}
      {reasoningNotes.filter(note => note !== selected.reasoningNotice).map(note => <small key={note}>{note}</small>)}
      <p className={styles.capabilities} aria-label="模型参考素材支持">{([
        ["图片", "imageInput", "maxImages", "张"], ["视频", "videoInput", "maxVideos", "个"], ["音频", "audioInput", "maxAudios", "个"],
      ] as const).map(([name, capability, limit, unit]) => <span key={name}>{name} {selected.capabilities[capability] ? `✓${selected.inputLimits?.[limit] === undefined ? "" : ` 最多 ${selected.inputLimits[limit]} ${unit}`}` : "—"}</span>)}</p>
      <details className={styles.modelDetails} aria-label="模型素材与思考详情">
        <summary>详情</summary>
        {reasoningDetail && <small>{reasoningDetail}</small>}
        {selected.capabilities.imageInput && selected.imageInputStatus === "assumed" && <small>图片支持来自应用默认设置。</small>}
        {([
          ["图片", "imageInput", "maxImages"], ["视频", "videoInput", "maxVideos"], ["音频", "audioInput", "maxAudios"],
        ] as const).filter(([, capability, limit]) => selected.capabilities[capability] && selected.inputLimits?.[limit] === undefined).map(([name]) => <small key={name}>供应商未注明{name}数量。</small>)}
        <small>每轮最多 16 个附件，单个 16 MB，总计 24 MB，含所选节点素材。{selected.inputLimits?.maxAssets !== undefined && `供应商每轮最多 ${selected.inputLimits.maxAssets} 个附件。`}</small>
      </details>
    </div>}
    <div className={styles.popoverFooter}><button type="button" className={styles.ghost} disabled={busy} onClick={onRefresh}><RefreshCw size={13} />刷新模型列表</button><button type="button" className={styles.ghost} onClick={onManage}><Plug size={13} />管理供应商与模型</button></div>
  </AgentPopover>;
}
