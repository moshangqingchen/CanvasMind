import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { choosePickerConnection, filterPickerModels, pickerConnectionGroups, pickerConnectionLabel, readRecentModels, rememberModel } from "./model-picker";

const connections = [
  { id: "a", name: "主连接", supplier: "supplier", supplierLabel: "供应商", group: "标准", available: true },
  { id: "b", name: "失效连接", supplier: "supplier", supplierLabel: "供应商", group: "标准", available: false },
  { id: "c", name: "另一供应商", supplier: "other", supplierLabel: "其他", group: "标准", available: true },
];
const models: ModelDescriptor[] = [
  { id: "gpt-2", name: "图像模型（¥0.1/张）", operations: ["image.generate"], metadata: { priceLabel: "¥0.1/张", imageCapabilitiesVerifiedAt: "2026-09-22" } },
  { id: "gpt-3", name: "图像模型", operations: ["image.generate"], metadata: { canvasRunnable: false, canvasUnavailableReason: "未适配" } },
  { id: "video-1", name: "视频", operations: ["video.generate"], metadata: { canvasRunnable: true } },
];

describe("connection identity in the canvas picker", () => {
  it("labels distinct connections by name and adds only enough ID to distinguish identical names", () => {
    expect(pickerConnectionLabel(connections[0], connections)).toBe("主连接");
    const peers = [
      { ...connections[0], id: "12345678-a-unique", name: "同名账号" },
      { ...connections[1], id: "87654321-b-unique", name: "同名账号" },
    ];
    expect(pickerConnectionLabel(peers[0], peers)).toBe("同名账号 · 12345678");
    peers[1].id = "12345678-b-unique";
    expect(pickerConnectionLabel(peers[0], peers)).toBe("同名账号 · 12345678-a");
  });
  it("keeps every same-group connection and uses any usable connection for group availability", () => {
    const groups = pickerConnectionGroups(connections, "supplier");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ available: true, connections: [connections[0], connections[1]] });
    expect(pickerConnectionGroups([...connections].reverse(), "supplier")[0]?.available).toBe(true);
  });
  it("preserves the selected unavailable connection instead of silently choosing its usable peer", () => {
    expect(choosePickerConnection(connections, "b", "supplier", "标准")?.id).toBe("b");
    expect(choosePickerConnection(connections, "c", "supplier", "标准")?.id).toBe("a");
    expect(choosePickerConnection(connections, "a", "other", "标准")?.id).toBe("c");
    expect(choosePickerConnection(connections, "a", "missing")).toBeUndefined();
  });
  it("compares another supplier using a usable exact-model group instead of its first unrelated group", () => {
    const groups = [
      { ...connections[0], id: "flow", group: "flow", modelMatch: false },
      { ...connections[0], id: "locked-token", group: "官方 token", available: false, modelMatch: true },
      { ...connections[0], id: "official-token", group: "官方 token", modelMatch: true },
      connections[2],
    ];
    expect(choosePickerConnection(groups, "c", "supplier")?.id).toBe("official-token");
    expect(choosePickerConnection(groups, "c", "supplier", "flow")?.id).toBe("flow");
    expect(choosePickerConnection(groups, "flow", "supplier")?.id).toBe("flow");
    expect(choosePickerConnection(groups, "locked-token", "supplier")?.id).toBe("locked-token");
  });
  it("falls back to a usable group when the exact model is absent or unknown, without crossing suppliers", () => {
    const groups = [
      { ...connections[1], id: "inactive-match", modelMatch: true },
      { ...connections[0], id: "other-model", modelMatch: false },
      { ...connections[2], modelMatch: true },
    ];
    expect(choosePickerConnection(groups, "c", "supplier")?.id).toBe("other-model");
    expect(choosePickerConnection(connections, "c", "supplier")?.id).toBe("a");
    expect(choosePickerConnection(groups.filter(item => item.available === false), "c", "supplier")?.id).toBe("inactive-match");
  });
});

describe("model search and history", () => {
  it("uses output facts for node type filters including music, irrespective of stale operations", () => {
    const mixed: ModelDescriptor[] = [
      { id: "video-image-to-video", name: "视频", operations: ["image.generate"], outputKinds: ["video"], metadata: { operationsSource: "inferred" } },
      { id: "vision", name: "图片理解", operations: [], inputKinds: ["image"], outputKinds: ["text"] },
      { id: "tts-1", name: "语音", operations: [], outputKinds: ["audio"] },
      { id: "lyria-3-pro", name: "音乐", operations: ["music.generate"], outputKinds: ["audio"] },
    ];
    expect(filterPickerModels(mixed, "", "image", "all", [])).toEqual([]);
    expect(filterPickerModels(mixed, "", "video", "all", []).map(model => model.id)).toEqual(["video-image-to-video"]);
    expect(filterPickerModels(mixed, "", "music", "all", []).map(model => model.id)).toEqual(["lyria-3-pro"]);
  });
  it("searches display names and exact ID fragments with normalization and multiple terms", () => {
    expect(filterPickerModels(models, "ＧＰＴ 图像 2", "all", "all", []).map(model => model.id)).toEqual(["gpt-2"]);
    expect(filterPickerModels(models, "图像", "all", "all", [])).toHaveLength(2);
    expect(filterPickerModels(models, "", "video", "all", []).map(model => model.id)).toEqual(["video-1"]);
  });
  it("does not mistake an adapted protocol or declared capability for a paid verification", () => {
    expect(filterPickerModels(models, "", "all", "runnable", []).map(model => model.id)).toEqual(["gpt-2", "video-1"]);
    expect(filterPickerModels(models, "", "all", "verified", []).map(model => model.id)).toEqual(["gpt-2"]);
  });
  it("isolates recent IDs by real connection and excludes models removed from that catalog", () => {
    const saved = rememberModel(rememberModel([], "connection-a", "gpt-2"), "connection-b", "video-1");
    expect(saved.find(item => item.connectionId === "connection-a")?.modelIds).toEqual(["gpt-2"]);
    expect(filterPickerModels(models, "", "all", "recent", ["removed", "video-1", "gpt-2"]).map(model => model.id)).toEqual(["video-1", "gpt-2"]);
    expect(rememberModel(saved, "connection-a", "gpt-2")[0]?.modelIds).toEqual(["gpt-2"]);
  });
  it("bounds storage and tolerates invalid or unavailable browser storage", () => {
    let recent = rememberModel([], "connection-a", "model-0");
    for (let i = 1; i < 20; i++) recent = rememberModel(recent, "connection-a", `model-${i}`);
    expect(recent[0]?.modelIds).toHaveLength(8);
    expect(readRecentModels("not JSON")).toEqual([]);
    expect(readRecentModels(JSON.stringify([{ connectionId: "a", modelIds: ["one", "one", null, 12], apiKey: "must-not-copy" }]))).toEqual([{ connectionId: "a", modelIds: ["one"] }]);
  });
});
