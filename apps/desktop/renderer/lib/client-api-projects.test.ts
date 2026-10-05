import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProjects } from "./client-api";

afterEach(() => vi.unstubAllGlobals());

describe("project list responses", () => {
  it.each([null, {}, { projects: null }, { projects: {} }])(
    "rejects a malformed success payload instead of showing an empty project library: %j",
    async (payload) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      await expect(fetchProjects()).rejects.toThrow("项目列表返回格式无效");
    },
  );

  it("rejects incomplete JSON from an otherwise successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"projects":')));
    await expect(fetchProjects()).rejects.toThrow("项目列表返回格式无效");
  });

  it("accepts an authoritative empty project list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ projects: [] })));
    await expect(fetchProjects()).resolves.toEqual([]);
  });

  it("preserves server failure details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "本地项目索引不可用" }, { status: 503 })));
    await expect(fetchProjects()).rejects.toThrow("本地项目索引不可用");
  });
});
