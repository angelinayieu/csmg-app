"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Finding, PropagationStep } from "@/types/finding";
import type { Entity, Edge } from "@/types";
import { tracePropagation } from "@/lib/findings/propagation-tracer";

const LAYER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  L4: { bg: "#007AFF", text: "#FFFFFF", border: "#007AFF" },
  L3: { bg: "#F59E0B", text: "#FFFFFF", border: "#F59E0B" },
  L2: { bg: "#8B5CF6", text: "#FFFFFF", border: "#8B5CF6" },
  L1: { bg: "#6B7280", text: "#FFFFFF", border: "#6B7280" },
};

interface FindingDetailPanelProps {
  finding: Finding;
  entities: Entity[];
  edges: Edge[];
  onClose: () => void;
}

export function FindingDetailPanel({
  finding,
  entities,
  edges,
  onClose,
}: FindingDetailPanelProps) {
  // Compute propagation path
  const propagation = useMemo(() => {
    if (finding.propagation_path && finding.propagation_path.length > 0) {
      return finding.propagation_path;
    }
    // Compute from entity graph
    const sourceId = finding.source_entity_ids[0];
    if (!sourceId) return [];
    return tracePropagation(sourceId, entities, edges);
  }, [finding, entities, edges]);

  const layerStyle = LAYER_COLORS[finding.layer] ?? LAYER_COLORS.L2;

  return (
    <aside className="flex h-full w-[340px] flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
              Selected Finding
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
              style={{ background: layerStyle.bg }}
            >
              {finding.layer}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <h3 className="text-[15px] font-bold leading-snug text-gray-900">
          {finding.title}
        </h3>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* ── Atomic Floor section ── */}
        {finding.atomic_floor && (
          <DetailSection label="Atomic Floor" icon="⊕">
            <div className="rounded-xl border border-green-200 bg-green-50 p-3.5">
              <div className="mb-3 flex items-start gap-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-500 text-[13px] font-bold text-white">
                  ✓
                </div>
                <p className="text-xs leading-relaxed text-gray-800">
                  <strong className="text-green-600">Floor confirmed.</strong>{" "}
                  {finding.atomic_floor.reached_irreducible
                    ? "No deeper decomposition exists."
                    : "Decomposition limit reached."}
                </p>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2">
                <StatCell
                  label="Decomp tries"
                  value={String(finding.atomic_floor.decomposition_attempts)}
                />
                <StatCell
                  label="Sub-probes"
                  value={String(finding.atomic_floor.sub_probes)}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {finding.atomic_floor.reached_irreducible && (
                  <ValidationChip label="Irreducible" />
                )}
                <ValidationChip label={`${finding.atomic_floor.decomposition_attempts} attempts`} />
              </div>
            </div>
          </DetailSection>
        )}

        {/* ── Propagation section ── */}
        {propagation.length > 0 && (
          <DetailSection label="Propagation" icon="↑">
            <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3.5">
              {propagation.map((step, i) => {
                const lc = LAYER_COLORS[step.layer] ?? LAYER_COLORS.L2;
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-2.5 py-2",
                      i < propagation.length - 1 && "border-b border-gray-100",
                    )}
                  >
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                      style={{ background: lc.bg }}
                    >
                      {step.layer}
                    </span>
                    <span className="flex-1 text-xs font-medium text-gray-800">
                      {step.label}
                    </span>
                    <span className="text-sm font-bold text-green-500">
                      {step.status === "verified" ? (i < propagation.length - 1 ? "↑" : "✓") : "~"}
                    </span>
                  </div>
                );
              })}
            </div>
          </DetailSection>
        )}

        {/* ── Reasoning section ── */}
        {finding.reasoning && finding.reasoning.length > 0 && (
          <DetailSection label="Reasoning" icon="◎">
            <div className="space-y-1.5">
              {finding.reasoning.map((r, i) => (
                <p key={i} className="text-xs leading-relaxed text-gray-600">
                  {r}
                </p>
              ))}
            </div>
          </DetailSection>
        )}

        {/* ── Domains / Sphere Matches section ── */}
        {finding.domains.length > 0 && (
          <DetailSection label="Sphere Matches" icon="◉" count={finding.domains.length}>
            <div className="space-y-1.5">
              {finding.domains.map((domain, i) => (
                <div
                  key={domain}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-2.5 py-2",
                    i < 2
                      ? "border-blue-200 bg-blue-50/50"
                      : "border-gray-200",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      i < 2 ? "bg-blue-500" : "bg-gray-300",
                    )}
                  />
                  <span className={cn(
                    "flex-1 text-xs font-semibold",
                    i < 2 ? "text-blue-800" : "text-gray-800",
                  )}>
                    {domain} sphere
                  </span>
                  {finding.convergence_data && (
                    <span className={cn(
                      "text-[11px] font-bold",
                      i < 2 ? "text-blue-500" : "text-gray-400",
                    )}>
                      {(finding.convergence_data.structural_value * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {/* ── Action section ── */}
        {finding.action_primary && (
          <DetailSection label="Recommended Action" icon="→">
            <p className="text-xs leading-relaxed text-gray-700">
              {finding.action_primary}
            </p>
          </DetailSection>
        )}

        {/* ── Convergence traced path ── */}
        {finding.convergence_data && (
          <DetailSection label={`Traced Path · ${finding.convergence_data.converging_branches.length + 1} nodes`} icon="⟶">
            <div className="flex flex-wrap items-center gap-1">
              {finding.convergence_data.converging_branches.map((branch, i) => (
                <span key={i}>
                  <span className="inline-block rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {branch.name}
                  </span>
                  <span className="mx-0.5 text-[10px] text-gray-300">→</span>
                </span>
              ))}
              <span
                className="inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: layerStyle.border,
                  background: `${layerStyle.bg}15`,
                  color: layerStyle.bg,
                }}
              >
                {finding.layer} ◆
              </span>
            </div>
          </DetailSection>
        )}
      </div>
    </aside>
  );
}

// ── Detail section wrapper ──

function DetailSection({
  label,
  icon,
  count,
  children,
}: {
  label: string;
  icon: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="text-[11px] text-gray-300">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          {label}
        </span>
        {count !== undefined && (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-px text-[10px] font-bold text-gray-500">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Stat cell ──

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold text-gray-900">{value}</div>
    </div>
  );
}

// ── Validation chip ──

function ValidationChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-500">
        <path d="M5 12l5 5L20 7" />
      </svg>
      {label}
    </span>
  );
}
