/**
 * Test-only selector migration inventory. The renderer does not import this
 * module. An A/B harness can replace the explicit selector branches in CSSOM
 * with legacySelector in the SAME rule, retaining declarations and cascade
 * order. Do not append duplicate legacy rules over the production rules.
 *
 * Match selector branches at top-level commas (not commas nested inside :is).
 * A production CSS optimizer may merge a rule with unrelated selectors: retain
 * those branches and replace only the explicitSelectors listed here. The
 * original descendant data attributes remain available in both A/B arms.
 */
export interface CanvasNodeSelectorMigration {
  id: string;
  source: "app/globals.css" | "app/canvas-workbench.css";
  legacySelector: string;
  explicitSelectors: readonly string[];
}

export const CANVAS_NODE_SELECTOR_MIGRATIONS: readonly CanvasNodeSelectorMigration[] = [
  {
    id: "image-reference-minimum",
    source: "app/globals.css",
    legacySelector: '.react-flow__node-workflow:has(.node-card[data-has-image-reference="true"])',
    explicitSelectors: [".react-flow__node-workflow.canvas-node-has-image-reference.canvas-node-has-image-reference"],
  },
  {
    id: "image-mask-minimum",
    source: "app/globals.css",
    legacySelector: '.react-flow__node-workflow:has(.node-card[data-mask-edit="true"])',
    explicitSelectors: [".react-flow__node-workflow.canvas-node-mask-edit.canvas-node-mask-edit"],
  },
  {
    id: "parameter-node-stack",
    source: "app/globals.css",
    legacySelector: ".react-flow__node-workflow:has(.node-config-popover)",
    explicitSelectors: [".react-flow__node-workflow[data-node-config-open]"],
  },
  {
    id: "parameter-viewport-stack",
    source: "app/globals.css",
    legacySelector: ".react-flow__viewport:has(.node-config-popover)",
    explicitSelectors: [".react-flow__viewport[data-node-config-open]"],
  },
  {
    id: "parameter-input-width",
    source: "app/globals.css",
    legacySelector: ".parameter-grid :is(input, select, textarea)",
    explicitSelectors: [".parameter-grid input", ".parameter-grid select", ".parameter-grid textarea"],
  },
  {
    id: "audio-node-color",
    source: "app/canvas-workbench.css",
    legacySelector: '.canvas-editor .node-card:is([data-node-type="music-generation"], [data-node-type="audio-generation"])',
    explicitSelectors: [
      '.canvas-editor .node-card[data-node-type="music-generation"]',
      '.canvas-editor .node-card[data-node-type="audio-generation"]',
    ],
  },
  {
    id: "node-editor-surface",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor .node-card :is(.node-inline-editor, .prompt-node-editor, .tiptap-prompt)",
    explicitSelectors: [
      ".canvas-editor .node-card .node-inline-editor",
      ".canvas-editor .node-card .prompt-node-editor",
      ".canvas-editor .node-card .tiptap-prompt",
    ],
  },
  {
    id: "node-toolbar-control",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor .node-inline-toolbar :is(button, select)",
    explicitSelectors: [".canvas-editor .node-inline-toolbar button", ".canvas-editor .node-inline-toolbar select"],
  },
  {
    id: "linked-asset-surface",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.node-linked-asset, .node-preview)",
    explicitSelectors: [".canvas-editor .node-linked-asset", ".canvas-editor .node-preview"],
  },
  {
    id: "node-copy-emphasis",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.node-linked-asset-copy strong, .node-config-copy strong)",
    explicitSelectors: [".canvas-editor .node-linked-asset-copy strong", ".canvas-editor .node-config-copy strong"],
  },
  {
    id: "node-resize-visibility",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor .node-card:is(:hover, :focus-within) .node-resize-corner, .canvas-editor .react-flow__node:is(:hover, :focus-within) .node-resize-corner",
    explicitSelectors: [
      ".canvas-editor .node-card:hover .node-resize-corner",
      ".canvas-editor .node-card:focus-within .node-resize-corner",
      ".canvas-editor .react-flow__node:hover .node-resize-corner",
      ".canvas-editor .react-flow__node:focus-within .node-resize-corner",
    ],
  },
  ...(["image", "video", "audio"] as const).map(kind => ({
    id: `${kind}-port-color`,
    source: "app/canvas-workbench.css" as const,
    legacySelector: `.canvas-editor .react-flow__handle:is([data-port-kind="${kind}"], [data-port-kind="${kind}[]"])`,
    explicitSelectors: [
      `.canvas-editor .react-flow__handle[data-port-kind="${kind}"]`,
      `.canvas-editor .react-flow__handle[data-port-kind="${kind}[]"]`,
    ],
  })),
  {
    id: "node-port-label",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.port-label, .node-port-title)",
    explicitSelectors: [".canvas-editor .port-label", ".canvas-editor .node-port-title"],
  },
  {
    id: "result-media-surface",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.generated-result-media, .generated-result-viewport)",
    explicitSelectors: [".canvas-editor .generated-result-media", ".canvas-editor .generated-result-viewport"],
  },
  {
    id: "result-alpha-surface",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.generated-result-media, .generated-result-viewport).node-image-transparent, .canvas-editor .generated-result-node.node-image-transparent",
    explicitSelectors: [
      ".canvas-editor .generated-result-media.node-image-transparent",
      ".canvas-editor .generated-result-viewport.node-image-transparent",
      ".canvas-editor .generated-result-node.node-image-transparent",
    ],
  },
  {
    id: "result-action-surface",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.generated-result-actions, .generated-result-provenance-overlay, .result-info-button)",
    explicitSelectors: [
      ".canvas-editor .generated-result-actions",
      ".canvas-editor .generated-result-provenance-overlay",
      ".canvas-editor .result-info-button",
    ],
  },
  {
    id: "parameter-quote-text",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.node-config-supplier-quote, .field-note, .node-config-price-summary)",
    explicitSelectors: [
      ".canvas-editor .node-config-supplier-quote",
      ".canvas-editor .field-note",
      ".canvas-editor .node-config-price-summary",
    ],
  },
  {
    id: "parameter-price-emphasis",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.node-config-price-summary strong, .model-resolution-choice strong)",
    explicitSelectors: [".canvas-editor .node-config-price-summary strong", ".canvas-editor .model-resolution-choice strong"],
  },
  {
    id: "parameter-notice-surface",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.node-model-availability, .node-linked-warning, .node-config-connection-warning, .parameter-group-note)",
    explicitSelectors: [
      ".canvas-editor .node-model-availability",
      ".canvas-editor .node-linked-warning",
      ".canvas-editor .node-config-connection-warning",
      ".canvas-editor .parameter-group-note",
    ],
  },
  {
    id: "parameter-notice-error",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.node-model-availability.is-error, .node-model-availability.is-unavailable)",
    explicitSelectors: [".canvas-editor .node-model-availability.is-error", ".canvas-editor .node-model-availability.is-unavailable"],
  },
  {
    id: "interaction-decoration",
    source: "app/canvas-workbench.css",
    legacySelector: '.canvas-editor .is-interacting :is(.node-card, .generated-result-node, .react-flow__handle):not([data-connection-compatible="true"])',
    explicitSelectors: [
      '.canvas-editor .is-interacting .node-card:not([data-connection-compatible="true"])',
      '.canvas-editor .is-interacting .generated-result-node:not([data-connection-compatible="true"])',
      '.canvas-editor .is-interacting .react-flow__handle:not([data-connection-compatible="true"])',
    ],
  },
  {
    id: "interaction-status-pause",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor .is-interacting :is(.node-progress-fill, .studio-edge-dash, .node-status)",
    explicitSelectors: [
      ".canvas-editor .is-interacting .node-progress-fill",
      ".canvas-editor .is-interacting .studio-edge-dash",
      ".canvas-editor .is-interacting .node-status",
    ],
  },
  {
    id: "interaction-edge-motion",
    source: "app/canvas-workbench.css",
    legacySelector: ".canvas-editor :is(.is-interacting, .is-layout-animating, .effects-paused, .connections-hidden) .studio-edge-motion",
    explicitSelectors: [
      ".canvas-editor .is-interacting .studio-edge-motion",
      ".canvas-editor .is-layout-animating .studio-edge-motion",
      ".canvas-editor .effects-paused .studio-edge-motion",
      ".canvas-editor .connections-hidden .studio-edge-motion",
    ],
  },
];
