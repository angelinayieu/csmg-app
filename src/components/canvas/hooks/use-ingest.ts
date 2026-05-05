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
  /** Two-phase parse signal (Phase 1, 2026-07-04). When true, `text`
   *  is empty and the row is in parse_status='pending'. The hook
   *  silently polls /api/ingest/[id]/parse-status until the worker
   *  finishes; consumers see the same IngestedContent shape they did
   *  pre-two-phase. */
  awaiting_parse?: boolean;
  parse_status?: "pending" | "parsing" | "ready" | "error" | "skipped";
}

interface ParseStatusResponse {
  asset_id: string;
  status: "pending" | "parsing" | "ready" | "error" | "skipped";
  error: string | null;
  text: string | null;
  source_name: string | null;
  asset_class: string | null;
  raw_chars: number | null;
  normalized_chars: number | null;
}

interface VisionExtractResponse {
  ingested_file_id: string;
  description: string;
  entity_count: number;
  relationship_count: number;
  duration_ms: number;
}

// Poll cadence + timeout for the background parse path. Most PDFs
// resolve in 5-30s; 90s is the practical cap before we surface an
// error. Polling every 1.2s keeps the load light without the user
// waiting noticeably between updates.
const PARSE_POLL_INTERVAL_MS = 1200;
const PARSE_POLL_TIMEOUT_MS = 90_000;

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

/**
 * Poll /api/ingest/[id]/parse-status every PARSE_POLL_INTERVAL_MS
 * until the row reaches a terminal state ('ready' | 'error' |
 * 'skipped') or the timeout elapses. Used for the PDF/DOCX
 * background-parse path so callers of ingestFile() see the same
 * IngestedContent shape regardless of synchronous vs. async parse.
 *
 * Also broadcasts window events on each poll tick so file-card UIs
 * can show a parse-progress chip without re-fetching themselves:
 *   • ingested-file:parse-tick   { ingestedFileId, status }
 *   • ingested-file:parse-ready  { ingestedFileId, text, source_name }
 *   • ingested-file:parse-error  { ingestedFileId, error }
 */
async function pollParseStatus(
  ingestedFileId: string,
): Promise<ParseStatusResponse> {
  const startedAt = Date.now();
  let last: ParseStatusResponse | null = null;

  while (Date.now() - startedAt < PARSE_POLL_TIMEOUT_MS) {
    let res: Response;
    try {
      res = await fetch(`/api/ingest/${ingestedFileId}/parse-status`, {
        method: "GET",
      });
    } catch {
      // Network blip — wait one interval and retry. Don't fail the
      // whole upload on a transient.
      await sleep(PARSE_POLL_INTERVAL_MS);
      continue;
    }

    if (res.ok) {
      last = (await res.json()) as ParseStatusResponse;
      // Broadcast the tick so the file-card can render a status chip
      // without re-fetching this endpoint itself.
      window.dispatchEvent(
        new CustomEvent("ingested-file:parse-tick", {
          detail: { ingestedFileId, status: last.status },
        }),
      );

      if (last.status === "ready") {
        window.dispatchEvent(
          new CustomEvent("ingested-file:parse-ready", {
            detail: {
              ingestedFileId,
              text: last.text ?? "",
              sourceName: last.source_name,
            },
          }),
        );
        return last;
      }
      if (last.status === "error") {
        window.dispatchEvent(
          new CustomEvent("ingested-file:parse-error", {
            detail: { ingestedFileId, error: last.error ?? "Parse failed" },
          }),
        );
        return last;
      }
      if (last.status === "skipped") {
        return last;
      }
    } else if (res.status === 404) {
      // Row went missing? Unrecoverable — return a synthetic error.
      return {
        asset_id: ingestedFileId,
        status: "error",
        error: "Asset row was deleted before parse completed",
        text: null,
        source_name: null,
        asset_class: null,
        raw_chars: null,
        normalized_chars: null,
      };
    }
    // 401/403/500 etc → transient, keep polling

    await sleep(PARSE_POLL_INTERVAL_MS);
  }

  // Timeout reached. Return the last observation we got, or a
  // synthetic 'pending' if we never got a response.
  return (
    last ?? {
      asset_id: ingestedFileId,
      status: "pending",
      error: null,
      text: null,
      source_name: null,
      asset_class: null,
      raw_chars: null,
      normalized_chars: null,
    }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Thin wrapper around /api/ingest. Handles URL fetch and file upload.
// Returns normalized text ready to pass to the materialize endpoint.
//
// For PDF/DOCX uploads the route returns immediately with parse_status=
// 'pending' and empty text; this hook silently polls /parse-status
// until the background worker finishes, then resolves with the same
// IngestedContent shape callers expect. Callers don't need to know
// the difference — they just await ingestFile() as before.
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
        const awaitingParse = !!payload.awaiting_parse;

        // ── Two-phase image ingest (existing) ──
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

        // ── Two-phase parse ingest (PDF / DOCX) ──
        // The route persisted the row in parse_status='pending' and
        // scheduled pdf-parse / docx via Next 16 after(). Poll
        // /parse-status until the worker writes 'ready' (or 'error')
        // — this kills the original 504 path because the user-facing
        // request returned in <1s; we just block the hook's promise
        // until the background work completes.
        if (awaitingParse && payload.ingested_file_id) {
          const finalStatus = await pollParseStatus(payload.ingested_file_id);
          if (finalStatus.status === "error") {
            throw new Error(finalStatus.error ?? "Parse failed");
          }
          if (finalStatus.status !== "ready") {
            throw new Error(
              `Parse did not complete within ${Math.round(PARSE_POLL_TIMEOUT_MS / 1000)}s (status=${finalStatus.status})`,
            );
          }
          return {
            text: finalStatus.text ?? "",
            sourceName: finalStatus.source_name ?? payload.source_name,
            ingestedFileId: payload.ingested_file_id,
            assetClass: finalStatus.asset_class ?? payload.asset_class ?? null,
            awaitingVision,
          };
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
