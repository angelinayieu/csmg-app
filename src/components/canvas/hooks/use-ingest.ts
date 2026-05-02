"use client";

import { useCallback, useState } from "react";

export interface IngestedContent {
  text: string;
  sourceName: string;
  /** ingested_files.id of the persisted row. Surfaced so the HITL
   *  extraction-review flow (POST /api/ingest/[id]/preview, /extract,
   *  /skip) can target this asset. May be null if the persistence
   *  step soft-failed (text still returned). */
  ingestedFileId: string | null;
  /** Asset class inferred at ingest time. Surfaced so the review
   *  drawer can render the right header chip without a second
   *  roundtrip. */
  assetClass: string | null;
  /** Two-phase image ingest signal — true when the ingest server
   *  deferred the vision pass to /api/ingest/vision-extract and the
   *  client should follow up. The hook itself fires phase 2 when
   *  this is true, but consumers may want to react (e.g. show a
   *  spinner on the file-card immediately). */
  awaitingVision: boolean;
}

interface IngestApiResponse {
  text: string;
  source_name: string;
  ingested_file_id: string | null;
  asset_class: string | null;
  awaiting_vision?: boolean;
}

interface VisionExtractResponse {
  ingested_file_id: string;
  description: string;
  entity_count: number;
  relationship_count: number;
  duration_ms: number;
}

/**
 * Fire-and-forget phase 2 dispatch. Re-uploads the same image
 * binary to /api/ingest/vision-extract, then broadcasts a window
 * event so the file-card shape (and any other listener) can update
 * its status badges + cached fields without re-fetching the row.
 *
 * Errors are emitted as a window event too so the file-card can
 * flip to its error badge — we don't surface them via the hook's
 * `error` state because phase 1 already returned successfully and
 * we don't want to retroactively flag the upload as failed.
 */
async function fireVisionPhase2(
  file: File,
  ingestedFileId: string,
): Promise<void> {
  try {
    // Tell listeners the analysis just started (file-card flips to
    // "Analyzing…"). The ingest hook ALSO sets this synchronously
    // when constructing the file-card via the asset class, so
    // subscribers without a phase-1 hook still get the signal.
    window.dispatchEvent(
      new CustomEvent("ingested-file:vision-start", {
        detail: { ingestedFileId },
      }),
    );
    const form = new FormData();
    form.set("file", file);
    form.set("ingested_file_id", ingestedFileId);
    const res = await fetch("/api/ingest/vision-extract", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `HTTP ${res.status}`);
    }
    const payload = (await res.json()) as VisionExtractResponse;
    window.dispatchEvent(
      new CustomEvent("ingested-file:vision-complete", {
        detail: {
          ingestedFileId,
          description: payload.description,
          entityCount: payload.entity_count,
          relationshipCount: payload.relationship_count,
          durationMs: payload.duration_ms,
        },
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vision extract failed";
    window.dispatchEvent(
      new CustomEvent("ingested-file:vision-error", {
        detail: { ingestedFileId, error: message },
      }),
    );
  }
}

// Thin wrapper around /api/ingest. Handles URL fetch and file upload.
// Returns normalized text ready to pass to the materialize endpoint.
export function useIngest(spaceId?: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestUrl = useCallback(
    async (url: string): Promise<IngestedContent | null> => {
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { type: "url", url };
        if (spaceId) body.space_id = spaceId;
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as IngestApiResponse;
        return {
          text: payload.text,
          sourceName: payload.source_name,
          ingestedFileId: payload.ingested_file_id ?? null,
          assetClass: payload.asset_class ?? null,
          awaitingVision: false, // URL ingests don't go through vision
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "URL ingest failed";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [spaceId],
  );

  const ingestFile = useCallback(
    async (file: File): Promise<IngestedContent | null> => {
      setLoading(true);
      setError(null);
      try {
        const form = new FormData();
        form.set("file", file);
        if (spaceId) form.set("space_id", spaceId);
        const res = await fetch("/api/ingest", { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as IngestApiResponse;
        const awaitingVision = !!payload.awaiting_vision;
        // ── Two-phase image ingest ──
        // Phase 1 returned with empty text + awaiting_vision=true.
        // Re-upload the binary to /api/ingest/vision-extract so the
        // structured Claude vision pass populates description +
        // extracted_entities + extracted_relationships. Run async so
        // the file-card lands on canvas immediately.
        if (awaitingVision && payload.ingested_file_id) {
          // Intentional fire-and-forget; the inner fn dispatches
          // window events so listeners (file-card, materializer) can
          // react when phase 2 finishes.
          void fireVisionPhase2(file, payload.ingested_file_id);
        }
        return {
          text: payload.text,
          sourceName: payload.source_name,
          ingestedFileId: payload.ingested_file_id ?? null,
          assetClass: payload.asset_class ?? null,
          awaitingVision,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "File ingest failed";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [spaceId],
  );

  return { ingestUrl, ingestFile, loading, error };
}

export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^https?:\/\/\S+$/i.test(t);
}
