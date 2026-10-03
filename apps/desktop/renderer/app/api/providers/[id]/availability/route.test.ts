import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import type { CangyuanAvailabilitySnapshot } from "../../../../../lib/cangyuan-availability-types";

const mocks = vi.hoisted(() => ({
  connections: new Map<string, ProviderConnectionRecord>(),
  fetchAvailability: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("@super-canvas/providers", () => ({ decryptSecret: mocks.decrypt }));
vi.mock("../../../../../lib/cangyuan-availability", () => ({
  fetchCangyuanAvailability: mocks.fetchAvailability,
}));
vi.mock("../../../../../lib/master-key", () => ({
  requireServerMasterKey: () => "isolated-availability-test-master",
}));
vi.mock("../../../../../lib/server", () => ({
  repository: {
    getConnection: async (id: string) => mocks.connections.get(id) ?? null,
  },
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
}));

import { GET } from "./route";

const START = Date.parse("2026-10-03T10:00:00.000Z");
const KEY_ONE = "fake-availability-key-one";
const KEY_TWO = "fake-availability-key-two";
let now: number;

function connection(
  id: string,
  options: {
    key?: string | null;
    supplierId?: string;
    sourceId?: string;
    preset?: string;
    baseUrl?: string;
  } = {},
) {
  const record: ProviderConnectionRecord = {
    id,
    name: id,
    provider: "rest",
    encryptedSecret:
      options.key === null ? null : `encrypted:${options.key ?? KEY_ONE}`,
    config: {
      preset: options.preset ?? "cangyuan-gpt-image-2",
      ...(options.supplierId ? { supplierId: options.supplierId } : {}),
      ...(options.sourceId ? { supplierSourceId: options.sourceId } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    },
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString(),
  };
  mocks.connections.set(id, record);
  return record;
}

function snapshot(
  checkedAt = new Date(START).toISOString(),
): CangyuanAvailabilitySnapshot {
  return {
    enabled: true,
    ready: true,
    checkedAt,
    items: [
      {
        name: "image-up",
        category: "image",
        latestStatus: "available",
        timeline: null,
        routes: [
          { name: "image-up-model", latestStatus: "available", timeline: null },
        ],
      },
      {
        name: "image-down",
        category: "image",
        latestStatus: "unavailable",
        timeline: null,
        routes: [
          {
            name: "image-down-model",
            latestStatus: "unavailable",
            timeline: null,
          },
        ],
      },
      {
        name: "text-up",
        category: "text",
        latestStatus: "available",
        timeline: null,
        routes: [
          { name: "text-up-model", latestStatus: "available", timeline: null },
        ],
      },
      {
        name: "video-wave",
        category: "video",
        latestStatus: "degraded",
        timeline: null,
        routes: [
          {
            name: "video-wave-model",
            latestStatus: "degraded",
            timeline: null,
          },
        ],
      },
    ],
  };
}

const query = (id: string, search = "") =>
  GET(
    new Request(
      `http://localhost/api/providers/${id}/availability${search ? `?${search}` : ""}`,
    ),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  mocks.connections.clear();
  mocks.fetchAvailability.mockReset();
  mocks.decrypt
    .mockReset()
    .mockImplementation((ciphertext: string) =>
      ciphertext.replace(/^encrypted:/u, ""),
    );
  delete (
    globalThis as typeof globalThis & {
      __superCanvasCangyuanAvailability?: unknown;
    }
  ).__superCanvasCangyuanAvailability;
  now = START;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => vi.restoreAllMocks());

describe("Cangyuan availability account cache and freshness", () => {
  it("filters the complete snapshot locally with the new available status and ignores window_days", async () => {
    connection("group");
    mocks.fetchAvailability.mockResolvedValue(snapshot());
    const response = await query(
      "group",
      "name=image-up&category=image&latest_status=available&window_days=30",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      source: "live",
      ready: true,
      items: [
        expect.objectContaining({
          name: "image-up",
          latestStatus: "available",
        }),
      ],
    });
    const anotherFilter = await query(
      "group",
      "category=video&latest_status=degraded&window_days=7",
    );
    expect(await anotherFilter.json()).toMatchObject({
      source: "cache",
      items: [expect.objectContaining({ name: "video-wave" })],
    });
    expect(mocks.fetchAvailability.mock.calls).toEqual([[KEY_ONE]]);
  });

  it("keeps the old checkedAt and snapshot as stale when the upstream is not ready", async () => {
    connection("group");
    const previous = snapshot();
    mocks.fetchAvailability.mockResolvedValueOnce(previous);
    await query("group");
    now += 30_000;
    mocks.fetchAvailability.mockResolvedValueOnce({
      enabled: true,
      ready: false,
      checkedAt: new Date(now).toISOString(),
      items: [],
    });
    const response = await query("group");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ready: false,
      source: "stale",
      checkedAt: previous.checkedAt,
      items: previous.items,
    });
    now += 29_999;
    expect(await (await query("group", "name=image-up")).json()).toMatchObject({
      ready: false,
      source: "stale",
      checkedAt: previous.checkedAt,
      items: [expect.objectContaining({ name: "image-up" })],
    });
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
  });

  it("matches a callable route and filters its status without using a different route's failure", async () => {
    connection("group");
    mocks.fetchAvailability.mockResolvedValue({
      ...snapshot(),
      items: [
        {
          name: "Mixed image product",
          category: "image",
          latestStatus: "degraded",
          timeline: null,
          routes: [
            {
              name: "healthy-image-model",
              latestStatus: "available",
              timeline: null,
            },
            {
              name: "failed-image-model",
              latestStatus: "unavailable",
              cause: "down",
              timeline: null,
            },
          ],
        },
      ],
    });
    const response = await query(
      "group",
      "name=healthy-image-model&latest_status=available",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [
        {
          name: "Mixed image product",
          routes: [{ name: "healthy-image-model", latestStatus: "available" }],
        },
      ],
    });
    expect(
      (
        await (
          await query(
            "group",
            "name=healthy-image-model&latest_status=unavailable",
          )
        ).json()
      ).items,
    ).toEqual([]);
    expect(mocks.fetchAvailability).toHaveBeenCalledOnce();
  });

  it("returns disabled monitoring without reviving the previous successful snapshot", async () => {
    connection("group");
    mocks.fetchAvailability.mockResolvedValueOnce(snapshot());
    await query("group");
    now += 30_000;
    mocks.fetchAvailability.mockResolvedValueOnce({
      enabled: false,
      ready: false,
      checkedAt: new Date(now).toISOString(),
      items: [],
    });
    expect(await (await query("group")).json()).toMatchObject({
      enabled: false,
      items: [],
    });
    now += 30_000;
    mocks.fetchAvailability.mockResolvedValueOnce({
      enabled: true,
      ready: false,
      checkedAt: new Date(now).toISOString(),
      items: [],
    });
    expect((await (await query("group")).json()).items).toEqual([]);
  });

  it("coalesces concurrent requests from different keys in the same supplier account", async () => {
    connection("images", {
      supplierId: "supplier",
      sourceId: "account",
      key: KEY_ONE,
    });
    connection("videos", {
      supplierId: "supplier",
      sourceId: "account",
      key: KEY_TWO,
    });
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    mocks.fetchAvailability.mockImplementation(
      () =>
        new Promise<ReturnType<typeof snapshot>>((done) => {
          resolve = done;
        }),
    );
    const image = query("images", "category=image");
    const video = query("videos", "category=video");
    await vi.waitFor(() =>
      expect(mocks.fetchAvailability).toHaveBeenCalledOnce(),
    );
    resolve(snapshot());
    const [imageResponse, videoResponse] = await Promise.all([image, video]);
    expect(
      (await imageResponse.json()).items.map(
        (item: { category: string }) => item.category,
      ),
    ).toEqual(["image", "image"]);
    expect(
      (await videoResponse.json()).items.map(
        (item: { category: string }) => item.category,
      ),
    ).toEqual(["video"]);
    await query("videos");
    expect(mocks.fetchAvailability).toHaveBeenCalledOnce();
  });

  it("shares one public snapshot when the same Key is duplicated across supplier records or sources", async () => {
    connection("first", { supplierId: "supplier-one", sourceId: "source-one" });
    connection("other-supplier", {
      supplierId: "supplier-two",
      sourceId: "source-one",
    });
    connection("other-source", {
      supplierId: "supplier-one",
      sourceId: "source-two",
    });
    mocks.fetchAvailability.mockResolvedValue(snapshot());
    for (const id of ["first", "other-supplier", "other-source"])
      expect((await query(id)).status).toBe(200);
    expect(mocks.fetchAvailability).toHaveBeenCalledOnce();
  });

  it("isolates different supplier accounts with different Keys", async () => {
    connection("first", { supplierId: "supplier-one", sourceId: "source-one", key: KEY_ONE });
    connection("other", { supplierId: "supplier-two", sourceId: "source-one", key: KEY_TWO });
    mocks.fetchAvailability.mockResolvedValue(snapshot());
    await query("first");
    await query("other");
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a connection's snapshot after its supplier source changes", async () => {
    connection("group", { supplierId: "supplier", sourceId: "old-account" });
    mocks.fetchAvailability.mockResolvedValueOnce(snapshot());
    await query("group");
    connection("group", { supplierId: "supplier", sourceId: "new-account", key: KEY_TWO });
    const moved = {
      ...snapshot(),
      items: [{ ...snapshot().items[0]!, name: "new-account-image" }],
    };
    mocks.fetchAvailability.mockResolvedValueOnce(moved);
    expect(await (await query("group")).json()).toMatchObject({
      source: "live",
      items: [expect.objectContaining({ name: "new-account-image" })],
    });
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
  });

  it("shares the fallback key cache across connections but isolates a replacement key", async () => {
    connection("first");
    connection("same-key");
    mocks.fetchAvailability.mockResolvedValueOnce(snapshot());
    await query("first");
    expect((await (await query("same-key")).json()).source).toBe("cache");
    connection("first", { key: KEY_TWO });
    const changed = {
      ...snapshot(),
      items: [{ ...snapshot().items[0]!, name: "replacement-key-image" }],
    };
    mocks.fetchAvailability.mockResolvedValueOnce(changed);
    expect(await (await query("first")).json()).toMatchObject({
      source: "live",
      items: [expect.objectContaining({ name: "replacement-key-image" })],
    });
    expect(mocks.fetchAvailability.mock.calls).toEqual([[KEY_ONE], [KEY_TWO]]);
    expect((await (await query("same-key")).json()).items[0].name).toBe(
      "image-up",
    );
  });

  it("refreshes only after the account's full 30 second cache interval", async () => {
    connection("group");
    mocks.fetchAvailability.mockResolvedValue(snapshot());
    await query("group");
    now += 29_999;
    expect((await (await query("group")).json()).source).toBe("cache");
    expect(mocks.fetchAvailability).toHaveBeenCalledOnce();
    now += 1;
    expect((await (await query("group")).json()).source).toBe("live");
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
  });

  it("caches an upstream 429 failure so filters and shared connections cannot retry rapidly", async () => {
    connection("first", { supplierId: "supplier", sourceId: "account" });
    connection("second", {
      supplierId: "supplier",
      sourceId: "account",
      key: KEY_TWO,
    });
    mocks.fetchAvailability.mockRejectedValue(
      Object.assign(new Error(`HTTP 429 Authorization: Bearer ${KEY_ONE}`), {
        details: { status: 429 },
      }),
    );
    const [first, second] = await Promise.all([
      query("first"),
      query("second", "category=image"),
    ]);
    expect(first.status).toBe(429);
    expect(second.status).toBe(429);
    for (const response of [first, second])
      expect(await response.text()).not.toContain(KEY_ONE);
    expect(mocks.fetchAvailability).toHaveBeenCalledOnce();
    now += 29_999;
    expect((await query("second", "latest_status=available")).status).toBe(429);
    expect(mocks.fetchAvailability).toHaveBeenCalledOnce();
    now += 1;
    expect((await query("first")).status).toBe(429);
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
  });

  it("reports a failed refresh but retains the last successful timestamp for a later not-ready response", async () => {
    connection("group");
    const previous = snapshot();
    mocks.fetchAvailability.mockResolvedValueOnce(previous);
    await query("group");
    now += 30_000;
    mocks.fetchAvailability.mockRejectedValueOnce(
      new Error(`failed request api_key=${KEY_ONE}`),
    );
    const response = await query("group");
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(KEY_ONE);
    now += 100;
    expect((await query("group")).status).toBe(502);
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
    now += 29_900;
    mocks.fetchAvailability.mockResolvedValueOnce({
      enabled: true,
      ready: false,
      checkedAt: new Date(now).toISOString(),
      items: [],
    });
    expect(await (await query("group")).json()).toMatchObject({
      ready: false,
      source: "stale",
      checkedAt: previous.checkedAt,
      items: previous.items,
    });
    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(3);
  });
});

describe("Cangyuan availability connection guardrails", () => {
  it.each([
    ["missing", undefined, 404],
    ["not-cangyuan", { preset: "other-provider" }, 422],
    ["no-key", { key: null }, 409],
  ] as const)(
    "rejects %s without decrypting or contacting the upstream",
    async (id, options, status) => {
      if (options) connection(id, options);
      expect((await query(id)).status).toBe(status);
      expect(mocks.decrypt).not.toHaveBeenCalled();
      expect(mocks.fetchAvailability).not.toHaveBeenCalled();
    },
  );

  it.each([
    "category=other",
    "latest_status=healthy",
    "latest_status=operational",
  ])(
    "rejects invalid filters (%s) without an upstream request",
    async (search) => {
      connection("group");
      expect((await query("group", search)).status).toBe(400);
      expect(mocks.fetchAvailability).not.toHaveBeenCalled();
    },
  );

  it("does not send a custom endpoint's API key to the official availability service", async () => {
    connection("custom", { baseUrl: "https://custom-provider.example/v1" });
    expect((await query("custom")).status).toBe(422);
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.fetchAvailability).not.toHaveBeenCalled();
  });

  it("supports a saved legacy 4K connection with the official base URL", async () => {
    connection("legacy", {
      preset: "cangyuan-gpt-image-2-4k",
      baseUrl: "https://ai.cangyuansuanli.cn/v1",
    });
    mocks.fetchAvailability.mockResolvedValue(snapshot());
    expect((await query("legacy")).status).toBe(200);
    expect(mocks.fetchAvailability).toHaveBeenCalledWith(KEY_ONE);
  });

  it("does not include the API key or encrypted secret in a successful response", async () => {
    const saved = connection("group");
    mocks.fetchAvailability.mockResolvedValue(snapshot());
    const text = await (await query("group")).text();
    expect(text).not.toContain(KEY_ONE);
    expect(text).not.toContain(saved.encryptedSecret);
    expect(text).not.toContain("apiKey");
  });
});
