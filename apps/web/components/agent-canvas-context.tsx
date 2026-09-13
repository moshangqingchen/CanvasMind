"use client";
import { createContext } from "react";
import type { CanvasResponse } from "../lib/client-api";
import type { RunSnapshot } from "./types";
export interface AgentCanvasResult {
  canvas?: CanvasResponse;
  run?: RunSnapshot | null;
}
export interface AgentCanvasBridge {
  perform<T extends AgentCanvasResult>(
    request: (revision: number) => Promise<T>,
  ): Promise<T>;
}
export const AgentCanvasContext = createContext<AgentCanvasBridge | null>(null);
