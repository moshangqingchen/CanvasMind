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
    expect(saved.siteLogin).toEqual({ authMode: "password", username: "user", configured: true });
    expect(JSON.stringify(saved)).not.toMatch(
      /encryptedPassword|never-return-this-password/u,
    );
    const listed = await (await GET()).text();
    expect(listed).not.toMatch(/encryptedPassword|never-return-this-password/u);
    const login = (await mocks.repository.listSuppliers())[0]?.state?.siteLogin;
    expect(login && "encryptedPassword" in login && login.encryptedPassword).toBeTruthy();
  });
  it("saves a site access token privately and retains it when updating only the user ID", async () => {
    const created = await POST(new Request("http://localhost/api/suppliers", {
      method: "POST",
      body: JSON.stringify({ name: "Token site", siteUrl: "https://token.example.test", kind: "newapi" }),
    }));
    const record = await created.json();
    const context = { params: Promise.resolve({ id: record.id }) };
    const patch = (body: unknown) => PATCH(new Request("http://localhost/api/suppliers/id", {
      method: "PATCH", body: JSON.stringify(body),
    }), context);
    const changed = await patch({ expectedRevision: record.state.revision,
      siteLogin: { authMode: "access-token", accessToken: "mock-site-access-token-private", userId: "42" } });
    expect(changed.status).toBe(200);
    const saved = await changed.json();
    expect(saved.siteLogin).toEqual({ authMode: "access-token", configured: true, userId: "42" });
    const privateLogin = (await mocks.repository.listSuppliers())[0]?.state?.siteLogin;
    expect(privateLogin?.authMode).toBe("access-token");
    if (privateLogin?.authMode !== "access-token") throw new Error("Expected private token credential");
    expect(privateLogin.encryptedAccessToken).toBeTruthy();
    expect(privateLogin.encryptedAccessToken).not.toBe("mock-site-access-token-private");
    expect(JSON.stringify(saved)).not.toMatch(/encryptedAccessToken|accessToken|mock-site-access-token-private/u);
    const updated = await patch({ expectedRevision: saved.state.revision,
      siteLogin: { authMode: "access-token", userId: "43" } });
    expect(updated.status).toBe(200);
    const metadata = await updated.json();
    expect(metadata.siteLogin).toEqual({ authMode: "access-token", configured: true, userId: "43" });
    const kept = (await mocks.repository.listSuppliers())[0]?.state?.siteLogin;
    expect(kept?.authMode === "access-token" && kept.encryptedAccessToken).toBe(privateLogin.encryptedAccessToken);
    expect(await (await GET()).text()).not.toMatch(/encryptedAccessToken|accessToken|mock-site-access-token-private/u);
    const conflict = await patch({ expectedRevision: saved.state.revision,
      siteLogin: { authMode: "access-token", accessToken: "mock-rejected-token-private" } });
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toMatch(/mock-rejected-token-private|mock-site-access-token-private|encryptedAccessToken/u);
  });
  it("rejects mixed secrets and metadata-only token configuration without saved credentials", async () => {
    const created = await POST(new Request("http://localhost/api/suppliers", {
      method: "POST", body: JSON.stringify({ name: "Empty site", siteUrl: "https://empty.example.test" }),
    }));
    const record = await created.json();
    const context = { params: Promise.resolve({ id: record.id }) };
    for (const login of [
      { authMode: "access-token", accessToken: "mock-private-token", username: "user", password: "mock-private-password" },
      { authMode: "access-token", userId: "42" },
    ]) {
      const response = await PATCH(new Request("http://localhost/api/suppliers/id", {
        method: "PATCH", body: JSON.stringify({ expectedRevision: record.state.revision, siteLogin: login }),
      }), context);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toMatch(/mock-private-token|mock-private-password/u);
    }
    expect((await mocks.repository.listSuppliers())[0]?.state?.siteLogin).toBeUndefined();
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
