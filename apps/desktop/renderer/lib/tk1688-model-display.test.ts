import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { groupTk1688Models, tk1688ModelFamily, tk1688RouteLabel, tk1688RouteSummary } from "./tk1688-model-display";
import { filterPickerModels } from "./model-picker";
import { supplierGroupMatchesQuery } from "./supplier-model-browser";

const base = "gpt-image-2.5-sunburst";
const route = (suffix = "", metadata: Record<string, unknown> = {}): ModelDescriptor => ({
  id: `${base}${suffix}`, name: `${base}${suffix}`, operations: ["image.generate"],
  metadata: { tk1688Catalog: true, tk1688BaseModel: base, protocol: "openai-images", ...metadata },
});

describe("词元模型与商家展示分组", () => {
  it("groups exact IDs without merging or mutating merchant contracts", () => {
    const merchant = route("@s47c261", { tk1688FixedSize: "3840x2160", tk1688OmitN: true });
    const smart = route();
    const other = { ...route("@s1c23"), metadata: {} };
    const original = JSON.stringify([merchant, smart, other]);
    const grouped = groupTk1688Models([merchant, smart, other]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ id: base, smart, merchants: [merchant], models: [smart, merchant] });
    expect(grouped[0]!.models[1]).toBe(merchant);
    expect(JSON.stringify([merchant, smart, other])).toBe(original);
    expect(tk1688ModelFamily(other)).toBeUndefined();
    expect(tk1688ModelFamily({ ...smart, id: "unrelated" })).toBeUndefined();
  });
  it("keeps merchant-only families without inventing an automatic route", () => {
    const merchant = route("@s47c261");
    expect(groupTk1688Models([merchant])[0]).toMatchObject({ models: [merchant], merchants: [merchant] });
    expect(groupTk1688Models([merchant])[0]!.smart).toBeUndefined();
    expect(tk1688RouteLabel(merchant)).toBe("商家 47 · 渠道 261");
    expect(tk1688RouteLabel(route())).toBe("自动路由");
  });
  it("distinguishes missing declarations, fixed sizes and stale evidence", () => {
    expect(tk1688RouteSummary(route("@s1c23", { tk1688SupportedResolutions: [] }))).toBe("分辨率档位未公布");
    expect(tk1688RouteSummary(route("@s47c261", { tk1688SupportedResolutions: ["4K"], tk1688FixedSize: "3840x2160",
      tk1688OmitN: true, supplierChannelDescription: "Adobe 原生4K", tk1688CatalogStale: true })))
      .toBe("固定 3840×2160 · 一次 1 张 · 商家说明：Adobe 原生4K · 上次目录，本次未确认");
    expect(tk1688RouteSummary(route())).toContain("规格和价格可能不同");
  });
  it("finds merchant descriptions through both the picker and the outer supplier search", () => {
    const merchant = route("@s55c294", { tk1688SupportedResolutions: ["1K"], supplierChannelDescription: "web 逆向渠道 默认1K 可超分" });
    const models = [route(), merchant];
    expect(filterPickerModels(models, "商家 55 超分", "all", "all", []).map(model => model.id)).toEqual([merchant.id]);
    expect(supplierGroupMatchesQuery({ id: "default", label: "default", models: [] }, [{ id: "key", provider: "openai", name: "词元",
      apiKey: "", apiKeySet: true, config: { modelGroup: "default", modelCatalogModels: models } }], "超分")).toBe(true);
  });
});
