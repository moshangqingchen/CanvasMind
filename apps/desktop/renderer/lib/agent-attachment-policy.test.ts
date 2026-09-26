import { describe, expect, it } from "vitest";
import { agentAttachmentError, selectAgentAttachments } from "./agent-attachment-policy";

const asset = (id: string, kind = "image", size = 1) => ({ id, kind, size });
const model = { capabilities: { imageInput: true, audioInput: true, videoInput: true }, inputLimits: { maxImages: 2, maxVideos: 1, maxAudios: 1, maxAssets: 3 } };
describe("agent attachment inputs", () => {
  it("enforces declared per-kind and combined counts before a model call", () => {
    expect(agentAttachmentError([asset("a"), asset("b"), asset("c")], model)).toContain("2 个图片");
    expect(agentAttachmentError([asset("a", "video"), asset("b", "video")], model)).toContain("1 个视频");
    expect(agentAttachmentError([asset("a", "audio"), asset("b", "audio")], model)).toContain("1 个音频");
    expect(agentAttachmentError([asset("a"), asset("b"), asset("c", "audio"), asset("d", "video")], model)).toContain("3 个附件");
    expect(agentAttachmentError([asset("a"), asset("c", "audio"), asset("d", "video")], model)).toBeUndefined();
  });
  it("does not invent provider counts when undocumented, while keeping app budgets", () => {
    const unspecified = { capabilities: model.capabilities };
    expect(agentAttachmentError(Array.from({ length: 16 }, (_, i) => asset(String(i))), unspecified)).toBeUndefined();
    expect(agentAttachmentError(Array.from({ length: 17 }, (_, i) => asset(String(i))), unspecified)).toContain("本应用");
    expect(agentAttachmentError([asset("big", "image", 17 * 1024 * 1024)], unspecified)).toContain("16 MB");
    expect(agentAttachmentError([asset("a", "video", 13 * 1024 * 1024), asset("b", "audio", 13 * 1024 * 1024)], unspecified)).toContain("24 MB");
  });
  it("never drops current attachments and returns omitted history IDs", () => {
    const result = selectAgentAttachments([asset("new"), asset("new")], [asset("oldest"), asset("recent")], model);
    expect(result.selected.map(a => a.id)).toEqual(["new", "recent"]);
    expect(result.omitted).toEqual(["oldest"]);
    expect(() => selectAgentAttachments([asset("a"), asset("b"), asset("c")], [], model)).toThrow("2 个图片");
  });
  it("rejects unsupported audio, but allows explicit image helper and text-only flows", () => {
    const text = { capabilities: { imageInput: false, videoInput: false, audioInput: false }, inputLimits: { maxAssets: 0 } };
    expect(agentAttachmentError([asset("a", "audio")], text)).toContain("不支持音频");
    expect(agentAttachmentError([asset("a")], text)).toBeUndefined();
    expect(agentAttachmentError([asset("a"), asset("b"), asset("c")], text, model)).toContain("2 个图片");
    expect(agentAttachmentError([asset("a")], text, model)).toBeUndefined();
  });
});
