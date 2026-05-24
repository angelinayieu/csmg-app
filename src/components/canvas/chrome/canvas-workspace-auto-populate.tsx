"use client";

// ── CanvasWorkspaceAutoPopulate (universal-canvas Phase C, Step 1) ──
//
// On the user's first ever open of their workspace canvas, materialize
// their existing brainstorms + strategies as WorkspaceRoomShape rooms
// in a clean grid so the canvas honours the homepage pill's promise
// — "every brainstorm, strategy, R&D space, and twin you've made
// lives here as a room you can compose" — instead of greeting them
// with a blank screen.
//
// Idempotent against /api/workspace/auto-populate, which stores
// reasoning_settings.auto_populated_at. The flag is server-side so
// it survives across devices: a user opening their workspace from a
// second machine still sees ALL their work without a re-seed.
//
// Layout: brainstorms in a top row, strategies in a bottom row,
// horizontally centered around origin, capped at MAX_PER_ROW each so
// the initial impression isn't a wall of cards. Provenance arrows
// auto-draw between each strategy and its source brainstorm using
// the same dashed-elbow vocabulary the manual spawner uses (kept
// in-sync visually).
//
// Mounts ONLY on workspace canvases (gated by isWorkspace in
// interaxis-canvas-overlays.tsx). Returns null — pure side-effect.

import { useEffect } from "react";
import {
  createShapeId,
  toRichText,
  useEditor,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import {
  WORKSPACE_ROOM_DEFAULT_H,
  WORKSPACE_ROOM_DEFAULT_W,
} from "@/components/canvas/shapes/workspace-room-shape";

interface BrainstormItem {
  id: string;
  title: string;
  updated_at: string;
}

interface StrategyItem {
  id: string;
  statement: string | null;
  session_id: string;
  updated_at: string;
}

interface SpaceItem {
  id: string;
  name: string | null;
  digital_twin_state:
    | "not_started"
    | "ready"
    | "active"
    | "retired"
    | null;
  updated_at: string;
}

const ROOM_W = WORKSPACE_ROOM_DEFAULT_W;
const ROOM_H = WORKSPACE_ROOM_DEFAULT_H;
const COL_GAP = 40;
const ROW_GAP = 80;
const MAX_PER_ROW = 6;

export function CanvasWorkspaceAutoPopulate({ spaceId }: { spaceId: string }) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    (async () => {
      // 1 — idempotency. Originally a server-side cache check against
      // /api/workspace/auto-populate, but that endpoint never shipped:
      // every fetch 404'd, the default `populated = true` short-
      // circuited, and seeding silently never ran. New workspace
      // canvases stayed blank.
      //
      // The fix is two-layered:
      //   • Client-side: if ANY workspace-room shape already exists on
      //     the canvas, this workspace has been seeded once before, so
      //     skip. This is the durable signal — the shapes are part of
      //     the tldraw document, persisted via the canvas autosave, so
      //     they survive remounts.
      //   • Server-side (forward-compat): we STILL try the GET, and
      //     respect a `populated: true` response if the endpoint is
      //     created later. The default flips from `true` to `false`
      //     so a 404 (or any non-ok response) falls through to seeding
      //     instead of skipping it.
      const existingWorkspaceRooms = editor
        .getCurrentPageShapes()
        .some((s) => s.type === "workspace-room");
      if (existingWorkspaceRooms) return;

      let populated = false;
      try {
        const res = await fetch(
          `/api/workspace/auto-populate?spaceId=${encodeURIComponent(spaceId)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const json = (await res.json()) as { populated: boolean };
          populated = json.populated;
        }
        // Non-ok (incl. 404) → leave populated=false → proceed to seed.
      } catch {
        // Network blip — leave populated=false; the client-side
        // shape-existence guard above is the safety net.
      }
      if (cancelled || populated) return;

      // 2 — fetch user's brainstorms + strategies + spaces in parallel.
      // Spaces tab feeds BOTH the R&D Space row and the Twin row — twin
      // is a projection of a space (digital_twin_state in ready/active)
      // rather than its own table. Splitting client-side avoids a second
      // round-trip and matches the picker's classification at
      // canvas-workspace-room-picker.tsx.
      const [bRes, sRes, spRes] = await Promise.all([
        fetch("/api/synergy/sessions", { cache: "no-store" }).catch(() => null),
        fetch("/api/synergy/strategies", { cache: "no-store" }).catch(
          () => null,
        ),
        fetch("/api/spaces/list", { cache: "no-store" }).catch(() => null),
      ]);
      if (cancelled) return;

      const brainstorms: BrainstormItem[] =
        bRes && bRes.ok
          ? ((await bRes.json()) as { sessions?: BrainstormItem[] }).sessions ??
            []
          : [];
      const strategies: StrategyItem[] =
        sRes && sRes.ok
          ? ((await sRes.json()) as { strategies?: StrategyItem[] })
              .strategies ?? []
          : [];
      const allSpaces: SpaceItem[] =
        spRes && spRes.ok
          ? ((await spRes.json()) as { spaces?: SpaceItem[] }).spaces ?? []
          : [];
      if (cancelled) return;

      // Split spaces into Twin (digital_twin_state ready/active) vs
      // R&D Space (the rest). Each artifact gets exactly one room —
      // spawning both a "space" room and a "twin" room for the same
      // underlying spaces.id would be confusing and stack two rooms
      // on top of each other.
      const twins = allSpaces.filter(
        (s) =>
          s.digital_twin_state === "ready" || s.digital_twin_state === "active",
      );
      const rdSpaces = allSpaces.filter(
        (s) =>
          s.digital_twin_state !== "ready" && s.digital_twin_state !== "active",
      );

      const brainstormsCapped = brainstorms.slice(0, MAX_PER_ROW);
      const strategiesCapped = strategies.slice(0, MAX_PER_ROW);
      const rdSpacesCapped = rdSpaces.slice(0, MAX_PER_ROW);
      const twinsCapped = twins.slice(0, MAX_PER_ROW);

      // 3 — nothing to populate: still mark done so the flag flips
      // and we don't retry every mount.
      if (
        brainstormsCapped.length === 0 &&
        strategiesCapped.length === 0 &&
        rdSpacesCapped.length === 0 &&
        twinsCapped.length === 0
      ) {
        void markPopulated(spaceId);
        return;
      }

      // 4 — compute row layout. Centered around x=0. Up to 4 rows
      // (brainstorm / strategy / R&D space / twin) stacked vertically
      // in the picker's order. Empty rows are skipped so the user
      // doesn't see visible empty bands between rows.
      const layoutRow = (count: number) => {
        if (count === 0) return { startX: 0 };
        const totalW = count * ROOM_W + (count - 1) * COL_GAP;
        return { startX: -totalW / 2 };
      };
      const bLayout = layoutRow(brainstormsCapped.length);
      const sLayout = layoutRow(strategiesCapped.length);
      const rdLayout = layoutRow(rdSpacesCapped.length);
      const tLayout = layoutRow(twinsCapped.length);

      // Build a presence list to compute per-row Y centered around 0.
      const rowsPresent = [
        brainstormsCapped.length > 0,
        strategiesCapped.length > 0,
        rdSpacesCapped.length > 0,
        twinsCapped.length > 0,
      ];
      const presentCount = rowsPresent.filter(Boolean).length;
      const totalH = presentCount * ROOM_H + (presentCount - 1) * ROW_GAP;
      const topY = -totalH / 2;
      // Compute Y for each row in declaration order, skipping rows
      // with zero items so we don't leave visible empty bands.
      const yForRow = (i: number) => {
        let y = topY;
        for (let k = 0; k < i; k++) {
          if (rowsPresent[k]) y += ROOM_H + ROW_GAP;
        }
        return y;
      };
      const brainstormY = yForRow(0);
      const strategyY = yForRow(1);
      const rdSpaceY = yForRow(2);
      const twinY = yForRow(3);

      // 5 — build all shape partials in one batch so the user sees
      // them appear together rather than streaming in.
      const shapes: TLShapePartial[] = [];
      const brainstormShapeId = new Map<string, TLShapeId>();
      const strategyShapeId = new Map<string, TLShapeId>();
      const now = Date.now();

      brainstormsCapped.forEach((b, i) => {
        const id = createShapeId();
        brainstormShapeId.set(b.id, id);
        shapes.push({
          id,
          type: "workspace-room",
          x: bLayout.startX + i * (ROOM_W + COL_GAP),
          y: brainstormY,
          props: {
            w: ROOM_W,
            h: ROOM_H,
            kind: "brainstorm",
            artifact_id: b.id,
            cached_title: b.title ?? "",
            spawnedAt: now,
            expanded: false,
          },
        });
      });

      strategiesCapped.forEach((s, i) => {
        const id = createShapeId();
        strategyShapeId.set(s.id, id);
        shapes.push({
          id,
          type: "workspace-room",
          x: sLayout.startX + i * (ROOM_W + COL_GAP),
          y: strategyY,
          props: {
            w: ROOM_W,
            h: ROOM_H,
            kind: "strategy",
            artifact_id: s.id,
            cached_title: s.statement ?? "",
            spawnedAt: now,
            expanded: false,
          },
        });
      });

      rdSpacesCapped.forEach((sp, i) => {
        const id = createShapeId();
        shapes.push({
          id,
          type: "workspace-room",
          x: rdLayout.startX + i * (ROOM_W + COL_GAP),
          y: rdSpaceY,
          props: {
            w: ROOM_W,
            h: ROOM_H,
            kind: "space",
            artifact_id: sp.id,
            cached_title: sp.name ?? "",
            spawnedAt: now,
            expanded: false,
          },
        });
      });

      twinsCapped.forEach((tw, i) => {
        const id = createShapeId();
        shapes.push({
          id,
          type: "workspace-room",
          x: tLayout.startX + i * (ROOM_W + COL_GAP),
          y: twinY,
          props: {
            w: ROOM_W,
            h: ROOM_H,
            kind: "twin",
            // Twin === space (twin is a projection); artifact_id is the
            // underlying spaces.id so the room navigates to the twin
            // surface via /app/space/:id/twin.
            artifact_id: tw.id,
            cached_title: tw.name ?? "",
            spawnedAt: now,
            expanded: false,
          },
        });
      });

      try {
        editor.createShapes(shapes);
      } catch (err) {
        console.warn("[workspace-auto-populate] createShapes failed:", err);
        return;
      }

      // 6 — provenance arrows: every strategy with a session_id that
      // matches a brainstorm we just spawned gets a dashed elbow arrow
      // (same vocabulary as the manual spawner's drawProvenanceArrow).
      const arrows: TLShapePartial<TLArrowShape>[] = [];
      const bindings: Array<{
        fromId: TLShapeId;
        toId: TLShapeId;
        terminal: "start" | "end";
        anchorX: number;
      }> = [];

      for (const s of strategiesCapped) {
        const fromId = brainstormShapeId.get(s.session_id);
        const toId = strategyShapeId.get(s.id);
        if (!fromId || !toId) continue;
        const arrowId = createShapeId();
        arrows.push({
          id: arrowId,
          type: "arrow",
          props: {
            color: "grey",
            size: "s",
            font: "sans",
            dash: "dashed",
            kind: "elbow",
            arrowheadStart: "none",
            arrowheadEnd: "arrow",
            richText: toRichText(""),
          },
          meta: {
            workspaceProvenance: { from: fromId, to: toId },
          },
        });
        bindings.push({ fromId: arrowId, toId: fromId, terminal: "start", anchorX: 1 });
        bindings.push({ fromId: arrowId, toId: toId, terminal: "end", anchorX: 0 });
      }

      if (arrows.length > 0) {
        try {
          editor.createShapes(arrows);
          editor.createBindings(
            bindings.map((b) => ({
              fromId: b.fromId,
              toId: b.toId,
              type: "arrow",
              props: {
                terminal: b.terminal,
                normalizedAnchor: { x: b.anchorX, y: 0.5 },
                isExact: false,
                isPrecise: false,
              },
              meta: {},
            })),
          );
        } catch (err) {
          console.warn(
            "[workspace-auto-populate] arrow creation failed:",
            err,
          );
        }
      }

      // 7 — frame everything so the user sees the whole layout.
      try {
        editor.zoomToFit({ animation: { duration: 600 } });
      } catch {
        // tldraw can throw on zoomToFit if no shapes exist yet on
        // the page; safe to ignore — we just created shapes.
      }

      // 8 — mark as populated. Fire-and-forget; a failure here just
      // means the user might see a re-seed on next mount, which is
      // fine (createShapes is idempotent on the same artifact_id).
      void markPopulated(spaceId);
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, spaceId]);

  return null;
}

async function markPopulated(spaceId: string): Promise<void> {
  try {
    await fetch(`/api/workspace/auto-populate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId }),
    });
  } catch {
    // soft-fail; see comment at call site.
  }
}
