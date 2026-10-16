"use client";

import { memo } from "react";
import type { CanvasNodeData } from "./types";
import { GenerationNodeBody } from "./workflow-node";
import "./canvas-parameter-dock.css";

export interface CanvasParameterDockProps {
  nodeId: string;
  data: CanvasNodeData;
  /** Only the keyboard-active card owns Escape and an open model menu. */
  active: boolean;
  /** Keep the keyed instance/drafts/scroll while a narrow-screen tab is hidden. */
  hidden?: boolean;
  onRequestClose: () => void;
  onRequestFocus: () => void;
  registerPanelElement?: (element: HTMLElement | null) => void;
}

/** Root owns this card. Its source React Flow node may be culled independently. */
export const CanvasParameterDock = memo(function CanvasParameterDock({
  nodeId,
  data,
  active,
  hidden = false,
  onRequestClose,
  onRequestFocus,
  registerPanelElement,
}: CanvasParameterDockProps) {
  return (
    <div
      className="canvas-parameter-dock"
      hidden={hidden}
      inert={hidden || undefined}
      data-parameter-node-id={nodeId}
      data-node-type={data.nodeType}
      data-active={active && !hidden}
    >
      <GenerationNodeBody
        presentation="parameters"
        nodeId={nodeId}
        data={data}
        active={active && !hidden}
        onRequestClose={onRequestClose}
        onRequestFocus={onRequestFocus}
        registerPanelElement={registerPanelElement}
      />
    </div>
  );
});
