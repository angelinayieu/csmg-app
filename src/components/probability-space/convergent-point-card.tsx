"use client";

// ── ConvergentPointCard ──
// Displays a single convergent point in compact or expanded form. The card
// is the atom of the probability-space UI — everything else is a list of
// these, sorted/filtered by the parent view.

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Undo2, Waves, ArrowUpRight, ArrowDownRight, Minus, AlertCircle, ThumbsUp, ThumbsDown, Target as TargetIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ConvergentPoint,
  ConvergentOutcome,
  ObjectiveAlignment,
} from "@/types/convergent-point";
import type { Entity } from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import { NodeSignatureRing } from "@/components/signatures/node-signature-ring";

type FeedbackValue = "useful" | "noise" | "inaccurate" | null;

interface Props {
  point: ConvergentPoint & { composite_score?: number; user_feedback?: FeedbackValue };
  entitiesByUuid: Map<string, Entity>;
  rank?: number;
  className?: string;
  /**
   * Phase 1.1 — opens the parent's NodeSignatureDetail drawer when a
   * ring is clicked. The card stays stateless about drawer ownership
   * so we don't end up with N drawers stacking on top of each other.
   * Optional; rings render but stay non-interactive when omitted.
   */
  onSelectSignature?: (sig: NodeSignature, entityName: string) => void;
}

// Same loose-cast guard as in node-probability-space-view; entities[*]
// .node_signature is jsonb so we narrow at the boundary.
function asSignature(json: Entity["node_signature"]): NodeSignature | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const sig = json as unknown as NodeSignature;
  if (typeof sig.canonical_code !== "string") return null;
  if (!Array.isArray(sig.basis) || sig.basis.length === 0) return null;
  return sig;
}

// ── Visual helpers ──

const POLARITY_CONFIG: Record<ConvergentOutcome["polarity"], {
  label: string;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  positive: {
    label: "Positive",
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    textColor: "text-emerald-700",
    Icon: ArrowUpRight,
  },
  negative: {
    label: "Negative",
    iconColor: "text-rose-600",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-200",
    textColor: "text-rose-700",
    Icon: ArrowDownRight,
  },
  neutral: {
    label: "Neutral",
    iconColor: "text-gray-500",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
    textColor: "text-gray-600",
    Icon: Minus,
  },
  conditional: {
    label: "Conditional",
    iconColor: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-700",
    Icon: AlertCircle,
  },
};

const REVERSIBILITY_LABEL: Record<ConvergentOutcome["reversibility"], string> = {
  easily_reversible: "Easily reversible",
  costly_to_reverse: "Costly to reverse",
  irreversible: "Irreversible",
};

const TIME_HORIZON_LABEL: Record<ConvergentOutcome["time_horizon"], string> = {
  immediate: "Immediate",
  hours: "Hours",
  days: "Days",
  months: "Months",
  years: "Years",
};

const PROPAGATION_LABEL: Record<ConvergentOutcome["propagation"], string> = {
  local: "Local",
  cascading: "Cascading",
  systemic: "Systemic",
};

const GENERATION_METHOD_LABEL: Record<ConvergentPoint["generation_method"], string> = {
  empirical_edge: "Empirical (direct edge)",
  structural_derivation: "Structural (2-hop)",
  analogical_mapping: "Analogical (cross-system)",
  domain_inference: "Domain-inferred",
  adversarial: "Adversarial",
};

function formatScore(n: number | undefined): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function AlignmentBar({ score }: { score: number }) {
  // -1 (left, red) to +1 (right, green). Center = 0.
  const pct = ((score + 1) / 2) * 100; // 0..100
  const color = score > 0.1 ? "bg-emerald-500" : score < -0.1 ? "bg-rose-500" : "bg-gray-400";
  return (
    <div className="relative h-1.5 w-full rounded-full bg-gray-100">
      <div className="absolute left-1/2 h-1.5 w-px bg-gray-300" />
      <div
        className={cn("absolute top-0 h-1.5 rounded-full", color)}
        style={{
          left: score >= 0 ? "50%" : `${pct}%`,
          width: `${Math.abs(score) * 50}%`,
        }}
      />
    </div>
  );
}

// ── Component ──

export function ConvergentPointCard({
  point,
  entitiesByUuid,
  rank,
  className,
  onSelectSignature,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackValue>(point.user_feedback ?? null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const polarity = POLARITY_CONFIG[point.outcome.polarity];
  const Polarity = polarity.Icon;

  // Pre-compute signatures for the expansion's signature row. Cheap —
  // the cast is structural, no JSON parsing — but useMemo keeps it
  // stable across feedback toggles so child rings don't remount.
  const signatureRow = React.useMemo(() => {
    const focal = entitiesByUuid.get(point.focal_entity_id);
    const focalSig = focal ? asSignature(focal.node_signature) : null;
    const interactors = point.interactor_entity_ids.map((uuid) => {
      const ent = entitiesByUuid.get(uuid);
      return {
        uuid,
        name: ent?.name ?? "(unknown)",
        sig: ent ? asSignature(ent.node_signature) : null,
      };
    });
    return { focal: focal ? { name: focal.name, sig: focalSig } : null, interactors };
  }, [entitiesByUuid, point.focal_entity_id, point.interactor_entity_ids]);

  const submitFeedback = async (value: FeedbackValue) => {
    // Toggle-off when the same button is pressed twice.
    const nextValue: FeedbackValue = feedback === value ? null : value;
    setFeedbackPending(true);
    setFeedbackError(null);
    const prev = feedback;
    setFeedback(nextValue); // optimistic
    try {
      const res = await fetch("/api/pipeline/probability-space/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ convergent_point_id: point.id, feedback: nextValue }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setFeedback(prev); // revert
      setFeedbackError(err instanceof Error ? err.message : "Failed to submit feedback");
    } finally {
      setFeedbackPending(false);
    }
  };

  const interactorNames = point.interactor_entity_ids.map(
    (uuid) => entitiesByUuid.get(uuid)?.name ?? "(unknown)",
  );

  return (
    <div
      className={cn(
        "group rounded-lg border bg-white transition-colors",
        polarity.borderColor,
        expanded ? polarity.bgColor : "hover:bg-gray-50/40",
        className,
      )}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        {typeof rank === "number" && (
          <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
            {rank + 1}
          </div>
        )}

        <div
          className={cn(
            "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full",
            polarity.bgColor,
          )}
        >
          <Polarity className={cn("h-3.5 w-3.5", polarity.iconColor)} />
        </div>

        <div className="min-w-0 flex-1">
          {/* Interactor phrase */}
          <div className="mb-1 text-xs text-gray-500">
            with {interactorNames.map((n, i) => (
              <React.Fragment key={i}>
                <span className="font-medium text-gray-700">{n}</span>
                {i < interactorNames.length - 1 && <span> + </span>}
              </React.Fragment>
            ))}
          </div>

          {/* Outcome description */}
          <div className="text-sm leading-snug text-gray-900">
            {point.outcome.description}
          </div>

          {/* Bottom chips row */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
            <span className={cn("rounded px-1.5 py-0.5", polarity.bgColor, polarity.textColor)}>
              {polarity.label}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
              <Clock className="mr-1 inline h-2.5 w-2.5" />
              {TIME_HORIZON_LABEL[point.outcome.time_horizon]}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
              <Undo2 className="mr-1 inline h-2.5 w-2.5" />
              {REVERSIBILITY_LABEL[point.outcome.reversibility]}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
              <Waves className="mr-1 inline h-2.5 w-2.5" />
              {PROPAGATION_LABEL[point.outcome.propagation]}
            </span>
            {point.pattern_tag && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700">
                {point.pattern_tag}
              </span>
            )}
          </div>
        </div>

        {/* Composite score + expand chevron */}
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <div
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-mono font-semibold",
              (point.composite_score ?? 0) > 0.05
                ? "bg-emerald-100 text-emerald-800"
                : (point.composite_score ?? 0) < -0.05
                  ? "bg-rose-100 text-rose-800"
                  : "bg-gray-100 text-gray-600",
            )}
          >
            {formatScore(point.composite_score)}
          </div>
          <div className="text-[10px] text-gray-400">
            p={point.probability.toFixed(2)} · c={point.confidence.toFixed(2)}
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-200 p-3 pt-3">
          {/* Signatures row (Phase 1.1) — focal + interactor canonical
              rings, click-to-open detail drawer. Hidden entirely when
              none of the participating entities have a materialized
              signature; we don't show empty rings.
              Layout: focal stays prominent on the left, interactors
              shrink to size 32 in a horizontal flow. The chevron-style
              ⋈ glyph reads as "composes-with" and ties the visual
              language to the Phase 4 combination-signature work. */}
          {(signatureRow.focal?.sig ||
            signatureRow.interactors.some((i) => i.sig)) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50/40 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Signatures
              </div>
              {signatureRow.focal?.sig && (
                <SignatureChip
                  sig={signatureRow.focal.sig}
                  name={signatureRow.focal.name}
                  size={40}
                  onSelect={onSelectSignature}
                />
              )}
              {signatureRow.interactors.length > 0 && (
                <span className="text-xs text-gray-400">⋈</span>
              )}
              {signatureRow.interactors.map((i) =>
                i.sig ? (
                  <SignatureChip
                    key={i.uuid}
                    sig={i.sig}
                    name={i.name}
                    size={32}
                    onSelect={onSelectSignature}
                  />
                ) : (
                  <span
                    key={i.uuid}
                    className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px] text-gray-400"
                    title={`${i.name} has no materialized signature`}
                  >
                    {i.name}
                  </span>
                ),
              )}
            </div>
          )}

          {/* Mechanism */}
          {point.outcome.mechanism && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Mechanism
              </div>
              <div className="text-xs leading-snug text-gray-700">{point.outcome.mechanism}</div>
            </div>
          )}

          {/* Objective alignment */}
          {point.objective_alignment.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Objective alignment
              </div>
              <div className="space-y-2">
                {point.objective_alignment.map((a: ObjectiveAlignment) => (
                  <div key={a.objective_id} className="text-xs">
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-gray-700">{a.objective_title}</span>
                      <span
                        className={cn(
                          "font-mono text-xs",
                          a.score > 0.1
                            ? "text-emerald-700"
                            : a.score < -0.1
                              ? "text-rose-700"
                              : "text-gray-500",
                        )}
                      >
                        {formatScore(a.score)}
                      </span>
                    </div>
                    <AlignmentBar score={a.score} />
                    {a.reasoning && (
                      <div className="mt-1 text-[11px] text-gray-500">{a.reasoning}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Downstream preview (Phase 1.3) — pulls the focal entity's
              consequence_surface and shows the top 3 targets resolved
              to names + probability. This answers "what does this
              focal node actually cause downstream?" without forcing
              the user to open the signature detail drawer. Hidden
              when the surface is empty (un-materialized signatures
              or terminal nodes). */}
          {signatureRow.focal?.sig &&
            signatureRow.focal.sig.consequence_surface.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Downstream from focal
                </div>
                <ul className="space-y-0.5 text-xs">
                  {signatureRow.focal.sig.consequence_surface
                    .slice(0, 3)
                    .map((c) => {
                      const target = entitiesByUuid.get(c.target_entity_id);
                      const polColor =
                        c.polarity === "positive"
                          ? "text-emerald-700"
                          : c.polarity === "negative"
                            ? "text-rose-700"
                            : c.polarity === "conditional"
                              ? "text-amber-700"
                              : "text-gray-600";
                      return (
                        <li
                          key={c.target_entity_id}
                          className="flex items-center justify-between gap-2 pl-2"
                        >
                          <span className="truncate text-gray-700">
                            → {target?.name ?? c.target_entity_id.slice(0, 8)}
                          </span>
                          <span className={cn("font-mono text-[10.5px] font-semibold", polColor)}>
                            {Math.round(c.probability * 100)}%
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}

          {/* External conditions */}
          {point.external_conditions.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                External conditions
              </div>
              <ul className="space-y-0.5 text-xs text-gray-600">
                {point.external_conditions.map((c, i) => (
                  <li key={i} className="pl-2">• {c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence */}
          {point.evidence_basis.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Evidence
              </div>
              <ul className="space-y-0.5 text-xs text-gray-600">
                {point.evidence_basis.map((e, i) => (
                  <li key={i} className="pl-2">
                    <span className="mr-1 font-mono text-[10px] text-gray-400">[{e.type}]</span>
                    {e.claim}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer metadata */}
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2 text-[10px] text-gray-500">
            <span>{GENERATION_METHOD_LABEL[point.generation_method]}</span>
            {point.structural_signature && (
              <span className="font-mono">
                sig: {point.structural_signature.focal_role} × [{point.structural_signature.interactor_roles.join(", ")}]
              </span>
            )}
          </div>

          {/* Feedback — trains the pattern library. Clicks propagate to
              pattern_library votes immediately via the feedback endpoint. */}
          <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Feedback
            </span>
            <div className="flex items-center gap-1">
              <FeedbackButton
                label="Useful"
                Icon={ThumbsUp}
                active={feedback === "useful"}
                pending={feedbackPending}
                activeClass="bg-emerald-100 text-emerald-700 border-emerald-300"
                onClick={() => submitFeedback("useful")}
              />
              <FeedbackButton
                label="Noise"
                Icon={ThumbsDown}
                active={feedback === "noise"}
                pending={feedbackPending}
                activeClass="bg-gray-200 text-gray-700 border-gray-400"
                onClick={() => submitFeedback("noise")}
              />
              <FeedbackButton
                label="Inaccurate"
                Icon={TargetIcon}
                active={feedback === "inaccurate"}
                pending={feedbackPending}
                activeClass="bg-amber-100 text-amber-700 border-amber-300"
                onClick={() => submitFeedback("inaccurate")}
              />
            </div>
            {feedbackError && (
              <span className="text-[10px] text-rose-600">{feedbackError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FeedbackButton (local) ──

function FeedbackButton({
  label,
  Icon,
  active,
  pending,
  activeClass,
  onClick,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  pending: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation(); // Prevent parent card expansion toggle
        if (!pending) onClick();
      }}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        active ? activeClass : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
        pending && "cursor-wait opacity-60",
      )}
    >
      {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Icon className="h-2.5 w-2.5" />}
      {label}
    </button>
  );
}

// ── SignatureChip (Phase 1.1) ──
//
// Compact ring + name pair used in the expanded card's signature row.
// Wraps NodeSignatureRing so it's the same primitive as the header /
// constellation widget, just with the name slotted in beside the ring
// instead of below it. Click bubbles up to onSelectSignature, which
// the parent view binds to the shared NodeSignatureDetail drawer.

function SignatureChip({
  sig,
  name,
  size,
  onSelect,
}: {
  sig: NodeSignature;
  name: string;
  size: number;
  onSelect?: (sig: NodeSignature, entityName: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // don't trigger card collapse
        if (onSelect) onSelect(sig, name);
      }}
      className="group inline-flex items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 transition-colors hover:border-gray-200 hover:bg-white"
      title={`${name} · ${sig.canonical_code} · ${sig.rings} ring${sig.rings === 1 ? "" : "s"}`}
    >
      <NodeSignatureRing
        signature={sig}
        size={size}
        showCode={false}
        animated={false}
      />
      <span className="max-w-[100px] truncate text-[10.5px] font-medium text-gray-700 group-hover:text-gray-900">
        {name}
      </span>
    </button>
  );
}
