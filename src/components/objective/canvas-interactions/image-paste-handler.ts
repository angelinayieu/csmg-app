// ── Canvas image paste/drop → vision analysis ──────────────────────
//
// Before this, pasting/dropping an image onto the tldraw board hit tldraw's
// DEFAULT files handler → a plain native `image` shape. No ingest, no vision
// pass, no "power-up" affordance — the user's "why is there no response to an
// image?" report. Here we override the `files` external-content handler so an
// image is routed through the SAME two-phase pipeline the chatbox uses
// (/api/ingest → /api/ingest/vision-extract), landing an analyzed
// `objective-image-card` (which the scanner / Converge-Diverge surfaces now
// recognize — see shape-node-adapter.ts). Non-image files fall back to
// tldraw's default behavior unchanged.

import {
  atom,
  defaultHandleExternalFileContent,
  type Editor,
  type TLDefaultExternalContentHandlerOpts,
} from "tldraw";
import { deployImageCard, updateImageCard } from "../board-bus";

interface VisionResponse {
  description?: string;
  entity_count?: number;
  entities?: Array<{ name?: string; type?: string }>;
  error?: string;
}

interface IngestResponse {
  ingested_file_id?: string;
  image_url?: string;
  awaiting_vision?: boolean;
  error?: string;
}

/** Minimal opts so `defaultHandleExternalFileContent` can run for non-image
 *  files without a real toasts/i18n context (we don't surface tldraw's toasts
 *  on this board). All TLExternalContentProps fields are optional → defaults. */
function fallbackOpts(): TLDefaultExternalContentHandlerOpts {
  return {
    toasts: {
      addToast: () => "",
      removeToast: () => "",
      clearToasts: () => {},
      toasts: atom("image-paste-toasts", []),
    },
    // The default handler only calls msg() for error toasts we don't show.
    msg: ((id: string) => id) as unknown as TLDefaultExternalContentHandlerOpts["msg"],
  } as unknown as TLDefaultExternalContentHandlerOpts;
}

/** Run the two-phase ingest+vision pipeline for one pasted image, patching the
 *  on-board card as each phase returns. Fire-and-forget; soft-fails to a red
 *  "analysis failed" footer rather than throwing. */
async function analyzeAndDeploy(spaceId: string, file: File): Promise<void> {
  const clientKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `paste-${crypto.randomUUID()}`
      : `paste-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const blobUrl = URL.createObjectURL(file);

  // Land immediately with a local preview + amber "Analyzing…" footer.
  deployImageCard({
    imageFileId: clientKey,
    imageName: file.name || "Pasted image",
    imageUrl: blobUrl,
    description: "",
    entityCount: 0,
    entitiesJson: "[]",
    objectId: "",
    analyzing: true,
  });

  let currentKey = clientKey;
  try {
    // Phase 1 — persist + store the binary, scoped to THIS space so the
    // /images poller + materialize-image-context pick it up.
    const fd = new FormData();
    fd.append("file", file);
    fd.append("space_id", spaceId);
    const res = await fetch("/api/ingest", { method: "POST", body: fd });
    const json = (await res.json().catch(() => ({}))) as IngestResponse;
    if (!res.ok || !json.ingested_file_id) {
      updateImageCard({
        key: currentKey,
        patch: { analyzing: false, analysisError: json.error ?? "Upload failed." },
      });
      return;
    }
    const ingestedId = json.ingested_file_id;
    const publicUrl = json.image_url || blobUrl;
    // Swap the temp key for the real ingested_file_id (so the poller dedupes
    // against it) + the durable public URL (survives reload; blob doesn't).
    updateImageCard({
      key: currentKey,
      patch: { imageFileId: ingestedId, imageUrl: publicUrl },
    });
    currentKey = ingestedId;
    if (publicUrl !== blobUrl) {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    }

    if (!json.awaiting_vision) {
      // Non-vision asset (shouldn't happen for images) — clear the spinner.
      updateImageCard({ key: currentKey, patch: { analyzing: false } });
      return;
    }

    // Phase 2 — the single Claude vision call.
    const vfd = new FormData();
    vfd.append("file", file);
    vfd.append("ingested_file_id", ingestedId);
    const vres = await fetch("/api/ingest/vision-extract", {
      method: "POST",
      body: vfd,
    });
    const vjson = (await vres.json().catch(() => ({}))) as VisionResponse;
    if (!vres.ok) {
      updateImageCard({
        key: currentKey,
        patch: { analyzing: false, analysisError: vjson.error ?? "Analysis failed." },
      });
      return;
    }
    const entities = Array.isArray(vjson.entities) ? vjson.entities.slice(0, 12) : [];
    updateImageCard({
      key: currentKey,
      patch: {
        analyzing: false,
        analysisError: "",
        description: vjson.description ?? "",
        entityCount: vjson.entity_count ?? entities.length,
        entitiesJson: JSON.stringify(entities),
      },
    });

    // Backfill the image_source library_object id (reuses the /images route's
    // lazy ensureImageSource) so the card's detail rail + drag-to-link wake up.
    try {
      const ires = await fetch(`/api/objective/${spaceId}/images`, {
        cache: "no-store",
      });
      if (ires.ok) {
        const ij = (await ires.json()) as {
          images?: Array<{ id: string; objectId?: string }>;
        };
        const row = (ij.images ?? []).find((im) => im.id === ingestedId);
        if (row?.objectId) {
          updateImageCard({ key: currentKey, patch: { objectId: row.objectId } });
        }
      }
    } catch {
      /* soft-fail — detail rail backfills on next board mount via the poller */
    }
  } catch (err) {
    updateImageCard({
      key: currentKey,
      patch: {
        analyzing: false,
        analysisError: err instanceof Error ? err.message : "Upload failed.",
      },
    });
  }
}

/** Override the board's `files` external-content handler so pasted/dropped
 *  images are analyzed (and surfaced as scanner-ready cards) instead of
 *  becoming inert native image shapes. Returns a cleanup that detaches it. */
export function registerImagePasteHandler(
  editor: Editor,
  spaceId: string,
): () => void {
  editor.registerExternalContentHandler("files", async (info) => {
    const files = (info.files ?? []) as File[];
    const images = files.filter((f) => f.type.startsWith("image/"));
    const others = files.filter((f) => !f.type.startsWith("image/"));

    // Preserve tldraw's default for non-image files (PDF/SVG/etc.).
    if (others.length > 0) {
      try {
        await defaultHandleExternalFileContent(
          editor,
          { point: info.point, files: others },
          fallbackOpts(),
        );
      } catch {
        /* ignore — non-image fallback is best-effort */
      }
    }

    for (const file of images) {
      void analyzeAndDeploy(spaceId, file);
    }
  });

  return () => {
    // Detach our handler. The editor is torn down with the board, so reverting
    // to null (rather than restoring the default) is safe here.
    editor.registerExternalContentHandler("files", null);
  };
}
