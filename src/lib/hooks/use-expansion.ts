"use client";

import { useState, useCallback, useMemo } from "react";
import type { Entity } from "@/types";
import type {
  Expansion,
  ExpansionBreadcrumb,
  DepthBudget,
  SubComponent,
} from "@/types/expansion";

interface UseExpansionOptions {
  spaceId: string;
  maxDepth?: number; // default 3
  maxExpansions?: number; // default 25
}

interface UseExpansionReturn {
  /** Current active expansion (null = viewing main graph) */
  activeExpansion: Expansion | null;
  /** Navigation breadcrumb trail */
  breadcrumbs: ExpansionBreadcrumb[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Depth budget info */
  budget: DepthBudget;
  /** Expand an entity — triggers LLM call if not cached */
  expand: (entity: Entity, parentExpansionId?: string) => Promise<void>;
  /** Expand a sub-component (drill deeper) */
  drillInto: (subComponent: SubComponent, parentExpansion: Expansion) => Promise<void>;
  /** Navigate back one level */
  goBack: () => void;
  /** Navigate to a specific breadcrumb level */
  goToLevel: (index: number) => void;
  /** Close expansion overlay entirely */
  close: () => void;
  /** Whether expansion overlay is open */
  isOpen: boolean;
}

/**
 * Hook that manages entity expansion lifecycle:
 * - Fetches expansions via POST to /api/pipeline/expand
 * - Maintains a breadcrumb navigation stack for nested drill-downs
 * - Tracks depth budget (max depth + total expansion count)
 * - Skips LLM calls when the API returns a cached expansion
 */
export function useExpansion(options: UseExpansionOptions): UseExpansionReturn {
  const { spaceId, maxDepth = 3, maxExpansions = 25 } = options;

  const [expansionStack, setExpansionStack] = useState<
    Array<{ expansion: Expansion; entityName: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expansionsUsed, setExpansionsUsed] = useState(0);

  const activeExpansion =
    expansionStack.length > 0
      ? expansionStack[expansionStack.length - 1].expansion
      : null;

  const isOpen = expansionStack.length > 0;

  const breadcrumbs = useMemo<ExpansionBreadcrumb[]>(
    () =>
      expansionStack.map((item, i) => ({
        entity_id: item.expansion.entity_id,
        entity_name: item.entityName,
        expansion_id: item.expansion.id,
        depth_level: i + 1,
      })),
    [expansionStack],
  );

  const budget = useMemo<DepthBudget>(
    () => ({
      max_depth: maxDepth,
      current_depth: expansionStack.length,
      expansions_used: expansionsUsed,
      max_expansions: maxExpansions,
    }),
    [maxDepth, maxExpansions, expansionStack.length, expansionsUsed],
  );

  const expand = useCallback(
    async (entity: Entity, parentExpansionId?: string) => {
      setLoading(true);
      setError(null);

      try {
        const depthLevel = expansionStack.length + 1;
        if (depthLevel > maxDepth) {
          setError(`Maximum depth (${maxDepth}) reached`);
          return;
        }

        const res = await fetch("/api/pipeline/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_id: entity.id,
            space_id: spaceId,
            parent_expansion_id: parentExpansionId ?? null,
            depth_level: depthLevel,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Expansion failed");
          return;
        }

        const expansion = data.expansion as Expansion;
        if (!data.cached) {
          setExpansionsUsed((prev) => prev + 1);
        }

        setExpansionStack((prev) => [
          ...prev,
          { expansion, entityName: entity.name },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    },
    [spaceId, maxDepth, expansionStack.length],
  );

  // drillInto: for sub-components, we create a "virtual entity" since
  // sub-components aren't real entities in the DB.
  // This calls expand with context about the parent.
  const drillInto = useCallback(
    async (subComponent: SubComponent, parentExpansion: Expansion) => {
      if (!subComponent.is_expandable) {
        setError("This component cannot be expanded further");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const depthLevel = expansionStack.length + 1;
        if (depthLevel > maxDepth) {
          setError(`Maximum depth (${maxDepth}) reached`);
          return;
        }

        const res = await fetch("/api/pipeline/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_id: parentExpansion.entity_id, // Same entity, but pass parent context
            space_id: spaceId,
            parent_expansion_id: parentExpansion.id,
            depth_level: depthLevel,
            sub_component_id: subComponent.id, // The API uses this to know WHICH sub-component
            sub_component_name: subComponent.name,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Drill-down failed");
          return;
        }

        const expansion = data.expansion as Expansion;
        if (!data.cached) {
          setExpansionsUsed((prev) => prev + 1);
        }

        setExpansionStack((prev) => [
          ...prev,
          { expansion, entityName: subComponent.name },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    },
    [spaceId, maxDepth, expansionStack.length],
  );

  const goBack = useCallback(() => {
    setExpansionStack((prev) => prev.slice(0, -1));
    setError(null);
  }, []);

  const goToLevel = useCallback((index: number) => {
    setExpansionStack((prev) => prev.slice(0, index + 1));
    setError(null);
  }, []);

  const close = useCallback(() => {
    setExpansionStack([]);
    setError(null);
  }, []);

  return {
    activeExpansion,
    breadcrumbs,
    loading,
    error,
    budget,
    expand,
    drillInto,
    goBack,
    goToLevel,
    close,
    isOpen,
  };
}
