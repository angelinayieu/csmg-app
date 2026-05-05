"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { createShapeId } from "tldraw";
import type { Edge, Entity } from "@/types";
import type { KGNodeShape } from "../shapes/types";
import type { ExternalExpandApi } from "../contexts/external-expand-context";

const CHILD_FAN_SPACING = 240;
const CHILD_DROP = 80;
const CHILD_W = 200;
const CHILD_H = 96;

function alternatingOffset(index: number, spacing: number): number {
  if (index === 0) return 0;
  const half = Math.ceil(index / 2);
  return (index % 2 === 1 ? half : -half) * spacing;
}

export function useExternalExpandController(
  editor: Editor | null,
  entities: Entity[],
  edges: Edge[],
): ExternalExpandApi {
  // Build parent → children map from has_component edges.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Entity[]>();
    const entityById = new Map(entities.map((e) => [e.id, e]));
    for (const ed of edges) {
      if (ed.relationship_type !== "has_component") continue;
      const child = entityById.get(ed.target_entity_id);
      if (!child) continue;
      const list = map.get(ed.source_entity_id) ?? [];
      list.push(child);
      map.set(ed.source_entity_id, list);
    }
    return map;
  }, [entities, edges]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Created shape ids per parent — used to delete on collapse.
  const shapesByParent = useRef(new Map<string, TLShapeId[]>());
  // Once-per-canvas scan: any kg-node shape already on canvas whose
  // entityId matches a known has_component child should be adopted into
  // the tracking map so the parent's chip reads "Hide parts" instead of
  // duplicating the children on next click. Re-runs when the parent set
  // grows (new entities loaded mid-session) but the adoptedRef guards
  // against re-processing already-adopted parents.
  const adoptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!editor) return;
    if (childrenByParent.size === 0) return;
    const shapes = editor.getCurrentPageShapes();
    const shapesByEntityId = new Map<string, TLShapeId>();
    for (const s of shapes) {
      if (s.type !== "kg-node") continue;
      const eid = (s.props as KGNodeShape["props"]).entityId;
      if (eid) shapesByEntityId.set(eid, s.id);
    }
    const newlyAdopted: string[] = [];
    for (const [parentEntityId, children] of childrenByParent) {
      if (adoptedRef.current.has(parentEntityId)) continue;
      const parentShapeId = shapesByEntityId.get(parentEntityId);
      if (!parentShapeId) continue;
      const childShapeIds: TLShapeId[] = [];
      for (const child of children) {
        const sid = shapesByEntityId.get(child.id);
        if (sid) childShapeIds.push(sid);
      }
      if (childShapeIds.length === 0) continue;
      shapesByParent.current.set(parentEntityId, childShapeIds);
      adoptedRef.current.add(parentEntityId);
      newlyAdopted.push(parentEntityId);
    }
    if (newlyAdopted.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const id of newlyAdopted) next.add(id);
        return next;
      });
    }
  }, [editor, childrenByParent]);

  const hasChildren = useCallback(
    (entityId: string) => (childrenByParent.get(entityId)?.length ?? 0) > 0,
    [childrenByParent],
  );

  const isExpanded = useCallback(
    (entityId: string) => expanded.has(entityId),
    [expanded],
  );

  const collapse = useCallback(
    (entityId: string, draft: Set<string>) => {
      // Recursively collapse any expanded descendants so we don't orphan
      // their shapes when the parent disappears.
      const childIds = (childrenByParent.get(entityId) ?? []).map((c) => c.id);
      for (const cid of childIds) {
        if (draft.has(cid)) collapse(cid, draft);
      }
      const ids = shapesByParent.current.get(entityId) ?? [];
      if (editor && ids.length > 0) {
        try {
          editor.deleteShapes(ids);
        } catch {
          /* shape may already be gone — ignore */
        }
      }
      shapesByParent.current.delete(entityId);
      draft.delete(entityId);
    },
    [childrenByParent, editor],
  );

  const toggle = useCallback(
    (entityId: string) => {
      if (!editor) return;
      if (expanded.has(entityId)) {
        const draft = new Set(expanded);
        collapse(entityId, draft);
        setExpanded(draft);
        return;
      }

      const children = childrenByParent.get(entityId) ?? [];
      if (children.length === 0) return;

      const parentShape = editor
        .getCurrentPageShapes()
        .find(
          (s) =>
            s.type === "kg-node" &&
            (s.props as KGNodeShape["props"]).entityId === entityId,
        );
      if (!parentShape) return;

      const bounds = editor.getShapePageBounds(parentShape.id);
      if (!bounds) return;

      const cx = bounds.midX;
      const baseY = bounds.maxY + CHILD_DROP;

      const newIds: TLShapeId[] = [];
      children.forEach((child, idx) => {
        const x = cx + alternatingOffset(idx, CHILD_FAN_SPACING) - CHILD_W / 2;
        const y = baseY;
        const sid = createShapeId();
        try {
          editor.createShape<KGNodeShape>({
            id: sid,
            type: "kg-node",
            x,
            y,
            props: {
              w: CHILD_W,
              h: CHILD_H,
              entityId: child.id,
              name: child.name.slice(0, 80),
              description: child.description ?? "",
              tier: "peripheral",
              isExternal: true,
              isGhost: true,
            },
          });
          newIds.push(sid);
        } catch (err) {
          console.warn("[external-expand] createShape failed", err);
        }
      });

      shapesByParent.current.set(entityId, newIds);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(entityId);
        return next;
      });
    },
    [editor, expanded, childrenByParent, collapse],
  );

  return useMemo(
    () => ({ hasChildren, isExpanded, toggle }),
    [hasChildren, isExpanded, toggle],
  );
}
