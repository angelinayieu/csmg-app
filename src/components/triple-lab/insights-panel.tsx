"use client";

// Insights panel — right column. Renders the live synthesis_data
// (master bottleneck, leverage points, axioms, hidden signals,
// convergences, open questions, action plan) plus the guardrail
// question queue. Sections collapse cleanly when empty so the panel
// stays light during early raw-signal phase.

import { useMemo, useState } from "react";
import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import { GuardrailQuestionQueue } from "./guardrail-question-queue";

interface InsightsPanelProps {
  spaceId: string;
  synthesisData: SynthesisData | null;
  entities: Entity[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}

export function InsightsPanel({
  spaceId,
  synthesisData,
  entities,
  selectedEntityId,
  onSelectEntity,
}: InsightsPanelProps) {
  const entitiesById = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) m.set(e.id, e);
    return m;
  }, [entities]);

  // Headline counts at the top so the user can scan freshness at a
  // glance without scrolling. Only count sections that have data.
  const headline = useMemo(() => {
    if (!synthesisData) return null;
    return {
      leverage: synthesisData.leverage_points?.length ?? 0,
      risks: synthesisData.risk_points?.length ?? 0,
      axioms: (synthesisData.axioms?.length ?? 0),
      hiddenAxioms:
        synthesisData.axioms?.filter((a) => a.visibility === "HIDDEN").length ?? 0,
      signals: synthesisData.signal_extraction?.structural_holes?.length ?? 0,
      convergences: synthesisData.insight_convergences?.length ?? 0,
      openQ: synthesisData.open_questions?.length ?? 0,
    };
  }, [synthesisData]);

  return (
    <div
      className="flex h-full flex-col"
      style={{
        background:
          "linear-gradient(180deg, #FBFCFE 0%, #F4F6FB 100%)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4"
        style={{ background: "rgba(255, 255, 255, 0.65)" }}
      >
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">
            ✦ Insights
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900">
            {synthesisData ? "Live" : "Awaiting synthesis"}
          </div>
        </div>
        {headline && (
          <div className="flex items-center gap-1.5">
            {headline.leverage > 0 && (
              <CountChip n={headline.leverage} label="lev" color="#F59E0B" />
            )}
            {headline.risks > 0 && (
              <CountChip n={headline.risks} label="risk" color="#EF4444" />
            )}
            {headline.axioms > 0 && (
              <CountChip
                n={headline.axioms}
                label={headline.hiddenAxioms > 0 ? `ax · ${headline.hiddenAxioms}h` : "ax"}
                color="#4F46E5"
              />
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!synthesisData ? (
          <InsightsEmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            <BottleneckSection
              bottleneck={synthesisData.master_bottleneck ?? null}
              entitiesById={entitiesById}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
            />
            <LeverageSection
              leverage={synthesisData.leverage_points ?? []}
              entitiesById={entitiesById}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
            />
            <RiskSection
              risks={synthesisData.risk_points ?? []}
              entitiesById={entitiesById}
              selectedEntityId={selectedEntityId}
              onSelectEntity={onSelectEntity}
            />
            <AxiomsSection axioms={synthesisData.axioms ?? []} />
            <HiddenSignalsSection
              signals={synthesisData.signal_extraction ?? null}
            />
            <ConvergencesSection
              convergences={synthesisData.insight_convergences ?? []}
              entitiesById={entitiesById}
            />
            <OpenQuestionsSection
              questions={synthesisData.open_questions ?? []}
            />
          </div>
        )}
      </div>

      {/* ── Guardrail queue (Phase 3) ──────────────────────────────── */}
      <GuardrailQuestionQueue spaceId={spaceId} />
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
function InsightsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
        No synthesis yet
      </div>
      <div className="mt-2 max-w-[240px] text-xs leading-relaxed text-slate-500">
        Drop signal in the left panel. When the chain runs, leverage
        points, hidden signals, and the master bottleneck will surface
        here.
      </div>
    </div>
  );
}

// ── Headline count chip ──────────────────────────────────────────────
function CountChip({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div
      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{
        background: `${color}1A`,
        color,
      }}
    >
      {n}
      <span className="ml-1 text-[9px] font-medium opacity-80">{label}</span>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────
function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-white/80">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <div
            className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-700"
          >
            {title}
          </div>
          {count !== undefined && count !== null && count !== "" && (
            <div className="rounded-full bg-slate-100 px-1.5 text-[9px] font-bold text-slate-600">
              {count}
            </div>
          )}
        </div>
        <span className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ── Bottleneck section ───────────────────────────────────────────────
function BottleneckSection({
  bottleneck,
  entitiesById,
  selectedEntityId,
  onSelectEntity,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bottleneck: any | null;
  entitiesById: Map<string, Entity>;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  if (!bottleneck) return null;
  const entity = bottleneck.entity_id
    ? entitiesById.get(bottleneck.entity_id)
    : null;
  const selected = bottleneck.entity_id === selectedEntityId;
  return (
    <Section title="Master bottleneck">
      <div
        className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-slate-50"
        onClick={() =>
          bottleneck.entity_id &&
          onSelectEntity(selected ? null : bottleneck.entity_id)
        }
        style={{
          background: selected ? "rgba(220, 38, 38, 0.06)" : "transparent",
        }}
      >
        {entity && (
          <div className="text-[12px] font-bold text-slate-900">
            {entity.name}
          </div>
        )}
        {bottleneck.summary && (
          <div className="mt-1 text-[11px] leading-relaxed text-slate-700">
            {bottleneck.summary}
          </div>
        )}
        {bottleneck.counterfactual_unlock && (
          <div
            className="mt-2 rounded-md px-2 py-1.5 text-[10.5px] leading-relaxed"
            style={{
              background: "rgba(220, 38, 38, 0.07)",
              color: "rgb(127, 29, 29)",
            }}
          >
            <span className="font-semibold">Unlock: </span>
            {bottleneck.counterfactual_unlock}
          </div>
        )}
      </div>
    </Section>
  );
}

// ── Leverage section ─────────────────────────────────────────────────
function LeverageSection({
  leverage,
  entitiesById,
  selectedEntityId,
  onSelectEntity,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leverage: any[];
  entitiesById: Map<string, Entity>;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  if (leverage.length === 0) return null;
  return (
    <Section title="Leverage points" count={leverage.length}>
      <div className="flex flex-col gap-1.5">
        {leverage.slice(0, 6).map((lev, idx) => {
          const ent = lev.entity_id ? entitiesById.get(lev.entity_id) : null;
          const selected = lev.entity_id === selectedEntityId;
          return (
            <div
              key={`lev-${idx}`}
              onClick={() =>
                lev.entity_id &&
                onSelectEntity(selected ? null : lev.entity_id)
              }
              className="cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-slate-50"
              style={{
                background: selected ? "rgba(245, 158, 11, 0.08)" : "transparent",
              }}
            >
              <div className="text-[11.5px] font-semibold text-slate-900">
                {ent?.name ?? lev.entity_name ?? "Leverage point"}
              </div>
              {lev.summary && (
                <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
                  {lev.summary}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Risk section ─────────────────────────────────────────────────────
function RiskSection({
  risks,
  entitiesById,
  selectedEntityId,
  onSelectEntity,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  risks: any[];
  entitiesById: Map<string, Entity>;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  if (risks.length === 0) return null;
  return (
    <Section title="Risk points" count={risks.length} defaultOpen={false}>
      <div className="flex flex-col gap-1.5">
        {risks.slice(0, 6).map((r, idx) => {
          const ent = r.entity_id ? entitiesById.get(r.entity_id) : null;
          const selected = r.entity_id === selectedEntityId;
          return (
            <div
              key={`risk-${idx}`}
              onClick={() =>
                r.entity_id && onSelectEntity(selected ? null : r.entity_id)
              }
              className="cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-slate-50"
              style={{
                background: selected ? "rgba(239, 68, 68, 0.08)" : "transparent",
              }}
            >
              <div className="text-[11.5px] font-semibold text-slate-900">
                {ent?.name ?? r.entity_name ?? "Risk"}
              </div>
              {r.summary && (
                <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
                  {r.summary}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Axioms section ───────────────────────────────────────────────────
function AxiomsSection({
  axioms,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axioms: any[];
}) {
  if (axioms.length === 0) return null;
  const hiddenCount = axioms.filter((a) => a.visibility === "HIDDEN").length;
  return (
    <Section
      title="Axioms"
      count={hiddenCount > 0 ? `${axioms.length} · ${hiddenCount} hidden` : axioms.length}
    >
      <div className="flex flex-col gap-1.5">
        {axioms.map((a, idx) => (
          <div
            key={`ax-${idx}`}
            className="rounded-md px-2 py-1.5"
            style={{
              background:
                a.visibility === "HIDDEN"
                  ? "rgba(79, 70, 229, 0.06)"
                  : "transparent",
            }}
          >
            <div className="mb-0.5 flex items-center gap-1.5">
              <span
                className="text-[8.5px] font-bold uppercase tracking-wider"
                style={{
                  color:
                    a.visibility === "HIDDEN"
                      ? "#4F46E5"
                      : a.visibility === "IMPLICIT"
                      ? "#0891B2"
                      : "#64748B",
                }}
              >
                {a.visibility ?? "—"} · {a.scope ?? "node"}
              </span>
            </div>
            <div className="text-[11px] font-medium leading-snug text-slate-900">
              {a.claim ?? "—"}
            </div>
            {a.if_false && (
              <div className="mt-0.5 text-[10px] italic text-slate-500">
                If false: {a.if_false}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Hidden signals section ───────────────────────────────────────────
function HiddenSignalsSection({
  signals,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signals: any | null;
}) {
  if (!signals) return null;
  const structural = signals.structural_holes?.length ?? 0;
  const hidden = signals.hidden_variables?.length ?? 0;
  const cascade = signals.cascade_vulnerabilities?.length ?? 0;
  const flip = signals.flip_prone_loops?.length ?? 0;
  const total = structural + hidden + cascade + flip;
  if (total === 0) return null;
  return (
    <Section title="Hidden signals" count={total} defaultOpen={false}>
      <div className="grid grid-cols-2 gap-1.5">
        {structural > 0 && <SignalChip label="Structural holes" n={structural} />}
        {hidden > 0 && <SignalChip label="Hidden mediators" n={hidden} />}
        {cascade > 0 && <SignalChip label="Cascade SPOFs" n={cascade} />}
        {flip > 0 && <SignalChip label="Flip-prone loops" n={flip} />}
      </div>
    </Section>
  );
}

function SignalChip({ label, n }: { label: string; n: number }) {
  return (
    <div
      className="flex items-center justify-between rounded-md px-2 py-1.5"
      style={{ background: "rgba(15, 23, 42, 0.03)" }}
    >
      <span className="text-[10.5px] text-slate-700">{label}</span>
      <span className="font-mono text-[10px] font-bold text-slate-900">{n}</span>
    </div>
  );
}

// ── Convergences section ─────────────────────────────────────────────
function ConvergencesSection({
  convergences,
  entitiesById,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  convergences: any[];
  entitiesById: Map<string, Entity>;
}) {
  if (convergences.length === 0) return null;
  return (
    <Section title="Convergences" count={convergences.length} defaultOpen={false}>
      <div className="flex flex-col gap-1.5">
        {convergences.slice(0, 4).map((c, idx) => (
          <div key={`conv-${idx}`} className="rounded-md px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[8.5px] font-bold uppercase tracking-wider"
                style={{
                  color:
                    c.strength === "strong"
                      ? "#10B981"
                      : c.strength === "moderate"
                      ? "#0891B2"
                      : "#64748B",
                }}
              >
                {c.strength ?? "moderate"} · {c.signal_count ?? "?"} signals
              </span>
              {c.has_hidden_axiom && (
                <span
                  className="rounded px-1 text-[8.5px] font-bold uppercase"
                  style={{ background: "rgba(79, 70, 229, 0.12)", color: "#4F46E5" }}
                >
                  hidden ax
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-900">
              {c.concern_label ?? "Convergence"}
            </div>
            {c.shared_entity_ids && c.shared_entity_ids.length > 0 && (
              <div className="mt-0.5 text-[10px] text-slate-500">
                Touches:{" "}
                {c.shared_entity_ids
                  .slice(0, 3)
                  .map((id: string) => entitiesById.get(id)?.name ?? id)
                  .join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Open questions section ──────────────────────────────────────────
function OpenQuestionsSection({
  questions,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  questions: any[];
}) {
  if (questions.length === 0) return null;
  return (
    <Section
      title="Open questions"
      count={questions.length}
      defaultOpen={false}
    >
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {questions.slice(0, 8).map((q, idx) => (
          <li
            key={`oq-${idx}`}
            className="text-[10.5px] leading-snug text-slate-700"
          >
            {typeof q === "string" ? q : q.question ?? q.text ?? "—"}
          </li>
        ))}
      </ul>
    </Section>
  );
}
