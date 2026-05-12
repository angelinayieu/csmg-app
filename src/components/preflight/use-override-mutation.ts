"use client";

// ── usePreflightOverride hook ────────────────────────────────────────
//
// Thin wrapper around POST /api/spaces/[id]/preflight/overrides that
// handles the round-trip + revalidation pattern Phase C edits all share:
//
//   1. Send the override
//   2. Trigger a fresh PreflightView fetch on success
//   3. Surface error state to the caller for inline rendering
//
// The hook uses Next's router.refresh() to invalidate the server
// component fetch — that's what re-runs the aggregator with the new
// override applied. For optimistic updates the caller handles local
// state separately and confirms via the refresh.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreflightOverride } from "@/types/preflight";

export interface UsePreflightOverrideArgs {
  spaceId: string;
}

export interface OverrideMutateInput {
  override_kind: PreflightOverride["override_kind"];
  target_id: string;
  value: unknown;
  reasoning?: string | null;
}

export interface UsePreflightOverrideResult {
  /** Send an override; resolves on completion. */
  mutate: (input: OverrideMutateInput) => Promise<{ ok: boolean; error?: string }>;
  /** True while a write is in flight. */
  pending: boolean;
  /** Last error message; null when none. */
  lastError: string | null;
  /** id of the most recently-written override target — useful for UI
   *  affordances ("just saved" indicators). */
  lastSavedTargetId: string | null;
}

export function usePreflightOverride({
  spaceId,
}: UsePreflightOverrideArgs): UsePreflightOverrideResult {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSavedTargetId, setLastSavedTargetId] = useState<string | null>(null);

  const mutate = useCallback(
    async (input: OverrideMutateInput) => {
      setPending(true);
      setLastError(null);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/preflight/overrides`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!res.ok) {
          const data = await safeJson(res);
          const err =
            (data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : null) ?? `HTTP ${res.status}`;
          setLastError(err);
          return { ok: false, error: err };
        }
        setLastSavedTargetId(input.target_id);
        // Trigger server-component re-fetch so the aggregator picks
        // up the new override on next render. Doesn't unmount the
        // client tree — locally-held state survives.
        router.refresh();
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setLastError(msg);
        return { ok: false, error: msg };
      } finally {
        setPending(false);
      }
    },
    [spaceId, router],
  );

  return { mutate, pending, lastError, lastSavedTargetId };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
