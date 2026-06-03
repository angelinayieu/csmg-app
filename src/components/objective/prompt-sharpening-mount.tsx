"use client";

// ── PromptSharpeningMount ──
//
// Headless. After intake fires the sharpening generation (brainstorm/start),
// this polls the status route until the artifact is ready, then dispatches
// deploySharpeningCard so WhiteboardBase materializes the card below the
// objective card. Idempotent (the board dedups; we dispatch once). Mounted
// in the objective layout in minimal mode only.

import { useEffect, useRef } from "react";
import { deploySharpeningCard } from "./board-bus";

interface RankedItem {
  ambiguity_type?: string;
}

/** Short chip label from a ranked ambiguity's type ("Output format
 *  ambiguity" → "Output format"). */
function chipLabel(r: RankedItem): string {
  const t = (r?.ambiguity_type ?? "").replace(/ambiguity/i, "").trim();
  const label = t || "Ambiguity";
  return label.length > 24 ? label.slice(0, 23) + "…" : label;
}

export function PromptSharpeningMount({ spaceId }: { spaceId: string }) {
  const dispatched = useRef(false);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    // Poll until the artifact lands. The mount starts when the board loads —
    // BEFORE the user submits — and an Opus generation can take 30–60s, so a
    // short window would give up before it finishes, leaving the card stuck
    // on "Sharpening…". ~4 min covers typing + a slow generation; it stops
    // early the moment the artifact is ready.
    const MAX_TRIES = 120;

    async function tick() {
      if (cancelled || dispatched.current) return;
      tries += 1;
      try {
        const res = await fetch(
          `/api/objective/${spaceId}/prompt-sharpening`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const json = (await res.json()) as {
            status?: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            artifact?: any;
          };
          if (json.status === "ready" && json.artifact) {
            dispatched.current = true;
            const a = json.artifact;
            const ranked: RankedItem[] = Array.isArray(a.ranked_ambiguities)
              ? a.ranked_ambiguities
              : [];
            deploySharpeningCard({
              spaceId,
              title: a.distilled_title ?? "",
              sharpenedPrompt: a.sharpened_prompt ?? "",
              chips: ranked.slice(0, 3).map(chipLabel),
              heatmapJson: JSON.stringify(a.ambiguity_heatmap ?? {}),
              rankedJson: JSON.stringify(ranked),
              // Color omitted → the board materializer applies SHARPEN_COLOR
              // (single source of truth in prompt-sharpening-card-shape).
            });
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (!cancelled && tries < MAX_TRIES) {
        timer = setTimeout(tick, 2000);
      }
    }

    // Short initial delay so the board has mounted + restored first.
    timer = setTimeout(tick, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId]);

  return null;
}
