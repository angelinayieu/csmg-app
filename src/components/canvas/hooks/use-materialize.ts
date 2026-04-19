"use client";

import { useCallback, useState } from "react";

export interface MaterializedEntity {
  id: string;
  entity_id: string;
  name: string;
  description?: string;
  importance?: string;
  entity_category?: string;
  layer?: string | null;
  depth?: number;
  confidence?: number;
}

export interface MaterializeResponse {
  entity: MaterializedEntity;
  predicted_edges: Array<{
    id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string;
    confidence: number;
    source_tag: string;
    requires_user_approval?: boolean;
  }>;
  connected_entity_ids: string[];
  llm_reasoning: string | null;
}

// Single-entity materialize helper. The canvas calls this for:
//   - Bottom dock submit (text → new KG node at viewport center)
//   - Sticky-note Decompose button (sticky text → new KG node near sticky)
//   - URL/file dropped on canvas (extracted text → new KG node at drop point)
export function useMaterialize(spaceId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialize = useCallback(
    async (text: string, placement?: { x: number; y: number }): Promise<MaterializeResponse | null> => {
      if (!text || text.trim().length < 3) return null;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/canvas/materialize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, text, placement }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as MaterializeResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Materialize failed";
        setError(msg);
        console.warn("[canvas-materialize]", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [spaceId],
  );

  return { materialize, loading, error };
}
