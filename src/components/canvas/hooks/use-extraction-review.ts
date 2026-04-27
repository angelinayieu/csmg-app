"use client";

// ── HITL extraction-review hook ──────────────────────────────────────
//
// Owns the state machine for the ExtractionChecklistDrawer:
//
//   open(assetId) → POST /preview → drawer renders preview
//        ↓
//   user toggles candidates + focus level
//        ↓
//   extract(selected, focus) → POST /extract → entities live in KG
//        ↓
//   close()
//
// Or alternatively:
//
//   open(assetId) → drawer
//        ↓
//   skip() → POST /skip → drawer closes, asset card flips to 'skipped'
//
// All POSTs are idempotent server-side (preview is cached, extract
// rejects re-extraction, skip is a no-op on already-extracted) so the
// hook doesn't need to guard against double-clicks beyond its own
// `loading` flag.

import { useCallback, useState } from "react";
import type {
  ExtractionCommitResult,
  ExtractionPreview,
  FocusLevel,
} from "@/types/extraction-preview";

export interface UseExtractionReviewState {
  /** Drawer is open AND a preview is loaded (or loading). Renamed
   *  from `open` to `isOpen` to avoid the name collision with the
   *  imperative `open()` action below. */
  isOpen: boolean;
  /** Loading the preview (POST /preview in flight). */
  previewLoading: boolean;
  /** The cached preview, or null while loading. */
  preview: ExtractionPreview | null;
  /** Asset metadata for the drawer header. */
  assetName: string | null;
  assetClass: string | null;
  /** Current asset id under review. null when drawer closed. */
  assetId: string | null;
  /** Last error from any POST, surfaced to the drawer's error banner. */
  error: string | null;
}

export interface UseExtractionReviewActions {
  /** Open the drawer for an asset. Fires POST /preview (with cache
   *  short-circuit on the server side). The drawer is rendered as
   *  soon as `open=true`; preview content streams in when the
   *  request resolves. */
  open: (input: {
    assetId: string;
    assetName: string;
    assetClass?: string | null;
    /** force=true bypasses the server-side cache, regenerating
     *  candidates from scratch. Use when the user explicitly wants
     *  to "re-analyze this asset." */
    force?: boolean;
  }) => Promise<void>;
  /** Submit the user's selection. Returns the commit result so the
   *  parent can display a success toast. Drawer auto-closes on
   *  success. */
  extract: (
    selectedCandidateIds: string[],
    focusLevel: FocusLevel,
  ) => Promise<ExtractionCommitResult | null>;
  /** Skip extraction for the current asset. Drawer auto-closes. */
  skip: () => Promise<void>;
  /** Close the drawer without taking any action. The cached preview
   *  on the server stays — re-opening hits the cache. */
  close: () => void;
}

export function useExtractionReview(): UseExtractionReviewState &
  UseExtractionReviewActions {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assetName, setAssetName] = useState<string | null>(null);
  const [assetClass, setAssetClass] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<ExtractionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    // Keep preview + asset info around briefly so the drawer's
    // close transition can animate without stale-state flicker; clear
    // on next open.
  }, []);

  const openDrawer = useCallback<UseExtractionReviewActions["open"]>(
    async ({ assetId: nextAssetId, assetName: nextName, assetClass: nextClass, force }) => {
      setAssetId(nextAssetId);
      setAssetName(nextName);
      setAssetClass(nextClass ?? null);
      setIsOpen(true);
      setPreviewLoading(true);
      setPreview(null);
      setError(null);
      try {
        const res = await fetch(`/api/ingest/${nextAssetId}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: !!force }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as {
          preview: ExtractionPreview;
          cached: boolean;
        };
        setPreview(payload.preview);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preview");
      } finally {
        setPreviewLoading(false);
      }
    },
    [],
  );

  const extract = useCallback<UseExtractionReviewActions["extract"]>(
    async (selectedCandidateIds, focusLevel) => {
      if (!assetId) return null;
      setError(null);
      try {
        const res = await fetch(`/api/ingest/${assetId}/extract`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            selected_candidate_ids: selectedCandidateIds,
            focus_level: focusLevel,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as ExtractionCommitResult;
        // Auto-close on success — the drawer's job is done. Caller
        // can re-open for review of a different asset.
        setIsOpen(false);
        return payload;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Extraction failed";
        setError(msg);
        // Re-throw so the drawer's submit handler surfaces the error
        // in its banner rather than silently swallowing.
        throw new Error(msg);
      }
    },
    [assetId],
  );

  const skip = useCallback<UseExtractionReviewActions["skip"]>(async () => {
    if (!assetId) return;
    setError(null);
    try {
      const res = await fetch(`/api/ingest/${assetId}/skip`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setIsOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Skip failed";
      setError(msg);
      throw new Error(msg);
    }
  }, [assetId]);

  return {
    isOpen,
    previewLoading,
    preview,
    assetName,
    assetClass,
    assetId,
    error,
    open: openDrawer,
    extract,
    skip,
    close,
  };
}
