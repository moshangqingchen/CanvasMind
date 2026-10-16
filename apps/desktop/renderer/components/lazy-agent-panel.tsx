"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { DynamicPanelLoading, WarmPanelBoundary } from "./panel-loading";
import { createPanelModulePreloader } from "../lib/panel-preload";

type AgentPanelProps = ComponentProps<typeof import("./creative-agent-panel").AgentPanel>;
/** Download/evaluate code only; this never mounts Agent or starts its polling. */
export const preloadAgentPanel = createPanelModulePreloader(() => import("./creative-agent-panel"));
const LoadedAgentPanel = dynamic<AgentPanelProps>(
  () => import("./creative-agent-panel").then(module => module.AgentPanel),
  { ssr: false, loading: DynamicPanelLoading },
);

export function AgentPanel({ visible = true, ...props }: AgentPanelProps & { visible?: boolean }) {
  return <WarmPanelBoundary open={visible} title="创作助手" dialogLabel="通用创作智能体" mode="panel" onClose={props.onClose}>
    <LoadedAgentPanel {...props} />
  </WarmPanelBoundary>;
}
