// Shared upload flow for triple-lab.
//
// Used by both the raw-signal panel's drop handler AND the page-level
// unified empty state. Single code path means parse-poll + drawer
// open + soft-failure behavior stays consistent across surfaces.
//
// Returns once the drawer is open (for research-class assets) or once
// the upload finishes (for text / markdown / image — those materialize
// inline server-side, no drawer needed).

// Progress states the parent UI can render. Each callback fires once
// per state change so consumers can drive a toast / inline strip /
// asset card status badge without polling.
export type UploadStage =
  | "uploading"      // POST /api/ingest in flight
  | "parsing"        // file uploaded, parse-worker running, polling
  | "opening_review" // parse done, opening HITL drawer
  | "materialized"   // non-research class (text/md/image) — inline
  | "done"           // drawer is open (caller takes over)
  | "error";         // upload, parse, or drawer-open failed

export interface UploadProgress {
  fileName: string;
  // Stable per-drop id so a parent rendering N concurrent toasts can
  // dedupe + animate each independently.
  id: string;
  stage: UploadStage;
  // Set when stage === "error"; tells the user what went wrong.
  errorMessage?: string;
  // Set once we have the server-side asset id (post-upload).
  assetId?: string;
}

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
  /** Optional — fires on every state change so the parent can render
   *  progress (toast, status badge, etc.). Without this the upload
   *  is silent (legacy behavior). */
  onProgress?: (progress: UploadProgress) => void;
}

export async function processFileDrops(
  files: File[],
  deps: UploadFlowDeps,
): Promise<void> {
  for (const file of files) {
    // Stable per-drop id so the parent can key toasts/cards. Uses
    // crypto.randomUUID when available so concurrent drops don't
    // collide on time-based ids.
    const dropId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `drop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const emit = (partial: Omit<UploadProgress, "fileName" | "id">) =>
      deps.onProgress?.({ fileName: file.name, id: dropId, ...partial });

    emit({ stage: "uploading" });

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
        // Try to lift a meaningful error message off the response.
        // /api/ingest returns { error, code? } on failure paths.
        let serverMsg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; code?: string };
          if (body.error) serverMsg = body.error;
        } catch {
          // Response wasn't JSON — keep the HTTP status fallback.
        }
        console.warn("[triple-lab/upload] ingest failed:", res.status, serverMsg);
        emit({ stage: "error", errorMessage: serverMsg });
        continue;
      }
      ingestResponse = (await res.json()) as typeof ingestResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.warn("[triple-lab/upload] ingest threw:", err);
      emit({ stage: "error", errorMessage: msg });
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

    if (!assetId) {
      // Upload was accepted but we got no asset id back — defensive
      // fallback. Treat as materialized so the toast clears.
      emit({ stage: "materialized" });
      continue;
    }

    // Open the HITL review drawer for anything the server parsed in the
    // background — that's the exact set of assets with a pending
    // `normalized_text`, and the server signals it with `awaiting_parse`.
    // Gating on asset_class was fragile: the background-parse decision is
    // MIME-based (any PDF/DOCX), but a PDF whose filename reads like a
    // "report" / "spec" / "assessment" classifies as prior_analysis or
    // spec_sheet — so those papers got parsed yet were silently skipped
    // here and never showed the review drawer.
    const shouldReview = ingestResponse.awaiting_parse === true;

    if (!shouldReview) {
      // Text / markdown / image / url / paste — materialized inline by
      // the ingest route, no background parse + review needed.
      emit({ stage: "materialized", assetId });
      continue;
    }

    // Research-class asset: wait for parse to complete (preview
    // endpoint needs normalized_text). Poll up to 90s @ 1.2s cadence.
    emit({ stage: "parsing", assetId });
    const outcome = await pollUntilParsed(assetId);
    if (outcome.status === "error") {
      // Parser failed server-side — surface the real reason instead of
      // opening an empty review drawer.
      emit({ stage: "error", assetId, errorMessage: outcome.message });
      continue;
    }
    if (outcome.status === "timeout") {
      emit({
        stage: "error",
        assetId,
        errorMessage:
          "Parse timed out after 90s. The PDF may be unusually large or scanned. Try again or check the asset detail page.",
      });
      continue;
    }

    // outcome.status === "ready" → drawer time.
    emit({ stage: "opening_review", assetId });
    try {
      await deps.onAssetReady(assetId, sourceName, assetClass);
      emit({ stage: "done", assetId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open review";
      console.warn("[triple-lab/upload] open drawer failed:", err);
      emit({ stage: "error", assetId, errorMessage: msg });
    }
  }
}

// ── Parse-status poller ─────────────────────────────────────────────
// After a research-PDF / internal-doc upload, the ingest route returns
// immediately with parse_status="pending" and runs the parse worker in
// after(). The HITL preview endpoint needs normalized_text, so we can't
// open the drawer until parse_status flips to "ready". If it flips to
// "error" (or "skipped") we surface the reason instead of opening a
// dead, empty review drawer.
type ParseOutcome =
  | { status: "ready" }
  | { status: "error"; message: string }
  | { status: "timeout" };

async function pollUntilParsed(assetId: string): Promise<ParseOutcome> {
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
        // NOTE: the endpoint returns `status` (the parse_status value),
        // and a human-readable `error` when status === "error".
        const body = (await res.json()) as {
          status?: string;
          error?: string | null;
        };
        if (body.status === "ready") {
          return { status: "ready" };
        }
        // Terminal failure states — stop polling and report why. Without
        // this, a failed parse would burn the full 90s and then look
        // like a timeout, hiding the real cause (e.g. a corrupt PDF).
        if (body.status === "error" || body.status === "skipped") {
          return {
            status: "error",
            message:
              body.error?.trim() ||
              (body.status === "skipped"
                ? "This file wasn't parsed, so there's nothing to review yet."
                : "The parser couldn't read this file. It may be scanned, image-only, or corrupt."),
          };
        }
        // pending / parsing → keep polling.
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
  return { status: "timeout" };
}
