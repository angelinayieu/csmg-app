"use client";

// useVariableProposals — fetch + cache the variable_proposals for a space.
//
// Drives the +Variable button counter and the VariableProposalsPanel
// review drawer. Single fetch on mount + on space change; consumers can
// also call refetch() after an approve/reject action.

import { useCallback, useEffect, useState } from "react";
import type {
  VariableProposal,
  VariableRole,
} from "@/types/variable-proposals";

export interface VariableProposalsResponse {
  proposals: VariableProposal[];
  counts: {
    proposed: number;
    approved: number;
    rejected: number;
    superseded: number;
    total: number;
  };
  by_role: Partial<Record<VariableRole, number>>;
  latest_strategy_version: number | null;
}

export interface UseVariableProposalsResult {
  data: VariableProposalsResponse | null;
  loading: boolean;
  error: string | null;
  /** Convenience: count of pending proposals — drives the +Variable badge. */
  pendingCount: number;
  refetch: () => Promise<void>;
}

export function useVariableProposals(
  spaceId: string | null | undefined,
): UseVariableProposalsResult {
  const [data, setData] = useState<VariableProposalsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!spaceId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/variable-proposals`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as VariableProposalsResponse;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/variable-proposals`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setData(null);
          setError(`HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as VariableProposalsResponse;
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return {
    data,
    loading,
    error,
    pendingCount: data?.counts.proposed ?? 0,
    refetch,
  };
}
