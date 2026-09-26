import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DirectorCatalogCandidate,
  DirectorCallDraft,
} from "@super-canvas/director";
import { routeDirectorCall } from "@super-canvas/director";
import type {
  DirectorProfileRecord,
  DirectorProposalRecord,
  JsonObject,
} from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  repository: {
    getDirectorProposal: vi.fn(),
    updateDirectorProposal: vi.fn(),
    getCanvas: vi.fn(),
    saveCanvas: vi.fn(),
    getRunByClientRequest: vi.fn(),
  },
  runService: {
    getRun: vi.fn(),
    createRun: vi.fn(),
  },
  getDirectorProfile: vi.fn(),
  resolveDirectorConnection: vi.fn(),
  loadDirectorCatalog: vi.fn(),
  loadExchangeRates: vi.fn(),
  publicRunSnapshot: vi.fn((value: unknown) => value),
}));

vi.mock("./server", () => ({
  repository: mocks.repository,
  runService: mocks.runService,
  storage: {},
  publicRunSnapshot: mocks.publicRunSnapshot,
}));

vi.mock("./director-connections", () => ({
  getDirectorProfile: mocks.getDirectorProfile,
  resolveDirectorConnection: mocks.resolveDirectorConnection,
}));

vi.mock("./director-catalog", () => ({
  loadDirectorCatalog: mocks.loadDirectorCatalog,
}));

vi.mock("./director-rates", () => ({
  loadExchangeRates: mocks.loadExchangeRates,
}));

import {
  approveDirectorProposal,
  cancelDirectorProposal,
  readDirectorResearchResponse,
} from "./director-service";

const createdAt = "2026-08-30T00:00:00.000Z";

function candidate(): DirectorCatalogCandidate {
  const checkedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  return {
    connectionId: "image-connection",
    connectionName: "Image Connection",
    provider: "test",
    supplier: "Test Supplier",
    authoritative: true,
    catalogCheckedAt: checkedAt,
    model: {
      id: "image-model",
      name: "Image Model",
      operations: ["image.generate"],
      inputKinds: ["text"],
      outputKinds: ["image"],
      pricing: {
        kind: "per-image",
        currency: "CNY",
        unitAmount: 1,
        checkedAt,
        validUntil,
        confidence: "exact",
      },
    },
  };
}

const draftCall: DirectorCallDraft = {
  id: "hero",
  label: "Hero image",
  prompt: "A cinematic hero frame",
  requirements: { operation: "image.generate", count: 1 },
};

function proposalFixture(
  catalogCandidate: DirectorCatalogCandidate,
  overrides: Partial<DirectorProposalRecord> = {},
): DirectorProposalRecord {
  const routedCall = routeDirectorCall(draftCall, [catalogCandidate]);
  return {
    id: "proposal-1",
    sessionId: "session-1",
    canvasId: "canvas-1",
    version: 1,
    status: "awaiting_approval",
    baseCanvasRevision: 4,
    plan: JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        decision: {
          type: "proposal",
          summary: "Generate one hero image",
          assumptions: [],
          calls: [draftCall],
        },
        calls: [routedCall],
        sources: [],
        manualSelections: {},
        origin: { x: 100, y: 100 },
      }),
    ) as JsonObject,
    quote: {
      schemaVersion: 1,
      totalCnyMaximum: routedCall.selected?.cnyMaximum ?? 1,
      allCallsSelected: true,
    },
    knowledgeVersion: "knowledge-v1",
    catalogFingerprint: "catalog-v1",
    expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
    workflowRunId: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function canvasFixture(revision = 4) {
  return {
    id: "canvas-1",
    title: "Canvas",
    graph: {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    revision,
    createdAt,
    updatedAt: createdAt,
  };
}

const profile: DirectorProfileRecord = {
  id: "default",
  brainConnectionId: "brain-1",
  brainModelId: "brain-model",
  researchConnectionId: null,
  config: {},
  createdAt,
  updatedAt: createdAt,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDirectorProfile.mockResolvedValue(profile);
  mocks.loadExchangeRates.mockResolvedValue(undefined);
});

describe("readDirectorResearchResponse", () => {
  it("parses a bounded JSON response", async () => {
    await expect(
      readDirectorResearchResponse(
        new Response(JSON.stringify({ results: [] })),
        128,
      ),
    ).resolves.toEqual({ results: [] });
  });

  it("rejects declared and streamed responses above the byte limit", async () => {
    await expect(
      readDirectorResearchResponse(
        new Response(null, { headers: { "content-length": "9" } }),
        8,
      ),
    ).rejects.toThrow("超过安全大小限制");

    await expect(
      readDirectorResearchResponse(
        new Response(JSON.stringify({ value: "123456789" })),
        8,
      ),
    ).rejects.toThrow("超过安全大小限制");
  });
});

describe("approveDirectorProposal", () => {
  it("returns an existing workflow run idempotently without another canvas save or run", async () => {
    const catalogCandidate = candidate();
    const proposal = proposalFixture(catalogCandidate, {
      status: "running",
      workflowRunId: "run-1",
    });
    const canvas = canvasFixture(5);
    const runSnapshot = {
      run: { id: "run-1", status: "running" },
      nodes: [],
    };
    mocks.repository.getDirectorProposal.mockResolvedValue(proposal);
    mocks.repository.getCanvas.mockResolvedValue(canvas);
    mocks.runService.getRun.mockResolvedValue(runSnapshot);

    const result = await approveDirectorProposal({
      proposalId: proposal.id,
      version: proposal.version,
      canvasRevision: 999,
    });

    expect(result).toMatchObject({ proposal: { workflowRunId: "run-1" } });
    expect(result.canvas).toEqual(canvas);
    expect(result.run).toEqual(runSnapshot);
    expect(mocks.getDirectorProfile).not.toHaveBeenCalled();
    expect(mocks.loadDirectorCatalog).not.toHaveBeenCalled();
    expect(mocks.repository.updateDirectorProposal).not.toHaveBeenCalled();
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
    expect(mocks.runService.createRun).not.toHaveBeenCalled();
  });

  it("rejects a canvas revision conflict before locking, saving, or creating a run", async () => {
    const catalogCandidate = candidate();
    const proposal = proposalFixture(catalogCandidate);
    mocks.repository.getDirectorProposal.mockResolvedValue(proposal);
    mocks.repository.getCanvas.mockResolvedValue(canvasFixture(5));
    mocks.loadDirectorCatalog.mockResolvedValue([catalogCandidate]);

    await expect(
      approveDirectorProposal({
        proposalId: proposal.id,
        version: proposal.version,
        canvasRevision: 4,
      }),
    ).rejects.toMatchObject({
      code: "CANVAS_REVISION_CONFLICT",
      status: 409,
    });

    expect(mocks.repository.updateDirectorProposal).not.toHaveBeenCalled();
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
    expect(mocks.runService.createRun).not.toHaveBeenCalled();
    expect(mocks.repository.getRunByClientRequest).not.toHaveBeenCalled();
  });
});

describe("cancelDirectorProposal", () => {
  it("only changes proposal state and never writes the canvas or creates a run", async () => {
    const proposal = proposalFixture(candidate());
    const cancelled = { ...proposal, status: "cancelled" as const };
    mocks.repository.getDirectorProposal.mockResolvedValue(proposal);
    mocks.repository.updateDirectorProposal.mockResolvedValue(cancelled);

    const result = await cancelDirectorProposal(proposal.id, proposal.version);

    expect(result.status).toBe("cancelled");
    expect(mocks.repository.updateDirectorProposal).toHaveBeenCalledWith(
      proposal.id,
      { status: "cancelled" },
      {
        expectedVersion: proposal.version,
        expectedStatuses: ["awaiting_approval", "expired"],
      },
    );
    expect(mocks.repository.getCanvas).not.toHaveBeenCalled();
    expect(mocks.repository.saveCanvas).not.toHaveBeenCalled();
    expect(mocks.runService.createRun).not.toHaveBeenCalled();
  });
});
