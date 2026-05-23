"use client";

// Concept-expansion strip — appears below each raw-signal card when
// the "Expansion" toggle is on. Calls /api/canvas/expansion-
// recommendations with the entity id, gets back 2-4 Claude-Opus-4
// candidates each enforced by the 5 guardrails.
//
// Each chip exposes the mechanism + ring-novelty + counterfactual
// unlock on hover so the user can read WHY the expansion was
// recommended before clicking to materialize.
//
// Materializing creates a new entity via the standard manual-create
// endpoint + an edge of the recommended typed relation. Same path the
// card-action-menu's "Add Related → accept" uses, so the chain hooks
// (prospect-connections, invalidate-coverage, signature-materializer)
// all fire normally.

import { useEffect, useState } from "react";
import type { Entity } from "@/types";
import { useRouter } from "next/navigation";
import type {
  ExpansionRecommendation,
  ExpansionRecommendationsResponse,
} from "@/lib/prompts/expansion-recommendations";

interface ExpansionRecommendationStripProps {
  spaceId: string;
  entity: Entity;
}

// In-memory cache so the same card doesn't refetch on every render.
// Keyed by entity id; cleared on unmount. Lives at module scope so the
// cache survives card hover/blur cycles within a single mount.
const cache = new Map<
  string,
  { at: number; data: ExpansionRecommendationsResponse }
>();
const CACHE_TTL_MS = 5 * 60_000; // 5 min

export function ExpansionRecommendationStrip({
  spaceId,
  entity,
}: ExpansionRecommendationStripProps) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; data: ExpansionRecommendationsResponse }
    | { kind: "error"; message: string }
  >(() => {
    // Initializer runs once on mount — safe to read the module cache
    // here without tripping react-hooks/set-state-in-effect. If a
    // recent payload exists we render it immediately; otherwise we
    // start in "loading" and the effect below fires the fetch.
    const cached = cache.get(entity.id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { kind: "ready", data: cached.data };
    }
    return { kind: "loading" };
  });
  const router = useRouter();

  // Fire the fetch only when we don't have a fresh cache hit. The
  // cached-hit case was handled by the useState initializer above so
  // the effect body never calls setState synchronously on first paint.
  useEffect(() => {
    const cached = cache.get(entity.id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/canvas/expansion-recommendations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity_id: entity.id }),
        });
        if (!res.ok) {
          if (cancelled) return;
          setState({
            kind: "error",
            message:
              res.status === 403
                ? "Access denied"
                : res.status === 404
                ? "Entity not found"
                : "Couldn't reach expansion service",
          });
          return;
        }
        const data = (await res.json()) as ExpansionRecommendationsResponse;
        if (cancelled) return;
        cache.set(entity.id, { at: Date.now(), data });
        setState({ kind: "ready", data });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  // ── Materialize a chip into the KG ──────────────────────────────────
  // Two-step: (1) create the new entity, (2) link to the existing
  // target via the recommended typed relation. We use the same APIs
  // the main canvas uses so downstream chain hooks fire. Defined as
  // a plain function — the React Compiler memoizes call sites
  // automatically and the explicit useCallback wrapper was confusing
  // the preserve-manual-memoization rule.
  const onAccept = async (rec: ExpansionRecommendation) => {
    try {
        // 1. Create entity via the manual endpoint. We default to
        // kind="variable" / variable_kind="modifier" — the most
        // generic-but-still-typed mapping. The provenance + mechanism
        // payload travel in `description` for now (the manual endpoint
        // doesn't expose a provenance field directly). A future
        // refactor can split this into a dedicated expansion-accept
        // route that writes the full provenance JSONB.
        const provenanceTag = `[expansion · from ${entity.name} · ${rec.mechanism.relation_type}]`;
        const createRes = await fetch(
          `/api/spaces/${spaceId}/entities/manual`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: rec.name,
              kind: "variable",
              variable_kind: "modifier",
              description: `${rec.description}\n\n${provenanceTag}`,
            }),
          },
        );
        if (!createRes.ok) return;
        const created = (await createRes.json()) as {
          entity?: { id: string };
        };
        const newEntityId = created.entity?.id;
        if (!newEntityId) return;

        // 2. Create the typed edge in the recommended direction. The
        // bridge endpoint validates both entities live in the space
        // and dedupes against existing edges, so we don't need to
        // pre-check anything client-side.
        const src =
          rec.mechanism.direction === "out" ? entity.id : newEntityId;
        const tgt =
          rec.mechanism.direction === "out" ? newEntityId : entity.id;
        await fetch(`/api/edges/bridge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            space_id: spaceId,
            source_entity_id: src,
            target_entity_id: tgt,
            relationship_type: rec.mechanism.relation_type,
          }),
        });

        // 3. Drop the chip from the cache so it doesn't re-suggest the
        // same expansion next time. Then refresh the page data so the
        // new entity + edge appear in the middle KG panel.
        const existing = cache.get(entity.id);
        if (existing) {
          cache.set(entity.id, {
            at: existing.at,
            data: {
              ...existing.data,
              recommendations: existing.data.recommendations.filter(
                (r) => r.id !== rec.id,
              ),
            },
          });
          setState({
            kind: "ready",
            data: {
              ...existing.data,
              recommendations: existing.data.recommendations.filter(
                (r) => r.id !== rec.id,
              ),
            },
          });
        }
        router.refresh();
      } catch (err) {
        console.warn("[expansion-strip] accept failed:", err);
      }
    };

  // ── Render ──────────────────────────────────────────────────────────
  if (state.kind === "idle" || state.kind === "loading") {
    return <StripShell><LoadingDots /></StripShell>;
  }
  if (state.kind === "error") {
    return (
      <StripShell>
        <div className="text-[10px] text-slate-500">{state.message}</div>
      </StripShell>
    );
  }
  // ready
  if (state.data.saturation_signal.is_saturated) {
    return (
      <StripShell>
        <div
          className="text-[10px] leading-relaxed text-slate-500"
          title={state.data.saturation_signal.reason ?? undefined}
        >
          Graph saturated here.{" "}
          {state.data.saturation_signal.reason ?? "Add more context first."}
        </div>
      </StripShell>
    );
  }
  return (
    <StripShell>
      <div className="flex flex-wrap gap-1">
        {state.data.recommendations.map((r) => (
          <ExpansionChip key={r.id} rec={r} onAccept={() => onAccept(r)} />
        ))}
      </div>
    </StripShell>
  );
}

// ── Shell ────────────────────────────────────────────────────────────
function StripShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border-t border-dashed px-3 py-2"
      style={{
        borderColor: "rgba(79, 70, 229, 0.18)",
        background:
          "linear-gradient(90deg, rgba(79, 70, 229, 0.025) 0%, rgba(79, 70, 229, 0.06) 100%)",
      }}
    >
      <div
        className="mb-1 flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.18em]"
        style={{ color: "rgba(79, 70, 229, 0.7)" }}
      >
        <span>⊕</span>
        <span>Expansion · 5-gate rigor</span>
      </div>
      {children}
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      <Dot delay={0} />
      <Dot delay={120} />
      <Dot delay={240} />
      <span className="ml-1.5 text-[10px] text-slate-500">
        Claude is thinking…
      </span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1 w-1 rounded-full"
      style={{
        background: "rgba(79, 70, 229, 0.6)",
        animation: `triple-lab-dot 1.2s ${delay}ms infinite ease-in-out`,
      }}
    />
  );
}

// ── Individual chip with hover rationale ───────────────────────────
function ExpansionChip({
  rec,
  onAccept,
}: {
  rec: ExpansionRecommendation;
  onAccept: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAccept();
        }}
        className="group flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-all"
        style={{
          background: hovered
            ? "linear-gradient(135deg, #FFFFFF 0%, #F5F7FF 100%)"
            : "rgba(255, 255, 255, 0.85)",
          borderColor: hovered
            ? "rgba(79, 70, 229, 0.45)"
            : "rgba(79, 70, 229, 0.22)",
          color: "rgb(67, 56, 202)",
          boxShadow: hovered ? "0 4px 12px rgba(79, 70, 229, 0.18)" : "none",
        }}
        title={rec.description}
      >
        <span className="text-[10px]">+</span>
        <span className="max-w-[180px] truncate">{rec.name}</span>
        <ConfidenceDot confidence={rec.confidence} />
      </button>
      {/* Hover popover with the four guardrail traces */}
      {hovered && (
        <div
          className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border bg-white p-3 text-[10.5px] leading-relaxed shadow-xl"
          style={{
            borderColor: "rgba(79, 70, 229, 0.2)",
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
          }}
        >
          <div className="mb-1.5 font-semibold text-slate-900">{rec.name}</div>
          <div className="mb-2 text-slate-600">{rec.description}</div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Pill label="MECHANISM" tone="indigo" />
            <span className="text-[10px] text-slate-700">
              <span className="font-mono text-[9.5px]">
                {rec.mechanism.direction === "out" ? "→" : "←"}
              </span>{" "}
              {rec.mechanism.target_entity_name}
            </span>
            <span
              className="rounded px-1 text-[8.5px] font-bold uppercase"
              style={{
                background: "rgba(79, 70, 229, 0.1)",
                color: "rgb(67, 56, 202)",
              }}
            >
              {rec.mechanism.relation_type}
            </span>
          </div>
          <div className="mb-1.5 text-[10px] italic text-slate-600">
            {rec.mechanism.rationale}
          </div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Pill label="RING" tone="teal" />
            <span className="text-[10px] text-slate-700">
              {rec.ring_novelty.new_ring_kind}
            </span>
          </div>
          <div className="mb-1.5 text-[10px] text-slate-600">
            {rec.ring_novelty.description}
          </div>
          <div className="mb-1 flex items-center gap-1.5">
            <Pill label="UNLOCK" tone="amber" />
          </div>
          <div className="mb-1.5 text-[10px] text-slate-700">
            {rec.counterfactual_unlock}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[9.5px] text-slate-500">
            <span>
              Evidence: {rec.evidence_required.kind} · {rec.evidence_required.description}
            </span>
            <span>
              <ConfidenceDot confidence={rec.confidence} />{" "}
              <span className="font-mono">{Math.round(rec.confidence * 100)}%</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ label, tone }: { label: string; tone: "indigo" | "teal" | "amber" }) {
  const map = {
    indigo: { bg: "rgba(79, 70, 229, 0.12)", color: "#4F46E5" },
    teal: { bg: "rgba(13, 148, 136, 0.12)", color: "#0F766E" },
    amber: { bg: "rgba(245, 158, 11, 0.14)", color: "#B45309" },
  };
  return (
    <span
      className="rounded px-1.5 text-[8.5px] font-bold uppercase tracking-wider"
      style={{ background: map[tone].bg, color: map[tone].color }}
    >
      {label}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.8 ? "#10B981" : confidence >= 0.65 ? "#F59E0B" : "#EF4444";
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: color }}
    />
  );
}
