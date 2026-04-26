// ── Canvas Bus (Sprint B.5 — decoupled navigation + dispatch) ────────
//
// Tldraw shape utils are class-level constructs — `onDoubleClick` etc.
// fire outside the React tree, so they can't use `useRouter()` or any
// other hook. Shapes still need to trigger navigation (open app detail
// page) and mutations (activate variant) in response to user input.
//
// This module is the thin seam that lets both worlds meet: the host
// React canvas component (InteraxisCanvas) registers its Next.js
// router + mutation handler on mount, and shape utils call the
// `canvasNavigate()` / `canvasDispatch()` helpers without caring
// where the wiring lands. Unregistered calls fall through silently.
//
// Keeping this in one tiny module (no hooks, no context provider, no
// fancy lifecycle) avoids context cascading through every shape util
// and keeps the dependency graph flat. The tradeoff is global state —
// if two canvases mount simultaneously the last-mounted wins. Acceptable
// because the app renders at most one InteraxisCanvas at a time.

import type { Router } from "next/router";

type Navigator = (href: string) => void;

/**
 * Dispatch payload schema — mirrors WidgetRenderContext.dispatch but
 * stripped of the Promise<DispatchResult> return contract because
 * canvas dispatches are optimistic (the painter re-renders from SSE,
 * not from the return value).
 */
export interface CanvasDispatchCall {
  widgetId: string;
  actionKey: string;
  payload?: Record<string, unknown>;
  /** Space + app context the shape knows about — helps the dispatcher
   *  route to the right endpoint without grepping manifest actions. */
  spaceId: string;
  appId: string | null;
}

type Dispatcher = (
  call: CanvasDispatchCall,
) => Promise<{ ok: boolean; reason?: string }>;

let registeredNavigator: Navigator | null = null;
let registeredDispatcher: Dispatcher | null = null;

/**
 * Register (or replace) the canvas navigator. Typical usage from a
 * React host component:
 *
 *   const router = useRouter();
 *   useEffect(() => {
 *     const unregister = setCanvasNavigator((href) => router.push(href));
 *     return unregister;
 *   }, [router]);
 *
 * Returns the unregistration callback so the host can tear down
 * cleanly on unmount — important in a SPA where an uncleared hook
 * would fire navigation after the host is gone.
 */
export function setCanvasNavigator(fn: Navigator): () => void {
  registeredNavigator = fn;
  return () => {
    if (registeredNavigator === fn) registeredNavigator = null;
  };
}

export function setCanvasDispatcher(fn: Dispatcher): () => void {
  registeredDispatcher = fn;
  return () => {
    if (registeredDispatcher === fn) registeredDispatcher = null;
  };
}

/**
 * Fire-and-forget navigate. Silent no-op if no navigator is registered
 * (e.g. shape util rendered inside a test harness, or during SSR).
 * Catches the common mistake of passing a `null`/`undefined` href.
 */
export function canvasNavigate(href: string | null | undefined): void {
  if (!href) return;
  if (!registeredNavigator) {
    if (typeof window !== "undefined") {
      // Last-resort fallback so a user clicking before the host's
      // effect runs still lands on the right page. Full-page nav,
      // not client-side — acceptable cost for a rare race.
      window.location.assign(href);
    }
    return;
  }
  try {
    registeredNavigator(href);
  } catch (err) {
    console.warn("[canvas-bus] navigator threw:", err);
  }
}

/**
 * Dispatch a widget action from inside a canvas shape. Returns a
 * typed result so the widget can branch on failure; rejected promises
 * map to `{ ok: false, reason }` so consumers don't have to wrap every
 * call in try/catch.
 */
export async function canvasDispatch(
  call: CanvasDispatchCall,
): Promise<{ ok: boolean; reason?: string }> {
  if (!registeredDispatcher) {
    return { ok: false, reason: "no-dispatcher" };
  }
  try {
    return await registeredDispatcher(call);
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error ? err.message : "canvas-dispatcher-threw",
    };
  }
}

// Re-export Router type so consumers that need it don't have to
// import next/router separately; not used inside this module today
// but kept for API stability.
export type { Router };
