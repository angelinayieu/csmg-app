// ── Binding Resolver ────────────────────────────────────────────────────
//
// Turns a DataBinding (source + selector) into a ResolvedBinding. The
// actual data fetchers are pluggable — the AppRenderer passes in a
// ResolverTable mapping DataSourceKind → resolver fn.
//
// Why pluggable rather than importing the data context directly:
//   - Keeps this library framework-agnostic (testable without React).
//   - Lets server code (preview/SSR) and client code share resolvers
//     without coupling to hooks.
//   - Lets Sprint 2 hook per-page data contexts without touching widgets.

import type { App } from "@/types/app";
import type {
  DataBinding,
  DataSourceKind,
} from "@/types/app-manifest";
import type { ResolvedBinding } from "./widget-context";

// ── Resolver signatures ────────────────────────────────────────────────

export type Resolver = (
  selector: Record<string, unknown> | undefined,
  ctx: ResolverContext
) => unknown;

export interface ResolverContext {
  app: App;
}

export type ResolverTable = Partial<Record<DataSourceKind, Resolver>>;

// ── Default resolvers ──────────────────────────────────────────────────
//
// Built-ins that don't need an external data context. More sophisticated
// resolvers (entity/intervention lookups against the space) are layered
// in by the page that mounts the AppRenderer.

const defaultResolvers: ResolverTable = {
  literal: (_selector, _ctx) => undefined, // handled in-line (see resolve below)
  app_state_field: (selector, ctx) => {
    if (!selector || typeof selector.field !== "string") return undefined;
    // Dotted-path read — e.g. "health_breakdown.momentum"
    return readPath(ctx.app.state as Record<string, unknown>, selector.field);
  },
  app_config_field: (selector, ctx) => {
    if (!selector || typeof selector.field !== "string") return undefined;
    return readPath(ctx.app.config as Record<string, unknown>, selector.field);
  },
};

// ── Public: build a resolver function the render context uses ──────────

export function makeResolve(
  table: ResolverTable,
  app: App
): <T = unknown>(binding: DataBinding | undefined) => ResolvedBinding<T> {
  return function resolve<T = unknown>(
    binding: DataBinding | undefined
  ): ResolvedBinding<T> {
    if (!binding) {
      return { status: "missing", value: null };
    }

    // Literal: value is inline — resolve immediately.
    if (binding.source === "literal") {
      return {
        status: "ok",
        value: (binding.value ?? binding.fallback ?? null) as T | null,
        used_fallback: binding.value == null && binding.fallback != null,
      };
    }

    const resolver = table[binding.source] ?? defaultResolvers[binding.source];
    if (!resolver) {
      return {
        status: "error",
        value: (binding.fallback ?? null) as T | null,
        error: `No resolver for source "${binding.source}"`,
        used_fallback: binding.fallback != null,
      };
    }

    try {
      const raw = resolver(binding.selector, { app });
      if (raw == null) {
        return {
          status: binding.fallback != null ? "ok" : "missing",
          value: (binding.fallback ?? null) as T | null,
          used_fallback: binding.fallback != null,
        };
      }
      return { status: "ok", value: raw as T };
    } catch (e) {
      return {
        status: "error",
        value: (binding.fallback ?? null) as T | null,
        error: e instanceof Error ? e.message : String(e),
        used_fallback: binding.fallback != null,
      };
    }
  };
}

// ── Internal helpers ───────────────────────────────────────────────────

function readPath(
  obj: Record<string, unknown> | undefined,
  path: string
): unknown {
  if (!obj) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
