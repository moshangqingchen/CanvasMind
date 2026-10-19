"use client";

import type { ReactNode } from "react";
import type { ModelDescriptor, ModelParameterDescriptor } from "@super-canvas/providers";
import type { GenerationNodeType } from "../lib/graph-ui";
import { videoDurationControl, videoDurationControlContext } from "../lib/video-duration-control";
import { Disclosure } from "./ui/Disclosure";

/** Domain evidence remains readable without occupying the editing hierarchy. */
export function NodeParameterSources({ model, descriptors, nodeType, nativeSources, transparencyNote }: {
  model?: ModelDescriptor | null;
  descriptors: readonly ModelParameterDescriptor[];
  nodeType: GenerationNodeType;
  nativeSources?: ReactNode;
  transparencyNote?: string | null;
}) {
  const metadata = model?.metadata;
  const contractNote = typeof metadata?.imageParameterContractNote === "string" ? metadata.imageParameterContractNote : "";
  const capabilitySummary = typeof metadata?.imageCapabilityNote === "string" ? metadata.imageCapabilityNote : "";
  // Exact transparency evidence supersedes an explicitly marked old summary,
  // while resolution, quality and concrete historical facts remain verbatim.
  const oldTransparencySummary = /^(?:旧|历史)\s*(?:透明|transparen(?:t|cy)|alpha)\s*(?:失败|不支持|不透明)\s*(?:摘要|结论)[。；;\s]*$/iu;
  const capabilityNote = transparencyNote ? capabilitySummary.split(/(?<=[。；;\n])/u)
    .filter(part => !oldTransparencySummary.test(part.trim())).join("") : capabilitySummary;
  const groupLabel = typeof metadata?.supplierGroupResolutionLabel === "string" ? metadata.supplierGroupResolutionLabel : "";
  const groupDescription = typeof metadata?.supplierGroupDescription === "string" ? metadata.supplierGroupDescription : "";
  const fieldSources = [...new Map([...(model?.parameters ?? []), ...descriptors]
    .filter(descriptor => descriptor.description).map(descriptor => [descriptor.key, descriptor])).values()];
  const durationSources = descriptors.flatMap(descriptor => {
    const context = videoDurationControlContext(model, descriptor.key);
    const control = context.userFallbackRange ? videoDurationControl(nodeType, descriptor, descriptor.default, false, false, context) : undefined;
    return control?.kind === "range" ? [`用户兜底范围：${control.min}–${control.max} 秒。供应商未公布完整范围；已公布的限制仍优先适用。`] : [];
  });
  if (!contractNote && !capabilityNote && !groupLabel && !groupDescription && !fieldSources.length && !nativeSources && !durationSources.length && !transparencyNote) return null;
  return <Disclosure label="参数与来源" className="parameter-sources">
    {contractNote && <p>{contractNote}</p>}
    {capabilityNote && <p>实测说明：{capabilityNote}</p>}
    {groupLabel && <p title={groupDescription || undefined}>分组说明：{groupLabel}{metadata?.supplierGroupInfoStale ? "（上次记录）" : ""}</p>}
    {groupDescription && <p>{groupDescription}</p>}
    {nativeSources}
    {durationSources.map(note => <p key={note}>{note}</p>)}
    {fieldSources.map(descriptor => <p key={descriptor.key}><strong>{descriptor.label}：</strong>{descriptor.description}</p>)}
    {transparencyNote && <p aria-label="透明模式依据">{transparencyNote}</p>}
  </Disclosure>;
}
