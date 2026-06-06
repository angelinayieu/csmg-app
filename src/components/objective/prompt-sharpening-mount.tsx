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
import { OPEN_BOARD_GOAL_EVENT } from "./canvas-interactions/goal-ranking-sidebar";

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
  const openedRail = useRef(false);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let pendingWithObjective = 0;
    let drove = false;
    // Poll until the artifact lands. The mount starts when the board loads —
    // BEFORE the user submits — and generation can take 10–30s, so a short
    // window would give up before it finishes, leaving the card stuck on
    // "Sharpening…". ~4 min covers typing + a slow generation; it stops early
    // the moment the artifact is ready.
    const MAX_TRIES = 120;

    function deploy(a: any) {
      if (dispatched.current) return;
      dispatched.current = true;
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
    }

    // One-shot DETERMINISTIC drive. The intake routes generate via after()
    // (post-response), which the platform can still cut short; an AWAITED POST
    // here keeps the function alive for the whole generation (its open request
    // can't be torn down) and is idempotent server-side (force only on a new
    // objective). Fires once, only after we've seen the objective is set but no
    // artifact landed — so a stuck generation recovers in ~6s, not ~4 min.
    async function drive() {
      try {
        const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!cancelled && res.ok) {
          const json = (await res.json()) as {
            status?: string;
            artifact?: any;
          };
          if (json.status === "ready" && json.artifact) deploy(json.artifact);
        }
      } catch {
        /* the GET poll remains the fallback */
      }
    }

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
            objectivePresent?: boolean;
            artifact?: any;
          };
          if (json.status === "ready" && json.artifact) {
            deploy(json.artifact);
            return;
          }
          if (json.objectivePresent) {
            pendingWithObjective += 1;
            // FRESH intake (objective set, artifact still generating) → open the
            // Goal rail so the user watches it work: the title lands fast, the
            // clarity metrics fill as they generate. We're in the not-ready
            // branch (ready short-circuits above + returns), so this never fires
            // on a returning board whose artifact already exists.
            if (!openedRail.current && typeof window !== "undefined") {
              openedRail.current = true;
              window.dispatchEvent(new CustomEvent(OPEN_BOARD_GOAL_EVENT));
            }
            // ~3 polls (~6s) with an objective set but no artifact ⇒ the
            // post-response generation didn't land — drive it once, awaited.
            if (!drove && pendingWithObjective >= 3) {
              drove = true;
              void drive();
            }
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
