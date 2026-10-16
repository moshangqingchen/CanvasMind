"use client";

import { useEffect, useRef } from "react";
import { mountNeuralScene, type NeuralSceneOptions } from "../lib/neural-scene-renderer";

export type NeuralSceneProps = NeuralSceneOptions;

/** Decorations only: all navigation and focusable hit areas live in the DOM above this layer. */
export function NeuralScene(props: NeuralSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const scene = useRef<ReturnType<typeof mountNeuralScene> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const runtime = mountNeuralScene(host.current, latest.current);
    scene.current = runtime;
    return () => { runtime.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { latest.current = props; scene.current?.update(props); }, [props]);
  return <div ref={host} className="neural-scene" data-testid="neural-scene" aria-hidden="true" />;
}

export default NeuralScene;
