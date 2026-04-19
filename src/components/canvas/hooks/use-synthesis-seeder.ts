"use client";

import { useEffect, useRef } from "react";
import type { Editor, TLShapePartial } from "tldraw";
import { createShapeId } from "tldraw";
import type { Space, Entity } from "@/types";
import type { SynthesisCardShape } from "../shapes/types";

// Parses space.synthesis_data and seeds SynthesisCardShape instances near
// each source entity. Runs once per mount; idempotent via deterministic
// shape ids derived from kind + entity_id.

interface RichInsight {
  entity_id: string;
  summary?: string;
  reasoning?: string[];
}
interface RichLoop {
  name: string;
  explanation?: string;
  steps?: string[];
}
interface RichBridge {
  source_variable_name?: string;
  target_variable_name?: string;
  description?: string;
  source_entity_id?: string;
  target_entity_id?: string;
}

interface SynthesisDataLike {
  leverage_points?: RichInsight[];
  risk_points?: RichInsight[];
  feedback_loops?: RichLoop[];
  bridges?: RichBridge[];
}

function synthShapeId(kind: string, anchor: string) {
  return createShapeId(`synth-${kind}-${anchor}`);
}

export function useSynthesisSeeder(
  editor: Editor | null,
  opts: { space: Space; entities: Entity[]; enabled: boolean },
) {
  const seeded = useRef(false);

  useEffect(() => {
    if (!editor || !opts.enabled || seeded.current) return;

    const raw = opts.space.synthesis_data;
    if (!raw) {
      seeded.current = true;
      return;
    }

    let data: SynthesisDataLike;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : (raw as SynthesisDataLike);
    } catch {
      seeded.current = true;
      return;
    }

    // Build display_id → Entity lookup for anchoring
    const byDisplayId = new Map<string, Entity>();
    for (const e of opts.entities) byDisplayId.set(e.entity_id, e);

    const shapes: TLShapePartial<SynthesisCardShape>[] = [];
    const pendingBindings: Array<{ cardId: ReturnType<typeof createShapeId>; entityUuid: string }> = [];

    const placeNear = (uuid: string | undefined, offsetX: number, offsetY: number) => {
      if (!uuid) return null;
      const kgShapeId = createShapeId(`kg-${uuid}`);
      const kg = editor.getShape(kgShapeId);
      if (!kg) return null;
      const bounds = editor.getShapePageBounds(kgShapeId);
      if (!bounds) return null;
      return { x: bounds.maxX + offsetX, y: bounds.midY + offsetY - 80 };
    };

    const pushCard = (
      kind: SynthesisCardShape["props"]["kind"],
      anchor: string,
      title: string,
      body: string,
      entityUuid: string | undefined,
      sourceEntityIds: string[] = [],
      fallbackIndex = 0,
    ) => {
      const id = synthShapeId(kind, anchor);
      if (editor.getShape(id)) return; // already seeded

      let pos = entityUuid ? placeNear(entityUuid, 160, 0) : null;
      if (!pos) {
        // Nowhere to anchor — fall back to a vertical stack off to the right
        pos = { x: 2000, y: -400 + fallbackIndex * 200 };
      }

      shapes.push({
        id,
        type: "synthesis-card",
        x: pos.x,
        y: pos.y,
        props: {
          w: 280,
          h: 160,
          kind,
          title,
          body,
          sourceEntityIds,
        },
      });

      if (entityUuid) pendingBindings.push({ cardId: id, entityUuid });
    };

    let idx = 0;
    for (const lp of data.leverage_points ?? []) {
      const entity = byDisplayId.get(lp.entity_id);
      pushCard(
        "leverage",
        lp.entity_id,
        entity?.name ?? lp.entity_id,
        lp.summary ?? (lp.reasoning?.[0] ?? ""),
        entity?.id,
        entity ? [entity.id] : [],
        idx++,
      );
    }

    for (const rp of data.risk_points ?? []) {
      const entity = byDisplayId.get(rp.entity_id);
      pushCard(
        "risk",
        rp.entity_id,
        entity?.name ?? rp.entity_id,
        rp.summary ?? (rp.reasoning?.[0] ?? ""),
        entity?.id,
        entity ? [entity.id] : [],
        idx++,
      );
    }

    for (const loop of data.feedback_loops ?? []) {
      pushCard(
        "cycle",
        loop.name,
        loop.name,
        loop.explanation ?? (loop.steps ? loop.steps.slice(0, 3).join(" → ") : ""),
        undefined,
        [],
        idx++,
      );
    }

    for (const br of data.bridges ?? []) {
      const key = `${br.source_variable_name ?? "?"}-${br.target_variable_name ?? "?"}`;
      pushCard(
        "bridge",
        key,
        `${br.source_variable_name ?? "?"} ↔ ${br.target_variable_name ?? "?"}`,
        br.description ?? "",
        br.source_entity_id ?? undefined,
        [br.source_entity_id, br.target_entity_id].filter((x): x is string => typeof x === "string"),
        idx++,
      );
    }

    if (shapes.length > 0) {
      editor.createShapes(shapes);
    }

    seeded.current = true;
  }, [editor, opts.space, opts.entities, opts.enabled]);
}
