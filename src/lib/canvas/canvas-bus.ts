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
let registeredExtractionReviewer: ExtractionReviewer | null = null;
let registeredStickyPinner: StickyPinner | null = null;

/**
 * HITL extraction-review trigger registered by the canvas host.
 * Asset-card shapes call canvasOpenExtractionReview() on user
 * interaction (click / dedicated button) and the host's hook
 * (useExtractionReview) opens the drawer + drives the /preview
 * route.
 *
 * See src/components/canvas/hooks/use-extraction-review.ts.
 */
type ExtractionReviewer = (input: {
  assetId: string;
  assetName: string;
  assetClass?: string | null;
  force?: boolean;
}) => void;

/**
 * Pin-as-sticky trigger. Surfaces highlighted text from a chrome panel
 * (typically the strategy drawer) onto the canvas as a sticky-note that
 * AutoDecompose can pick up. The host (interaxis-canvas) registers a
 * handler that knows how to place the sticky at a sensible canvas
 * location (viewport center, with offset for stacked drops).
 */
type StickyPinner = (input: {
  text: string;
  /** Free-form provenance string ("strategy-drawer-highlight", "synthesis", …)
   *  — surfaces in dev tools / future telemetry but not user-visible. */
  source?: string;
}) => void;

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

/**
 * Register (or replace) the extraction-review trigger. Typical usage
 * from a React host:
 *
 *   const review = useExtractionReview();
 *   useEffect(() => {
 *     const unregister = setCanvasExtractionReviewer((input) => {
 *       void review.open(input);
 *     });
 *     return unregister;
 *   }, [review.open]);
 */
export function setCanvasExtractionReviewer(
  fn: ExtractionReviewer,
): () => void {
  registeredExtractionReviewer = fn;
  return () => {
    if (registeredExtractionReviewer === fn) {
      registeredExtractionReviewer = null;
    }
  };
}

/**
 * Fire the extraction-review drawer for an asset. Silent no-op if no
 * reviewer is registered (e.g. shape util rendered in a context
 * without the host hook). Called from asset-card shape utils on
 * double-click / dedicated review button.
 */
export function canvasOpenExtractionReview(input: {
  assetId: string;
  assetName: string;
  assetClass?: string | null;
  force?: boolean;
}): void {
  if (!input.assetId) return;
  if (!registeredExtractionReviewer) {
    console.warn(
      "[canvas-bus] canvasOpenExtractionReview called but no reviewer registered",
    );
    return;
  }
  try {
    registeredExtractionReviewer(input);
  } catch (err) {
    console.warn("[canvas-bus] extraction reviewer threw:", err);
  }
}

/**
 * Register the sticky-pinner. Typical host usage:
 *
 *   useEffect(() => setCanvasStickyPinner(({ text }) => {
 *     // create sticky-note shape at viewport center
 *   }), [editor]);
 */
export function setCanvasStickyPinner(fn: StickyPinner): () => void {
  registeredStickyPinner = fn;
  return () => {
    if (registeredStickyPinner === fn) registeredStickyPinner = null;
  };
}

/** Pin a piece of text onto the canvas as a sticky-note. AutoDecompose
 *  will pick it up after the standard idle window. Silent no-op when no
 *  canvas is mounted (e.g. user is on a non-whiteboard page). */
export function canvasPinAsSticky(input: {
  text: string;
  source?: string;
}): void {
  const text = input.text.trim();
  if (!text) return;
  if (!registeredStickyPinner) {
    console.warn(
      "[canvas-bus] canvasPinAsSticky called but no pinner registered",
    );
    return;
  }
  try {
    registeredStickyPinner({ text, source: input.source });
  } catch (err) {
    console.warn("[canvas-bus] sticky pinner threw:", err);
  }
}

// Re-export Router type so consumers that need it don't have to
// import next/router separately; not used inside this module today
// but kept for API stability.
export type { Router };
