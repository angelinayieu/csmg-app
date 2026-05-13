"use client";

// ── Variable Contract Card (W5.4 base + W5.8a override drawer) ──────
//
// Renders the App's variable contract — what IV/DV/control/mediator/
// moderator entities this app operates against. Reads:
//
//   • context.app.config.variables — AppVariableEntry[] populated by
//     derive-app-variables.ts at generation time
//   • context.app.config.mediator_light — denormalized parent
//     mechanism { id, name, kind } snapshot from W5.3
//
// W5.8a — Override drawer:
//   Each variable row is now clickable. Click opens a lightweight
//   inline drawer (no portal; absolute-positioned overlay) with:
//     - The current role + rationale (read-only)
//     - A role picker (all VariableRole values)
//     - Optional reasoning textarea
//     - Submit → dispatches the "primary" action (tune_variable),
//       which writes an override to environment_overrides and
//       triggers redriveAppVariablesForSpace
//   On success, the dispatcher returns the updated App; AppRenderer
//   swaps it into context, the widget re-renders with the new role.
//
// Empty states:
//   When variables is absent (legacy app generated before W5.1) or
//   empty, the card renders a friendly "contract TBD" hint rather
//   than "no variables exist."

import { useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type { AppVariableEntry } from "@/types/app";
import type { VariableRole } from "@/types/variable-proposals";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";
import { cn } from "@/lib/utils";
// W6.8c — Tier 1 canonical concept badge on each variable chip.
import { CanonicalConceptBadge } from "@/components/canonical/canonical-concept-badge";

interface VariableContractConfig {
  /** Optional card title override. */
  title?: string;
  /** Dense layout — drops the subtle role-counts header. */
  dense?: boolean;
}

const ROLE_DISPLAY: Record<
  VariableRole,
  { label: string; chipClass: string; barClass: string }
> = {
  independent: {
    label: "IV",
    chipClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    barClass: "bg-emerald-500",
  },
  dependent: {
    label: "DV",
    chipClass: "bg-sky-50 text-sky-700 border-sky-200",
    barClass: "bg-sky-500",
  },
  outcome: {
    label: "DV",
    chipClass: "bg-sky-50 text-sky-700 border-sky-200",
    barClass: "bg-sky-500",
  },
  mediator: {
    label: "Mediator",
    chipClass: "bg-violet-50 text-violet-700 border-violet-200",
    barClass: "bg-violet-500",
  },
  confounding: {
    label: "Confound",
    chipClass: "bg-amber-50 text-amber-700 border-amber-200",
    barClass: "bg-amber-500",
  },
  controlled: {
    label: "Control",
    chipClass: "bg-slate-50 text-slate-700 border-slate-200",
    barClass: "bg-slate-500",
  },
  condition: {
    label: "Control",
    chipClass: "bg-slate-50 text-slate-700 border-slate-200",
    barClass: "bg-slate-500",
  },
  modifier: {
    label: "Modifier",
    chipClass: "bg-rose-50 text-rose-700 border-rose-200",
    barClass: "bg-rose-500",
  },
  instrument: {
    label: "Instrument",
    chipClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    barClass: "bg-emerald-500",
  },
  unclassified: {
    label: "TBD",
    chipClass: "bg-gray-50 text-gray-500 border-gray-200",
    barClass: "bg-gray-400",
  },
};

const ROLE_ORDER: VariableRole[] = [
  "independent",
  "dependent",
  "outcome",
  "mediator",
  "confounding",
  "controlled",
  "condition",
  "modifier",
  "instrument",
  "unclassified",
];

// Roles offered in the override-drawer dropdown. Skips "outcome"
// (redundant with dependent) and "condition" (redundant with
// controlled) so the user picker stays one-knob-per-concept.
const PICKABLE_ROLES: VariableRole[] = [
  "independent",
  "dependent",
  "controlled",
  "confounding",
  "mediator",
  "modifier",
  "instrument",
  "unclassified",
];

interface OverrideDrawerState {
  entry: AppVariableEntry;
  newRole: VariableRole;
  reasoning: string;
  submitting: boolean;
  error: string | null;
}

export function VariableContractCard({
  instance,
  context,
}: WidgetComponentProps<VariableContractConfig>) {
  const cfg = instance.config ?? {};
  const app = context.app;
  const variables: AppVariableEntry[] =
    (app.config?.variables as AppVariableEntry[] | undefined) ?? [];
  const mediatorLight = app.config?.mediator_light;

  const [drawer, setDrawer] = useState<OverrideDrawerState | null>(null);

  // Group by role, preserving order.
  const byRole = new Map<VariableRole, AppVariableEntry[]>();
  for (const v of variables) {
    const arr = byRole.get(v.role) ?? [];
    arr.push(v);
    byRole.set(v.role, arr);
  }

  const isEmpty = variables.length === 0;

  function openDrawer(entry: AppVariableEntry) {
    setDrawer({
      entry,
      newRole: entry.role,
      reasoning: "",
      submitting: false,
      error: null,
    });
  }

  async function submitOverride() {
    if (!drawer) return;
    if (drawer.newRole === drawer.entry.role && !drawer.reasoning) {
      setDrawer({ ...drawer, error: "Pick a different role or add reasoning." });
      return;
    }
    setDrawer({ ...drawer, submitting: true, error: null });
    const result = await context.dispatch(instance.id, "primary", {
      entity_id: drawer.entry.entity_id,
      new_role: drawer.newRole,
      reasoning: drawer.reasoning || undefined,
    });
    if (!result.ok) {
      setDrawer({
        ...drawer,
        submitting: false,
        error: result.reason ?? "Override failed",
      });
      return;
    }
    setDrawer(null);
  }

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Variable contract"
        title={cfg.title ?? "What this app measures"}
        subtitle={
          isEmpty
            ? undefined
            : `${variables.length} variable${variables.length === 1 ? "" : "s"} tracked`
        }
      />

      {mediatorLight && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2 text-[12.5px]">
          <span className="font-medium text-violet-700">Mediator:</span>
          <span className="truncate text-violet-900">
            {mediatorLight.mechanism_name}
          </span>
          <span className="ml-auto rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700">
            {mediatorLight.mechanism_kind}
          </span>
        </div>
      )}

      {isEmpty && (
        <WidgetEmpty>
          Variable contract not yet derived for this app. It will fill in
          after the next strategy regen — or when you reclassify a variable
          in preflight.
        </WidgetEmpty>
      )}

      {!isEmpty && (
        <div className="space-y-2.5">
          {ROLE_ORDER.map((role) => {
            const entries = byRole.get(role);
            if (!entries || entries.length === 0) return null;
            const display = ROLE_DISPLAY[role];
            return (
              <div key={role} className="space-y-1">
                {entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.entity_id + ":" + role}
                    onClick={() => openDrawer(entry)}
                    className={cn(
                      "group relative flex w-full items-center gap-2.5 rounded-lg border bg-white/60 px-3 py-1.5 text-left transition hover:bg-white/90 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200",
                      "border-gray-200/60",
                    )}
                    title={`${entry.rationale.reason} — click to tune role`}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        display.barClass,
                      )}
                    />
                    <span
                      className={cn(
                        "flex-shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        display.chipClass,
                      )}
                    >
                      {display.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900">
                      {entry.name}
                    </span>
                    {/* W6.8 — canonical concept badge. Clickable
                        (stops propagation to the chip's own click).
                        Renders nothing for entities not yet linked
                        unless showUnlinked is set. */}
                    <CanonicalConceptBadge
                      canonicalConceptId={entry.canonical_concept_id ?? null}
                      canonicalCode={entry.canonical_code ?? null}
                      size="compact"
                    />
                    {entry.observability !== "unknown" && (
                      <span className="flex-shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-gray-400">
                        {entry.observability === "directly_observable"
                          ? "observed"
                          : entry.observability === "latent"
                            ? "latent"
                            : "proxy"}
                      </span>
                    )}
                    <span className="flex-shrink-0 text-[10px] text-gray-300 opacity-0 transition group-hover:opacity-100">
                      tune
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {drawer && (
        <OverrideDrawer
          state={drawer}
          onChange={setDrawer}
          onCancel={() => setDrawer(null)}
          onSubmit={submitOverride}
        />
      )}
    </Surface>
  );
}

// ── Override drawer ─────────────────────────────────────────────────
//
// Lightweight inline overlay. No portal — sits inside the Surface
// container with absolute positioning so it doesn't escape the
// card's clip boundary. For a richer modal experience the widget
// could be promoted to use a shadcn Dialog later; this is V1.

function OverrideDrawer({
  state,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: OverrideDrawerState;
  onChange: (s: OverrideDrawerState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { entry, newRole, reasoning, submitting, error } = state;
  const currentDisplay = ROLE_DISPLAY[entry.role];

  return (
    <div
      className="absolute inset-0 z-10 flex items-end justify-center rounded-2xl bg-gray-900/20 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Tune variable role"
        className="m-3 w-full max-w-md rounded-2xl border border-gray-200/80 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
            Tune variable role
          </div>
          <div className="mt-1 truncate text-[14px] font-semibold text-gray-900">
            {entry.name}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-gray-600">
            <span className="text-gray-400">Currently:</span>
            <span
              className={cn(
                "rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                currentDisplay.chipClass,
              )}
            >
              {currentDisplay.label}
            </span>
          </div>
          {entry.rationale.reason && (
            <p className="mt-2 text-[11.5px] leading-snug text-gray-500">
              {entry.rationale.reason}
            </p>
          )}
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label
              htmlFor="tune-role"
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500"
            >
              New role
            </label>
            <select
              id="tune-role"
              value={newRole}
              onChange={(e) =>
                onChange({ ...state, newRole: e.target.value as VariableRole })
              }
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] text-gray-900 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
            >
              {PICKABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_DISPLAY[r].label} — {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="tune-reasoning"
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500"
            >
              Why are you changing this? <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="tune-reasoning"
              rows={2}
              value={reasoning}
              onChange={(e) =>
                onChange({ ...state, reasoning: e.target.value })
              }
              placeholder="e.g. We manipulate this directly via the lab — should be IV, not Modifier."
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] text-gray-900 placeholder:text-gray-300 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
            />
          </div>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11.5px] text-rose-700">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save override"}
          </button>
        </div>
      </div>
    </div>
  );
}
