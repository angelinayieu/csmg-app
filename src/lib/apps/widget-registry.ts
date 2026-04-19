// ── Widget Registry ─────────────────────────────────────────────────────
//
// The only way the AppRenderer learns about widgets. Registering a widget
// does three things:
//   1. Maps a widget `type` string → React component.
//   2. Declares the widget's contract (required bindings/actions, etc.).
//   3. Makes it visible to the manifest validator.
//
// Agents producing manifests should only use widget types that appear in
// listWidgets() — but the renderer is defensive: unknown types render a
// placeholder rather than crash.
//
// ── Lifecycle ─────────────────────────────────────────────────────────
//
// Registration happens once at module load. See
// src/components/apps/widgets/index.ts for the bootstrap that imports this
// module and registers every starter widget. Modules that want to render
// an app should import './components/apps/widgets' once at startup.

import type { ComponentType } from "react";
import type {
  WidgetContract,
  WidgetInstance,
  WidgetCapability,
  WidgetCategory,
} from "@/types/app-manifest";
import type { WidgetRenderContext } from "./widget-context";

/**
 * The props every widget component receives. `instance` carries the
 * widget's manifest entry; `context` carries the render-time resolver
 * helpers (resolve bindings, dispatch actions, read the current App).
 */
export interface WidgetComponentProps<Config = Record<string, unknown>> {
  instance: WidgetInstance<Config>;
  context: WidgetRenderContext;
}

export interface RegisteredWidget {
  contract: WidgetContract;
  Component: ComponentType<WidgetComponentProps>;
}

// ── Registry state (module-scoped) ─────────────────────────────────────

const registry = new Map<string, RegisteredWidget>();

/**
 * Register a widget. Idempotent — re-registering with the same type
 * replaces the prior entry (useful for HMR). Logs a warning in dev so
 * accidental name collisions are visible.
 */
export function registerWidget<Config = Record<string, unknown>>(
  contract: WidgetContract,
  Component: ComponentType<WidgetComponentProps<Config>>
): void {
  if (registry.has(contract.type) && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      `[widget-registry] Overwriting existing widget type "${contract.type}". ` +
        `This is fine during HMR; investigate if it happens in a prod build.`
    );
  }
  registry.set(contract.type, {
    contract,
    // Widen the component type for storage; props narrow at render via cast.
    Component: Component as ComponentType<WidgetComponentProps>,
  });
}

/**
 * Look up a widget by type. Returns undefined for unknown types — callers
 * should render a placeholder rather than throwing.
 */
export function getWidget(type: string): RegisteredWidget | undefined {
  return registry.get(type);
}

/**
 * Enumerate all registered widgets. Used by the validator to check that
 * every widget type in a manifest is known, and by introspection tools.
 */
export function listWidgets(): RegisteredWidget[] {
  return Array.from(registry.values());
}

/**
 * Lookup a widget contract without the component. Useful for validation
 * pipelines that don't want to bundle React.
 */
export function getContract(type: string): WidgetContract | undefined {
  return registry.get(type)?.contract;
}

/**
 * Reset the registry — test-only. In production the registry is populated
 * once at module load and never cleared.
 */
export function __resetRegistry(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetRegistry must not be called in production");
  }
  registry.clear();
}

/**
 * Snapshot of all known widget types. Convenient for validators that want
 * the set without importing React.
 */
export function knownWidgetTypes(): Set<string> {
  return new Set(registry.keys());
}

/**
 * Enumerate widgets whose contract declares the given capability. The
 * manifest builder uses this to discover widgets that should be injected
 * for each entry in a proposal's `mechanism_hints`. Stable ordering
 * (insertion order from the Map) keeps the resulting manifests
 * deterministic across renders.
 */
export function listWidgetsByCapability(
  capability: WidgetCapability,
): RegisteredWidget[] {
  return listWidgets().filter((w) =>
    (w.contract.capabilities ?? []).includes(capability),
  );
}

/**
 * Enumerate widgets by category — intended for UI grouping in a future
 * widget picker / palette. Widgets without a declared category default
 * to "core" when asked, matching pre-Item-3 behavior.
 */
export function listWidgetsByCategory(
  category: WidgetCategory,
): RegisteredWidget[] {
  return listWidgets().filter(
    (w) => (w.contract.category ?? "core") === category,
  );
}
