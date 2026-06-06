"use client";

// ── ObjectiveImageMount ──
//
// Headless. Polls the space's image attachments until each one's vision
// analysis has landed, then dispatches deployImageCard so WhiteboardBase
// materializes it as a card below the objective. Dedupes per image id.
// Mounted in the objective layout in minimal mode only.

import { useEffect, useRef } from "react";
import { deployImageCard } from "./board-bus";

interface ApiImage {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  entities: Array<{ name: string; type?: string }>;
  entityCount: number;
  analyzed: boolean;
  objectId?: string;
}

export function ObjectiveImageMount({ spaceId }: { spaceId: string }) {
  // Track imageFileId → last-seen objectId so we re-fire deployImageCard
  // when a backfill resolves the objectId on a poll AFTER the card already
  // landed. The deploy-side guard (deployImageCardOnBoard) idempotently
  // patches the existing shape's props.objectId.
  const deployedObjectId = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const MAX_TRIES = 20; // ~45s

    async function tick() {
      if (cancelled) return;
      tries += 1;
      let stop = false;
      try {
        const res = await fetch(`/api/objective/${spaceId}/images`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as { images?: ApiImage[] };
          const images = Array.isArray(json.images) ? json.images : [];
          let pending = false;
          let backfillPending = false;
          for (const img of images) {
            if (!img.analyzed) {
              pending = true;
              continue;
            }
            const newObjectId = img.objectId ?? "";
            const prevObjectId = deployedObjectId.current.get(img.id);
            if (prevObjectId !== undefined && (prevObjectId || !newObjectId)) {
              if (!prevObjectId && !newObjectId) backfillPending = true;
              continue;
            }
            deployedObjectId.current.set(img.id, newObjectId);
            deployImageCard({
              imageFileId: img.id,
              imageName: img.name,
              imageUrl: img.imageUrl,
              description: img.description ?? "",
              entityCount: img.entityCount ?? 0,
              entitiesJson: JSON.stringify(img.entities ?? []),
              objectId: newObjectId,
            });
            if (!newObjectId) backfillPending = true;
          }
          if (images.length > 0 && !pending && !backfillPending) stop = true;
        }
      } catch {
        /* transient — keep polling */
      }
      if (!cancelled && !stop && tries < MAX_TRIES) {
        timer = setTimeout(tick, 2200);
      }
    }

    timer = setTimeout(tick, 1600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId]);

  return null;
}
