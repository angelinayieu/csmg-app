"use client";

import { useEffect } from "react";

export type ToolboxEvent =
  | { type: "open-chat" }
  | { type: "open-comment" }
  | { type: "reevaluate"; depth: "light" | "standard" | "deep" }
  | { type: "refresh-strategy" }
  | { type: "quick-check" }
  | { type: "quick-decompose" }
  | { type: "research" };

const EVENT_NAME = "interaxis:toolbox";

export function dispatchToolboxEvent(evt: ToolboxEvent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToolboxEvent>(EVENT_NAME, { detail: evt }));
}

export function useToolboxEvents(handler: (evt: ToolboxEvent) => void) {
  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<ToolboxEvent>).detail;
      if (detail) handler(detail);
    };
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
  }, [handler]);
}
