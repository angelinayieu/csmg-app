// ── Standalone Widget Context ─────────────────────────────────────────
//
// Sprint A (2026-04-24) — lightweight context builder so AppRenderer
// widgets can render OUTSIDE the AppRenderer. Tldraw shape wrappers
// (downstream-reality-shape, iv-decomposition-shape, variant-
// carousel-shape, etc.) serialize their data onto the shape and need
// to feed a WidgetComponentProps pair into the actual widget React
// components without booting the full resolver / dispatcher stack.
//
// Contract:
//   • Caller passes a plain { [bindingKey: string]: unknown } map of
//     pre-resolved values keyed by widget binding name.
//   • We build a WidgetInstance whose bindings reference those same
//     keys via a special marker, plus a WidgetRenderContext whose
//     resolve() reads the map.
//   • dispatch/navigate/getAction/isActionAvailable are no-ops so
//     interactive widgets render their visuals but user clicks that
//     would mutate data silently fail (canvas shapes are informational
//     — real interactions go through the App detail page).
//
// Widgets that *require* the full dispatcher (agent-workflow mutations,
// complete-intervention, etc.) should NOT be wrapped this way. The four
// widgets we're wrapping in Sprint A (DownstreamReality,
// IVDecomposition, VariantCarousel, StageNode) are all read-only
// visualizations.

import type { App } from "@/types/app";
import type {
  AppManifest,
  DataBinding,
  WidgetInstance,
} from "@/types/app-manifest";
import type {
  WidgetRenderContext,
  ResolvedBinding,
  DispatchResult,
} from "./widget-context";

// ── Marker so our stub resolver can tell which bindings it owns ──────

const STANDALONE_MARKER = "__standalone__";

interface StandaloneBinding extends DataBinding {
  /** Custom key the stub resolver uses to look up the value in dataMap. */
  [STANDALONE_MARKER]?: string;
}

/**
 * Build a DataBinding that the standalone context's resolve() can map
 * back to a pre-provided value. Source is set to "app_state_field" as
 * a typechecker-friendly placeholder — the stub never reads it.
 */
function bindingForKey(key: string): StandaloneBinding {
  return {
    source: "app_state_field",
    selector: { key },
    [STANDALONE_MARKER]: key,
  };
}

// ── Stub App + Manifest ────────────────────────────────────────────

/**
 * Minimal App shape for contexts where we don't have a real App row.
 * Cast through unknown because the App type is tied to Supabase rows
 * — the wrapped widgets don't read these fields, they only read what
 * resolve() hands them. Only fields actually read by the four wrapped
 * widgets need realistic values.
 */
function stubApp(spaceId: string, appId: string | null): App {
  // Intentional soft-cast — real App row has many DB-backed columns that
  // the Sprint A widgets never read. We only populate what's plausibly
  // useful to a read-only widget's optional chrome.
  return {
    id: appId ?? "standalone-app",
    space_id: spaceId,
    name: "Standalone",
    config: {},
    state: {},
  } as unknown as App;
}

function stubManifest(): AppManifest {
  return {
    version: 1,
    widgets: [],
    actions: [],
  } as unknown as AppManifest;
}

// ── Instance + context factory ─────────────────────────────────────

export interface StandaloneWidgetSetup<Config = Record<string, unknown>> {
  instance: WidgetInstance<Config>;
  context: WidgetRenderContext;
}

export interface BuildStandaloneOptions<Config = Record<string, unknown>> {
  widgetType: string;
  widgetId?: string;
  config?: Config;
  /** Pre-resolved values keyed by widget binding name. */
  data: Record<string, unknown>;
  spaceId: string;
  appId?: string | null;
  /**
   * Sprint B.5 — optional dispatch routing. When provided, widget
   * dispatch() calls are forwarded here instead of the silent
   * {ok:false, reason:"standalone-context"} stub. Callers typically
   * wire this to a canvas-bus dispatcher that POSTs to the right
   * endpoint (e.g. activate_variant → /api/experiment-variants/[id]/activate).
   * Returns DispatchResult shape so interactive widgets branch
   * correctly on failure.
   */
  onDispatch?: (
    widgetId: string,
    actionKey: string,
    payload?: Record<string, unknown>,
  ) => Promise<DispatchResult>;
  /**
   * Sprint B.5 — optional navigation routing. When provided, widget
   * navigate() calls are forwarded here. Falls back to a no-op
   * (current behavior) when absent. Canvas hosts usually wire this
   * through `canvasNavigate` from @/lib/canvas/canvas-bus so the
   * registered Next.js router takes over.
   */
  onNavigate?: (href: string) => void;
}

export function buildStandaloneWidgetSetup<Config = Record<string, unknown>>(
  opts: BuildStandaloneOptions<Config>,
): StandaloneWidgetSetup<Config> {
  const bindings: Record<string, DataBinding> = {};
  for (const key of Object.keys(opts.data)) {
    bindings[key] = bindingForKey(key);
  }

  const instance: WidgetInstance<Config> = {
    id: opts.widgetId ?? `standalone-${opts.widgetType}`,
    type: opts.widgetType,
    config: opts.config,
    bindings,
  };

  const app = stubApp(opts.spaceId, opts.appId ?? null);
  const manifest = stubManifest();

  const context: WidgetRenderContext = {
    app,
    manifest,
    resolve: <T = unknown>(binding: DataBinding | undefined): ResolvedBinding<T> => {
      if (!binding) {
        return { status: "missing", value: null };
      }
      const key = (binding as StandaloneBinding)[STANDALONE_MARKER];
      if (!key) {
        // Unknown binding — treat as missing rather than throwing.
        return { status: "missing", value: null };
      }
      const value = opts.data[key];
      if (value == null) {
        if (binding.fallback != null) {
          return {
            status: "ok",
            value: binding.fallback as T,
            used_fallback: true,
          };
        }
        return { status: "missing", value: null };
      }
      return { status: "ok", value: value as T };
    },
    dispatch: async (
      widgetId: string,
      actionKey: string,
      payload?: Record<string, unknown>,
    ): Promise<DispatchResult> => {
      // Sprint B.5 — route through the caller's handler if provided.
      // Canvas shapes wire this to canvasDispatch() so user clicks on
      // e.g. the variant carousel actually flip is_active in the DB.
      if (opts.onDispatch) {
        return opts.onDispatch(widgetId, actionKey, payload);
      }
      return {
        ok: false,
        reason: "standalone-context",
      };
    },
    getAction: () => undefined,
    isActionAvailable: () => false,
    navigate: (href: string) => {
      // Sprint B.5 — forward to the caller's navigator if provided.
      // Canvas shapes wire this to canvasNavigate() so the widget's
      // internal "open entity" links land on the right Next.js route.
      if (opts.onNavigate) {
        opts.onNavigate(href);
      }
      // No fallback — silent no-op is the old behavior and safer than
      // a surprise full-page redirect from a widget that just wanted
      // to log a no-op.
    },
    preview: false,
  };

  return { instance, context };
}
