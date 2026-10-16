# Legacy director renderer import audit

Baseline: `release/v0.2.104`. TypeScript AST import/export graph captured before deletion, checked with `git grep`. Next route handlers are registered by the framework. Named imports below include tests.

## apps/desktop/renderer/app/api/agent/legacy/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `GET` -> No external named import; internal use or Next entry point.

## apps/desktop/renderer/app/api/director/_schemas.ts

- `DirectorProfilePatchSchema` -> `apps/desktop/renderer/app/api/director/profile/route.ts`
- `DirectorSessionsQuerySchema` -> `apps/desktop/renderer/app/api/director/sessions/route.ts`
- `DirectorSessionCreateSchema` -> `apps/desktop/renderer/app/api/director/sessions/route.ts`
- `DirectorTurnRequestSchema` -> `apps/desktop/renderer/app/api/director/turn/route.ts`
- `DirectorProposalRevisionSchema` -> `apps/desktop/renderer/app/api/director/proposals/[id]/route.ts`
- `DirectorProposalApprovalSchema` -> `apps/desktop/renderer/app/api/director/proposals/[id]/approve/route.ts`
- `DirectorProposalCancellationSchema` -> `apps/desktop/renderer/app/api/director/proposals/[id]/cancel/route.ts`

## apps/desktop/renderer/app/api/director/_shared.ts

- `PublicDirectorError` -> No external named import; internal use or Next entry point.
- `publicDirectorError` -> `apps/desktop/renderer/app/api/director/turn/route.ts`
- `directorErrorResponse` -> `apps/desktop/renderer/app/api/director/proposals/[id]/approve/route.ts`, `apps/desktop/renderer/app/api/director/proposals/[id]/cancel/route.ts`, `apps/desktop/renderer/app/api/director/proposals/[id]/route.ts`, `apps/desktop/renderer/app/api/director/sessions/route.ts`
- `directorProfileErrorResponse` -> `apps/desktop/renderer/app/api/director/profile/route.ts`

## apps/desktop/renderer/app/api/director/profile/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `GET` -> No external named import; internal use or Next entry point.
- `PATCH` -> `apps/desktop/renderer/app/api/director/routes.test.ts`

## apps/desktop/renderer/app/api/director/proposals/[id]/approve/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `POST` -> `apps/desktop/renderer/app/api/director/routes.test.ts`, `apps/desktop/renderer/lib/agent-service.test.ts`

## apps/desktop/renderer/app/api/director/proposals/[id]/cancel/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `POST` -> No external named import; internal use or Next entry point.

## apps/desktop/renderer/app/api/director/proposals/[id]/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `PATCH` -> `apps/desktop/renderer/app/api/director/routes.test.ts`

## apps/desktop/renderer/app/api/director/routes.test.ts

No named exports (test/support file).


## apps/desktop/renderer/app/api/director/sessions/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `POST` -> `apps/desktop/renderer/app/api/director/routes.test.ts`
- `GET` -> `apps/desktop/renderer/app/api/director/routes.test.ts`

## apps/desktop/renderer/app/api/director/turn/route.ts

- `runtime` -> No external named import; internal use or Next entry point.
- `dynamic` -> No external named import; internal use or Next entry point.
- `POST` -> `apps/desktop/renderer/app/api/director/routes.test.ts`

## apps/desktop/renderer/lib/director-connections.test.ts

No named exports (test/support file).


## apps/desktop/renderer/lib/director-connections.ts

- `DEFAULT_DIRECTOR_PROFILE_ID` -> No external named import; internal use or Next entry point.
- `resolveDirectorConnection` -> `apps/desktop/renderer/lib/agent-models.ts`, `apps/desktop/renderer/lib/director-connections.test.ts`, `apps/desktop/renderer/lib/director-service.ts`
- `getDirectorProfile` -> `apps/desktop/renderer/lib/director-service.ts`
- `saveDirectorProfileConfiguration` -> `apps/desktop/renderer/app/api/director/profile/route.ts`, `apps/desktop/renderer/lib/director-connections.test.ts`
- `publicDirectorProfile` -> `apps/desktop/renderer/app/api/director/profile/route.ts`, `apps/desktop/renderer/lib/director-connections.test.ts`

## apps/desktop/renderer/lib/director-contracts.ts

- `DIRECTOR_STAGES` -> No external named import; internal use or Next entry point.
- `DirectorStage` -> `apps/desktop/renderer/lib/director-service.ts`
- `DirectorPublicProfile` -> `apps/desktop/renderer/lib/director-connections.ts`
- `DirectorPublicMessage` -> `apps/desktop/renderer/lib/director-service.ts`
- `DirectorPublicProposal` -> `apps/desktop/renderer/lib/director-service.ts`
- `DirectorConversation` -> `apps/desktop/renderer/lib/director-service.ts`
- `DirectorConversationSummary` -> No external named import; internal use or Next entry point.
- `DirectorTurnEvent` -> `apps/desktop/renderer/app/api/director/turn/route.ts`, `apps/desktop/renderer/lib/director-service.ts`
- `DirectorApproveResult` -> No external named import; internal use or Next entry point.

## apps/desktop/renderer/lib/director-rates.ts

- `manualExchangeRates` -> No external named import; internal use or Next entry point.
- `loadExchangeRates` -> `apps/desktop/renderer/lib/director-service.ts`
- `parseEcbRates` -> No external named import; internal use or Next entry point.

## apps/desktop/renderer/lib/director-reasoning.test.ts

No named exports (test/support file).


## apps/desktop/renderer/lib/director-reasoning.ts

- `DirectorReasoningEffort` -> No external named import; internal use or Next entry point.
- `DirectorReasoningOption` -> No external named import; internal use or Next entry point.
- `directorModelSupportsReasoning` -> `apps/desktop/renderer/lib/director-reasoning.test.ts`
- `directorReasoningOptions` -> `apps/desktop/renderer/lib/director-reasoning.test.ts`

## apps/desktop/renderer/lib/director-service.test.ts

No named exports (test/support file).


## apps/desktop/renderer/lib/director-service.ts

- `MAX_RESEARCH_RESPONSE_BYTES` -> No external named import; internal use or Next entry point.
- `DirectorServiceError` -> `apps/desktop/renderer/app/api/director/_shared.ts`, `apps/desktop/renderer/app/api/director/sessions/route.ts`
- `readDirectorResearchResponse` -> `apps/desktop/renderer/lib/director-service.test.ts`
- `publicDirectorMessage` -> No external named import; internal use or Next entry point.
- `publicDirectorProposal` -> No external named import; internal use or Next entry point.
- `getDirectorConversation` -> `apps/desktop/renderer/app/api/director/sessions/route.ts`, `apps/desktop/renderer/lib/director-turn-cancellation.test.ts`
- `listDirectorConversations` -> `apps/desktop/renderer/app/api/director/sessions/route.ts`
- `createDirectorConversation` -> `apps/desktop/renderer/app/api/director/sessions/route.ts`
- `loadDirectorAttachments` -> `apps/desktop/renderer/lib/agent-service.ts`
- `runDirectorTurn` -> `apps/desktop/renderer/app/api/director/turn/route.ts`, `apps/desktop/renderer/lib/director-turn-cancellation.test.ts`
- `reviseDirectorProposal` -> `apps/desktop/renderer/app/api/director/proposals/[id]/route.ts`
- `cancelDirectorProposal` -> `apps/desktop/renderer/app/api/director/proposals/[id]/cancel/route.ts`, `apps/desktop/renderer/lib/director-service.test.ts`
- `reconcileRevalidatedCalls` -> No external named import; internal use or Next entry point.
- `approveDirectorProposal` -> `apps/desktop/renderer/app/api/director/proposals/[id]/approve/route.ts`, `apps/desktop/renderer/lib/director-service.test.ts`
- `directorRequestFingerprint` -> No external named import; internal use or Next entry point.


## Cleanup decisions

- Delete all `app/api/director/*` and `app/api/agent/legacy/route.ts`: old profile/session/turn/proposal HTTP entry points only.
- Extract `loadDirectorAttachments` unchanged into `lib/agent-attachments.ts`; keep its validation, limits, metadata, original bytes and errors. `agent-service.ts` uses this shared helper.
- Delete remaining `director-service.ts`, `director-rates.ts`, `director-reasoning.ts`, their old-only tests, and `director-contracts.ts`: no current agent or graphic-design consumers after extraction/profile cleanup.
- Keep `resolveDirectorConnection` and its private dependencies unchanged; `agent-models.ts` still calls it. Delete old profile getters/configuration/public shape and their tests.
- Keep shared adapter/schema/catalog modules and `Director*` names. Default adapter decision parsing remains part of current behavior.
- Keep all DB `Director*` records/CRUD: current agent and project serialization still use the same tables. Unchanged stored table JSON is preserved verbatim and tested with a temporary file.
- The Old conversations button also reads current project/local chat history; keep those sources and remove only the old director source.
- Package/knowledge findings: see [package audit](legacy-director-package-audit.md).

## Additional unused old settings module

`lib/director-provider-options.ts` has no production import or dynamic import. Its exports were verified individually with `git grep`; all seven functions below were imported only by `director-provider-options.test.ts`. Both files are deleted.

| Export | Consumers before deletion |
| --- | --- |
| `DirectorMarketplaceGroups` | Same-file signatures only |
| `DirectorModelInventory` | Same-file signatures only |
| `directorBrainConnections` | Its test file only |
| `directorConfiguredModelInventory` | Its test file only |
| `mergeDirectorModelInventory` | Its test file only |
| `ensureDirectorModel` | Its test file only |
| `directorModelSupportsText` | Same-file model selection and its test file |
| `preferredDirectorModelId` | Its test file only |
| `findProviderGroupConnection` | Its test file only |

## UI, history and data boundaries

- `components/creative-agent-panel.tsx`: remove only its `/api/agent/legacy` request and director-session formatting. Keep the button, local v2 chat history and `fetchProjectChat` source.
- `lib/agent-service.ts`: remove `listLegacyAgentHistory`, previously called only by the deleted legacy route and its unit test. Keep the current agent session type guard and rejection of old director sessions.
- `lib/agent-service.test.ts`: remove imports/assertions for the deleted approval route and history getter; keep current agent approval and session-isolation coverage.
- `e2e/agent.spec.ts`: assert local/project history still works and never requests old director APIs. `e2e/helpers/phase3-large-fixtures.ts` and `e2e/studio-agent-chat.spec.ts`: remove obsolete legacy mocks.
- `app/globals.css`: remove only unused `.director-brain-*`, `.director-connection-*`, `.director-model-inventory-status` and `.director-capabilities` rules, including responsive rules.
- `components/supplier-manager.css`: remove only unused `.sm-director-tab` rules. No TS/TSX consumer or dynamically assembled selector was found for these old settings styles.
- Keep `directorDraft` and `[data-director-draft]`: current graph compilation and canvas handling still use them.
- Keep `DirectorProfileRecord`, `DirectorSessionRecord`, `DirectorMessageRecord`, `DirectorProposalRecord`, their tables and DB CRUD: `agent-models`, `agent-service` and project persistence still consume them.
- `packages/db/src/file.ts` preserves original JSON value text for unchanged director tables. A real current-agent edit persists normally and is never replaced with cached original data. Modified tables retain their existing semantic serialization behavior.
- `packages/db/tests/file.test.ts` adds a temporary-file read/save regression comparing raw Buffer bytes for all four unchanged fields, plus a reopen/update/readback check. No production profile is used.
- README and `docs/creative-agent.md` now describe current behavior. Historical documents remain unchanged.

## Verification

- Shared packages and Next production build: `corepack pnpm --filter @super-canvas/desktop-ui^... build` passed. The generated route list has no director or agent/legacy endpoints.
- Workspace types: `corepack pnpm -r --if-present typecheck` passed.
- Renderer lint: `corepack pnpm --filter @super-canvas/desktop-ui lint` passed.
- Unit tests: providers 3342 passed; runtime 503 passed; director 17 passed; renderer 3555 passed, 7 skipped (300 passing files, 6 skipped files).
- DB: reuse the previously passed 50-test suite as requested; the new preservation regression and DB typecheck passed separately.
- E2E: `corepack pnpm --filter @super-canvas/desktop-ui exec playwright test 'agent.*\.spec\.ts' 'graphic-design.*\.spec\.ts' 'phase3-agent-history.spec.ts' 'studio-agent-chat.spec.ts'` passed all 38 tests using temporary isolated data and offline fixtures.
- `node --check apps/desktop/scripts/stage.mjs` and `git diff --check` passed. The complete desktop installer/stage was not run.
- Hash comparison confirms all 44 pre-existing modified/untracked UI files are unchanged by this task. No paid requests, supplier implementation changes, commits or production profile changes were made.


## Retained renderer shared exports

Current-source import graph after removal. Internal named references and same-module dependencies are retained; tests are shown alongside production callers.

### `apps/desktop/renderer/lib/director-adapters/google.ts`

- `GoogleGenerateContentAdapter` -> `apps/desktop/renderer/lib/director-adapters/registry.ts`

### `apps/desktop/renderer/lib/director-adapters/index.ts`


### `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`

- `OpenAIChatAdapter` -> `apps/desktop/renderer/lib/director-adapters/registry.ts`

### `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`

- `OpenAIResponsesAdapter` -> `apps/desktop/renderer/lib/director-adapters/registry.ts`

### `apps/desktop/renderer/lib/director-adapters/probe.ts`

- `capabilitiesFromVerifiedModel` -> Same module or registry-internal API; kept with shared adapter behavior.
- `probeOpenAICompatibleCapabilities` -> `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `probeGoogleCapabilities` -> `apps/desktop/renderer/lib/director-adapters/google.ts`

### `apps/desktop/renderer/lib/director-adapters/registry.ts`

- `DirectorAdapterRegistry` -> Same module or registry-internal API; kept with shared adapter behavior.
- `createDirectorAdapterRegistry` -> Same module or registry-internal API; kept with shared adapter behavior.
- `directorAdapterRegistry` -> Same module or registry-internal API; kept with shared adapter behavior.

### `apps/desktop/renderer/lib/director-adapters/shared.ts`

- `DIRECTOR_ADAPTER_TIMEOUT_MS` -> Same module or registry-internal API; kept with shared adapter behavior.
- `JsonRecord` -> `apps/desktop/renderer/lib/director-adapters/probe.ts`
- `DirectorAdapterError` -> `apps/desktop/renderer/app/api/agent/chat/route.ts`, `apps/desktop/renderer/lib/agent-errors.ts`, `apps/desktop/renderer/lib/agent-model-call.test.ts`, `apps/desktop/renderer/lib/agent-model-call.ts`, `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`, `apps/desktop/renderer/lib/director-adapters/probe.ts`
- `isRecord` -> `apps/desktop/renderer/lib/agent-model-call.ts`, `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`, `apps/desktop/renderer/lib/director-adapters/probe.ts`
- `adapterOutputTokenLimit` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `adapterFinishReason` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `lastUserMessageIndex` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `adapterEndpoint` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`, `apps/desktop/renderer/lib/director-adapters/probe.ts`
- `adapterHeaders` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`, `apps/desktop/renderer/lib/director-adapters/probe.ts`
- `readModelResponse` -> `apps/desktop/renderer/app/api/agent/chat/route.ts`
- `requestJson` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`, `apps/desktop/renderer/lib/director-adapters/probe.ts`
- `strictDecisionFromCandidates` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `structuredFields` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `textFromStructuredValue` -> `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`
- `structuredSystemPrompt` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `boundedSearchCalls` -> `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `assertAttachmentCapabilities` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `dataUri` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`
- `SourceCandidate` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `normalizeSources` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`
- `usageFrom` -> `apps/desktop/renderer/lib/director-adapters/google.ts`, `apps/desktop/renderer/lib/director-adapters/openai-chat.ts`, `apps/desktop/renderer/lib/director-adapters/openai-responses.ts`

### `apps/desktop/renderer/lib/director-catalog.ts`

- `loadDirectorCatalog` -> `apps/desktop/renderer/lib/agent-catalog.ts`, `apps/desktop/renderer/lib/director-catalog.test.ts`
