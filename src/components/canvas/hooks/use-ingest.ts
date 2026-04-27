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
}

interface IngestApiResponse {
  text: string;
  source_name: string;
  ingested_file_id: string | null;
  asset_class: string | null;
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
        return {
          text: payload.text,
          sourceName: payload.source_name,
          ingestedFileId: payload.ingested_file_id ?? null,
          assetClass: payload.asset_class ?? null,
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
