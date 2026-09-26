import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
}));
vi.mock("../../../lib/server", () => ({
  get repository() {
    return mocks.repository;
  },
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
}));
import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";
import { DELETE as deleteGroup } from "./[id]/groups/route";
beforeEach(() => {
  mocks.repository = new MemoryRepository();
});
describe("supplier API", () => {
  it("validates group deletion and persists removal through the API", async () => {
    const created = await POST(
      new Request("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: "Site",
          siteUrl: "https://example.com",
          catalog: {
            groups: [{ id: "manual/图像", label: "Manual", models: [] }],
          },
        }),
      }),
    );
    const supplier = await created.json();
    const context = { params: Promise.resolve({ id: supplier.id }) };
    const request = (body: unknown) =>
      new Request("http://localhost/api/suppliers/id/groups", {
        method: "DELETE",
        body: JSON.stringify(body),
      });
    expect(
      (await deleteGroup(request({ groupId: "manual/图像" }), context)).status,
    ).toBe(400);
    expect(
      (
        await deleteGroup(
          request({ groupId: "manual/图像", expectedRevision: 0 }),
          context,
        )
      ).status,
    ).toBe(409);
    const deleted = await deleteGroup(
      request({
        groupId: "manual/图像",
        expectedRevision: supplier.state.revision,
      }),
      context,
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).catalog.groups).toEqual([]);
    expect((await (await GET()).json())[0].catalog.groups).toEqual([]);
  });
  it("returns only account and configured status after saving a password and when listing suppliers", async () => {
    const created = await POST(
      new Request("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: "Login site",
          siteUrl: "https://example.com",
        }),
      }),
    );
    const record = await created.json();
    const changed = await PATCH(
      new Request("http://localhost/api/suppliers/id", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: record.state.revision,
          siteLogin: {
            username: "user",
            password: "never-return-this-password",
          },
        }),
      }),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(changed.status).toBe(200);
    const saved = await changed.json();
    expect(saved.siteLogin).toEqual({ username: "user", configured: true });
    expect(JSON.stringify(saved)).not.toMatch(
      /encryptedPassword|never-return-this-password/u,
    );
    const listed = await (await GET()).text();
    expect(listed).not.toMatch(/encryptedPassword|never-return-this-password/u);
    expect(
      (await mocks.repository.listSuppliers())[0]?.state?.siteLogin
        ?.encryptedPassword,
    ).toBeTruthy();
  });
  it("creates a zero-group supplier, lists it, and manually adds a group", async () => {
    const created = await POST(
      new Request("http://localhost/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: "New API",
          siteUrl: "https://example.com",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const record = await created.json();
    expect(record.catalog.groups).toEqual([]);
    const changed = await PATCH(
      new Request("http://localhost/api/suppliers/id", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: record.state.revision,
          catalog: { groups: [{ id: "manual", label: "手动组", models: [] }] },
        }),
      }),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(changed.status).toBe(200);
    expect((await changed.json()).catalog.groups[0]).toMatchObject({
      id: "manual",
      source: "manual",
    });
    expect(await (await GET()).json()).toHaveLength(1);
  });
  it("rejects unsafe URL fields and missing supplier IDs", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/suppliers", {
            method: "POST",
            body: JSON.stringify({ name: "Site", apiUrl: "file:///tmp/key" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PATCH(
          new Request("http://localhost/api/suppliers/missing", {
            method: "PATCH",
            body: JSON.stringify({ name: "New", expectedRevision: 0 }),
          }),
          { params: Promise.resolve({ id: "missing" }) },
        )
      ).status,
    ).toBe(404);
  });
});
