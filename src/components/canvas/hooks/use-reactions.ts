"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalKey, type Reaction, type ReactionType } from "@/types/reactions";

export interface UseReactionLookupOptions {
  spaceId: string;
  entityIds: string[];
  enabled: boolean;
}

// GET the saved reaction (if any) for the exact combination slot.
// Debounced slightly so rapid slot changes don't thrash the endpoint.
export function useReactionLookup({
  spaceId,
  entityIds,
  enabled,
}: UseReactionLookupOptions): { reaction: Reaction | null; loading: boolean } {
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [loading, setLoading] = useState(false);
  const key = entityIds.length >= 2 ? canonicalKey(entityIds) : null;
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !key) {
      ctrlRef.current?.abort();
      setReaction(null);
      setLoading(false);
      return;
    }
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(true);
    const params = new URLSearchParams({ spaceId, entityIds: entityIds.join(",") });
    fetch(`/api/canvas/reactions?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { reaction: Reaction | null }) => {
        setReaction(json.reaction ?? null);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setReaction(null);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, key, enabled]);

  return { reaction, loading };
}

export interface SaveReactionInput {
  spaceId: string;
  name: string;
  reactionType: ReactionType;
  entityIds: string[];
  probability: number;
  ciLow?: number | null;
  ciHigh?: number | null;
  mechanism?: string | null;
  implication?: string | null;
  probes?: string[] | null;
  sourceTag?: "user" | "llm" | "inferred";
  provenance?: Record<string, unknown> | null;
}

export function useSaveReaction() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (input: SaveReactionInput): Promise<Reaction | null> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas/reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId: input.spaceId,
          name: input.name,
          reaction_type: input.reactionType,
          entity_ids: input.entityIds,
          probability: input.probability,
          ci_low: input.ciLow ?? null,
          ci_high: input.ciHigh ?? null,
          mechanism: input.mechanism ?? null,
          implication: input.implication ?? null,
          probes: input.probes ?? null,
          source_tag: input.sourceTag ?? "llm",
          provenance: input.provenance ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { reaction: Reaction };
      return json.reaction;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return { save, saving, error };
}
