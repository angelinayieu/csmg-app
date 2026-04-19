// ── Manifest Validator ─────────────────────────────────────────────────
//
// Runs at two seams:
//   1. On read (AppRenderer): loads a manifest and sanitizes it before
//      handing to render. Unknown widget types become placeholders,
//      broken action refs get dropped. Nothing crashes.
//   2. On write (agent patch endpoints, Sprint 3): validates an agent's
//      proposed manifest before persisting. Rejects manifests with any
//      "error"-level issue; warnings pass but are logged.
//
// Intentionally lightweight: TypeScript already enforces author-time
// correctness. This validator's job is the *runtime* cases — stale agent
// outputs, manually edited JSON, version-skew manifests.

import {
  APP_MANIFEST_SCHEMA_VERSION,
  emptyManifest,
  type ActionBinding,
  type AppManifest,
  type ManifestIssue,
  type ManifestValidationResult,
  type WidgetInstance,
} from "@/types/app-manifest";
import { getContract, knownWidgetTypes } from "./widget-registry";

// ── Helpers ────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(path: string, message: string, hint?: string): ManifestIssue {
  return { level: "error", path, message, hint };
}
function warn(path: string, message: string, hint?: string): ManifestIssue {
  return { level: "warning", path, message, hint };
}

// ── Main entry ─────────────────────────────────────────────────────────

export function validateManifest(
  input: unknown
): ManifestValidationResult {
  const issues: ManifestIssue[] = [];

  // ── Top-level shape ──
  if (!isObject(input)) {
    return {
      ok: false,
      issues: [err("$", "Manifest is not an object")],
      sanitized: null,
    };
  }

  const m = input as Partial<AppManifest>;

  if (typeof m.schema_version !== "number") {
    return {
      ok: false,
      issues: [
        err(
          "schema_version",
          "Missing or non-numeric schema_version",
          `Expected ${APP_MANIFEST_SCHEMA_VERSION}`
        ),
      ],
      sanitized: null,
    };
  }

  if (m.schema_version > APP_MANIFEST_SCHEMA_VERSION) {
    // Newer than we understand — warn and try to render; future-proofing.
    issues.push(
      warn(
        "schema_version",
        `Manifest schema_version=${m.schema_version} is newer than renderer (${APP_MANIFEST_SCHEMA_VERSION}). ` +
          `Render may degrade.`,
        "Client upgrade may be required."
      )
    );
  }

  if (!Array.isArray(m.widgets)) {
    return {
      ok: false,
      issues: [err("widgets", "Missing or non-array widgets")],
      sanitized: null,
    };
  }

  // ── Layout ──
  const layout =
    isObject(m.layout) && typeof m.layout.kind === "string"
      ? m.layout
      : emptyManifest().layout;
  if (!isObject(m.layout)) {
    issues.push(warn("layout", "Missing layout — defaulted to dashboard"));
  }

  // ── Actions ──
  const sanitizedActions: ActionBinding[] = [];
  const seenActionIds = new Set<string>();
  if (Array.isArray(m.actions)) {
    m.actions.forEach((a, i) => {
      const path = `actions[${i}]`;
      if (!isObject(a)) {
        issues.push(err(path, "Not an object — dropped"));
        return;
      }
      const rec = a as Partial<ActionBinding>;
      if (typeof rec.id !== "string" || !rec.id) {
        issues.push(err(`${path}.id`, "Missing id — dropped"));
        return;
      }
      if (seenActionIds.has(rec.id)) {
        issues.push(err(`${path}.id`, `Duplicate action id "${rec.id}" — dropped`));
        return;
      }
      if (typeof rec.kind !== "string") {
        issues.push(err(`${path}.kind`, "Missing kind — dropped"));
        return;
      }
      if (typeof rec.label !== "string") {
        issues.push(warn(`${path}.label`, "Missing label — will fall back to kind-derived label"));
      }
      seenActionIds.add(rec.id);
      sanitizedActions.push(rec as ActionBinding);
    });
  }

  // ── Widgets ──
  const knownTypes = knownWidgetTypes();
  const sanitizedWidgets: WidgetInstance[] = [];
  const seenWidgetIds = new Set<string>();

  m.widgets.forEach((w, i) => {
    const path = `widgets[${i}]`;
    if (!isObject(w)) {
      issues.push(err(path, "Not an object — dropped"));
      return;
    }
    const rec = w as Partial<WidgetInstance>;
    if (typeof rec.id !== "string" || !rec.id) {
      issues.push(err(`${path}.id`, "Missing id — dropped"));
      return;
    }
    if (seenWidgetIds.has(rec.id)) {
      issues.push(err(`${path}.id`, `Duplicate widget id "${rec.id}" — dropped`));
      return;
    }
    if (typeof rec.type !== "string") {
      issues.push(err(`${path}.type`, "Missing type — dropped"));
      return;
    }

    // Unknown type → swap for placeholder but keep slot so layout is preserved.
    let effectiveType: string = rec.type;
    if (!knownTypes.has(rec.type)) {
      issues.push(
        warn(
          `${path}.type`,
          `Unknown widget type "${rec.type}" — rendered as placeholder`,
          "Register the widget or remove from manifest."
        )
      );
      effectiveType = "__unknown__";
    }

    // Check required bindings + actions against the contract.
    const contract = getContract(rec.type);
    if (contract) {
      for (const req of contract.required_bindings ?? []) {
        if (!rec.bindings || !(req in rec.bindings)) {
          issues.push(
            err(`${path}.bindings.${req}`, `Required binding "${req}" missing`)
          );
        }
      }
      for (const req of contract.required_actions ?? []) {
        const actionId = rec.actions?.[req];
        if (!actionId) {
          issues.push(
            err(`${path}.actions.${req}`, `Required action "${req}" missing`)
          );
        } else if (!seenActionIds.has(actionId)) {
          issues.push(
            err(
              `${path}.actions.${req}`,
              `Action "${req}" → "${actionId}" does not exist in manifest.actions`
            )
          );
        }
      }
    }

    // Action refs that point at undefined action ids → warn + strip the bad ref.
    const cleanedActions: Record<string, string> | undefined = rec.actions
      ? { ...rec.actions }
      : undefined;
    if (cleanedActions) {
      for (const [key, actionId] of Object.entries(cleanedActions)) {
        if (!seenActionIds.has(actionId)) {
          issues.push(
            warn(
              `${path}.actions.${key}`,
              `Action ref "${actionId}" not found — stripped`
            )
          );
          delete cleanedActions[key];
        }
      }
    }

    seenWidgetIds.add(rec.id);
    sanitizedWidgets.push({
      ...(rec as WidgetInstance),
      type: effectiveType,
      actions: cleanedActions,
    });
  });

  const hasError = issues.some((x) => x.level === "error");

  const sanitized: AppManifest = {
    schema_version: APP_MANIFEST_SCHEMA_VERSION,
    version: typeof m.version === "number" ? m.version : 0,
    layout,
    widgets: sanitizedWidgets,
    actions: sanitizedActions.length > 0 ? sanitizedActions : undefined,
    refresh: m.refresh,
    provenance: m.provenance,
  };

  return {
    ok: !hasError,
    issues,
    sanitized,
  };
}

/**
 * Convenience: load a (possibly malformed) manifest and always produce a
 * renderable result. If sanitization produced nothing renderable, fall
 * back to the empty manifest placeholder.
 */
export function loadManifestForRender(
  input: unknown
): { manifest: AppManifest; issues: ManifestIssue[] } {
  const res = validateManifest(input);
  if (res.sanitized && res.sanitized.widgets.length > 0) {
    return { manifest: res.sanitized, issues: res.issues };
  }
  return {
    manifest: emptyManifest(),
    issues: res.issues,
  };
}
