"use client";

// ── PromptSharpeningMount ──
//
// Headless DRIVER. After intake, this ensures the sharpening generation runs to
// completion — it polls the status route and, if the post-response generation
// stalled, fires one awaited POST to drive it. The route persists the artifact
// into synthesis_data.objective_canvas.prompt_sharpening — the seed's INTERNAL
// metadata (ambiguity heatmap, priority/optimization map, distilled prompt).
//
// S3 (OBJECTIVE_SEED_PLAN — no auto-export): it NO LONGER forks a board card or
// opens the Goal rail. The reasoning is sandboxed inside the seed; the objective
// card surfaces only the external deliverable. This mount just guarantees the
// internal metadata gets filled. Mounted once in the objective layout.

import { useEffect, useRef } from "react";

export function PromptSharpeningMount({ spaceId }: { spaceId: string }) {
  const done = useRef(false);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let pendingWithObjective = 0;
    let drove = false;
    // Poll until the artifact lands. Generation can take 10–30s; ~4 min covers
    // typing + a slow generation, stops early the moment it's ready.
    const MAX_TRIES = 120;

    // One-shot DETERMINISTIC drive — an AWAITED POST that can't be torn down,
    // so a stalled post-response generation still completes (idempotent server-
    // side). Fires once, after we've seen the objective set but no artifact.
    async function drive() {
      try {
        await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch {
        /* the GET poll remains the fallback */
      } finally {
        if (!cancelled) done.current = true; // generation driven → stop polling
      }
    }

    async function tick() {
      if (cancelled || done.current) return;
      tries += 1;
      try {
        const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as {
            status?: string;
            objectivePresent?: boolean;
          };
          if (json.status === "ready") {
            done.current = true; // artifact persisted internally → done
            return;
          }
          if (json.objectivePresent) {
            pendingWithObjective += 1;
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
