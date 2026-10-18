import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ModelDescriptor, StructuredPriceTier } from "@super-canvas/providers";
import { ModelPicker } from "../../components/model-picker";
import { ModelPriceDetails } from "../../components/model-price-details";
import { SupplierModelRow } from "../../components/supplier-manager";
import { modelPickerInventoryFact } from "../../lib/model-picker-data";
import "../../app/globals.css";
import "../../app/studio-theme.css";
import "../../app/canvas-studio.css";
import "../../app/theme-tokens.css";
import "../../components/neural-tokens.css";

const tier = (series: string, size: string | undefined, quality: string | undefined, price: number): StructuredPriceTier => ({
  id: [series, size, quality].filter(Boolean).join("-"), label: [series, size, quality].filter(Boolean).join(" "), price,
  conditionMode: "all", conditions: [{ parameter: "series", operator: "equals", value: series },
    ...(size ? [{ parameter: "tier", operator: "equals" as const, value: size }] : []),
    ...(quality ? [{ parameter: "quality", operator: "equals" as const, value: quality }] : [])],
});
const tiers = ["flare", "sunburst"].flatMap(series => ["4k", "2k", "1k"].flatMap((size, index) => [
  tier(series, size, "xhigh", .44 - index * .04), tier(series, size, "max", .44 - index * .04), tier(series, size, undefined, .22 - index * .02),
]));
tiers.push(tier("flare", undefined, undefined, .025), tier("sunburst", undefined, undefined, .025));
const image: ModelDescriptor = {
  id: "gpt-image-2.5", name: "gpt-image-2.5", operations: ["image.generate", "image.edit"], inputKinds: ["text", "image"], outputKinds: ["image"],
  parameters: [
    { key: "series", label: "系列", control: "text" }, { key: "tier", label: "档位", control: "text" }, { key: "quality", label: "质量", control: "text" },
  ], pricing: { kind: "per-image", currency: "CNY", confidence: "exact", tiers, checkedAt: "2026-10-17T08:00:00Z", sourceUrl: "https://offline.invalid/pricing" },
  metadata: { canvasRunnable: true, protocol: "openai-images", endpointPath: "/v1/images/generations" },
};
const alternate: ModelDescriptor = { ...image, id: "comparison-image", name: "候选图片型号", pricing: { ...image.pricing!, tiers: tiers.map(item => ({ ...item, price: item.price * 10 })) } };
const flat: ModelDescriptor = { ...image, id: "single-price-image", name: "单价图片型号", pricing: { ...image.pricing!, unitAmount: .18, tiers: [] } };
const missing: ModelDescriptor = { ...image, id: "no-price-image", name: "空价格图片型号", pricing: undefined };
const token: ModelDescriptor = { ...image, id: "token-model", name: "Token 型号", operations: [], inputKinds: ["text"], outputKinds: ["text"], pricing: {
  kind: "token", currency: "USD", confidence: "snapshot", inputPerMillion: 2, outputPerMillion: 8, imageOutputPerMillion: 32, checkedAt: "2026-10-17T08:00:00Z",
} };

function Fixture() {
  const query = new URLSearchParams(location.search);
  const width = Number(query.get("width") ?? 640), many = query.get("many") === "1", view = query.get("view") ?? "menu";
  const protocol = query.get("longIdentifiers") === "1" ? "openai-compatible-image-generation-with-an-extra-long-protocol-token" : "openai-images";
  const endpoint = query.get("longIdentifiers") === "1" ? "/v1/images/generations/super_long_endpoint_segment_that_must_not_break_inside_the_word" : "/v1/images/generations";
  const panelModel = query.get("rawTier") === "1" ? { ...image, parameters: image.parameters!.map(parameter => parameter.key === "tier" ? { ...parameter, label: "tier" } : parameter) } : image;
  const [value, setValue] = useState(image.id);
  const models = [image, alternate, flat, missing, ...(many ? Array.from({ length: 40 }, (_, index) => ({ ...flat, id: `extra-image-${index}`, name: `额外图片型号 ${index}` })) : [])];
  return <main style={{ width, margin: 24, color: "var(--text)", fontFamily: "var(--font-ui)" }}>
    <section style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-floating)" }}>
      {view === "menu" ? <ModelPicker label="离线图片模型" connectionId="offline" models={models} value={value} onChange={setValue}
        catalogDirectory={{ catalogCount: 32, keyCount: 32, sharedCount: 32, catalogOnlyIds: [], keyOnlyIds: [], models: [], keyConfirmed: true, catalogStale: false }} />
        : view === "supplier" ? <div className="sm-model-items">{[image, token].map(model => <SupplierModelRow key={model.id} model={{ id: model.id, name: model.name, capability: model === token ? "other" : "image", descriptor: model, availability: { ...modelPickerInventoryFact(model, "live", true), facts: [{ label: "扫描状态", value: "live" }, { label: "完整目录", value: "true" }, { label: "协议", value: protocol, identifier: "token" }, { label: "提交接口", value: endpoint, identifier: "path" }] } }} />)}</div>
          : <ModelPriceDetails model={panelModel} parameters={{ series: "flare", tier: "4k", quality: "max", n: 1 }} />}
      <output aria-label="已选择型号">{value}</output>
    </section>
  </main>;
}

document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") ?? "light";
createRoot(document.getElementById("root")!).render(<Fixture />);

