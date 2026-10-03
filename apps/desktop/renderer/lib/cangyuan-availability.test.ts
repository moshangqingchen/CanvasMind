import { describe, expect, it, vi } from "vitest";
import {
  fetchCangyuanAvailability,
  parseCangyuanAvailabilityPayload,
} from "./cangyuan-availability";
import { providerFetch } from "@super-canvas/providers";

vi.mock("@super-canvas/providers", async (original) => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: vi.fn(),
}));

const timeline = {
  started_at: 1790992200,
  ended_at: 1791020836,
  bucket_seconds: 600,
  statuses: Array.from({ length: 48 }, () => "available"),
};
const fixture = () => ({
  object: "list",
  enabled: true,
  ready: true,
  data: [
    {
      name: "byte-dance",
      category: "image",
      latest_status: "degraded",
      cause: "down",
      timeline,
      routes: [
        {
          name: "doubao-seedream-5-0-pro",
          latest_status: "available",
          timeline,
          pace: { kind: "generation", ms: 42000 },
        },
        {
          name: "seedream-5.0-pro-x",
          latest_status: "unavailable",
          cause: "down",
          timeline: { ...timeline, statuses: ["unavailable"] },
        },
      ],
    },
  ],
});

describe("current Cangyuan published service contract", () => {
  it("keeps product lines separate from model routes and never exposes uptime fields", () => {
    const input = fixture();
    Object.assign(input.data[0]!, {
      availability: 99.9,
      api_key: "should-not-leak",
      average_latency_ms: 100,
    });
    const snapshot = parseCangyuanAvailabilityPayload(input);
    expect(snapshot).toMatchObject({
      enabled: true,
      ready: true,
      items: [
        {
          name: "byte-dance",
          category: "image",
          latestStatus: "degraded",
          cause: "down",
          routes: [
            {
              name: "doubao-seedream-5-0-pro",
              latestStatus: "available",
              pace: { kind: "generation", ms: 42000 },
            },
            {
              name: "seedream-5.0-pro-x",
              latestStatus: "unavailable",
              cause: "down",
            },
          ],
        },
      ],
    });
    expect(snapshot.items[0]!.timeline).toEqual({
      startedAt: timeline.started_at,
      endedAt: timeline.ended_at,
      bucketSeconds: 600,
      statuses: timeline.statuses,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /availability|average_latency|api_key|should-not-leak/u,
    );
  });
  it("retains absent pace as absent and text first-token samples as medians", () => {
    const snapshot = parseCangyuanAvailabilityPayload({
      enabled: true,
      ready: true,
      data: [
        {
          name: "GPT",
          category: "text",
          latest_status: "available",
          cause: "down",
          routes: [
            {
              name: "LLM-GPT-plus",
              latest_status: "degraded",
              cause: "slow",
              pace: { kind: "first_token", ms: 1500 },
            },
            { name: "LLM-GPT-pro", latest_status: "available" },
          ],
        },
      ],
    });
    expect(snapshot.items[0]).not.toHaveProperty("cause");
    expect(snapshot.items[0]!.routes[0]).toMatchObject({
      cause: "slow",
      pace: { kind: "first_token", ms: 1500 },
    });
    expect(snapshot.items[0]!.routes[1]).not.toHaveProperty("pace");
    expect(snapshot.items[0]!.timeline).toBeNull();
  });
  it("does not interpret ready=false or enabled=false as a new healthy result", () => {
    expect(
      parseCangyuanAvailabilityPayload({ ...fixture(), ready: false }),
    ).toMatchObject({ ready: false, items: [] });
    expect(
      parseCangyuanAvailabilityPayload({ ...fixture(), enabled: false }),
    ).toMatchObject({ enabled: false, items: [] });
  });
  it.each([
    null,
    {},
    { enabled: true, ready: true },
    { enabled: true, ready: true, data: {}, success: true },
    { ...fixture(), success: false },
  ])(
    "rejects incomplete or failed payloads instead of recording an empty success",
    (payload) => {
      expect(() => parseCangyuanAvailabilityPayload(payload)).toThrow(
        "返回格式不完整",
      );
    },
  );
  it("keeps unfamiliar state grey, never assumes healthy, and rejects malformed timeline and pace", () => {
    const snapshot = parseCangyuanAvailabilityPayload({
      enabled: true,
      ready: true,
      data: [
        {
          name: "future",
          category: "video",
          latest_status: "future-state",
          cause: "slow",
          pace: { kind: "generation", ms: -1 },
          timeline: { ...timeline, bucket_seconds: 0 },
          routes: [],
        },
      ],
    });
    expect(snapshot.items[0]).toEqual({
      name: "future",
      category: "video",
      latestStatus: "unknown",
      timeline: null,
      routes: [],
    });
  });
  it("bounds an overlong published timeline to its latest 48 phases and advances its start", () => {
    const statuses = [
      "unavailable",
      "degraded",
      ...Array.from({ length: 48 }, () => "available"),
    ];
    const snapshot = parseCangyuanAvailabilityPayload({
      enabled: true,
      ready: true,
      data: [
        {
          name: "image",
          category: "image",
          latest_status: "available",
          timeline: {
            started_at: 600,
            ended_at: 30600,
            bucket_seconds: 600,
            statuses,
          },
        },
      ],
    });
    expect(snapshot.items[0]!.timeline).toEqual({
      startedAt: 1800,
      endedAt: 30600,
      bucketSeconds: 600,
      statuses: statuses.slice(2),
    });
  });
  it("retains a short final affected phase when the start falls inside a clock-aligned bucket", () => {
    const snapshot = parseCangyuanAvailabilityPayload({
      enabled: true,
      ready: true,
      data: [
        {
          name: "line",
          category: "image",
          latest_status: "unavailable",
          timeline: {
            started_at: 610,
            ended_at: 1201,
            bucket_seconds: 600,
            statuses: ["available", "unavailable"],
          },
        },
      ],
    });
    expect(snapshot.items[0]!.timeline).toEqual({
      startedAt: 610,
      endedAt: 1201,
      bucketSeconds: 600,
      statuses: ["available", "unavailable"],
    });
  });
  it("clips an overlong unaligned timeline on the supplier's clock boundary", () => {
    const snapshot = parseCangyuanAvailabilityPayload({
      enabled: true,
      ready: true,
      data: [
        {
          name: "line",
          category: "image",
          latest_status: "available",
          timeline: {
            started_at: 610,
            ended_at: 30600,
            bucket_seconds: 600,
            statuses: Array.from({ length: 50 }, () => "available"),
          },
        },
      ],
    });
    expect(snapshot.items[0]!.timeline!.startedAt).toBe(1800);
    expect(snapshot.items[0]!.timeline!.statuses).toHaveLength(48);
  });
  it("queries the current endpoint without obsolete windows or upstream filters", async () => {
    vi.mocked(providerFetch).mockResolvedValueOnce(Response.json(fixture()));
    const snapshot = await fetchCangyuanAvailability("isolated-test-key");
    expect(snapshot.ready).toBe(true);
    expect(providerFetch).toHaveBeenCalledWith(
      "https://ai.cangyuansuanli.cn/v1/availability",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer isolated-test-key" },
        cache: "no-store",
      }),
    );
  });
});
