"use client";

// ── Lab Methodology Disclosure Overlay (Phase 6D) ─────────────────
//
// Researcher-mode panel surfacing every methodological decision the
// lab is making behind the simulation:
//   • Pooling method (REML τ²) + per-edge pooling state
//   • Active edge response models (linear / hill / emax / …)
//   • Active prior selection strategy (from approved plan)
//   • Heterogeneity layers active
//   • Active parsers + versions
//
// Honest disclosure builds researcher trust. Hidden by default —
// click the "Methodology" button in the lab header to expand.
//
// Reads from:
//   • spaces.active_plan_id → kg_generation_plans.methodology_disclosure
//   • Per-edge dynamics_properties.pooling_metadata for pooled-vs-LLM
//     status counts
//   • Per-edge dynamics for response model histogram
//
// All data fetched in one /api/spaces/[id]/methodology-disclosure
// request that's cached client-side per spaceId.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck, X } from "lucide-react";

interface MethodologyResponse {
  active_plan_id: string | null;
  methodology_disclosure: {
    active_parsers?: Array<{
      module: string;
      version: string;
      handles_metrics: string[];
      known_limits: string[];
    }>;
    trust_boundary_explanation?: string;
    prior_selection_strategy?: {
      default_tier: string;
      per_node_overrides: Array<{
        node_pattern: string;
        tier: string;
        reason: string;
      }>;
    };
    dose_response_defaults?: Record<string, string>;
    heterogeneity_handling?: {
      layers_active: string[];
      pooling_method: string;
      tau_squared_estimator: string;
    };
    consensus_profile_selection?: {
      profiles_used: string[];
      disagreement_handling: string;
    };
  } | null;
  pooling_stats: {
    edges_total: number;
    edges_pooled: number;
    edges_llm_estimated: number;
    evidence_rows_total: number;
    evidence_rows_reviewed: number;
  };
  dynamics_histogram: Record<string, number>;
}

interface LabMethodologyDisclosureProps {
  spaceId: string;
  open: boolean;
  onClose: () => void;
}

async function fetchMethodology(
  spaceId: string,
  signal: AbortSignal,
): Promise<MethodologyResponse | null> {
  const res = await fetch(
    `/api/spaces/${spaceId}/methodology-disclosure`,
    { credentials: "include", signal, cache: "no-store" },
  );
  if (!res.ok) return null;
  return (await res.json()) as MethodologyResponse;
}

export function LabMethodologyDisclosure({
  spaceId,
  open,
  onClose,
}: LabMethodologyDisclosureProps) {
  const [data, setData] = useState<MethodologyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["pooling", "parsers"]),
  );

  useEffect(() => {
    if (!open || !spaceId) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetchMethodology(spaceId, ctrl.signal)
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [open, spaceId]);

  if (!open) return null;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[640px] max-w-[95vw] overflow-y-auto rounded-t-2xl border border-[rgba(148,163,184,0.18)] bg-[#0a1020] p-5 text-[#e8edf4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <h2 className="text-[14px] font-semibold tracking-tight">
              Methodology disclosure
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#7a8da8] hover:bg-white/5 hover:text-[#e8edf4]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-[11px] leading-relaxed text-[#7a8da8]">
          Every methodological decision the lab is making behind the
          simulation. Trust boundary preserved: LLMs label spans, deterministic
          parsers extract numbers, REML τ² pools effects across studies.
        </p>

        {loading && !data && (
          <div className="text-[11px] italic text-[#6a7a95]">
            Loading methodology…
          </div>
        )}

        {data && (
          <>
            {/* Pooling stats — always expanded by default */}
            <Section
              k="pooling"
              title="Edge pooling"
              expanded={expanded}
              toggle={toggle}
            >
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Pooled from evidence"
                  value={`${data.pooling_stats.edges_pooled} / ${data.pooling_stats.edges_total}`}
                  hint="Edges whose strength was recomputed via REML τ² random-effects pooling of attached evidence rows. Remainder use LLM-estimated strength."
                />
                <Stat
                  label="LLM-estimated"
                  value={`${data.pooling_stats.edges_llm_estimated}`}
                  hint="Edges still relying on the upstream LLM's strength estimate. These will switch to pooled the moment evidence rows attach to either endpoint."
                />
                <Stat
                  label="Evidence rows total"
                  value={`${data.pooling_stats.evidence_rows_total}`}
                  hint="All extracted effect-size rows in this space (attached + unattached)."
                />
                <Stat
                  label="Reviewed"
                  value={`${data.pooling_stats.evidence_rows_reviewed} / ${data.pooling_stats.evidence_rows_total}`}
                  hint="Rows manually reviewed by a researcher. v1 pools both reviewed + extracted; v2 will require reviewed for rigorous mode."
                />
              </div>
              <div className="mt-3 rounded border border-white/[0.06] bg-white/[0.02] p-2 text-[10.5px] text-[#a8b8d0]">
                <div className="font-mono">
                  Pooling method:{" "}
                  <span className="text-emerald-300">
                    Random-effects · REML τ²
                  </span>
                </div>
                <div className="mt-1 text-[#7a8da8]">
                  See{" "}
                  <code className="rounded bg-white/[0.04] px-1 py-0.5">
                    src/lib/evidence/edge-strength-pooler.ts
                  </code>{" "}
                  for the math (Acklam inverse-Φ + iterated REML τ² to
                  REML_TOL=1e-7).
                </div>
              </div>
            </Section>

            {/* Active parsers */}
            <Section
              k="parsers"
              title="Active parsers"
              expanded={expanded}
              toggle={toggle}
            >
              {data.methodology_disclosure?.active_parsers?.length ? (
                <ul className="space-y-2">
                  {data.methodology_disclosure.active_parsers.map((p, i) => (
                    <li
                      key={`${p.module}:${i}`}
                      className="rounded border border-white/[0.06] bg-white/[0.02] p-2"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-[11.5px] font-semibold text-emerald-300">
                          {p.module}@{p.version}
                        </span>
                      </div>
                      <div className="mt-1 text-[10.5px] text-[#a8b8d0]">
                        Handles: {p.handles_metrics.join(", ")}
                      </div>
                      {p.known_limits.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[10px] text-[#7a8da8]">
                          {p.known_limits.map((l, idx) => (
                            <li key={idx}>{l}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[10.5px] italic text-[#6a7a95]">
                  No plan-declared parsers. Default:{" "}
                  <code>cohens_d_with_ci_v1</code> handles d/g/SMD with inline
                  CI; falls back to LLM-only for OR/RR/beta/raw-means.
                </div>
              )}
            </Section>

            {/* Trust boundary */}
            {data.methodology_disclosure?.trust_boundary_explanation && (
              <Section
                k="trust"
                title="Trust boundary"
                expanded={expanded}
                toggle={toggle}
              >
                <p className="text-[11px] leading-relaxed text-[#a8b8d0]">
                  {data.methodology_disclosure.trust_boundary_explanation}
                </p>
              </Section>
            )}

            {/* Dynamics histogram */}
            <Section
              k="dynamics"
              title="Edge response models"
              expanded={expanded}
              toggle={toggle}
            >
              {Object.keys(data.dynamics_histogram).length === 0 ? (
                <div className="text-[10.5px] italic text-[#6a7a95]">
                  No dynamics tagged on edges yet. Default response model:
                  linear.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(data.dynamics_histogram)
                    .sort((a, b) => b[1] - a[1])
                    .map(([kind, count]) => {
                      const total = Object.values(
                        data.dynamics_histogram,
                      ).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? (count / total) * 100 : 0;
                      return (
                        <div
                          key={kind}
                          className="flex items-center gap-2 text-[10.5px]"
                        >
                          <span className="w-[80px] flex-shrink-0 font-mono text-[#a8b8d0]">
                            {kind}
                          </span>
                          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="absolute left-0 top-0 h-full rounded-full bg-cyan-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-[36px] flex-shrink-0 text-right font-mono text-[#e8edf4]">
                            {count}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </Section>

            {/* Prior selection */}
            {data.methodology_disclosure?.prior_selection_strategy && (
              <Section
                k="priors"
                title="Prior selection"
                expanded={expanded}
                toggle={toggle}
              >
                <div className="text-[10.5px] text-[#a8b8d0]">
                  Default tier:{" "}
                  <code className="rounded bg-white/[0.04] px-1 py-0.5 text-emerald-300">
                    {
                      data.methodology_disclosure.prior_selection_strategy
                        .default_tier
                    }
                  </code>
                </div>
                {data.methodology_disclosure.prior_selection_strategy
                  .per_node_overrides.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[10px]">
                    {data.methodology_disclosure.prior_selection_strategy.per_node_overrides.map(
                      (o, i) => (
                        <li key={i} className="flex gap-2 text-[#7a8da8]">
                          <code className="text-[#a8b8d0]">{o.node_pattern}</code>
                          → <span className="text-emerald-300">{o.tier}</span>
                          <span className="italic">({o.reason})</span>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </Section>
            )}

            {/* Heterogeneity */}
            {data.methodology_disclosure?.heterogeneity_handling && (
              <Section
                k="heterogeneity"
                title="Heterogeneity handling"
                expanded={expanded}
                toggle={toggle}
              >
                <div className="space-y-1 text-[10.5px] text-[#a8b8d0]">
                  <div>
                    Pooling method:{" "}
                    <code className="rounded bg-white/[0.04] px-1 py-0.5 text-emerald-300">
                      {
                        data.methodology_disclosure.heterogeneity_handling
                          .pooling_method
                      }
                    </code>
                  </div>
                  <div>
                    τ² estimator:{" "}
                    <code className="rounded bg-white/[0.04] px-1 py-0.5 text-emerald-300">
                      {
                        data.methodology_disclosure.heterogeneity_handling
                          .tau_squared_estimator
                      }
                    </code>
                  </div>
                  {data.methodology_disclosure.heterogeneity_handling
                    .layers_active.length > 0 && (
                    <div>
                      Active layers:{" "}
                      <span className="font-mono">
                        {data.methodology_disclosure.heterogeneity_handling.layers_active.join(
                          ", ",
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  k,
  title,
  expanded,
  toggle,
  children,
}: {
  k: string;
  title: string;
  expanded: Set<string>;
  toggle: (k: string) => void;
  children: React.ReactNode;
}) {
  const isOpen = expanded.has(k);
  return (
    <div className="mb-2 border-t border-white/[0.06] pt-3">
      <button
        type="button"
        onClick={() => toggle(k)}
        className="flex w-full items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#a8b8d0] hover:text-[#e8edf4]"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {isOpen && <div className="mt-2 pl-4">{children}</div>}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div
      className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2"
      title={hint}
    >
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-[#7a8da8]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[16px] font-bold text-[#e8edf4]">
        {value}
      </div>
    </div>
  );
}
