"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { createCanvasPortalTarget } from "../lib/canvas-portal-target";

const edgeLabelTarget = createCanvasPortalTarget(".react-flow__edgelabel-renderer");
const selectEdgeLabelTarget = (state: { domNode: HTMLDivElement | null }) => edgeLabelTarget(state.domNode);

/** Reuse ReactFlow's host without scanning all node DOM for every edge/frame. */
export function CanvasEdgeLabelPortal({ children }: { children: ReactNode }) {
  const target = useStore(selectEdgeLabelTarget);
  return target ? createPortal(children, target) : null;
}
