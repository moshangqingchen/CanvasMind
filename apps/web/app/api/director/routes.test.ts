import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockDirectorServiceError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 400,
    ) {
      super(message);
      this.name = "DirectorServiceError";
    }
  }
  return {
    DirectorServiceError: MockDirectorServiceError,
    createDirectorConversation: vi.fn(),
    getDirectorConversation: vi.fn(),
    listDirectorConversations: vi.fn(),
    runDirectorTurn: vi.fn(),
    reviseDirectorProposal: vi.fn(),
    approveDirectorProposal: vi.fn(),
    cancelDirectorProposal: vi.fn(),
    getDirectorProfile: vi.fn(),
    publicDirectorProfile: vi.fn(),
    saveDirectorProfileConfiguration: vi.fn(),
  };
});

vi.mock("../../../lib/director-service", () => ({
  DirectorServiceError: mocks.DirectorServiceError,
  createDirectorConversation: mocks.createDirectorConversation,
  getDirectorConversation: mocks.getDirectorConversation,
  listDirectorConversations: mocks.listDirectorConversations,
  runDirectorTurn: mocks.runDirectorTurn,
  reviseDirectorProposal: mocks.reviseDirectorProposal,
  approveDirectorProposal: mocks.approveDirectorProposal,
  cancelDirectorProposal: mocks.cancelDirectorProposal,
}));

vi.mock("../../../lib/director-connections", () => ({
  getDirectorProfile: mocks.getDirectorProfile,
  publicDirectorProfile: mocks.publicDirectorProfile,
  saveDirectorProfileConfiguration: mocks.saveDirectorProfileConfiguration,
}));

import { PATCH as patchProfile } from "./profile/route";
import { PATCH as reviseProposal } from "./proposals/[id]/route";
import { POST as approveProposal } from "./proposals/[id]/approve/route";
import { GET as getSessions, POST as createSession } from "./sessions/route";
import { POST as turn } from "./turn/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const proposalContext = {
  params: Promise.resolve({ id: "proposal-1" }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("director profile route", () => {
  it("rejects secret fields and never passes them to the connection service", async () => {
    const response = await patchProfile(
      jsonRequest("http://localhost/api/director/profile", "PATCH", {
        brainConnectionId: "brain-1",
        brainModelId: "gpt-test",
        apiKey: "must-not-pass",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.saveDirectorProfileConfiguration).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("must-not-pass");
  });

  it("returns only the public profile produced by the connection service", async () => {
    mocks.saveDirectorProfileConfiguration.mockResolvedValue({ id: "default" });
    mocks.publicDirectorProfile.mockResolvedValue({
      id: "default",
      configured: true,
      connected: true,
      brainConnectionId: "brain-1",
      brainModelId: "claude-test",
    });
    const response = await patchProfile(
      jsonRequest("http://localhost/api/director/profile", "PATCH", {
        brainConnectionId: "brain-1",
        brainModelId: "claude-test",
        protocol: "anthropic-messages",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: expect.objectContaining({
        brainConnectionId: "brain-1",
        brainModelId: "claude-test",
      }),
    });
  });
});

describe("director session route", () => {
  it("creates an empty conversation for the requested canvas", async () => {
    mocks.createDirectorConversation.mockResolvedValue({
      session: { id: "session-1", canvasId: "canvas-1" },
      messages: [],
      proposals: [],
    });
    const response = await createSession(
      jsonRequest("http://localhost/api/director/sessions", "POST", {
        canvasId: "canvas-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.createDirectorConversation).toHaveBeenCalledWith("canvas-1");
    expect(await response.json()).toMatchObject({
      conversation: { session: { id: "session-1" } },
    });
  });

  it("does not return a session belonging to another canvas", async () => {
    mocks.getDirectorConversation.mockResolvedValue({
      session: { id: "session-1", canvasId: "canvas-other" },
      messages: [],
      proposals: [],
    });
    const response = await getSessions(
      new Request(
        "http://localhost/api/director/sessions?canvasId=canvas-1&sessionId=session-1",
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("rejects duplicate and unknown query parameters", async () => {
    const response = await getSessions(
      new Request(
        "http://localhost/api/director/sessions?canvasId=one&canvasId=two&extra=1",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.listDirectorConversations).not.toHaveBeenCalled();
  });
});

describe("director proposal routes", () => {
  it("passes a validated candidate revision to the service", async () => {
    mocks.reviseDirectorProposal.mockResolvedValue({
      id: "proposal-1",
      version: 2,
    });
    const response = await reviseProposal(
      jsonRequest(
        "http://localhost/api/director/proposals/proposal-1",
        "PATCH",
        {
          version: 1,
          callId: "call-1",
          connectionId: "connection-1",
          modelId: "model-1",
        },
      ),
      proposalContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.reviseDirectorProposal).toHaveBeenCalledWith({
      proposalId: "proposal-1",
      version: 1,
      callId: "call-1",
      connectionId: "connection-1",
      modelId: "model-1",
    });
  });

  it("requires canvasRevision and rejects the legacy approval field", async () => {
    const response = await approveProposal(
      jsonRequest(
        "http://localhost/api/director/proposals/proposal-1/approve",
        "POST",
        { version: 1, expectedCanvasRevision: 3 },
      ),
      proposalContext,
    );

    expect(response.status).toBe(400);
    expect(mocks.approveDirectorProposal).not.toHaveBeenCalled();
  });

  it("preserves service conflict codes for a stale proposal", async () => {
    mocks.approveDirectorProposal.mockRejectedValue(
      new mocks.DirectorServiceError(
        "PROPOSAL_STALE",
        "方案版本已变化，请重新确认",
        409,
      ),
    );
    const response = await approveProposal(
      jsonRequest(
        "http://localhost/api/director/proposals/proposal-1/approve",
        "POST",
        { version: 1, canvasRevision: 3 },
      ),
      proposalContext,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "方案版本已变化，请重新确认",
      code: "PROPOSAL_STALE",
    });
  });
});

describe("director turn SSE route", () => {
  it("rejects duplicate or excessive attachment IDs before starting the director", async () => {
    for (const attachmentAssetIds of [
      ["asset-1", "asset-1"],
      ["asset-1", "asset-2", "asset-3", "asset-4"],
    ]) {
      const response = await turn(
        jsonRequest("http://localhost/api/director/turn", "POST", {
          canvasId: "canvas-1",
          message: "参考这些素材做一条视频",
          attachmentAssetIds,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.runDirectorTurn).not.toHaveBeenCalled();
  });

  it("rejects turn payloads larger than the small JSON limit", async () => {
    const response = await turn(
      jsonRequest("http://localhost/api/director/turn", "POST", {
        canvasId: "canvas-1",
        message: "x".repeat(140 * 1024),
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.runDirectorTurn).not.toHaveBeenCalled();
  });

  it("streams stage and message events before done", async () => {
    mocks.runDirectorTurn.mockImplementation(async (_input, emit) => {
      await emit({
        type: "stage",
        stage: "understanding",
        message: "正在理解目标",
      });
      await emit({
        type: "message",
        message: {
          id: "message-1",
          sessionId: "session-1",
          role: "assistant",
          kind: "message",
          content: "已经理解",
          createdAt: "2026-08-30T00:00:00.000Z",
        },
      });
      await emit({ type: "done", sessionId: "session-1" });
      return "session-1";
    });
    const response = await turn(
      jsonRequest("http://localhost/api/director/turn", "POST", {
        canvasId: "canvas-1",
        message: "做一条 5 秒的视频",
        viewport: { x: 10, y: 20, zoom: 1 },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body.indexOf("event: stage")).toBeLessThan(
      body.indexOf("event: message"),
    );
    expect(body.indexOf("event: message")).toBeLessThan(
      body.indexOf("event: done"),
    );
    expect(body).toContain("data: [DONE]");
    expect(mocks.runDirectorTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: "canvas-1",
        message: "做一条 5 秒的视频",
      }),
      expect.any(Function),
    );
  });

  it("maps unknown failures to a secret-free error event and closes cleanly", async () => {
    mocks.runDirectorTurn.mockRejectedValue(
      new Error("postgres://admin:secret@internal.example/director"),
    );
    const response = await turn(
      jsonRequest("http://localhost/api/director/turn", "POST", {
        canvasId: "canvas-1",
        message: "生成一张图片",
      }),
    );
    const body = await response.text();

    expect(body).toContain("DIRECTOR_INTERNAL_ERROR");
    expect(body).toContain("event: done");
    expect(body).not.toContain("admin:secret");
  });
});
