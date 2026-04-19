// ── Widget Render Context ───────────────────────────────────────────────
//
// What every widget receives alongside its manifest entry. Widgets stay
// ignorant of endpoints + global state: they call `resolve(binding)` to
// read data and `dispatch(actionId)` to mutate — nothing else.
//
// The AppRenderer constructs this context once per render from the App
// row + the current space's data. Widgets are pure functions of it.

import type { App } from "@/types/app";
import type {
  ActionBinding,
  ActionKind,
  AppManifest,
  DataBinding,
} from "@/types/app-manifest";

// ── Resolver result ────────────────────────────────────────────────────

/**
 * Resolved binding — always has a `value` (possibly null) and a `status`
 * the widget can branch on. Loading/error are first-class so widgets can
 * render skeletons without each one inventing its own state machine.
 */
export interface ResolvedBinding<T = unknown> {
  status: "ok" | "loading" | "missing" | "error";
  value: T | null;
  error?: string;
  /** Did we fall back to the binding.fallback value. */
  used_fallback?: boolean;
}

// ── Dispatch result ────────────────────────────────────────────────────

export interface DispatchResult {
  ok: boolean;
  /** If the dispatcher refused (e.g. guard failed), why. */
  reason?: string;
  /** Optional server-returned payload (e.g. the updated app). */
  payload?: unknown;
}

// ── Context shape ──────────────────────────────────────────────────────

export interface WidgetRenderContext {
  /** The App this manifest belongs to. Read-only. */
  app: App;
  /** The full manifest being rendered (so widgets can peek at siblings). */
  manifest: AppManifest;

  /**
   * Resolve a data binding against the current data context. The generic
   * is a narrowing cast, not a runtime guarantee — widgets pass the shape
   * they expect and must tolerate null/wrong-type results (status !== "ok").
   */
  resolve: <T = unknown>(binding: DataBinding | undefined) => ResolvedBinding<T>;

  /**
   * Dispatch an action by its *local widget key* (e.g. "primary") OR its
   * manifest-level id (e.g. "complete_intervention_5"). The renderer maps
   * the local key to the ActionBinding on the widget instance.
   */
  dispatch(
    widgetId: string,
    actionKey: string,
    payload?: Record<string, unknown>
  ): Promise<DispatchResult>;

  /**
   * Look up an action binding by its id (manifest.actions[].id). Widgets
   * need this to render button labels and evaluate guards.
   */
  getAction(actionId: string): ActionBinding | undefined;

  /** Evaluate an action's guard; true means "available." */
  isActionAvailable(actionId: string): boolean;

  /**
   * Navigate to a URL within the app shell. Widgets use this for
   * "open entity", "open whiteboard" flows. The implementation is
   * host-provided (AppRenderer wires this up).
   */
  navigate(href: string): void;

  /**
   * Is this render in "preview" mode — i.e. showing a manifest that has
   * not been saved or is being edited. Widgets may suppress destructive
   * actions when this is true.
   */
  preview?: boolean;
}

// ── Utility: convert an ActionKind to a readable fallback label ────────

export function defaultActionLabel(kind: ActionKind): string {
  switch (kind) {
    case "log_observation": return "Log observation";
    case "complete_intervention": return "Mark complete";
    case "accept_agent_suggestion": return "Accept";
    case "reject_agent_suggestion": return "Dismiss";
    case "open_sub_whiteboard": return "Open whiteboard";
    case "refresh_app": return "Refresh";
    case "focus_entity": return "Open entity";
    case "focus_intervention": return "Open intervention";
    case "focus_goal": return "Open goal";
    default:
      // custom:* — make it readable
      if (typeof kind === "string" && kind.startsWith("custom:")) {
        return kind.slice("custom:".length).replace(/_/g, " ");
      }
      return "Action";
  }
}
