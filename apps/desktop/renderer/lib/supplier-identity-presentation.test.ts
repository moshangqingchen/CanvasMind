import { describe, expect, it } from "vitest";
import { supplierIdentityPresentation } from "./supplier-identity-presentation";

describe("supplier identity presentation", () => {
  it("keeps colors tied to the supplier name through filtering and ordering", () => {
    const names = ["主供应商", "备用供应商", "Example API", "🧪 隔离测试"];
    const initial = new Map(names.map(name => [name, supplierIdentityPresentation(name)]));
    for (const name of [...names].reverse()) {
      expect(supplierIdentityPresentation(name)).toEqual(initial.get(name));
    }
    expect(supplierIdentityPresentation(" 主供应商 ")).toEqual(initial.get("主供应商"));
  });

  it("shows a complete leading Unicode character and handles blank display names", () => {
    expect(supplierIdentityPresentation("🧪 隔离测试").initial).toBe("🧪");
    expect(supplierIdentityPresentation("中文名称").initial).toBe("中");
    expect(supplierIdentityPresentation(" ").initial).toBe("供");
  });
});
