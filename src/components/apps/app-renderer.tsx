"use client";

// ── AppRenderer ────────────────────────────────────────────────────────
//
// The one component that ever renders an App. Given an App (row +
// hydrated config/state), it:
//   1. Loads + sanitizes the manifest (placeholder on failure).
//   2. Builds a WidgetRenderContext with pluggable resolvers.
//   3. Packs widgets into a grid honoring their slot hints.
//   4. Renders each widget through its registered component.
//
// Intentionally accepts a `resolverTable` prop — Sprint 2 pages will
// pass resolvers for `entity`/`intervention`/synthesis_*` that read from
// the current space's data context. Sprint 0 ships with the app_state
// + app_config + literal resolvers built in (sufficient for smoke tests).

import { useEffect, useMemo, useRef, useState } from "react";
import type { App } from "@/types/app";
import type {
  ActionBinding,
  AppLayout,
  AppManifest,
  DataBinding,
  WidgetInstance,
} from "@/types/app-manifest";
import type { AppPreferences } from "@/types/app-preferences";
import { loadManifestForRender } from "@/lib/apps/manifest-validator";
import { getWidget } from "@/lib/apps/widget-registry";
import { makeResolve, type ResolverTable } from "@/lib/apps/binding-resolver";
import { applyPreferencesToManifest } from "@/lib/apps/preferences";
import type {
  DispatchResult,
  ResolvedBinding,
  WidgetRenderContext,
} from "@/lib/apps/widget-context";
import { cn } from "@/lib/utils";

// Importing the bootstrap registers every starter widget as a side-effect.
import "./widgets";

// ── Props ──────────────────────────────────────────────────────────────

export interface AppRendererProps {
  app: App;
  /** Optional: additional resolvers beyond the built-ins. */
  resolverTable?: ResolverTable;
  /**
   * Optional: host-level navigate. Called by built-in nav actions
   * (open_sub_whiteboard, focus_entity, etc.). Defaults to window.location.
   */
  onNavigate?: (href: string) => void;
  /**
   * Optional: callback when the server reports the App was updated by
   * an action dispatch. Lets parent refresh its local copy.
   */
  onAppUpdated?: (app: App) => void;
  /** Preview mode — suppresses destructive actions. */
  preview?: boolean;
  /** Visual override to pass through to the outer wrapper. */
  className?: string;
  /**
   * Per-user preferences merged on top of the canonical manifest at
   * render time. If omitted, the renderer fetches them itself from
   * `/api/apps/:id/preferences`. Pass explicitly from server-rendered
   * pages to avoid the round-trip.
   */
  preferences?: AppPreferences;
  /**
   * Disable interaction-count tracking (default: false). Useful in
   * previews and tests.
   */
  disable_interaction_tracking?: boolean;
}

// ── The component ──────────────────────────────────────────────────────

export function AppRenderer({
  app,
  resolverTable,
  onNavigate,
  onAppUpdated,
  preview,
  className,
  preferences,
  disable_interaction_tracking,
}: AppRendererProps) {
  // Keep a mutable ref to the latest App so dispatch() always sees the
  // freshest copy (e.g. after an earlier action updated state).
  const liveAppRef = useRef<App>(app);
  liveAppRef.current = app;

  const [pending, setPending] = useState(false);

  // ── Preferences: load lazily if the caller didn't provide them ──
  const [fetchedPrefs, setFetchedPrefs] = useState<AppPreferences | null>(null);
  useEffect(() => {
    if (preferences !== undefined) return; // caller-supplied wins
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/apps/${app.id}/preferences`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { preferences?: AppPreferences };
        if (!cancelled) setFetchedPrefs(json.preferences ?? {});
      } catch {
        /* preferences failures are non-fatal — renderer uses manifest as-is */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.id, preferences]);

  const effectivePreferences: AppPreferences =
    preferences ?? fetchedPrefs ?? {};

  const { manifest, issues } = useMemo(() => {
    const loaded = loadManifestForRender(app.config.manifest);
    // Layer user preferences on top of the canonical manifest.
    // Canonical manifest stays agent-authored; this merge is at-render only.
    return {
      manifest: applyPreferencesToManifest(loaded.manifest, effectivePreferences),
      issues: loaded.issues,
    };
  }, [app.config.manifest, effectivePreferences]);

  // Build the resolve() helper fresh whenever the App changes.
  const resolve = useMemo(
    () => makeResolve(resolverTable ?? {}, app),
    [resolverTable, app]
  );

  const actionById = useMemo(() => {
    const m = new Map<string, ActionBinding>();
    for (const a of manifest.actions ?? []) m.set(a.id, a);
    return m;
  }, [manifest]);

  const navigate = onNavigate ?? ((href: string) => {
    if (typeof window !== "undefined") window.location.href = href;
  });

  // ── Build the context every widget shares ──
  const context: WidgetRenderContext = useMemo(() => {
    function isActionAvailable(actionId: string): boolean {
      const action = actionById.get(actionId);
      if (!action?.guard) return true;
      const liveApp = liveAppRef.current;
      const localResolve = makeResolve(resolverTable ?? {}, liveApp);
      if (action.guard.when_truthy) {
        const r: ResolvedBinding = localResolve(action.guard.when_truthy);
        if (!r.value) return false;
      }
      if (action.guard.when_equals) {
        const r: ResolvedBinding = localResolve(action.guard.when_equals.binding);
        if (r.value !== action.guard.when_equals.value) return false;
      }
      return true;
    }

    async function dispatch(
      widgetId: string,
      actionKey: string,
      payload?: Record<string, unknown>
    ): Promise<DispatchResult> {
      const widget = manifest.widgets.find((w) => w.id === widgetId);
      const actionId = widget?.actions?.[actionKey];
      if (!actionId) {
        return { ok: false, reason: `No action "${actionKey}" on widget "${widgetId}"` };
      }
      const action = actionById.get(actionId);
      if (!action) {
        return { ok: false, reason: `Action "${actionId}" not in manifest` };
      }

      if (!isActionAvailable(actionId)) {
        return { ok: false, reason: "Action guard failed" };
      }

      // Fire-and-forget interaction counter (skip in preview mode).
      if (!disable_interaction_tracking && !preview) {
        void fetch(`/api/apps/${liveAppRef.current.id}/preferences/interaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ widget_id: widgetId }),
          keepalive: true,
        }).catch(() => {
          /* best-effort only — never blocks the action */
        });
      }

      // Client-side nav actions don't round-trip.
      if (
        action.kind === "open_sub_whiteboard" ||
        action.kind === "focus_entity" ||
        action.kind === "focus_intervention" ||
        action.kind === "focus_goal"
      ) {
        const href = buildNavHref(action, payload, liveAppRef.current);
        if (href) navigate(href);
        return { ok: true };
      }

      // Server round-trip through the uniform action endpoint.
      setPending(true);
      try {
        const res = await fetch(`/api/apps/${liveAppRef.current.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: action.kind,
            payload: { ...(action.payload ?? {}), ...(payload ?? {}) },
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          app?: App;
          error?: string;
          extra?: unknown;
        };
        if (!res.ok) {
          return { ok: false, reason: json.error ?? `HTTP ${res.status}` };
        }
        if (json.app) {
          liveAppRef.current = json.app;
          onAppUpdated?.(json.app);
        }
        // Tier 8 real-data wiring: nudge the PulseBar to refetch
        // immediately. Widget actions frequently produce events that
        // belong in the activity feed (log_prediction → agent_run,
        // escalate_to_research → research_finding, end_experiment →
        // prediction_resolved, run_simulation → scenario saved). Rather
        // than opt-in per action, we dispatch on any successful widget
        // action — it's cheap (one fetch) and keeps the bar feeling
        // alive. Import is dynamic to avoid a circular dep through the
        // pulse barrel.
        import("@/components/pulse").then((m) => m.dispatchPulseRefresh?.()).catch(() => {
          /* pulse refresh is non-critical */
        });
        return { ok: true, payload: json.extra };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      } finally {
        setPending(false);
      }
    }

    return {
      app,
      manifest,
      resolve,
      dispatch,
      getAction: (id) => actionById.get(id),
      isActionAvailable,
      navigate,
      preview,
    };
    // disable_interaction_tracking is captured by dispatch closure and doesn't
    // need to be in deps — it's a boolean flag that rarely changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, manifest, actionById, resolve, resolverTable, navigate, onAppUpdated, preview]);

  // ── Layout packing ──
  const columns = manifest.layout.columns ?? 3;
  const packed = packIntoColumns(manifest.widgets, columns);

  return (
    <div
      className={cn(
        "relative w-full",
        pending && "[&_button]:cursor-wait",
        className
      )}
    >
      {process.env.NODE_ENV !== "production" && issues.length > 0 && (
        <ManifestIssuesBanner issues={issues} />
      )}
      <LayoutGrid layout={manifest.layout}>
        {packed.map((widget) => (
          <WidgetSlot key={widget.id} widget={widget}>
            <WidgetHost widget={widget} context={context} />
          </WidgetSlot>
        ))}
      </LayoutGrid>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function LayoutGrid({
  layout,
  children,
}: {
  layout: AppLayout;
  children: React.ReactNode;
}) {
  const columns = layout.columns ?? 3;
  const gap =
    layout.density === "compact"
      ? "gap-3"
      : layout.density === "comfortable"
      ? "gap-5"
      : "gap-4";

  if (layout.kind === "workflow") {
    // Vertical stack — one column regardless of layout.columns.
    return <div className={cn("flex flex-col", gap)}>{children}</div>;
  }

  const colClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
      ? "grid-cols-1 md:grid-cols-2"
      : columns === 3
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";

  return <div className={cn("grid", gap, colClass)}>{children}</div>;
}

function WidgetSlot({
  widget,
  children,
}: {
  widget: WidgetInstance;
  children: React.ReactNode;
}) {
  const span = widget.slot?.span ?? 1;
  const spanClass =
    span === 4 ? "lg:col-span-4" : span === 3 ? "lg:col-span-3" : span === 2 ? "md:col-span-2" : "";
  return <div className={spanClass}>{children}</div>;
}

function WidgetHost({
  widget,
  context,
}: {
  widget: WidgetInstance;
  context: WidgetRenderContext;
}) {
  const entry = getWidget(widget.type);
  if (!entry) {
    const fallback = getWidget("__unknown__");
    if (!fallback) return null; // bootstrap should prevent this
    const Fallback = fallback.Component;
    return <Fallback instance={widget} context={context} />;
  }
  const Component = entry.Component;
  return <Component instance={widget} context={context} />;
}

function ManifestIssuesBanner({
  issues,
}: {
  issues: ReturnType<typeof loadManifestForRender>["issues"];
}) {
  if (issues.length === 0) return null;
  return (
    <details className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] text-amber-800">
      <summary className="cursor-pointer font-semibold">
        Manifest issues ({issues.length})
      </summary>
      <ul className="mt-2 space-y-0.5">
        {issues.map((it, i) => (
          <li key={i}>
            <span className="font-mono">{it.path}</span>: {it.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function packIntoColumns(
  widgets: WidgetInstance[],
  _columns: number
): WidgetInstance[] {
  // Sort by (column, order) so the grid flow matches author intent.
  return [...widgets].sort((a, b) => {
    const ac = a.slot?.column ?? 99;
    const bc = b.slot?.column ?? 99;
    if (ac !== bc) return ac - bc;
    const ao = a.slot?.order ?? 0;
    const bo = b.slot?.order ?? 0;
    return ao - bo;
  });
}

function buildNavHref(
  action: ActionBinding,
  payload: Record<string, unknown> | undefined,
  app: App
): string | null {
  const merged = { ...(action.payload ?? {}), ...(payload ?? {}) };
  switch (action.kind) {
    case "open_sub_whiteboard":
      // Per-app whiteboard route is preferred when the app has a sub_space;
      // otherwise fall back to the parent space's main whiteboard.
      return app.sub_space_id
        ? `/app/space/${app.space_id}/app/${app.id}/whiteboard`
        : `/app/space/${app.space_id}/whiteboard`;
    case "focus_entity": {
      const id = typeof merged.entity_id === "string" ? merged.entity_id : null;
      if (!id) return null;
      return `/app/space/${app.space_id}/entity/${id}`;
    }
    case "focus_intervention": {
      const id =
        typeof merged.intervention_id === "string"
          ? merged.intervention_id
          : null;
      if (!id) return null;
      // First-class interventions list (replaced the old /actions route).
      return `/app/space/${app.space_id}/interventions#intervention-${id}`;
    }
    case "focus_goal": {
      const id = typeof merged.goal_id === "string" ? merged.goal_id : null;
      if (!id) return null;
      return `/app/space/${app.space_id}/objectives#goal-${id}`;
    }
    default:
      return null;
  }
}
