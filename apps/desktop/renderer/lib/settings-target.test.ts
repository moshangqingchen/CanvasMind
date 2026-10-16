import { describe, expect, it } from "vitest";
import { initialSettingsSection, settingsAccountTarget, settingsSupplierTarget } from "./settings-target";

describe("settings navigation targets", () => {
  it("opens the requested section and infers personal accounts only when appropriate", () => {
    expect(initialSettingsSection()).toBe("suppliers");
    expect(initialSettingsSection(undefined, "account-2")).toBe("personal-ai");
    expect(initialSettingsSection(undefined, null, true)).toBe("personal-ai");
    expect(initialSettingsSection("appearance", "account-2")).toBe("appearance");
  });

  it("resolves stable supplier records and legacy keys without changing the inventory", () => {
    const entries = Object.freeze([
      Object.freeze({ id: "supplier-1", supplierKey: "first" }),
      Object.freeze({ id: "supplier-2", supplierKey: "second" }),
      Object.freeze({ id: "template:cangyuan", supplierKey: "cangyuan" }),
    ]);
    expect(settingsSupplierTarget(entries, "supplier-2")).toBe(entries[1]);
    expect(settingsSupplierTarget(entries, "second")).toBe(entries[1]);
    expect(settingsSupplierTarget(entries, "template:cangyuan")).toBe(entries[2]);
    expect(settingsSupplierTarget(entries, "", "group-a")).toBe(entries[2]);
    expect(settingsSupplierTarget(entries, "missing")).toBe(entries[0]);
    expect(settingsSupplierTarget([], "missing")).toBeUndefined();
  });

  it("selects only personal website connections and lets the add flow stay empty", () => {
    const connections = Object.freeze([
      Object.freeze({ id: "provider-1", provider: "openai" }),
      Object.freeze({ id: "account-1", provider: "cli" }),
      Object.freeze({ id: "account-2", provider: "cli" }),
    ]);
    expect(settingsAccountTarget(connections, "account-2")).toBe(connections[2]);
    expect(settingsAccountTarget(connections, "provider-1")).toBe(connections[1]);
    expect(settingsAccountTarget(connections, "missing")).toBe(connections[1]);
    expect(settingsAccountTarget(connections, "account-2", true)).toBeUndefined();
    expect(settingsAccountTarget([], "account-2")).toBeUndefined();
  });
});
