"use client";

import { Play } from "lucide-react";
import type { createGenerationNodeRunAction } from "../lib/generation-node-actions";
import type { NodeParameterQuote } from "../lib/node-parameter-quote";

export function NodeParameterFooter({ label, quote, summary, runAction, beforeRun, reasonId }: {
  label: string;
  quote?: NodeParameterQuote;
  summary: string;
  runAction: ReturnType<typeof createGenerationNodeRunAction>;
  beforeRun: () => void;
  reasonId: string;
}) {
  return <footer className="node-config-footer" aria-label="本次运行">
    <div className="node-config-footer-main">
      <div className="node-config-footer-quote">
        <span>本次预计</span>
        <strong data-testid="param-panel-total-price">{quote?.displayCost ?? "—"}</strong>
        {summary && <small>{summary}</small>}
      </div>
      <button className="node-config-run" type="button" aria-label={`运行 ${label} 节点`}
        title={runAction.title} disabled={runAction.disabled}
        aria-describedby={runAction.disabled ? reasonId : undefined}
        onPointerDown={beforeRun}
        onClick={event => { event.stopPropagation(); runAction.run("node", beforeRun); }}>
        <Play size={14} /><span>{runAction.label}</span>
      </button>
    </div>
    {runAction.disabled && <small className="node-config-run-reason" id={reasonId} role="status">{runAction.title}</small>}
  </footer>;
}
