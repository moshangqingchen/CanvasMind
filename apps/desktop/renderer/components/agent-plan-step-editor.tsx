"use client";

import { useMemo, useState } from "react";
import type { RoutedDirectorCall, DirectorCatalogCandidate } from "@super-canvas/director";
import type { AgentProposal } from "../lib/agent-contracts";
import type { ProviderConnectionView } from "../lib/client-api";
import { agentCallParameters, agentNodeType, agentParameterIssues, agentRequirementsForParameters, scalarAgentParameters, switchAgentChannel } from "../lib/agent-plan-parameters";
import { ModelPicker } from "./model-picker";
import { NodeParameterFields } from "./node-parameter-fields";
import { ModelResolutionShortcuts } from "./model-resolution-shortcuts";
import { ModelPriceDetails } from "./model-price-details";
import { AgentCatalogNotice } from "./agent-catalog-notice";
import type { AgentCatalogConnection } from "../lib/agent-catalog-status";
import styles from "./creative-agent-panel.module.css";

type Call = AgentProposal["calls"][number];
export function AgentPlanStepEditor({ call, route, connections, catalogConnections, disabled, onManage, onChange }: {
  call: Call; route?: RoutedDirectorCall; connections: readonly ProviderConnectionView[];
  catalogConnections: readonly AgentCatalogConnection[];
  onManage: (connectionId: string) => void;
  disabled: boolean; onChange: (call: Call) => void;
}) {
  const [notice, setNotice] = useState("");
  const candidates = useMemo(() => (route?.alternatives ?? []).map(option => option.candidate).filter(candidate =>
    candidate.connectionActive !== false && candidate.credentialUsable !== false && candidate.model.operations.includes(call.requirements.operation)), [route, call.requirements.operation]);
  const selected = candidates.find(candidate => candidate.connectionId === call.preferredConnectionId && candidate.model.id === call.preferredModelId) ?? route?.selected?.candidate;
  const supplier = (candidate: DirectorCatalogCandidate) => {
    const connection = connections.find(item => item.id === candidate.connectionId);
    return String(connection?.config.supplierId ?? `${candidate.provider}:${candidate.supplier}`);
  };
  const supplierName = (candidate: DirectorCatalogCandidate) => {
    const connection = connections.find(item => item.id === candidate.connectionId);
    return String(connection?.config.supplierName ?? candidate.connectionName.split(" · ")[0] ?? candidate.supplier);
  };
  const supplierId = selected ? supplier(selected) : candidates[0] ? supplier(candidates[0]) : "";
  const suppliers = [...new Map(candidates.map(candidate => [supplier(candidate), supplierName(candidate)])).entries()];
  const supplierCandidates = candidates.filter(candidate => supplier(candidate) === supplierId);
  const group = selected?.group ?? supplierCandidates[0]?.group ?? "默认分组";
  const groups = [...new Set(supplierCandidates.map(candidate => candidate.group ?? "默认分组"))];
  const groupCandidates = supplierCandidates.filter(candidate => (candidate.group ?? "默认分组") === group);
  const connectionId = selected?.connectionId ?? groupCandidates[0]?.connectionId ?? "";
  const channelConnections = [...new Map(groupCandidates.map(candidate => [candidate.connectionId, candidate.connectionName])).entries()];
  const models = groupCandidates.filter(candidate => candidate.connectionId === connectionId).map(candidate => candidate.model);
  const parameters = selected ? agentCallParameters(call.requirements, selected, call.parameters) : call.parameters ?? {};
  const issues = selected ? agentParameterIssues(call.requirements, selected, parameters) : [];
  const updateParameters = (next: Record<string, unknown>) => {
    if (!selected) return;
    const values = scalarAgentParameters(next);
    onChange({ ...call, parameters: values, preferredConnectionId: selected.connectionId, preferredModelId: selected.model.id,
      requirements: agentRequirementsForParameters(call.requirements, values, selected.model) as Call["requirements"] });
  };
  const choose = (candidate?: DirectorCatalogCandidate) => {
    if (!candidate) return;
    const result = switchAgentChannel(call.requirements, parameters, candidate);
    setNotice(result.changedKeys.length ? `已切换渠道。${result.changedKeys.map(key => selected?.model.parameters?.find(descriptor => descriptor.key === key)?.label ?? key).join("、")}已按所选型号的合法默认值调整；其余合法参数已保留。请检查后保存方案。` : "已切换渠道，合法参数已保留。请检查后保存方案。");
    onChange({ ...call, preferredConnectionId: candidate.connectionId, preferredModelId: candidate.model.id,
      parameters: result.parameters, requirements: agentRequirementsForParameters(call.requirements, result.parameters, candidate.model) as Call["requirements"] });
  };
  return <fieldset className={styles.planParameters} disabled={disabled} aria-label={`${call.label} 渠道与参数`}>
    <legend>渠道与参数 <small>MODEL & PARAMETERS</small></legend>
    <AgentCatalogNotice connections={catalogConnections} onManage={onManage} />
    <div className={styles.planChannelSelectors}>
      <label>供应商<select aria-label={`${call.label} 供应商`} value={supplierId} onChange={event => choose(candidates.find(candidate => supplier(candidate) === event.target.value))}>
        {!suppliers.length && <option value="">暂无已保存的渠道目录</option>}{suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>分组<select aria-label={`${call.label} 模型群组`} value={group} onChange={event => choose(supplierCandidates.find(candidate => (candidate.group ?? "默认分组") === event.target.value))}>
        {groups.map(group => <option key={group} value={group}>{group}</option>)}
      </select></label>
      {channelConnections.length > 1 && <label>连接<select aria-label={`${call.label} API 连接`} value={connectionId} onChange={event => choose(groupCandidates.find(candidate => candidate.connectionId === event.target.value))}>
        {channelConnections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>}
    </div>
    <ModelPicker label={`${call.label} 执行模型`} connectionId={connectionId} models={models} value={selected?.model.id ?? ""} allowAutomatic={false}
      onChange={id => choose(candidates.find(candidate => candidate.connectionId === connectionId && candidate.model.id === id))} />
    {notice && <p role="status" className={styles.parameterNotice}>{notice}</p>}
    {selected && <>
      <ModelResolutionShortcuts models={models} selected={selected.model} onChange={id => choose(candidates.find(candidate => candidate.connectionId === connectionId && candidate.model.id === id))} />
      <NodeParameterFields nodeId={`agent-${call.id}`} nodeType={agentNodeType(call.requirements.operation)} provider={selected.provider} model={selected.model}
        operation={call.requirements.operation} parameters={parameters} showAdvanced={false} normalizeAutomatically={false} onChange={updateParameters} />
      {issues.length > 0 && <p role="alert" className={styles.parameterNotice}>{issues.map(issue => issue.message).join("；")}</p>}
      <ModelPriceDetails model={selected.model} parameters={{ ...parameters, prompt: call.prompt }} />
    </>}
  </fieldset>;
}
