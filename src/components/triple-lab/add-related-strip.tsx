"use client";

// Add Related strip — appears beneath a card when the user clicks the
// "Related" hover action. Fetches 5-7 peer (same-layer) concept
// suggestions from /api/entities/[id]/related?action=suggest, renders
// each as a chip the user can accept or dismiss. Accepted chips POST
// back through the same endpoint with action="accept" so the entities
// + relates_to edges materialize in the KG.
//
// Distinct from ExpansionRecommendationStrip (Phase 2 of the build):
//   - Expansion: Claude-Opus-4 deep-reasoning, 5-gate-guarded, focuses
//     on adding NEW abstraction rings to the source concept
//   - Add Related: lighter peer-discovery — sibling concepts at the
//     same layer, no ring-novelty enforcement
//
// They're complementary: Expansion goes DEEPER, Related goes WIDER.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Entity } from "@/types";
import { colors, tracking } from "./tokens";

interface RelatedSuggestion {
  entity_id: string;
  name: string;
  description: string;
  relationship_type: string;
  rationale: string;
  importance?: string;
  entity_category?: string;
  confidence?: number;
}

interface AddRelatedStripProps {
  entity: Entity;
  /** Called when the user closes the strip (X button) — parent
   *  retracts the panel and clears any cached suggestions. */
  onClose: () => void;
}

export function AddRelatedStrip({ entity, onClose }: AddRelatedStripProps) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; suggestions: RelatedSuggestion[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  // Track which suggestions the user has dismissed locally so we can
  // remove them from the chip list without refetching.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);
  const router = useRouter();

  // Fetch suggestions on mount. Single request, no polling.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/entities/${entity.id}/related`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "suggest" }),
        });
        if (!res.ok) {
          if (cancelled) return;
          setState({
            kind: "error",
            message: `Couldn't fetch related (HTTP ${res.status})`,
          });
          return;
        }
        const body = (await res.json()) as { related?: RelatedSuggestion[] };
        if (cancelled) return;
        setState({
          kind: "ready",
          suggestions: Array.isArray(body.related) ? body.related : [],
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Request threw",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  const onAccept = async (s: RelatedSuggestion) => {
    setAccepting(s.entity_id);
    try {
      const res = await fetch(`/api/entities/${entity.id}/related`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept", accepted: [s] }),
      });
      if (res.ok) {
        // Mark this suggestion as dismissed in the UI so it drops out
        // of the chip list. The KG panel picks up the new entity +
        // edge on the next render via router.refresh().
        setDismissed((prev) => {
          const next = new Set(prev);
          next.add(s.entity_id);
          return next;
        });
        router.refresh();
      }
    } catch (err) {
      console.warn("[add-related-strip] accept failed:", err);
    } finally {
      setAccepting(null);
    }
  };

  const onDismiss = (s: RelatedSuggestion) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(s.entity_id);
      return next;
    });
  };

  const visible =
    state.kind === "ready"
      ? state.suggestions.filter((s) => !dismissed.has(s.entity_id))
      : [];

  return (
    <div
      className="border-t border-dashed px-3 py-2"
      style={{
        borderColor: colors.brand.haloSoft,
        background: `linear-gradient(90deg, ${colors.state.leverageSoft} 0%, ${colors.state.leverageChip} 100%)`,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <div
          className="flex items-center gap-1.5 text-[8.5px] font-bold uppercase"
          style={{
            color: colors.state.leverageFgDark,
            letterSpacing: tracking.eyebrowTight,
          }}
        >
          <span>+</span>
          <span>Related peers · same layer</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[9.5px] font-medium text-slate-500 transition-colors hover:text-slate-800"
        >
          ✕
        </button>
      </div>

      {state.kind === "loading" && (
        <div className="text-[10px] text-slate-500">
          Searching for peers…
        </div>
      )}
      {state.kind === "error" && (
        <div className="text-[10px]" style={{ color: colors.state.bottleneckFg }}>
          {state.message}
        </div>
      )}
      {state.kind === "ready" && visible.length === 0 && (
        <div className="text-[10px] text-slate-500">
          No more suggestions for this card.
        </div>
      )}
      {state.kind === "ready" && visible.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visible.map((s) => (
            <SuggestionChip
              key={s.entity_id}
              suggestion={s}
              accepting={accepting === s.entity_id}
              onAccept={() => onAccept(s)}
              onDismiss={() => onDismiss(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chip with accept + dismiss in one row ────────────────────────────
function SuggestionChip({
  suggestion,
  accepting,
  onAccept,
  onDismiss,
}: {
  suggestion: RelatedSuggestion;
  accepting: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      <div
        className="flex items-stretch overflow-hidden rounded-full border bg-white text-[10.5px] font-medium"
        style={{ borderColor: colors.brand.haloSoft }}
      >
        <button
          type="button"
          onClick={onAccept}
          disabled={accepting}
          className="flex items-center gap-1 px-2.5 py-1 transition-colors hover:bg-slate-50 disabled:opacity-50"
          style={{ color: colors.brand.fgDark }}
          title={suggestion.description}
        >
          <span>+</span>
          <span className="max-w-[160px] truncate">{suggestion.name}</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={accepting}
          className="border-l px-1.5 text-[10px] text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
          style={{ borderLeftColor: colors.neutral.borderFaint }}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
      {hovered && (
        <div
          className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border bg-white p-2.5 text-[10.5px] leading-relaxed shadow-xl"
          style={{
            borderColor: colors.brand.haloSoft,
            boxShadow: colors.neutral.cardShadowFloating,
          }}
        >
          <div className="mb-1 font-semibold text-slate-900">
            {suggestion.name}
          </div>
          <div className="mb-1.5 text-slate-600">{suggestion.description}</div>
          <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider">
            <span className="text-slate-400">via</span>
            <span style={{ color: colors.brand.fgDark }}>
              {suggestion.relationship_type}
            </span>
          </div>
          <div className="mt-1 text-[10px] italic text-slate-500">
            {suggestion.rationale}
          </div>
        </div>
      )}
    </div>
  );
}
