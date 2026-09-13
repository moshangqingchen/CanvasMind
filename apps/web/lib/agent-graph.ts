import {
  compileDirectorGraphPatch,
  type DirectorGraphPatch,
  type RoutedDirectorCall,
} from "@super-canvas/director";
import type { AssetRecord, JsonObject } from "@super-canvas/db";
import {
  CanvasGraphSchema,
  validateCanvasGraphSemantics,
} from "./api-validation";
import type { AgentProposal } from "./agent-contracts";

export function compileAgentGraph(
  id: string,
  proposal: AgentProposal,
  calls: RoutedDirectorCall[],
  graph: JsonObject,
  assets: AssetRecord[],
): DirectorGraphPatch {
  const canvas = CanvasGraphSchema.parse(graph);
  let seq = 0;
  const makeId = (kind: string) => `agent-${id}-${kind}-${seq++}`;
  const origin = {
    x: Math.max(0, ...canvas.nodes.map((n) => (n.position?.x ?? 0) + 500)),
    y: 100,
  };
  const compiled = calls.length
    ? compileDirectorGraphPatch(calls, {
        proposalId: id,
        draft: false,
        origin,
        idFactory: makeId,
      })
    : {
        nodes: [],
        edges: [],
        generationNodeIds: [],
        touchedExistingNodeIds: [],
      };
  const nodes = [...compiled.nodes];
  const edges = [...compiled.edges];
  const touched: string[] = [];
  const sourceNodes = new Map<string, string>();
  for (const call of proposal.calls) {
    const target = nodes.find(
      (n) => n.data.directorCallId === call.id && n.data.nodeType !== "prompt",
    );
    if (!target) continue;
    for (const [index, assetId] of call.sourceAssetIds.entries()) {
      const asset = assets.find((a) => a.id === assetId && !a.deleted);
      if (!asset || asset.kind === "text")
        throw new Error("方案引用的素材不存在或不可用");
      const routed = calls.find((c) => c.id === call.id);
      if (
        !routed?.selected?.candidate.model.inputKinds?.some(
          (k) => k === asset.kind || k === `${asset.kind}[]`,
        )
      )
        throw new Error("所选模型不支持此参考素材类型");
      let source = sourceNodes.get(assetId);
      if (!source) {
        source = makeId("asset");
        sourceNodes.set(assetId, source);
        nodes.push({
          id: source,
          type: "workflow",
          position: { x: origin.x - 460, y: 100 + sourceNodes.size * 270 },
          style: { width: 360, height: 210 },
          data: {
            nodeType: "asset-input",
            label: asset.name,
            directorDraft: false,
            directorCallId: "source",
            directorProposalId: id,
            assetId,
            assetKind: asset.kind,
            outputs: [{ id: "asset", kind: asset.kind, label: "素材" }],
          },
        });
      }
      const handle =
        asset.kind === "video"
          ? "referenceVideos"
          : asset.kind === "audio"
            ? "referenceAudios"
            : call.requirements.operation === "video.image-to-video" &&
                index === 0 &&
                !call.dependsOn?.length
              ? "firstFrame"
              : "references";
      edges.push({
        id: makeId("edge"),
        type: "smoothstep",
        source,
        sourceHandle: "asset",
        target: target.id,
        targetHandle: handle,
      });
    }
  }
  for (const [index, item] of proposal.texts.entries()) {
    const existing = item.targetNodeId
      ? canvas.nodes.find((n) => n.id === item.targetNodeId)
      : undefined;
    if (item.targetNodeId && existing?.data?.nodeType !== "prompt")
      throw new Error("只能修改明确选中的提示词节点");
    if (existing) touched.push(existing.id);
    nodes.push({
      id: existing?.id ?? makeId("text"),
      type: "workflow",
      position: existing?.position ?? {
        x: origin.x,
        y: 100 + (calls.length + index) * 290,
      },
      style: { width: 360, height: 240 },
      data: {
        ...existing?.data,
        nodeType: "prompt",
        label: item.title,
        directorDraft: false,
        directorCallId: item.id,
        directorProposalId: id,
        parts: [{ type: "text", text: item.content }],
        outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      },
    });
  }
  const updated = CanvasGraphSchema.parse({
    ...canvas,
    nodes: [...canvas.nodes.filter((n) => !touched.includes(n.id)), ...nodes],
    edges: [...canvas.edges, ...edges],
  });
  const result = validateCanvasGraphSemantics(updated);
  if (result.length) throw new Error("方案连线或节点参数无效");
  return {
    nodes,
    edges,
    generationNodeIds: [...compiled.generationNodeIds],
    touchedExistingNodeIds: touched,
  };
}
