"use client";

import { useCallback, useState } from "react";

export interface IngestedContent {
  text: string;
  sourceName: string;
}

// Thin wrapper around /api/ingest. Handles URL fetch and file upload.
// Returns normalized text ready to pass to the materialize endpoint.
export function useIngest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestUrl = useCallback(async (url: string): Promise<IngestedContent | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "url", url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { text: string; source_name: string };
      return { text: payload.text, sourceName: payload.source_name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "URL ingest failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const ingestFile = useCallback(async (file: File): Promise<IngestedContent | null> => {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { text: string; source_name: string };
      return { text: payload.text, sourceName: payload.source_name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "File ingest failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { ingestUrl, ingestFile, loading, error };
}

export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^https?:\/\/\S+$/i.test(t);
}
