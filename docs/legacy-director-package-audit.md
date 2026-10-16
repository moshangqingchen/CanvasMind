# Legacy director package dependency audit

Sample date: 2026-10-15. Evidence: tracked source inventory, TypeScript AST named import/export graph, and per-export identifier searches. Already removed legacy callers are read from HEAD to preserve the pre-deletion evidence. No application profile data was read.

## Knowledge conclusion

The only production knowledge loading path is `lib/director-service.ts`: `knowledgeFor` -> `loadDirectorKnowledge` / `createFileSystemKnowledgeReader` / `sha256KnowledgeText` -> `directorSystemPrompt`. The current creative agent only borrowed its attachment loader, which does not read knowledge. Current agent prompts come from inline `SYSTEM`, `CHAT_SYSTEM`, `PLAN_MODE`, messages and task context. `graphic-design-extraction.ts` also builds its own prompt without this knowledge.

`knowledgeVersion` is a persisted proposal field, not an exported package function. Current agent proposals store the literal `"agent-v1"`; only the removed legacy service used `manifest.contentHash`. The field, historic values and current literal remain unchanged.

Remove the unused knowledge assets, loaders, tests and both sync paths. Also remove the corresponding knowledge-copy operation in desktop staging.

## Every source export and its consumers

The table records pre-deletion references, including types, named imports and package-internal references. The shared `index.ts` barrel is not repeated in each row. Same-file dependencies are marked explicitly. `lib/` and `api/` are relative to `apps/desktop/renderer/`.

### `packages/director/src/adapter-registry.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `DirectorAdapterRegistry` | `lib/director-adapters/registry.ts` | `director/tests/adapter-registry.test.ts` | Keep |

### `packages/director/src/compiler.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `CompileDirectorGraphOptions` | Same-file references | None | Keep |
| `DirectorGraphCompileError` | Same-file references | `director/tests/compiler.test.ts` | Keep |
| `compileDirectorGraphPatch` | `lib/agent-graph.ts`<br>`lib/director-service.ts` | `director/tests/compiler.test.ts` | Keep |

### `packages/director/src/knowledge-node.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `sha256KnowledgeText` | `lib/director-service.ts` | None | Remove |
| `createFileSystemKnowledgeReader` | `lib/director-service.ts` | None | Remove |
| `loadDirectorKnowledgeFromFileSystem` | None | `director/tests/knowledge-node.test.ts` | Remove |

### `packages/director/src/knowledge.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `KnowledgeFileSchema` | Same-file references | None | Remove |
| `KnowledgeReferenceSchema` | Same-file references | None | Remove |
| `KnowledgeArtifactSchema` | Same-file references | None | Remove |
| `KnowledgeManifestSchema` | Same-file references | None | Remove |
| `KnowledgeManifest` | Same-file references | None | Remove |
| `KnowledgeReference` | Same-file references | None | Remove |
| `DirectorKnowledgeTask` | `director/src/knowledge-node.ts` | None | Remove |
| `LoadedKnowledgeDocument` | Same-file references | None | Remove |
| `LoadedDirectorKnowledge` | `director/src/knowledge-node.ts` | None | Remove |
| `DirectorKnowledgeReader` | `director/src/knowledge-node.ts` | None | Remove |
| `KnowledgeTextHasher` | Same-file references | None | Remove |
| `selectKnowledgeReferences` | Same-file references | `director/tests/knowledge.test.ts` | Remove |
| `parseKnowledgeManifest` | Same-file references | `director/tests/knowledge.test.ts` | Remove |
| `loadDirectorKnowledge` | `lib/director-service.ts`<br>`director/src/knowledge-node.ts` | `director/tests/knowledge.test.ts` | Remove |

### `packages/director/src/routing.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `DEFAULT_PRICING_MAX_AGE_MS` | Same-file references | None | Keep |
| `DEFAULT_CATALOG_MAX_AGE_MS` | Same-file references | None | Keep |
| `candidateExclusionReasons` | Same-file references | None | Keep |
| `quoteCandidate` | `lib/agent-service.ts` | `director/tests/routing.test.ts` | Keep |
| `parametersForRequirements` | `lib/agent-service.ts`<br>`lib/director-service.ts` | `director/tests/routing.test.ts` | Keep |
| `compareDirectorQuotes` | Same-file references | None | Keep |
| `routeDirectorCall` | Same-file references | `lib/director-service.test.ts`<br>`director/tests/compiler.test.ts`<br>`director/tests/routing.test.ts` | Keep |
| `routeDirectorCalls` | `lib/agent-service.ts`<br>`lib/director-service.ts` | None | Keep |
| `fingerprintCatalog` | `lib/director-service.ts` | `director/tests/routing.test.ts` | Remove |

### `packages/director/src/schemas.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `DirectorProtocolSchema` | `app/api/director/_schemas.ts` | None | Remove |
| `DirectorModelCapabilitiesSchema` | `app/api/director/_schemas.ts`<br>`lib/director-connections.ts` | None | Keep |
| `DirectorConnectionDescriptorSchema` | None | None | Remove |
| `ExchangeRateTableSchema` | None | `director/tests/schemas.test.ts` | Remove |
| `GenerationRequirementsSchema` | Same-file references | `director/tests/schemas.test.ts` | Keep |
| `DirectorCallDraftSchema` | `lib/agent-contracts.ts` | None | Keep |
| `DirectorDecisionSchema` | `lib/director-service.ts` | `director/tests/schemas.test.ts` | Keep |
| `DIRECTOR_DECISION_JSON_SCHEMA` | `lib/director-adapters/google.ts`<br>`lib/director-adapters/openai-chat.ts`<br>`lib/director-adapters/openai-responses.ts`<br>`lib/director-adapters/shared.ts`<br>`lib/director-service.ts` | `director/tests/schemas.test.ts` | Keep |
| `parseDirectorDecision` | `lib/director-adapters/shared.ts`<br>`lib/director-service.ts` | `director/tests/schemas.test.ts` | Keep |

### `packages/director/src/types.ts`

| Export | Production/internal consumers | Tests | Action |
| --- | --- | --- | --- |
| `DIRECTOR_PROTOCOLS` | `lib/director-connections.ts`<br>`director/src/schemas.ts` | None | Keep |
| `DirectorProtocol` | `lib/agent-model-call.ts`<br>`lib/agent-model-capabilities.ts`<br>`lib/agent-models.ts`<br>`lib/director-adapters/openai-chat.ts`<br>`lib/director-adapters/openai-responses.ts`<br>`lib/director-adapters/shared.ts`<br>`lib/director-connections.ts`<br>`lib/director-contracts.ts`<br>`lib/director-reasoning.ts`<br>`director/src/adapter-registry.ts` | `lib/agent-adapters.test.ts`<br>`lib/director-adapters/adapters.test.ts`<br>`lib/director-adapters/completion.test.ts`<br>`lib/director-adapters/native-reasoning.test.ts` | Keep |
| `DirectorModelCapabilities` | `lib/agent-attachment-policy.ts`<br>`lib/agent-model-capabilities.ts`<br>`lib/agent-models.ts`<br>`lib/director-adapters/probe.ts`<br>`lib/director-connections.ts`<br>`lib/director-contracts.ts`<br>`lib/director-reasoning.ts` | None | Keep |
| `DirectorConnectionDescriptor` | Same-file references | None | Keep |
| `ResolvedDirectorConnection` | `lib/agent-model-call.ts`<br>`lib/agent-models.ts`<br>`lib/agent-service.ts`<br>`lib/director-connections.ts` | `app/api/graphic-design/extract/route.test.ts`<br>`lib/agent-model-call.test.ts`<br>`lib/director-adapters/completion.test.ts` | Keep |
| `DirectorConnection` | `lib/director-adapters/google.ts`<br>`lib/director-adapters/openai-chat.ts`<br>`lib/director-adapters/openai-responses.ts`<br>`lib/director-adapters/probe.ts`<br>`lib/director-adapters/shared.ts` | `lib/director-adapters/adapters.test.ts`<br>`lib/director-adapters/native-reasoning.test.ts` | Keep |
| `DirectorEvidenceLevel` | Same-file references | None | Keep |
| `DirectorSource` | `lib/director-adapters/shared.ts`<br>`lib/director-contracts.ts`<br>`lib/director-service.ts` | None | Keep |
| `DirectorAttachment` | `lib/director-adapters/google.ts`<br>`lib/director-service.ts`<br>`lib/graphic-design-extraction.ts` | None | Keep |
| `DirectorAdapterInput` | `lib/agent-context.ts`<br>`lib/agent-model-call.ts`<br>`lib/agent-service.ts`<br>`lib/director-adapters/google.ts`<br>`lib/director-adapters/openai-chat.ts`<br>`lib/director-adapters/openai-responses.ts`<br>`lib/director-adapters/shared.ts` | `app/api/graphic-design/extract/route.test.ts`<br>`lib/director-adapters/adapters.test.ts`<br>`lib/director-adapters/completion.test.ts`<br>`lib/director-adapters/native-reasoning.test.ts` | Keep |
| `DirectorFinishReason` | `lib/director-adapters/shared.ts` | None | Keep |
| `DirectorAdapterResult` | `lib/agent-model-call.ts`<br>`lib/director-adapters/google.ts`<br>`lib/director-adapters/openai-chat.ts`<br>`lib/director-adapters/openai-responses.ts`<br>`lib/model-call-metrics.ts` | None | Keep |
| `DirectorModelAdapter` | `lib/director-adapters/google.ts`<br>`lib/director-adapters/openai-chat.ts`<br>`lib/director-adapters/openai-responses.ts`<br>`director/src/adapter-registry.ts` | `director/tests/adapter-registry.test.ts` | Keep |
| `GenerationRequirements` | `lib/agent-preflight.ts`<br>`director/src/routing.ts` | None | Keep |
| `DirectorCallDraft` | `director/src/routing.ts` | `lib/director-service.test.ts`<br>`director/tests/compiler.test.ts`<br>`director/tests/routing.test.ts` | Keep |
| `DirectorDecision` | `lib/director-service.ts` | None | Remove |
| `DirectorCatalogCandidate` | `lib/agent-catalog.ts`<br>`lib/director-catalog.ts`<br>`director/src/routing.ts` | `lib/agent-service.test.ts`<br>`lib/director-service.test.ts`<br>`director/tests/compiler.test.ts`<br>`director/tests/routing.test.ts` | Keep |
| `DirectorPricingStatus` | Same-file references | None | Keep |
| `DirectorQuoteBreakdown` | `director/src/routing.ts` | None | Keep |
| `DirectorQuote` | `lib/director-service.ts`<br>`director/src/routing.ts` | None | Keep |
| `RoutedDirectorCall` | `lib/agent-contracts.ts`<br>`lib/agent-graph.ts`<br>`lib/agent-service.ts`<br>`lib/director-contracts.ts`<br>`lib/director-service.ts`<br>`director/src/compiler.ts`<br>`director/src/routing.ts` | `director/tests/compiler.test.ts` | Keep |
| `DirectorCanvasNodeData` | Same-file references | None | Keep |
| `DirectorCanvasNode` | `director/src/compiler.ts` | None | Keep |
| `DirectorCanvasEdge` | `director/src/compiler.ts` | None | Keep |
| `DirectorGraphPatch` | `lib/agent-contracts.ts`<br>`lib/agent-graph.ts`<br>`lib/director-contracts.ts`<br>`lib/director-service.ts`<br>`director/src/compiler.ts` | None | Keep |
| `ExchangeRateTable` | `lib/director-rates.ts`<br>`director/src/routing.ts` | `director/tests/routing.test.ts` | Keep |
| `DirectorRoutingOptions` | `director/src/routing.ts` | None | Keep |

## Assets and maintenance entry points

| File/scope | Consumer and reason | Action |
| --- | --- | --- |
| `packages/director/src/index.ts` | Shared adapter/compiler/routing/schema/type barrel; only remove knowledge re-export | Partial cleanup |
| `packages/director/knowledge/**` | Only legacy service loading, knowledge tests, sync output and desktop staging | Remove all 20 tracked assets |
| `packages/director/src/knowledge.ts`, `knowledge-node.ts` | Only production caller is the removed service; every export is listed above | Remove |
| `packages/director/tests/knowledge.test.ts`, `knowledge-node.test.ts` | Test only the removed knowledge subsystem | Remove |
| `packages/director/scripts/sync-knowledge.mjs` | Package `sync:knowledge` script | Remove |
| `scripts/sync-super-director.mjs`, `sync-super-director.test.mjs` | Root `director:sync` and its maintenance test; only populate the unused knowledge package | Remove |
| `packages/director/package.json` | Remove knowledge file allowlist, `./node` knowledge entry and sync script; preserve package name and shared main entry | Partial cleanup |
| `package.json` | Remove only `director:sync` | Partial cleanup |
| `apps/desktop/scripts/stage.mjs` | Remove only the knowledge directory copy | Partial cleanup |
| `packages/director/tests/routing.test.ts`, `schemas.test.ts` | Remove only obsolete fingerprint/rate-schema cases; retain shared routing and schema coverage | Partial cleanup |

## Shared behavior retained

- `DirectorAdapterRegistry`, `compileDirectorGraphPatch`, routing, quoting and parameter mapping remain because the current creative agent uses them.
- `DIRECTOR_DECISION_JSON_SCHEMA`, `parseDirectorDecision`, `DirectorDecisionSchema` and their internal decision structure remain: shared protocol adapters still use the default response schema and parser fallback. Removing them would change current agent and graphic-design adapter behavior.
- `ExchangeRateTable` and currency calculation remain in the shared route signatures and behavior. Only the unused validation schema is removed.
- Connection descriptors, resolved connections, adapter inputs/results, capabilities, attachments, catalog candidates, generation requirements, quotes and graph types remain along their actual dependencies. No broad renaming.
- Music generation, personal AI website CLI and supplier implementation are outside this package change.
