"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";

/** Only change a CSS boundary when crossing the threshold, never node data/keys. */
export const CanvasLevelOfDetail = memo(function CanvasLevelOfDetail() {
  const flow = useStoreApi();
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const viewport = marker.current?.closest(".react-flow")?.querySelector(".react-flow__viewport");
    if (!viewport) return;
    let previous: boolean | undefined;
    const update = () => {
      const compact = flow.getState().transform[2] < .55;
      if (compact === previous) return;
      viewport.classList.toggle("canvas-lod-compact", compact);
      previous = compact;
    };
    update();
    const unsubscribe = flow.subscribe(update);
    return () => { unsubscribe(); viewport.classList.remove("canvas-lod-compact"); };
  }, [flow]);
  return <span ref={marker} hidden aria-hidden="true" />;
});
