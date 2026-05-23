// Shared upload flow for triple-lab.
//
// Used by both the raw-signal panel's drop handler AND the page-level
// unified empty state. Single code path means parse-poll + drawer
// open + soft-failure behavior stays consistent across surfaces.
//
// Returns once the drawer is open (for research-class assets) or once
// the upload finishes (for text / markdown / image — those materialize
// inline server-side, no drawer needed).

export interface UploadFlowDeps {
  spaceId: string;
  /** Called once per parsed research-class asset so the parent can
   *  open the HITL extraction-review drawer. The parent owns the
   *  drawer state (useExtractionReview) and the actual drawer JSX. */
  onAssetReady: (
    assetId: string,
    assetName: string,
    assetClass: string | null,
  ) => Promise<void>;
  /** Called after each upload so the panel can pull fresh entities.
   *  Usually router.refresh(). */
  onRefresh: () => void;
}

export async function processFileDrops(
  files: File[],
  deps: UploadFlowDeps,
): Promise<void> {
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("space_id", deps.spaceId);

    let ingestResponse: {
      ingested_file_id?: string;
      asset_class?: string;
      source_name?: string;
      awaiting_parse?: boolean;
      parse_status?: string;
    };
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        console.warn("[triple-lab/upload] ingest failed:", res.status);
        continue;
      }
      ingestResponse = (await res.json()) as typeof ingestResponse;
    } catch (err) {
      console.warn("[triple-lab/upload] ingest threw:", err);
      continue;
    }

    // Refresh once now so the asset card appears immediately as
    // "parsing…". Middle KG panel picks it up via spaceData.entities
    // on the next render.
    deps.onRefresh();

    const assetId = ingestResponse.ingested_file_id;
    const assetClass = ingestResponse.asset_class ?? null;
    const sourceName =
      ingestResponse.source_name ?? file.name ?? "Untitled asset";

    if (!assetId) continue;

    const shouldReview =
      assetClass === "research_pdf" || assetClass === "internal_doc";

    if (!shouldReview) {
      // Text / markdown / image — materialized inline by the ingest
      // route, no HITL needed.
      continue;
    }

    // Research-class asset: wait for parse to complete (preview
    // endpoint needs normalized_text). Poll up to 90s @ 1.2s cadence.
    await pollUntilParsed(assetId);

    // Drawer time.
    try {
      await deps.onAssetReady(assetId, sourceName, assetClass);
    } catch (err) {
      console.warn("[triple-lab/upload] open drawer failed:", err);
    }
  }
}

// ── Parse-status poller ─────────────────────────────────────────────
// After a research-PDF / internal-doc upload, the ingest route returns
// immediately with parse_status="pending" and runs the parse worker in
// after(). The HITL preview endpoint needs normalized_text, so we
// can't open the drawer until parse_status flips to "ready" (or
// "error"). Same pattern as the asset-card-shape poll loop.
async function pollUntilParsed(assetId: string): Promise<void> {
  const INTERVAL_MS = 1200;
  const TIMEOUT_MS = 90_000;
  const start = Date.now();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch(`/api/ingest/${assetId}/parse-status`, {
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { parse_status?: string };
        // "ready" → safe to open drawer. "error" → still open the
        // drawer so the user sees the error banner. Everything else
        // (pending / parsing) → keep polling.
        if (body.parse_status === "ready" || body.parse_status === "error") {
          return;
        }
      }
    } catch {
      // Soft-fail: a transient network blip shouldn't abort the poll.
    }
    await sleep(INTERVAL_MS);
  }
  console.warn(
    "[triple-lab/upload] parse-status poll timed out after 90s for",
    assetId,
  );
}
