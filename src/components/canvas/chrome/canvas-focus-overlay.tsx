// ── Canvas focus overlay (Phase 2c) ──
//
// Right-side glassmorphic pane for guided convergence on the
// unified canvas. The canvas-flavored version of synergy's
// FocusModeOverlay — same staged-funnel pattern (curate → extract
// → sharpen → publish) but operates on entities (not brainstorm
// nodes) and reuses canvas APIs for the AI work.
//
// MVP scope (Phase 2c-A):
//   ✅ Stage 1 — Curate: keep/exclude entities. Defaults to
//      importance-driven auto-mark (fundamental + critical kept;
//      everything else excluded by default). User can override per
//      entity. The "kept" set drives downstream stages.
//   ⏳ Stage 2 — Extract: placeholder. Will call an LLM endpoint
//      that extracts polished_product / upstream / downstream
//      derived entities from the kept set. Wired when Phase 3
//      lands the extraction_kind column on entities.
//   ⏳ Stage 3 — Sharpen: placeholder. Reuses the existing
//      flashcard pattern (dashboard-clarify-modal) wrapped for the
//      kept set.
//   ⏳ Stage 4 — Publish: placeholder. Calls /api/synergy/...
//      strategy/generate adapted for spaces (Phase 3 schema).
//
// Why ship Stage 1 first: it's the highest-value standalone
// surface — the user can already think "which entities matter" and
// have the canvas reflect that decision (dimmed vs prominent).
// Stages 2-4 stack on this foundation incrementally.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Focus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import type { Entity } from "@/types";

type Stage = 1 | 2 | 3 | 4;

type ExtractionKind =
  | "core_idea"
  | "upstream_dependency"
  | "downstream_output"
  | "polished_product"
  | "alternative";

interface ExtractionResult {
  entity_id: string;
  kind: ExtractionKind;
  rationale: string;
}

// Mirrors /api/pipeline/clarifying-questions response. The MCQ
// options form is honored when present; otherwise we render a
// free-text input.
interface SharpenQuestion {
  question: string;
  rationale: string;
  kind: "mcq" | "free_text";
  options?: Array<{ label: string; detail: string }>;
}

const KIND_META: Record<
  ExtractionKind,
  { label: string; tone: string; emoji: string }
> = {
  core_idea: {
    label: "Core idea",
    tone: "bg-rose-50 text-rose-700 border-rose-200",
    emoji: "◆",
  },
  upstream_dependency: {
    label: "Upstream",
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    emoji: "↑",
  },
  downstream_output: {
    label: "Downstream",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    emoji: "↓",
  },
  polished_product: {
    label: "Polished product",
    tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
    emoji: "✦",
  },
  alternative: {
    label: "Alternative",
    tone: "bg-purple-50 text-purple-700 border-purple-200",
    emoji: "⤳",
  },
};

const STAGES: Array<{
  n: Stage;
  label: string;
  hint: string;
  status: "available" | "soon";
}> = [
  {
    n: 1,
    label: "Curate",
    hint: "Mark which entities make the cut.",
    status: "available",
  },
  {
    n: 2,
    label: "Extract",
    hint: "Pull out polished products + upstream / downstream.",
    status: "available",
  },
  {
    n: 3,
    label: "Sharpen",
    hint: "Three flashcard questions to tighten the objective.",
    status: "available",
  },
  {
    n: 4,
    label: "Publish",
    hint: "Generate the strategy doc + share.",
    status: "soon",
  },
];

interface Props {
  /** Parent unmounts on close — fresh state each open. */
  onClose: () => void;
  spaceId: string;
}

export function CanvasFocusOverlay({ onClose, spaceId }: Props) {
  const { entities } = useSpaceData();
  const [stage, setStage] = useState<Stage>(1);

  // Per-entity keep state. Default: keep if importance is
  // fundamental/critical; exclude otherwise. User overrides
  // persist across stage navigation but reset on overlay close
  // (parent unmount = fresh state).
  const [keepState, setKeepState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const e of entities) {
      initial[e.id] =
        e.importance === "fundamental" || e.importance === "critical";
    }
    return initial;
  });

  // Stage 2 — extraction classifications. Keyed by entity_id. The
  // user can manually override the LLM's classification via the
  // kind dropdown on each row. extractError + extractTriggered let
  // us derive the "extracting" loading state without setting state
  // synchronously inside the fetch effect (which the lint rule
  // forbids).
  const [extractions, setExtractions] = useState<
    Record<string, ExtractionResult> | null
  >(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractTriggered, setExtractTriggered] = useState(false);

  // Stage 3 — sharpening questions. 3 clarifying questions
  // generated from a synthesized objective text derived from the
  // kept entities + their Stage 2 classifications. Same endpoint
  // and pattern as the dashboard clarify modal; rendered inline
  // here rather than as a separate modal.
  const [sharpenQuestions, setSharpenQuestions] = useState<
    SharpenQuestion[] | null
  >(null);
  const [sharpenError, setSharpenError] = useState<string | null>(null);
  const [sharpenTriggered, setSharpenTriggered] = useState(false);
  const [sharpenAnswers, setSharpenAnswers] = useState<Record<number, string>>(
    {},
  );

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sortedEntities = useMemo(() => {
    // Importance descending, then entity_type alphabetic for
    // deterministic ordering.
    const rank: Record<string, number> = {
      fundamental: 4,
      critical: 3,
      important: 2,
      moderate: 1,
    };
    return [...entities].sort((a, b) => {
      const ra = rank[a.importance ?? "moderate"] ?? 0;
      const rb = rank[b.importance ?? "moderate"] ?? 0;
      if (ra !== rb) return rb - ra;
      return (a.entity_type ?? "").localeCompare(b.entity_type ?? "");
    });
  }, [entities]);

  const keptCount = useMemo(
    () => Object.values(keepState).filter(Boolean).length,
    [keepState],
  );

  const toggleKeep = (id: string) => {
    setKeepState((s) => ({ ...s, [id]: !s[id] }));
  };

  // Kept entities — recomputed each render. The Stage 2 fetch uses
  // these as the input set; the kind override uses them as a sort
  // key.
  const keptEntities = useMemo(
    () => sortedEntities.filter((e) => keepState[e.id]),
    [sortedEntities, keepState],
  );

  // Extraction trigger — fires as a side effect of the Next click
  // when transitioning 1 → 2. Pure event handler; no setState in
  // useEffect.
  const triggerExtraction = useCallback(() => {
    if (extractTriggered) return;
    if (keptEntities.length === 0) return;
    setExtractTriggered(true);
  }, [extractTriggered, keptEntities.length]);

  // The fetch — runs once when extractTriggered flips true. Uses
  // refs to avoid re-firing on every render.
  useEffect(() => {
    if (!extractTriggered) return;
    if (extractions !== null || extractError !== null) return;
    let cancelled = false;
    fetch("/api/canvas/selection/extract", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId,
        entityIds: keptEntities
          .map((e) => e.entity_id)
          .filter((id): id is string => typeof id === "string"),
      }),
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as {
          classifications?: ExtractionResult[];
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok) throw new Error(json.error ?? `${r.status}`);
        const map: Record<string, ExtractionResult> = {};
        for (const c of json.classifications ?? []) {
          map[c.entity_id] = c;
        }
        setExtractions(map);
      })
      .catch((e) => {
        if (!cancelled) {
          setExtractError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [extractTriggered, extractions, extractError, keptEntities, spaceId]);

  // Derived loading flag — no setState needed.
  const extracting =
    extractTriggered && extractions === null && extractError === null;

  // ── Stage 3 sharpening ──
  //
  // Synthesizes a one-paragraph "objective" string from the kept
  // entities + their extracted classifications, then POSTs to the
  // existing clarifying-questions endpoint. Same endpoint used by
  // the dashboard's pre-prompt clarifier — the questions adapt to
  // the input text.
  const triggerSharpening = useCallback(() => {
    if (sharpenTriggered) return;
    if (keptEntities.length === 0) return;
    setSharpenTriggered(true);
  }, [sharpenTriggered, keptEntities.length]);

  const synthesizedObjective = useMemo(() => {
    if (keptEntities.length === 0) return "";
    const byKind: Record<ExtractionKind, string[]> = {
      core_idea: [],
      upstream_dependency: [],
      downstream_output: [],
      polished_product: [],
      alternative: [],
    };
    for (const e of keptEntities) {
      const eid = e.entity_id ?? e.id;
      const cls = extractions?.[eid];
      const name = e.name;
      if (cls) byKind[cls.kind].push(name);
      else byKind.core_idea.push(name);
    }
    const parts: string[] = [];
    if (byKind.core_idea.length > 0) {
      parts.push(`Core ideas: ${byKind.core_idea.join(", ")}.`);
    }
    if (byKind.polished_product.length > 0) {
      parts.push(
        `Polished deliverables: ${byKind.polished_product.join(", ")}.`,
      );
    }
    if (byKind.upstream_dependency.length > 0) {
      parts.push(`Upstream dependencies: ${byKind.upstream_dependency.join(", ")}.`);
    }
    if (byKind.downstream_output.length > 0) {
      parts.push(`Downstream outputs: ${byKind.downstream_output.join(", ")}.`);
    }
    if (byKind.alternative.length > 0) {
      parts.push(`Considering alternatives: ${byKind.alternative.join(", ")}.`);
    }
    return parts.join(" ");
  }, [keptEntities, extractions]);

  useEffect(() => {
    if (!sharpenTriggered) return;
    if (sharpenQuestions !== null || sharpenError !== null) return;
    if (synthesizedObjective.length < 4) return;
    let cancelled = false;
    fetch("/api/pipeline/clarifying-questions", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: synthesizedObjective }),
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as {
          questions?: SharpenQuestion[];
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !Array.isArray(json.questions)) {
          throw new Error(json.error ?? "No questions returned");
        }
        // Cap at 3 to match the flashcard pattern.
        setSharpenQuestions(json.questions.slice(0, 3));
      })
      .catch((e) => {
        if (!cancelled) {
          setSharpenError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    sharpenTriggered,
    sharpenQuestions,
    sharpenError,
    synthesizedObjective,
  ]);

  const sharpening =
    sharpenTriggered && sharpenQuestions === null && sharpenError === null;

  const overrideKind = (entityId: string, kind: ExtractionKind) => {
    setExtractions((prev) => {
      if (!prev) return prev;
      const existing = prev[entityId];
      return {
        ...prev,
        [entityId]: existing
          ? { ...existing, kind, rationale: `Manually set to ${kind}.` }
          : { entity_id: entityId, kind, rationale: "Manually set." },
      };
    });
  };

  const next = () => {
    if (stage < 4) {
      const newStage = (stage + 1) as Stage;
      setStage(newStage);
      // Kick the appropriate side-effect for the new stage as a
      // direct event handler. Done here rather than in a useEffect
      // to satisfy the set-state-in-effect lint rule and keep
      // "user clicked next" as the explicit trigger.
      if (newStage === 2) triggerExtraction();
      if (newStage === 3) triggerSharpening();
    }
  };
  const prev = () => {
    if (stage > 1) setStage((stage - 1) as Stage);
  };

  return (
    <>
      {/* Backdrop dim — canvas stays visible behind */}
      <button
        type="button"
        aria-label="Close focus mode"
        onClick={onClose}
        className="fixed inset-0 z-[68]"
        style={{
          background: "rgba(15, 23, 42, 0.25)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          animation: "canvasFocusBackdropIn 220ms ease both",
        }}
      />

      {/* Right-side pane */}
      <aside
        role="dialog"
        aria-label="Focus mode"
        className="fixed right-6 top-6 bottom-6 z-[69] flex w-[480px] max-w-[40vw] flex-col"
        style={{
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.7)",
          borderRadius: 20,
          boxShadow: [
            "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
            "0 24px 60px -18px rgba(15, 23, 42, 0.28)",
            "0 0 80px -20px rgba(6, 182, 212, 0.25)",
          ].join(", "),
          animation:
            "canvasFocusPaneIn 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-black/[0.05] px-5 py-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-white shadow-[0_6px_18px_-6px_rgba(6,182,212,0.55)]">
            <Focus className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-gray-500">
              Convergence
            </div>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-gray-900">
              Focus &amp; Publish
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Stage progress dots */}
        <div className="flex items-center gap-1.5 px-5 py-3">
          {STAGES.map((s) => {
            const done = s.n < stage;
            const active = s.n === stage;
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => {
                  if (s.status !== "available") return;
                  setStage(s.n);
                  if (s.n === 2) triggerExtraction();
                  if (s.n === 3) triggerSharpening();
                }}
                disabled={s.status === "soon"}
                title={`${s.label} — ${s.hint}`}
                className="group flex flex-1 items-center gap-1.5 disabled:cursor-not-allowed"
              >
                <span
                  className={`h-[3px] flex-1 rounded-full transition ${
                    done
                      ? "bg-cyan-600"
                      : active
                        ? "bg-gray-900"
                        : "bg-gray-200"
                  }`}
                />
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
                    active
                      ? "text-gray-900"
                      : done
                        ? "text-cyan-700"
                        : "text-gray-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {stage === 1 && (
            <Stage1Curate
              entities={sortedEntities}
              keepState={keepState}
              onToggle={toggleKeep}
              keptCount={keptCount}
              totalCount={entities.length}
            />
          )}
          {stage === 2 && (
            <Stage2Extract
              keptEntities={keptEntities}
              extractions={extractions}
              extracting={extracting}
              error={extractError}
              onOverride={overrideKind}
              onRetry={() => {
                setExtractions(null);
                setExtractError(null);
                setExtractTriggered(false);
              }}
            />
          )}
          {stage === 3 && (
            <Stage3Sharpen
              questions={sharpenQuestions}
              answers={sharpenAnswers}
              onAnswer={(idx, value) =>
                setSharpenAnswers((s) => ({ ...s, [idx]: value }))
              }
              loading={sharpening}
              error={sharpenError}
              onRetry={() => {
                setSharpenQuestions(null);
                setSharpenError(null);
                setSharpenTriggered(false);
              }}
              objectivePreview={synthesizedObjective}
            />
          )}
          {stage > 3 && <StagePlaceholder stage={stage} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-black/[0.05] px-5 py-3">
          <button
            type="button"
            onClick={prev}
            disabled={stage === 1}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
          <span className="text-[10.5px] text-gray-500">
            {stage === 1
              ? `${keptCount} of ${entities.length} kept`
              : `Stage ${stage} of 4`}
          </span>
          <button
            type="button"
            onClick={next}
            disabled={stage === 4 || (stage === 1 && keptCount === 0)}
            className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-800 disabled:opacity-40"
          >
            {stage === 4 ? "Publish" : "Next"}{" "}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </aside>

      <style jsx>{`
        @keyframes canvasFocusBackdropIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes canvasFocusPaneIn {
          from {
            opacity: 0;
            transform: translateX(32px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
      `}</style>
    </>
  );
}

// ── Stage 1 — Curate ─────────────────────────────────────────────

function Stage1Curate({
  entities,
  keepState,
  onToggle,
  keptCount,
  totalCount,
}: {
  entities: Entity[];
  keepState: Record<string, boolean>;
  onToggle: (id: string) => void;
  keptCount: number;
  totalCount: number;
}) {
  if (entities.length === 0) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <Sparkles className="h-6 w-6 text-gray-400" />
        <p className="max-w-xs text-[12.5px] leading-relaxed text-gray-600">
          No entities to curate yet. Decompose some ideas first, then
          come back here to keep what matters.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">
          Stage 1
        </div>
        <h3 className="mt-1 font-display-tight text-[18px] font-semibold leading-snug tracking-tight text-gray-900">
          Curate what makes the cut
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
          Default-kept: fundamental + critical. Toggle anything else
          on or off. The kept set drives the next stages.
        </p>
      </div>

      <ul className="space-y-1">
        {entities.map((e) => (
          <li key={e.id}>
            <EntityKeepRow
              entity={e}
              kept={!!keepState[e.id]}
              onToggle={() => onToggle(e.id)}
            />
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 text-[10.5px] text-gray-600">
        <strong className="font-semibold text-gray-800">
          {keptCount}
        </strong>{" "}
        of {totalCount} entities kept. Continue to extract polished
        outputs from this set.
      </div>
    </div>
  );
}

function EntityKeepRow({
  entity,
  kept,
  onToggle,
}: {
  entity: Entity;
  kept: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
        kept
          ? "border-cyan-200 bg-cyan-50/40 hover:bg-cyan-50/70"
          : "border-gray-200 bg-white/60 opacity-60 hover:opacity-100"
      }`}
    >
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
        {kept ? (
          <CheckCircle2 className="h-4 w-4 text-cyan-600" strokeWidth={2} />
        ) : (
          <Circle className="h-4 w-4 text-gray-300" strokeWidth={1.8} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-gray-900">
            {entity.name}
          </span>
          {entity.importance && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] ${
                entity.importance === "fundamental"
                  ? "bg-rose-50 text-rose-700"
                  : entity.importance === "critical"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {entity.importance}
            </span>
          )}
        </span>
        {entity.description && (
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-gray-600">
            {entity.description}
          </span>
        )}
      </span>
    </button>
  );
}

// ── Stage 2 — Extract ────────────────────────────────────────────

const KIND_ORDER: ExtractionKind[] = [
  "polished_product",
  "core_idea",
  "upstream_dependency",
  "downstream_output",
  "alternative",
];

function Stage2Extract({
  keptEntities,
  extractions,
  extracting,
  error,
  onOverride,
  onRetry,
}: {
  keptEntities: Entity[];
  extractions: Record<string, ExtractionResult> | null;
  extracting: boolean;
  error: string | null;
  onOverride: (entityId: string, kind: ExtractionKind) => void;
  onRetry: () => void;
}) {
  if (keptEntities.length === 0) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <Sparkles className="h-6 w-6 text-gray-400" />
        <p className="max-w-xs text-[12.5px] leading-relaxed text-gray-600">
          Nothing kept to extract from. Go back to Stage 1 and pick
          which entities matter.
        </p>
      </div>
    );
  }
  if (extracting) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        <p className="text-[12.5px] text-gray-600">
          Classifying {keptEntities.length} entities…
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[12.5px] text-rose-700">Extract failed: {error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!extractions) return null;

  // Group entities by their classified kind for display.
  const grouped: Record<ExtractionKind, Entity[]> = {
    core_idea: [],
    upstream_dependency: [],
    downstream_output: [],
    polished_product: [],
    alternative: [],
  };
  for (const e of keptEntities) {
    const eid = e.entity_id ?? e.id;
    const cls = extractions[eid];
    if (cls) grouped[cls.kind].push(e);
  }

  return (
    <div>
      <div className="mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">
          Stage 2
        </div>
        <h3 className="font-display-tight mt-1 text-[18px] font-semibold leading-snug tracking-tight text-gray-900">
          Pull out the polished pieces
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
          Each kept entity classified into one of five canonical kinds.
          Override any row if the system got it wrong.
        </p>
      </div>

      {KIND_ORDER.map((kind) => {
        const items = grouped[kind];
        if (items.length === 0) return null;
        const meta = KIND_META[kind];
        return (
          <div key={kind} className="mb-4 last:mb-0">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className={`inline-flex h-4 min-w-4 items-center justify-center rounded-md border px-1 font-mono text-[10px] ${meta.tone}`}
              >
                {meta.emoji}
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-gray-500">
                {meta.label}
              </span>
              <span className="font-mono text-[9.5px] tabular-nums text-gray-400">
                · {items.length}
              </span>
            </div>
            <ul className="space-y-1">
              {items.map((e) => {
                const eid = e.entity_id ?? e.id;
                const cls = extractions[eid];
                return (
                  <li key={e.id}>
                    <ExtractedRow
                      entity={e}
                      classification={cls}
                      onOverride={(k) => onOverride(eid, k)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ExtractedRow({
  entity,
  classification,
  onOverride,
}: {
  entity: Entity;
  classification: ExtractionResult | undefined;
  onOverride: (kind: ExtractionKind) => void;
}) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white/70 px-3 py-2 transition hover:border-gray-300">
      <div className="flex items-start gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="truncate text-[12.5px] font-semibold text-gray-900">
            {entity.name}
          </span>
          {classification?.rationale && (
            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-gray-600">
              {classification.rationale}
            </span>
          )}
        </span>
        <select
          value={classification?.kind ?? "core_idea"}
          onChange={(e) => onOverride(e.target.value as ExtractionKind)}
          className="shrink-0 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-gray-700 outline-none transition hover:border-gray-400 focus:border-gray-700"
          aria-label="Override classification"
        >
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_META[k].label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Stage 3 — Sharpen ────────────────────────────────────────────

function Stage3Sharpen({
  questions,
  answers,
  onAnswer,
  loading,
  error,
  onRetry,
  objectivePreview,
}: {
  questions: SharpenQuestion[] | null;
  answers: Record<number, string>;
  onAnswer: (idx: number, value: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  objectivePreview: string;
}) {
  if (loading) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        <p className="text-[12.5px] text-gray-600">Drafting questions…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[12.5px] text-rose-700">
          Couldn&apos;t draft questions: {error}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-gray-800"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!questions || questions.length === 0) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
        <Sparkles className="h-6 w-6 text-gray-400" />
        <p className="max-w-xs text-[12.5px] leading-relaxed text-gray-600">
          Nothing to sharpen — your set was already specific enough.
          Continue to publish.
        </p>
      </div>
    );
  }

  const answeredCount = Object.values(answers).filter(
    (v) => v.trim().length > 0,
  ).length;

  return (
    <div>
      <div className="mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">
          Stage 3
        </div>
        <h3 className="font-display-tight mt-1 text-[18px] font-semibold leading-snug tracking-tight text-gray-900">
          Sharpen the objective
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
          Three questions to tighten what you&apos;re actually trying
          to ship. All optional — skip any.
        </p>
      </div>

      {/* Synthesized objective preview */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-gray-500">
          working objective
        </div>
        <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-gray-700">
          {objectivePreview}
        </p>
      </div>

      <ul className="space-y-3">
        {questions.map((q, idx) => (
          <li key={idx}>
            <SharpenRow
              index={idx}
              total={questions.length}
              question={q}
              value={answers[idx] ?? ""}
              onChange={(v) => onAnswer(idx, v)}
            />
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 text-[10.5px] text-gray-600">
        <strong className="font-semibold text-gray-800">
          {answeredCount}
        </strong>{" "}
        of {questions.length} answered. Continue to publish — answers
        will refine the final synthesis.
      </div>
    </div>
  );
}

function SharpenRow({
  index,
  total,
  question,
  value,
  onChange,
}: {
  index: number;
  total: number;
  question: SharpenQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = question.options ?? [];
  const hasOptions = question.kind === "mcq" && opts.length > 0;
  const matchesOption = hasOptions && opts.some((o) => o.label === value);
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="font-mono text-[9.5px] tabular-nums text-gray-400">
          {index + 1}/{total}
        </span>
        <span className="text-[12.5px] font-semibold leading-snug text-gray-900">
          {question.question}
        </span>
      </div>
      {question.rationale && (
        <p className="mb-2 text-[10.5px] leading-snug text-gray-500">
          {question.rationale}
        </p>
      )}
      {hasOptions && (
        <div className="mb-2 space-y-0.5">
          {opts.map((opt) => {
            const active = value === opt.label;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => onChange(opt.label)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                  active
                    ? "bg-cyan-50 text-gray-900"
                    : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
                    active ? "bg-cyan-600" : "bg-gray-200"
                  }`}
                >
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-medium">
                    {opt.label}
                  </span>
                  {opt.detail && (
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-gray-500">
                      {opt.detail}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <input
        type="text"
        value={matchesOption ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          hasOptions ? "Or write your own answer…" : "Optional — skip freely"
        }
        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11.5px] text-gray-900 outline-none focus:border-cyan-500"
      />
    </div>
  );
}

// ── Stage 4 placeholder ──────────────────────────────────────────

function StagePlaceholder({ stage }: { stage: Stage }) {
  const meta = STAGES.find((s) => s.n === stage);
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="h-5 w-5 text-gray-400" />
      <div>
        <p className="text-[13px] font-semibold text-gray-800">
          Stage {stage} · {meta?.label} — coming next
        </p>
        <p className="mt-1.5 max-w-xs text-[11.5px] leading-relaxed text-gray-600">
          {meta?.hint} This stage lands in a follow-up to Phase 2c
          — the shell + Stage 1 are ready first so the curation
          step is usable on its own.
        </p>
      </div>
    </div>
  );
}
