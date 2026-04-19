"use client";

// ── Intervention widgets ───────────────────────────────────────────────
//
// The user-facing face of the Intervention domain type. Two flavors:
//   - intervention_card → single intervention with status + primary action
//   - intervention_list → stacked list, one action per row
//
// These are the only widgets that touch Intervention rows. Other widgets
// that need to reference interventions do so by id via bindings and let
// these render the UI.

import type { InterventionRow, InterventionStatus } from "@/types/intervention";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { Surface, WidgetTitle, WidgetEmpty, ActionButton } from "./shared";
import { cn } from "@/lib/utils";

// ── Shared row chrome ──────────────────────────────────────────────────

function InterventionRowView({
  iv,
  onComplete,
  onFocus,
  dense,
}: {
  iv: InterventionRow;
  onComplete?: () => void;
  onFocus?: () => void;
  dense?: boolean;
}) {
  const status = (iv.status ?? "proposed") as InterventionStatus;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white/70 backdrop-blur-sm",
        dense ? "px-3 py-2" : "px-3.5 py-3"
      )}
    >
      <StatusDot status={status} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onFocus}
          className="block truncate text-left text-[13.5px] font-medium text-gray-800 hover:text-gray-900"
        >
          {iv.title ?? "Untitled intervention"}
        </button>
        {iv.description && (
          <div className="line-clamp-1 text-[11.5px] text-gray-500">{iv.description}</div>
        )}
      </div>
      {status !== "completed" && onComplete && (
        <ActionButton
          label="Mark done"
          onClick={onComplete}
          variant="secondary"
          compact
        />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: InterventionStatus }) {
  const color =
    status === "completed"
      ? "#16a34a"
      : status === "active"
      ? "#2563eb"
      : status === "superseded"
      ? "#9ca3af"
      : status === "abandoned"
      ? "#dc2626"
      : "#f59e0b";
  return (
    <span
      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 0 3px ${color}20` }}
      aria-label={status}
    />
  );
}

// ── intervention_card ──────────────────────────────────────────────────

interface InterventionCardConfig {
  label?: string;
  accent?: string;
}

export function InterventionCard({
  instance,
  context,
}: WidgetComponentProps<InterventionCardConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<InterventionRow>(instance.bindings?.intervention);
  const iv = res.value ?? null;

  const completeActionKey = instance.actions?.primary;

  return (
    <Surface accent={cfg.accent ?? "#16a34a"}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Intervention"}
        title={iv?.title ?? "—"}
        subtitle={iv?.description ?? undefined}
      />
      {!iv ? (
        <WidgetEmpty>
          {res.status === "loading"
            ? "Loading intervention…"
            : "No intervention bound."}
        </WidgetEmpty>
      ) : (
        <div className="space-y-2">
          <InterventionRowView
            iv={iv}
            onFocus={() => context.dispatch(instance.id, "focus")}
            onComplete={
              completeActionKey
                ? () =>
                    context.dispatch(instance.id, "primary", {
                      intervention_id: iv.id,
                    })
                : undefined
            }
          />
        </div>
      )}
    </Surface>
  );
}

// ── intervention_list ──────────────────────────────────────────────────

interface InterventionListConfig {
  label?: string;
  accent?: string;
  /** Max rows to show before adding "+N more" affordance. */
  limit?: number;
}

export function InterventionList({
  instance,
  context,
}: WidgetComponentProps<InterventionListConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<InterventionRow[]>(instance.bindings?.items);
  const items: InterventionRow[] = Array.isArray(res.value) ? res.value : [];
  const limit = cfg.limit ?? 6;
  const visible = items.slice(0, limit);
  const hidden = Math.max(0, items.length - visible.length);

  return (
    <Surface accent={cfg.accent ?? "#16a34a"}>
      <WidgetTitle
        eyebrow={cfg.label ?? "Interventions"}
        title={items.length === 0 ? "—" : `${items.length} total`}
        subtitle={
          items.length === 0
            ? "No interventions bound yet."
            : summarizeInterventionStatuses(items)
        }
      />
      {items.length === 0 ? (
        <WidgetEmpty>No interventions to show.</WidgetEmpty>
      ) : (
        <div className="space-y-2">
          {visible.map((iv) => (
            <InterventionRowView
              key={iv.id}
              iv={iv}
              dense
              onFocus={() =>
                context.dispatch(instance.id, "focus", { intervention_id: iv.id })
              }
              onComplete={
                instance.actions?.primary
                  ? () =>
                      context.dispatch(instance.id, "primary", {
                        intervention_id: iv.id,
                      })
                  : undefined
              }
            />
          ))}
          {hidden > 0 && (
            <div className="pt-1 text-center text-[11.5px] text-gray-400">
              +{hidden} more
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}

function summarizeInterventionStatuses(items: InterventionRow[]): string {
  const counts: Record<string, number> = {};
  for (const iv of items) {
    const k = iv.status ?? "proposed";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(" · ");
}
