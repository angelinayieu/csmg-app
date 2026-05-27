"use client";

// ── Lab Page View ─────────────────────────────────────────────────
//
// Phase 11.2 — the client orchestrator for the focused evaluation
// workspace. Renders five table-based sections (per design spec):
//
//   1. Header strip — mechanism name + top-score badge + last-scored
//   2. Indicators table — variations × 5 rubric criteria (+ per-
//      proxy-indicator breakdown when outcomes carry indicators)
//   3. Variation Diff — 2-pick side-by-side compare
//   4. Evidence table — citations from item-level research
//   5. Simulation Results — only when method="simulation" has run
//   6. Actions row — re-run / open drawer / propose test / etc.
//
// Tables only. No charts. Method badges everywhere a score appears.
// Restrained color: appleVibe tokens, hairline borders, generous
// row padding. Tabular-nums on every score so they align vertically.
//
// State owned here:
//   • Last action status (running / done / error) for each Action button
//   • Variation diff picker (left + right)
//   • Optimistic data refresh after action runs
//
// Action dispatch — calls existing /score, /refine, /prototype,
// /mockup, /export-prompt routes. No new endpoints. The notebook
// rail above the page captures every event as it happens.

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Beaker,
  Check,
  ChevronDown,
  ChevronRight,
  Dice5,
  ExternalLink,
  FileText,
  FlaskConical,
  GitBranch,
  Layers,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { MethodBadge } from "@/components/objective/method-badge";
import type {
  EvaluationMethod,
} from "@/components/objective/method-badge";
import type {
  ExpandedItemDetail,
  ItemVariation,
} from "@/lib/objective-canvas/expand-item-detail";

interface PeerOutcome {
  id: string;
  name: string;
  indicators: string[];
}

interface Props {
  spaceId: string;
  subObjectiveId: string;
  entityId: string;
  entityName: string;
  entityType: string;
  causalChain: Record<string, unknown> | null;
  expandedDetail: ExpandedItemDetail | null;
  detailResearch: unknown;
  peerOutcomes: PeerOutcome[];
  coreObjectiveText: string;
  subObjectiveTitle: string;
}

interface ResearchSource {
  url?: string;
  title?: string;
  snippet?: string;
  relevance?: number;
}

const CRITERION_LABELS = {
  plausibility: "Plausibility",
  addresses_pain: "Addresses pain",
  constraint_fit: "Constraint fit",
  novelty: "Novelty",
  risk: "Risk",
} as const;

const CRITERION_KEYS = Object.keys(CRITERION_LABELS) as Array<
  keyof typeof CRITERION_LABELS
>;

export function LabPageView({
  spaceId,
  subObjectiveId,
  entityId,
  entityName,
  entityType,
  causalChain,
  expandedDetail,
  detailResearch,
  peerOutcomes,
  coreObjectiveText: _coreObjectiveText,
  subObjectiveTitle: _subObjectiveTitle,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Local optimistic state for the variations array — after a re-run,
  // patch the locally-rendered list while the router.refresh() repaints.
  const [variationsLocal, setVariationsLocal] = useState<ItemVariation[]>(
    expandedDetail?.variations ?? [],
  );
  const [envelopeLocal, setEnvelopeLocal] = useState(
    expandedDetail?.effectiveness_envelope ?? null,
  );
  const [actionStatus, setActionStatus] = useState<{
    label: string;
    state: "running" | "done" | "error";
    message?: string;
  } | null>(null);

  // Pick variations for the diff table. Default to top 2 by composite
  // score. Falls back to the first two when no scores exist yet.
  const sortedVariations = useMemo(() => {
    return [...variationsLocal].sort(
      (a, b) =>
        (b.effectiveness_score ?? 0) - (a.effectiveness_score ?? 0),
    );
  }, [variationsLocal]);
  const [diffLeft, setDiffLeft] = useState<string | null>(
    sortedVariations[0]?.id ?? null,
  );
  const [diffRight, setDiffRight] = useState<string | null>(
    sortedVariations[1]?.id ?? null,
  );

  // Top score for the header — max composite across variations.
  const topScore = useMemo(() => {
    let max = 0;
    let method: EvaluationMethod | undefined;
    for (const v of variationsLocal) {
      if ((v.effectiveness_score ?? 0) > max) {
        max = v.effectiveness_score ?? 0;
        method = v.evaluation_method as EvaluationMethod | undefined;
      }
    }
    return { score: max, method };
  }, [variationsLocal]);

  const scoredAt = envelopeLocal?.scored_at ?? null;
  const evalMethod = (envelopeLocal?.evaluation_method ?? topScore.method) as
    | EvaluationMethod
    | undefined;

  // ── Action dispatcher ──
  // All buttons funnel through here for consistent status + error
  // handling. Each action either updates local state optimistically
  // or kicks router.refresh() to repaint from server.
  const dispatchAction = useCallback(
    async (
      label: string,
      run: () => Promise<{
        ok: boolean;
        message?: string;
        nextVariations?: ItemVariation[];
        nextEnvelope?: ExpandedItemDetail["effectiveness_envelope"];
        refreshRoute?: boolean;
      }>,
    ) => {
      setActionStatus({ label, state: "running" });
      try {
        const res = await run();
        if (!res.ok) {
          setActionStatus({
            label,
            state: "error",
            message: res.message ?? "Action failed.",
          });
          return;
        }
        if (res.nextVariations) setVariationsLocal(res.nextVariations);
        if (res.nextEnvelope !== undefined) setEnvelopeLocal(res.nextEnvelope);
        if (res.refreshRoute) {
          startTransition(() => {
            router.refresh();
          });
        }
        setActionStatus({
          label,
          state: "done",
          message: res.message,
        });
        // Auto-dismiss done state after 4s so the chrome stays calm.
        setTimeout(() => {
          setActionStatus((cur) =>
            cur?.label === label && cur.state === "done" ? null : cur,
          );
        }, 4000);
      } catch (err) {
        setActionStatus({
          label,
          state: "error",
          message: err instanceof Error ? err.message : "Network error.",
        });
      }
    },
    [router],
  );

  // ── Score actions ──
  const runRubric = useCallback(() => {
    void dispatchAction("Rubric scoring", async () => {
      const res = await fetch("/api/brainstorm/item/variation/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId, method: "rubric" }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        status_detail?: string | null;
      };
      if (!res.ok) {
        return { ok: false, message: j.status_detail ?? "Rubric failed." };
      }
      return {
        ok: true,
        message: "Rubric scored — reloading.",
        refreshRoute: true,
      };
    });
  }, [dispatchAction, entityId]);

  const runSimulation = useCallback(() => {
    void dispatchAction("Monte Carlo simulation", async () => {
      const res = await fetch("/api/brainstorm/item/variation/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId, method: "simulation" }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        status_detail?: string | null;
      };
      if (!res.ok || j.status !== "ok") {
        return {
          ok: false,
          message:
            j.status_detail ??
            "Simulation needs a target pain reachable via an approved edge. Approve the chain first or fall back to rubric.",
        };
      }
      return { ok: true, message: "Simulated — reloading.", refreshRoute: true };
    });
  }, [dispatchAction, entityId]);

  const runRefine = useCallback(() => {
    void dispatchAction("R&D refine", async () => {
      const res = await fetch("/api/brainstorm/item/variation/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        status_detail?: string | null;
      };
      if (!res.ok || j.status !== "ok") {
        return { ok: false, message: j.status_detail ?? "Refine failed." };
      }
      return {
        ok: true,
        message: "New candidates proposed — reloading.",
        refreshRoute: true,
      };
    });
  }, [dispatchAction, entityId]);

  // Phase 11.3 ensemble scorer — 5 lenses + Goodhart counter-indicator
  // + Prentice mediation classification. Slower than rubric (~5-8s) but
  // surfaces lens disagreement as a confidence signal. Use when you
  // want the strongest read short of an empirical test.
  const runEnsemble = useCallback(() => {
    void dispatchAction("Ensemble scoring", async () => {
      const res = await fetch("/api/brainstorm/item/variation/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId, method: "ensemble" }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        status_detail?: string | null;
      };
      if (!res.ok || j.status !== "ok") {
        return {
          ok: false,
          message:
            j.status_detail ??
            "Ensemble scoring failed. Re-run rubric instead — it's lighter and almost always sufficient.",
        };
      }
      return {
        ok: true,
        message:
          "Ensemble scored — lens disagreement, Goodhart risk, and mediation classifications populated.",
        refreshRoute: true,
      };
    });
  }, [dispatchAction, entityId]);

  // Phase 11.4 chain enrichment — turns shallow (Pain × Feature × Outcome)
  // labels into sophisticated narratives + closes orphan gaps via
  // complementary chain proposals. Room-scoped (not per-mechanism)
  // because the endpoint operates over the room's chain set.
  const runEnrichChains = useCallback(() => {
    void dispatchAction("Chain enrichment", async () => {
      const res = await fetch(
        `/api/brainstorm/room/${subObjectiveId}/enrich-chains`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        return { ok: false, message: j.error ?? "Enrichment failed." };
      }
      const j = (await res.json().catch(() => ({}))) as {
        enriched_count?: number;
        new_chains_count?: number;
        avg_chain_strength?: number;
      };
      return {
        ok: true,
        message: `Enriched ${j.enriched_count ?? 0} chains · ${j.new_chains_count ?? 0} new · avg strength ${(j.avg_chain_strength ?? 0).toFixed(2)}`,
        refreshRoute: true,
      };
    });
  }, [dispatchAction, subObjectiveId]);

  // ── Per-variation disposition (elect/reject) ──
  const setDisposition = useCallback(
    (variationId: string, disposition: "elected" | "rejected" | null) => {
      void dispatchAction(
        disposition === null ? "Clear disposition" : `${disposition === "elected" ? "Elect" : "Reject"}`,
        async () => {
          const res = await fetch(
            "/api/brainstorm/item/variation/disposition",
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                entityId,
                variationId,
                disposition,
              }),
            },
          );
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            return { ok: false, message: j.error ?? "Disposition failed." };
          }
          // Optimistic update — patch the local row.
          const next = variationsLocal.map((v) =>
            v.id === variationId ? { ...v, disposition } : v,
          );
          return {
            ok: true,
            message:
              disposition === null
                ? "Cleared."
                : disposition === "elected"
                  ? "Elected."
                  : "Rejected.",
            nextVariations: next,
            refreshRoute: true,
          };
        },
      );
    },
    [dispatchAction, entityId, variationsLocal],
  );

  const hasVariations = variationsLocal.length > 0;
  const isFeature = entityType === "feature";

  // ── Empty state — no variations yet ──
  if (!isFeature) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div
          className="rounded-2xl px-6 py-10 text-center"
          style={{
            background: appleVibe.surface.card,
            border: `1px dashed ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.xl,
          }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            The Lab is only available for mechanism (feature) entities.
            <br />
            This entity is a {entityType}.
          </p>
        </div>
      </main>
    );
  }

  if (!expandedDetail || !hasVariations) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1
          className="text-[24px] font-semibold tracking-tight"
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.015em",
          }}
        >
          {entityName}
        </h1>
        <div
          className="mt-6 rounded-2xl px-6 py-10 text-center"
          style={{
            background: appleVibe.surface.card,
            border: `1px dashed ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.xl,
          }}
        >
          <p
            className="text-[13px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
          >
            This mechanism hasn&rsquo;t been expanded yet — no variations to
            evaluate. Open the room&rsquo;s drawer to expand it, then come
            back here.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {/* ── Header ── */}
      <header className="mb-6">
        <h1
          className="text-[26px] font-semibold tracking-tight"
          style={{
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.display,
            letterSpacing: "-0.015em",
          }}
        >
          {entityName}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {topScore.score > 0 && evalMethod && (
            <MethodBadge method={evalMethod} score={topScore.score} />
          )}
          <span
            className="text-[11px]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {variationsLocal.length} variation
            {variationsLocal.length === 1 ? "" : "s"}
            {scoredAt ? ` · scored ${formatRelativeTime(scoredAt)}` : ""}
          </span>
          {envelopeLocal?.status === "llm_failed" && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: "rgba(220,38,38,0.08)",
                color: "rgba(127,29,29,0.95)",
                border: "1px solid rgba(220,38,38,0.20)",
              }}
            >
              Last scoring run failed — re-run rubric below
            </span>
          )}
        </div>

        {/* Top-level actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ActionButton
            label="Re-run rubric"
            icon={RefreshCw}
            onClick={runRubric}
            primary
            disabled={actionStatus?.state === "running"}
          />
          <ActionButton
            label="Run ensemble"
            icon={Layers}
            onClick={runEnsemble}
            disabled={actionStatus?.state === "running"}
            title="5-lens scoring (systems / skeptic / operator / engineer / historian) + Goodhart counter-indicators + Prentice mediation classification. ~5-8s. The strongest read short of an empirical test."
          />
          <ActionButton
            label="Run simulation"
            icon={Dice5}
            onClick={runSimulation}
            disabled={actionStatus?.state === "running"}
            title="Monte Carlo + placebo refutation. Use when adherence/dose introduces real propagating uncertainty."
          />
          <ActionButton
            label="Enrich chains"
            icon={GitBranch}
            onClick={runEnrichChains}
            disabled={actionStatus?.state === "running"}
            title="Room-scoped — enriches every chain's narrative and closes orphan gaps via complementary chain proposals."
          />
          <ActionButton
            label="Propose R&D iteration"
            icon={Beaker}
            onClick={runRefine}
            disabled={actionStatus?.state === "running"}
            title="Proposes 3 new candidate variations targeting the weakest root cause."
          />
        </div>

        {actionStatus && (
          <ActionStatusChip status={actionStatus} />
        )}
      </header>

      {/* ── Section 1: Indicators (rubric criteria) ── */}
      <Section title="Indicators · rubric criteria">
        <IndicatorsTable
          variations={sortedVariations}
          onElect={(id) => setDisposition(id, "elected")}
          onReject={(id) => setDisposition(id, "rejected")}
          onClear={(id) => setDisposition(id, null)}
        />
      </Section>

      {/* ── Section 2: Per-proxy-indicator breakdown ── */}
      {peerOutcomes.some((o) => o.indicators.length > 0) && (
        <Section title="Proxy indicators · per-outcome">
          <ProxyIndicatorsTable
            variations={sortedVariations}
            peerOutcomes={peerOutcomes}
          />
        </Section>
      )}

      {/* ── Section 2b: Counter-indicators (ensemble yin proxies) ──
          Renders only when ensemble scoring has populated them on
          the envelope. The whole concept (Goodhart defense via paired
          opposing proxies) is meaningless without an ensemble run, so
          empty-state-CTA explains that when missing. */}
      {Array.isArray(envelopeLocal?.counter_indicators) &&
        envelopeLocal.counter_indicators.length > 0 && (
          <Section title="Counter-indicators · Goodhart defense">
            <CounterIndicatorsTable
              counterIndicators={envelopeLocal.counter_indicators}
            />
          </Section>
        )}

      {/* ── Section 3: Variation diff (2-pick) ── */}
      {variationsLocal.length >= 2 && (
        <Section title="Variation diff">
          <VariationDiffTable
            variations={variationsLocal}
            leftId={diffLeft}
            rightId={diffRight}
            onChangeLeft={setDiffLeft}
            onChangeRight={setDiffRight}
          />
        </Section>
      )}

      {/* ── Section 4: Evidence (item-level research) ── */}
      <Section title="Evidence · research-grounded">
        <EvidenceTable detailResearch={detailResearch} />
      </Section>

      {/* ── Section 5: Simulation Results (MC) ── */}
      {envelopeLocal?.evaluation_method === "simulation" && (
        <Section title="Simulation results">
          <SimulationResultsTable
            envelope={envelopeLocal}
            variations={sortedVariations}
          />
        </Section>
      )}
      {envelopeLocal?.evaluation_method !== "simulation" && (
        <Section title="Simulation results">
          <SimulationEmptyState onRun={runSimulation} />
        </Section>
      )}

      {/* ── Section 6: Actions ── */}
      <Section title="Deeper actions">
        <DeeperActionsRow
          spaceId={spaceId}
          subObjectiveId={subObjectiveId}
          entityId={entityId}
          variations={variationsLocal}
          causalChain={causalChain}
          dispatchAction={dispatchAction}
          actionDisabled={actionStatus?.state === "running"}
        />
      </Section>

      {/* Discuss anchor — the layout-level rail's chat is the actual
          target; this is just a scroll target so the "Discuss" link
          in the header chrome doesn't 404. */}
      <div id="discuss" className="h-2" />
    </main>
  );
}

// ── Section wrapper ──────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── Indicators table ─────────────────────────────────────────────

function IndicatorsTable({
  variations,
  onElect,
  onReject,
  onClear,
}: {
  variations: ItemVariation[];
  onElect: (id: string) => void;
  onReject: (id: string) => void;
  onClear: (id: string) => void;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <div
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11.5px]">
          <thead
            style={{
              background: appleVibe.surface.chip,
              borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            <tr>
              <Th className="text-left">Variation</Th>
              <Th className="text-right">Score</Th>
              <Th className="text-center">Method</Th>
              {CRITERION_KEYS.map((k) => (
                <Th key={k} className="text-right">
                  {CRITERION_LABELS[k]}
                </Th>
              ))}
              <Th className="text-center">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {variations.map((v) => {
              const score = v.effectiveness_score ?? 0;
              const method = v.evaluation_method as EvaluationMethod | undefined;
              const c = v.rubric_criteria;
              const isElected = v.disposition === "elected";
              const isRejected = v.disposition === "rejected";
              const isExpanded = expandedRow === v.id;
              return (
                <tr
                  key={v.id}
                  className="cursor-pointer transition-colors hover:bg-[rgba(15,23,42,0.025)]"
                  style={{
                    opacity: isRejected ? 0.5 : 1,
                    borderTop: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                  onClick={() =>
                    setExpandedRow(isExpanded ? null : v.id)
                  }
                >
                  <Td className="text-left">
                    <div className="flex items-center gap-1.5">
                      <ChevronRight
                        className="h-2.5 w-2.5 flex-shrink-0 transition-transform"
                        strokeWidth={2.4}
                        style={{
                          color: appleVibe.text.tertiary,
                          transform: isExpanded ? "rotate(90deg)" : "none",
                        }}
                      />
                      {isElected && (
                        <Check
                          className="h-2.5 w-2.5 flex-shrink-0"
                          strokeWidth={2.6}
                          style={{ color: appleVibe.stage.outcomes }}
                        />
                      )}
                      <span
                        className="truncate font-semibold"
                        style={{ color: appleVibe.text.primary }}
                        title={v.name}
                      >
                        {v.name}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {score > 0 ? (
                      <span
                        className="font-semibold"
                        style={{ color: appleVibe.text.primary }}
                      >
                        {score.toFixed(2)}
                      </span>
                    ) : (
                      <span style={{ color: appleVibe.text.faint }}>—</span>
                    )}
                  </Td>
                  <Td className="text-center">
                    {method ? (
                      <MethodBadge method={method} compact />
                    ) : (
                      <span style={{ color: appleVibe.text.faint }}>—</span>
                    )}
                  </Td>
                  {CRITERION_KEYS.map((k) => (
                    <Td key={k} className="text-right tabular-nums">
                      {c ? (
                        <span
                          title={c[k].reason}
                          style={{ color: appleVibe.text.primary }}
                        >
                          {c[k].score.toFixed(2)}
                        </span>
                      ) : (
                        <span style={{ color: appleVibe.text.faint }}>—</span>
                      )}
                    </Td>
                  ))}
                  <Td className="text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <IconButton
                        title={isElected ? "Clear election" : "Elect"}
                        onClick={() =>
                          isElected ? onClear(v.id) : onElect(v.id)
                        }
                        color={appleVibe.stage.outcomes}
                        active={isElected}
                      >
                        <Check className="h-3 w-3" strokeWidth={2.4} />
                      </IconButton>
                      <IconButton
                        title={isRejected ? "Clear rejection" : "Reject"}
                        onClick={() =>
                          isRejected ? onClear(v.id) : onReject(v.id)
                        }
                        color={appleVibe.stage.pain}
                        active={isRejected}
                      >
                        <X className="h-3 w-3" strokeWidth={2.4} />
                      </IconButton>
                    </div>
                  </Td>
                </tr>
              );
            })}
            {variations.length === 0 && (
              <tr>
                <td
                  colSpan={3 + CRITERION_KEYS.length + 1}
                  className="px-3 py-6 text-center text-[11.5px] font-light italic"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  No variations to evaluate yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Expanded reasons panel — shown below the table when a row
          is expanded. Renders the per-criterion reason strings the
          rubric scorer captured. */}
      {expandedRow &&
        (() => {
          const v = variations.find((x) => x.id === expandedRow);
          if (!v || !v.rubric_criteria) {
            return (
              <div
                className="border-t px-4 py-3 text-[11.5px] font-light italic"
                style={{
                  borderColor: appleVibe.stroke.hairline,
                  color: appleVibe.text.tertiary,
                  background: appleVibe.surface.chip,
                }}
              >
                No rubric criteria for this variation — run the rubric to
                generate per-criterion reasons.
              </div>
            );
          }
          const c = v.rubric_criteria;
          return (
            <div
              className="border-t px-4 py-3"
              style={{
                borderColor: appleVibe.stroke.hairline,
                background: appleVibe.surface.chip,
              }}
            >
              <p
                className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: appleVibe.text.tertiary }}
              >
                Reasons for {v.name}
              </p>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CRITERION_KEYS.map((k) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <dt
                      className="text-[10.5px] font-semibold"
                      style={{ color: appleVibe.text.secondary }}
                    >
                      {CRITERION_LABELS[k]} ·{" "}
                      <span className="tabular-nums">
                        {c[k].score.toFixed(2)}
                      </span>
                    </dt>
                    <dd
                      className="text-[11px] font-light leading-snug"
                      style={{ color: appleVibe.text.primary }}
                    >
                      {c[k].reason || (
                        <span style={{ color: appleVibe.text.faint }}>
                          (no reason captured)
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })()}
    </div>
  );
}

// ── Proxy indicators table ───────────────────────────────────────

function ProxyIndicatorsTable({
  variations,
  peerOutcomes,
}: {
  variations: ItemVariation[];
  peerOutcomes: PeerOutcome[];
}) {
  // Flatten: one row per (outcome, indicator). Columns: indicator
  // text + outcome name + per-variation score cells. When the
  // variation has no indicator_scores entry for this (outcome,
  // indicator) pair the cell shows "—".
  const rows = useMemo(() => {
    const out: Array<{
      key: string;
      indicator: string;
      outcome_name: string;
      outcome_id: string;
    }> = [];
    for (const o of peerOutcomes) {
      for (const i of o.indicators) {
        out.push({
          key: `${o.id}::${i}`,
          indicator: i,
          outcome_name: o.name,
          outcome_id: o.id,
        });
      }
    }
    return out;
  }, [peerOutcomes]);

  if (rows.length === 0) {
    return (
      <EmptyTable text="Room outcomes don't carry proxy indicators yet. Generate the outcomes or re-expand them to populate indicators." />
    );
  }

  // Phase 11.3+ ensemble decorations: when ensemble has run, each
  // indicator_scores entry carries lens_scores + disagreement_score
  // + mediation_check + goodhart_risk. We return the FULL hit so the
  // cell renderer can surface those signals as small badges/icons.
  function findScore(
    v: ItemVariation,
    outcomeId: string,
    indicatorText: string,
  ): NonNullable<ItemVariation["indicator_scores"]>[number] | null {
    if (!Array.isArray(v.indicator_scores)) return null;
    return (
      v.indicator_scores.find(
        (s) =>
          s.outcome_id === outcomeId && s.indicator_text === indicatorText,
      ) ?? null
    );
  }

  return (
    <div
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11.5px]">
          <thead
            style={{
              background: appleVibe.surface.chip,
              borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            <tr>
              <Th className="text-left">Indicator</Th>
              <Th className="text-left">Outcome</Th>
              {variations.map((v) => (
                <Th key={v.id} className="text-right">
                  {truncate(v.name, 14)}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                style={{
                  borderTop: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                <Td
                  className="text-left"
                  style={{ maxWidth: 320 }}
                >
                  <span
                    className="font-medium"
                    style={{ color: appleVibe.text.primary }}
                  >
                    {row.indicator}
                  </span>
                </Td>
                <Td className="text-left">
                  <span
                    className="text-[10.5px] font-light"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    {row.outcome_name}
                  </span>
                </Td>
                {variations.map((v) => {
                  const cell = findScore(v, row.outcome_id, row.indicator);
                  return (
                    <Td key={v.id} className="text-right tabular-nums">
                      {cell ? (
                        <IndicatorCell cell={cell} />
                      ) : (
                        <span style={{ color: appleVibe.text.faint }}>—</span>
                      )}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className="px-3 py-2 text-[10px] font-light italic"
        style={{
          color: appleVibe.text.faint,
          borderTop: `1px solid ${appleVibe.stroke.hairline}`,
        }}
      >
        Hover any cell for reason + proxy confidence. ⚠ = confidence &lt;0.4.
        When ensemble has run, cells also show lens-agreement chips (e.g.
        &ldquo;4/5&rdquo;), mediation classification (necessary / indirect /
        questionable), and Goodhart risk warnings.
      </p>
    </div>
  );
}

// ── Indicator cell — renders one variation × indicator score with
//    ensemble decorations when present. Pure-rubric cells stay
//    minimal (just score + ⚠); ensemble cells layer in lens
//    agreement count + mediation classification + Goodhart risk. ──

type IndicatorScoreCell = NonNullable<
  ItemVariation["indicator_scores"]
>[number];

function IndicatorCell({ cell }: { cell: IndicatorScoreCell }) {
  const hasEnsemble =
    Array.isArray(cell.lens_scores) && cell.lens_scores.length > 0;
  const titleBase = `${cell.reason} (proxy confidence ${cell.confidence.toFixed(2)})`;
  // Compose the hover-title with ensemble extras when present so users
  // can see the lens spread without us needing a dropdown.
  const titleFull = hasEnsemble
    ? [
        titleBase,
        cell.lens_scores
          ? `Lens scores: ${cell.lens_scores.map((l) => `${l.lens}=${l.score.toFixed(2)}`).join(", ")}`
          : null,
        typeof cell.disagreement_score === "number"
          ? `Disagreement σ=${cell.disagreement_score.toFixed(2)} ${cell.disagreement_score > 0.2 ? "(meaningful divergence)" : ""}`
          : null,
        cell.mediation_check
          ? `Mediation: ${cell.mediation_check}`
          : null,
        cell.goodhart_risk ? `Goodhart risk: ${cell.goodhart_risk}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : titleBase;

  const mediationColor = cell.mediation_check
    ? cell.mediation_check === "necessary"
      ? appleVibe.stage.outcomes
      : cell.mediation_check === "questionable"
        ? appleVibe.stage.pain
        : appleVibe.text.tertiary
    : null;

  const goodhartColor =
    cell.goodhart_risk === "high"
      ? appleVibe.stage.pain
      : cell.goodhart_risk === "medium"
        ? "rgba(217,119,6,0.85)"
        : null;

  return (
    <span
      title={titleFull}
      className="inline-flex flex-col items-end gap-0.5"
    >
      <span
        className="font-semibold"
        style={{
          color:
            cell.confidence < 0.4
              ? appleVibe.stage.pain
              : appleVibe.text.primary,
        }}
      >
        {cell.score.toFixed(2)}
        {cell.confidence < 0.4 && (
          <span
            className="ml-1 text-[9px]"
            title="Proxy confidence below 0.4 — this indicator may not actually map to the outcome you care about"
          >
            ⚠
          </span>
        )}
      </span>
      {hasEnsemble && (
        <span className="flex items-center gap-1 text-[9px] font-light">
          {typeof cell.lens_agreement_count === "number" && (
            <span
              className="rounded-full px-1 py-px"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.tertiary,
                border: `1px solid ${appleVibe.stroke.hairline}`,
              }}
              title={`${cell.lens_agreement_count} of 5 lenses had confidence ≥0.5`}
            >
              {cell.lens_agreement_count}/5
            </span>
          )}
          {mediationColor && cell.mediation_check && (
            <span
              className="rounded-full px-1 py-px font-medium uppercase tracking-[0.1em]"
              style={{
                background: `${mediationColor}14`,
                color: mediationColor,
                border: `1px solid ${mediationColor}26`,
                fontSize: "8px",
              }}
              title={`Prentice mediation: ${cell.mediation_check}`}
            >
              {cell.mediation_check === "necessary"
                ? "Nec"
                : cell.mediation_check === "indirect"
                  ? "Ind"
                  : "?"}
            </span>
          )}
          {goodhartColor && cell.goodhart_risk && cell.goodhart_risk !== "low" && (
            <span
              className="rounded-full px-1 py-px font-medium uppercase tracking-[0.1em]"
              style={{
                background: `${goodhartColor}14`,
                color: goodhartColor,
                border: `1px solid ${goodhartColor}26`,
                fontSize: "8px",
              }}
              title={`Goodhart risk: ${cell.goodhart_risk} — ${cell.goodhart_risk === "high" ? "trivially gameable / vanity proxy" : "gameable with sustained effort"}`}
            >
              {cell.goodhart_risk === "high" ? "GH!" : "GH"}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// ── Counter-indicators section — renders envelope.counter_indicators
//    when ensemble scoring populated them. These are "yin" proxies the
//    rigor doc calls for: pair every primary indicator with one that
//    should hold steady or improve alongside, to defend against
//    Goodhart-style optimization that wins the metric but loses the
//    outcome. ──

interface CounterIndicator {
  outcome_id: string;
  outcome_name: string;
  counter_indicator: string;
  rationale: string;
}

function CounterIndicatorsTable({
  counterIndicators,
}: {
  counterIndicators: CounterIndicator[];
}) {
  if (counterIndicators.length === 0) {
    return (
      <EmptyTable text="Counter-indicators populate when ensemble scoring runs — each outcome gets paired with an opposing proxy that should hold steady to defend against Goodhart-style optimization." />
    );
  }
  return (
    <div
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <table className="min-w-full text-[11.5px]">
        <thead
          style={{
            background: appleVibe.surface.chip,
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <tr>
            <Th className="text-left">Outcome</Th>
            <Th className="text-left">Counter-indicator (yin)</Th>
            <Th className="text-left">Rationale</Th>
          </tr>
        </thead>
        <tbody>
          {counterIndicators.map((ci, i) => (
            <tr
              key={`${ci.outcome_id}-${i}`}
              style={{
                borderTop: `1px solid ${appleVibe.stroke.hairline}`,
              }}
            >
              <Td className="text-left">
                <span
                  className="text-[10.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {ci.outcome_name}
                </span>
              </Td>
              <Td className="text-left">
                <span
                  className="font-medium"
                  style={{ color: appleVibe.text.primary }}
                >
                  {ci.counter_indicator}
                </span>
              </Td>
              <Td className="text-left" style={{ maxWidth: 360 }}>
                <span
                  className="text-[10.5px] font-light leading-snug"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {ci.rationale}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        className="px-3 py-2 text-[10px] font-light italic"
        style={{
          color: appleVibe.text.faint,
          borderTop: `1px solid ${appleVibe.stroke.hairline}`,
        }}
      >
        If a variation moves the primary indicator BUT the counter-indicator
        also moves against you, you&rsquo;ve probably Goodharted the proxy.
      </p>
    </div>
  );
}

// ── Variation diff table ─────────────────────────────────────────

function VariationDiffTable({
  variations,
  leftId,
  rightId,
  onChangeLeft,
  onChangeRight,
}: {
  variations: ItemVariation[];
  leftId: string | null;
  rightId: string | null;
  onChangeLeft: (id: string) => void;
  onChangeRight: (id: string) => void;
}) {
  const left = variations.find((v) => v.id === leftId) ?? variations[0];
  const right =
    variations.find((v) => v.id === rightId) ?? variations[1] ?? variations[0];

  if (!left || !right || left.id === right.id) {
    return (
      <EmptyTable text="Pick two different variations to compare." />
    );
  }

  return (
    <div
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: appleVibe.stroke.hairline,
          background: appleVibe.surface.chip,
        }}
      >
        <span
          className="text-[10.5px] font-semibold"
          style={{ color: appleVibe.text.tertiary }}
        >
          Compare:
        </span>
        <VariationPicker
          value={left.id}
          variations={variations}
          onChange={onChangeLeft}
        />
        <span
          className="text-[10.5px]"
          style={{ color: appleVibe.text.faint }}
        >
          vs
        </span>
        <VariationPicker
          value={right.id}
          variations={variations}
          onChange={onChangeRight}
        />
      </div>
      <table className="min-w-full text-[11.5px]">
        <thead
          style={{
            background: appleVibe.surface.chip,
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <tr>
            <Th className="text-left">Criterion</Th>
            <Th className="text-right">{truncate(left.name, 22)}</Th>
            <Th className="text-right">{truncate(right.name, 22)}</Th>
            <Th className="text-right">Δ</Th>
          </tr>
        </thead>
        <tbody>
          <DiffRow
            label="Composite"
            l={left.effectiveness_score ?? 0}
            r={right.effectiveness_score ?? 0}
            highlight
          />
          {CRITERION_KEYS.map((k) => (
            <DiffRow
              key={k}
              label={CRITERION_LABELS[k]}
              l={left.rubric_criteria?.[k].score ?? 0}
              r={right.rubric_criteria?.[k].score ?? 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffRow({
  label,
  l,
  r,
  highlight,
}: {
  label: string;
  l: number;
  r: number;
  highlight?: boolean;
}) {
  const delta = l - r;
  const winner = Math.abs(delta) < 0.005 ? null : delta > 0 ? "left" : "right";
  return (
    <tr
      style={{
        borderTop: `1px solid ${appleVibe.stroke.hairline}`,
        background: highlight ? appleVibe.surface.chip : undefined,
      }}
    >
      <Td className="text-left">
        <span
          className={highlight ? "font-semibold" : ""}
          style={{ color: appleVibe.text.primary }}
        >
          {label}
        </span>
      </Td>
      <Td className="text-right tabular-nums">
        {l > 0 ? l.toFixed(2) : "—"}
      </Td>
      <Td className="text-right tabular-nums">
        {r > 0 ? r.toFixed(2) : "—"}
      </Td>
      <Td className="text-right tabular-nums">
        {winner === null ? (
          <span style={{ color: appleVibe.text.faint }}>0</span>
        ) : (
          <span
            style={{
              color:
                winner === "left"
                  ? appleVibe.stage.outcomes
                  : appleVibe.stage.features,
              fontWeight: 600,
            }}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(2)}
          </span>
        )}
      </Td>
    </tr>
  );
}

function VariationPicker({
  value,
  variations,
  onChange,
}: {
  value: string;
  variations: ItemVariation[];
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md px-2 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-1"
      style={{
        background: appleVibe.surface.card,
        color: appleVibe.text.primary,
        border: `1px solid ${appleVibe.stroke.medium}`,
      }}
    >
      {variations.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}

// ── Evidence table ───────────────────────────────────────────────

function EvidenceTable({ detailResearch }: { detailResearch: unknown }) {
  // detailResearch shape (per existing ItemResearchBundle in
  // /api/brainstorm/item/research): { query, sources: [{ url, title,
  // snippet, relevance }], fetched_at }. We render the sources flat;
  // per-variation "supports?" grading is Phase 11.3.
  const sources: ResearchSource[] = useMemo(() => {
    if (!detailResearch || typeof detailResearch !== "object") return [];
    const r = detailResearch as { sources?: unknown };
    if (!Array.isArray(r.sources)) return [];
    return (r.sources as unknown[])
      .filter((s): s is ResearchSource => typeof s === "object" && s !== null)
      .map((s) => ({
        url: typeof s.url === "string" ? s.url : undefined,
        title: typeof s.title === "string" ? s.title : undefined,
        snippet: typeof s.snippet === "string" ? s.snippet : undefined,
        relevance:
          typeof s.relevance === "number" ? s.relevance : undefined,
      }))
      .slice(0, 10);
  }, [detailResearch]);

  if (sources.length === 0) {
    return (
      <EmptyTable text="No research grounding yet. Trigger “Research this item” from the room drawer to populate evidence." />
    );
  }

  return (
    <div
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <table className="min-w-full text-[11.5px]">
        <thead
          style={{
            background: appleVibe.surface.chip,
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <tr>
            <Th className="text-left">Source</Th>
            <Th className="text-left">Snippet</Th>
            <Th className="text-right">Relevance</Th>
            <Th className="text-center">Supports?</Th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => (
            <tr
              key={i}
              style={{
                borderTop: `1px solid ${appleVibe.stroke.hairline}`,
              }}
            >
              <Td className="text-left">
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-medium hover:underline"
                    style={{ color: appleVibe.accent.primary }}
                  >
                    {truncate(s.title ?? s.url, 48)}
                    <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.4} />
                  </a>
                ) : (
                  <span style={{ color: appleVibe.text.primary }}>
                    {truncate(s.title ?? "Untitled", 48)}
                  </span>
                )}
              </Td>
              <Td className="text-left" style={{ maxWidth: 320 }}>
                <span
                  className="text-[10.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {truncate(s.snippet ?? "", 100)}
                </span>
              </Td>
              <Td className="text-right tabular-nums">
                {typeof s.relevance === "number"
                  ? s.relevance.toFixed(2)
                  : "—"}
              </Td>
              <Td className="text-center">
                <span
                  className="text-[10.5px] italic"
                  style={{ color: appleVibe.text.faint }}
                  title="Per-source-per-variation 'supports?' grading is Phase 11.3."
                >
                  ungraded
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Simulation results table ─────────────────────────────────────

function SimulationResultsTable({
  envelope,
  variations,
}: {
  envelope: ExpandedItemDetail["effectiveness_envelope"];
  variations: ItemVariation[];
}) {
  if (!envelope || envelope.status !== "ok") {
    return (
      <EmptyTable
        text={
          envelope?.status_detail ??
          "Simulation hasn't returned a valid envelope yet."
        }
      />
    );
  }

  return (
    <div
      className="overflow-hidden"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.md,
      }}
    >
      <table className="min-w-full text-[11.5px]">
        <thead
          style={{
            background: appleVibe.surface.chip,
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <tr>
            <Th className="text-left">Variation</Th>
            <Th className="text-left">Target pain</Th>
            <Th className="text-right">Lift p50</Th>
            <Th className="text-right">p10 – p90</Th>
            <Th className="text-center">Placebo</Th>
            <Th className="text-center">Method</Th>
          </tr>
        </thead>
        <tbody>
          {variations.map((v) => (
            <tr
              key={v.id}
              style={{
                borderTop: `1px solid ${appleVibe.stroke.hairline}`,
              }}
            >
              <Td className="text-left">
                <span style={{ color: appleVibe.text.primary }}>{v.name}</span>
              </Td>
              <Td className="text-left">
                <span
                  className="text-[10.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {envelope.target_entity_name ?? "—"}
                </span>
              </Td>
              <Td className="text-right tabular-nums">
                {typeof envelope.lift_pct === "number"
                  ? `${(envelope.lift_pct * 100).toFixed(1)}%`
                  : "—"}
              </Td>
              <Td className="text-right tabular-nums text-[10.5px]">
                {envelope.lift_band
                  ? `${(envelope.lift_band.p10 * 100).toFixed(0)} / ${(envelope.lift_band.p90 * 100).toFixed(0)}%`
                  : "—"}
              </Td>
              <Td className="text-center">
                <PlaceboBadge verdict={envelope.placebo_verdict} />
              </Td>
              <Td className="text-center">
                <MethodBadge method="simulation" compact />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimulationEmptyState({ onRun }: { onRun: () => void }) {
  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: appleVibe.surface.card,
        border: `1px dashed ${appleVibe.stroke.medium}`,
      }}
    >
      <p
        className="text-[11.5px] font-light leading-snug"
        style={{ color: appleVibe.text.secondary }}
      >
        No simulation has run yet. Monte Carlo makes sense when you have
        propagating uncertainty across the causal graph — adherence × dose ×
        time. The rubric (above) already answers most &ldquo;is this good?&rdquo;
        questions in ~0.4s. Run simulation when you want a distribution,
        not a point estimate.
      </p>
      <div className="mt-2.5">
        <ActionButton
          label="Run Monte Carlo"
          icon={Dice5}
          onClick={onRun}
        />
      </div>
    </div>
  );
}

// ── Deeper actions row ───────────────────────────────────────────

function DeeperActionsRow({
  spaceId,
  subObjectiveId,
  entityId,
  variations,
  causalChain,
  dispatchAction,
  actionDisabled,
}: {
  spaceId: string;
  subObjectiveId: string;
  entityId: string;
  variations: ItemVariation[];
  causalChain: Record<string, unknown> | null;
  dispatchAction: (
    label: string,
    run: () => Promise<{
      ok: boolean;
      message?: string;
      nextVariations?: ItemVariation[];
      nextEnvelope?: ExpandedItemDetail["effectiveness_envelope"];
      refreshRoute?: boolean;
    }>,
  ) => void;
  actionDisabled: boolean;
}) {
  const elected = variations.filter((v) => v.disposition === "elected");
  const electedCount = elected.length;
  const firstElectedId = elected[0]?.id;

  // Propose a prototype brief on the FIRST elected variation +
  // its FIRST open_question (lowest-friction default — user can
  // refine from the existing prototype lifecycle UI).
  const proposeTest = useCallback(() => {
    if (!firstElectedId) {
      void dispatchAction("Propose real test", async () => ({
        ok: false,
        message: "Elect at least one variation first.",
      }));
      return;
    }
    const elected0 = variations.find((v) => v.id === firstElectedId);
    const openQ = elected0?.open_questions?.[0];
    if (!openQ) {
      void dispatchAction("Propose real test", async () => ({
        ok: false,
        message:
          "The elected variation has no open questions to anchor a prototype brief.",
      }));
      return;
    }
    void dispatchAction("Propose real test", async () => {
      const res = await fetch("/api/brainstorm/item/variation/prototype", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId,
          variationId: firstElectedId,
          openQuestion: openQ,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, message: j.error ?? "Brief generation failed." };
      }
      return {
        ok: true,
        message: "Brief created — see the experiments library.",
        refreshRoute: true,
      };
    });
  }, [dispatchAction, entityId, firstElectedId, variations]);

  void causalChain; // currently unused; kept available for future actions

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        label="Propose real test"
        icon={FlaskConical}
        onClick={proposeTest}
        disabled={actionDisabled || electedCount === 0}
        title={
          electedCount === 0
            ? "Elect a variation first"
            : "Spawns a prototype brief from the first elected variation's first open question"
        }
      />
      <ActionButton
        label="Open in drawer"
        icon={FileText}
        onClick={() => {
          // Drawer lives in the room view; route there and the user
          // can click the entity to open. (Direct drawer open from a
          // separate route would need cross-page state — out of
          // scope for 11.2.)
          window.location.href = `/app/objective/${spaceId}/sub/${subObjectiveId}`;
        }}
      />
      <span
        className="text-[10.5px] font-light italic"
        style={{ color: appleVibe.text.faint }}
      >
        {electedCount} elected
        {variations.length > 0 ? ` of ${variations.length}` : ""}
      </span>
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.10em] ${className ?? ""}`}
      style={{ color: appleVibe.text.tertiary }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  style,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      className={`px-3 py-2 align-middle ${className ?? ""}`}
      style={style}
      onClick={onClick}
    >
      {children}
    </td>
  );
}

function EmptyTable({ text }: { text: string }) {
  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: appleVibe.surface.card,
        border: `1px dashed ${appleVibe.stroke.medium}`,
      }}
    >
      <p
        className="text-[11.5px] font-light italic"
        style={{ color: appleVibe.text.tertiary }}
      >
        {text}
      </p>
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  primary,
  title,
}: {
  label: string;
  icon: typeof RefreshCw;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { y: 0.5 }}
      className="inline-flex items-center gap-1.5 transition-[background,color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: primary ? appleVibe.accent.primary : appleVibe.surface.card,
        color: primary ? appleVibe.text.onAccent : appleVibe.text.secondary,
        border: `1px solid ${primary ? appleVibe.accent.primary : appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.pill,
        padding: "5px 12px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        boxShadow: primary ? appleVibe.shadow.chip : "none",
        fontFamily: appleVibe.font.stack,
      }}
      title={title}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </motion.button>
  );
}

function IconButton({
  children,
  onClick,
  title,
  color,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  color: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-all"
      style={{
        background: active ? `${color}15` : "transparent",
        color: active ? color : appleVibe.text.tertiary,
        border: `1px solid ${active ? color : appleVibe.stroke.hairline}`,
      }}
    >
      {children}
    </button>
  );
}

function ActionStatusChip({
  status,
}: {
  status: { label: string; state: "running" | "done" | "error"; message?: string };
}) {
  const color =
    status.state === "running"
      ? appleVibe.stage.features
      : status.state === "done"
        ? appleVibe.stage.outcomes
        : appleVibe.stage.pain;
  const Icon =
    status.state === "running"
      ? Loader2
      : status.state === "done"
        ? Check
        : X;
  return (
    <div
      className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10.5px] font-medium"
      style={{
        background: `${color}10`,
        color,
        border: `1px solid ${color}30`,
      }}
    >
      <Icon
        className={`h-3 w-3 ${status.state === "running" ? "animate-spin" : ""}`}
        strokeWidth={2.4}
      />
      <span>
        {status.label}
        {status.message ? ` — ${status.message}` : ""}
      </span>
    </div>
  );
}

function PlaceboBadge({
  verdict,
}: {
  verdict: "pass" | "fail" | "skip" | null;
}) {
  if (!verdict)
    return <span style={{ color: appleVibe.text.faint }}>—</span>;
  const color =
    verdict === "pass"
      ? appleVibe.stage.outcomes
      : verdict === "fail"
        ? appleVibe.stage.pain
        : appleVibe.text.tertiary;
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
      style={{
        background: `${color}10`,
        color,
        border: `1px solid ${color}26`,
      }}
    >
      {verdict}
    </span>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay}d ago`;
}
