"use client";

// ── Canvas cascade-connector spawner ─────────────────────────────────
//
// B2 + B3 (operational whiteboard): once the artifact cards exist on
// the canvas, draw persistent arrows that show the operational
// cascade flow:
//
//   persona ──"served by"──▶ strategy-hero ──"materialized"──▶
//     twin-snapshot ──"drives"──▶ app-card
//
// Without these, the strategy/twin/app cards float as disconnected
// blocks. With them, the user reads the canvas as a flowchart of
// "who → what strategy → what twin → what apps run."
//
// Visuals: tldraw native elbow arrows, grey solid stroke, small
// labels on the strategy→twin and twin→app legs (the persona→strategy
// leg is unlabeled because there are typically 4+ personas — labels
// would clutter).
//
// Persistence: arrows are bound to their endpoint shapes via
// tldraw's binding API, so when the user drags a card the arrow
// follows automatically. Deterministic shape IDs gate duplicate
// creation across mounts and re-runs.
//
// Idempotency contract:
//   - Each arrow's ID is keyed on (source-shape-id, target-shape-id)
//   - If both endpoints exist and the arrow doesn't, create it
//   - If the arrow exists but an endpoint disappeared, leave it (tldraw
//     handles the orphaned-binding visual gracefully; cleanup is a
//     future C-track ticket)
//   - Re-running the effect doesn't duplicate

import { useEffect } from "react";
import {
  createShapeId,
  toRichText,
  useEditor,
  useValue,
  type TLArrowShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";

const SETTLE_MS = 700;

interface CascadeConnectorSpawnerProps {
  spaceId: string;
}

export function CanvasCascadeConnectorSpawner({
  spaceId,
}: CascadeConnectorSpawnerProps) {
  const editor = useEditor();

  // Subscribe to a coarse "artifact set changed" signal — the shape
  // kinds we connect: subject-card, strategy-hero-card, twin-snapshot,
  // mechanism-card, app-card. Mechanism cards are now part of the
  // fingerprint so the cascade re-routes through them when they exist
  // (twin → mechanism → app) and falls back to direct twin → app when
  // they don't (legacy strategies that pre-date the mechanism table).
  // Position changes don't matter — the bindings handle that
  // automatically — so we only re-run when the SET of artifact shapes
  // changes (one created, one deleted).
  const artifactFingerprint = useValue(
    "cascade-connector-fingerprint",
    () => {
      if (!editor) return "";
      const ids: string[] = [];
      for (const s of editor.getCurrentPageShapes()) {
        if (
          s.type === "subject-card" ||
          s.type === "strategy-hero-card" ||
          s.type === "twin-snapshot" ||
          s.type === "mechanism-card" ||
          s.type === "app-card"
        ) {
          ids.push(`${s.type}:${s.id}`);
        }
      }
      return ids.sort().join("|");
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    const t = window.setTimeout(() => {
      if (cancelled) return;
      try {
        ensureCascadeConnectors(editor, spaceId);
      } catch (err) {
        console.warn("[cascade-connector-spawner] ensure failed:", err);
      }
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [editor, spaceId, artifactFingerprint]);

  return null;
}

type AppShape = TLShape & {
  props: { appId?: string };
};
type MechanismShape = TLShape & {
  props: { mechanismId?: string };
};

function ensureCascadeConnectors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  spaceId: string,
) {
  // Categorize artifact shapes once.
  const subjects: TLShape[] = [];
  let strategyHero: TLShape | null = null;
  let twinSnapshot: TLShape | null = null;
  const mechanismCards: MechanismShape[] = [];
  const appCards: AppShape[] = [];

  for (const s of editor.getCurrentPageShapes() as TLShape[]) {
    if (s.type === "subject-card") subjects.push(s);
    else if (s.type === "strategy-hero-card") {
      // First wins — there should only ever be one hero card per space,
      // but if a duplicate slipped through pick the earliest by id for
      // stable wiring.
      if (!strategyHero || s.id < strategyHero.id) strategyHero = s;
    } else if (s.type === "twin-snapshot") {
      if (!twinSnapshot || s.id < twinSnapshot.id) twinSnapshot = s;
    } else if (s.type === "mechanism-card") {
      mechanismCards.push(s as MechanismShape);
    } else if (s.type === "app-card") {
      appCards.push(s as AppShape);
    }
  }

  // ── B2: persona → strategy-hero ────────────────────────────────────
  // One arrow per persona. Without a hero or any subjects, skip.
  if (strategyHero && subjects.length > 0) {
    for (const subject of subjects) {
      ensureArrow({
        editor,
        spaceId,
        fromShape: subject,
        toShape: strategyHero,
        slug: "persona-to-strategy",
        label: null, // unlabeled — multi-persona case clutters with labels
      });
    }
  }

  // ── B3a: strategy-hero → twin-snapshot ─────────────────────────────
  if (strategyHero && twinSnapshot) {
    ensureArrow({
      editor,
      spaceId,
      fromShape: strategyHero,
      toShape: twinSnapshot,
      slug: "strategy-to-twin",
      label: "materializes",
    });
  }

  // ── B3b/B3c: twin-snapshot → mechanism-card[] → app-card[] ─────────
  //
  // When mechanism cards exist on canvas, route the cascade THROUGH
  // them — this matches the real data model where apps.parent_mechanism_id
  // links each app to a mechanism, not directly to the twin. The
  // resulting layout reads as twin → mechanism → app, which is the
  // operational architecture the user actually wants to see.
  //
  // Fallback: when no mechanism cards exist (legacy spaces approved
  // before the mechanisms table landed, OR mechanisms still loading),
  // draw twin → app arrows directly as before. The fingerprint watcher
  // re-runs this function once the mechanism cards appear, which then
  // creates the through-mechanism arrows alongside the direct ones.
  // The direct arrows aren't cleaned up automatically — that's
  // intentional, since deleting an existing arrow could trample user
  // arrangements. A future cleanup pass (see C-track) can prune
  // redundant direct arrows when through-mechanism routing supersedes
  // them.
  if (twinSnapshot && mechanismCards.length > 0) {
    // twin → mechanism
    for (const mech of mechanismCards) {
      ensureArrow({
        editor,
        spaceId,
        fromShape: twinSnapshot,
        toShape: mech,
        slug: "twin-to-mechanism",
        label: null, // multi-mechanism case — labels would clutter
      });
    }

    // mechanism → app, routed by parent_mechanism_id when available.
    // The app-card shape carries appId but NOT parent_mechanism_id in
    // its props (the shape was authored before mechanisms existed), so
    // we can't infer the mechanism→app edges from canvas state alone.
    // Until app-card carries parentMechanismId, draw an arrow from
    // EACH mechanism to EACH app — this gives a visually rich "twin
    // operationalizes through these mechanisms which manage these
    // apps" but doesn't claim a specific app belongs to a specific
    // mechanism. When app-card adds the parent prop (small follow-up),
    // the loop below can filter by it for surgical routing.
    if (appCards.length > 0) {
      for (const mech of mechanismCards) {
        for (const app of appCards) {
          ensureArrow({
            editor,
            spaceId,
            fromShape: mech,
            toShape: app,
            slug: "mechanism-to-app",
            label: null,
          });
        }
      }
    }
  } else if (twinSnapshot && appCards.length > 0) {
    // Fallback (legacy): twin → app directly.
    for (const app of appCards) {
      ensureArrow({
        editor,
        spaceId,
        fromShape: twinSnapshot,
        toShape: app,
        slug: "twin-to-app",
        label: null,
      });
    }
  }
}

interface EnsureArrowArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
  spaceId: string;
  fromShape: TLShape;
  toShape: TLShape;
  slug: string;
  label: string | null;
}

function ensureArrow(args: EnsureArrowArgs) {
  const { editor, spaceId, fromShape, toShape, slug, label } = args;

  // Deterministic id keyed on source + target shape ids — survives
  // mounts, prevents duplicates, follows tldraw's persistence cycle.
  const arrowId = createShapeId(
    `cascade-arrow-${spaceId}-${slug}-${fromShape.id}-${toShape.id}`,
  );

  if (editor.getShape(arrowId)) {
    // Already exists — bindings handle position tracking automatically,
    // nothing to do.
    return;
  }

  try {
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        size: "s",
        font: "sans",
        labelColor: "grey",
        dash: "solid",
        kind: "elbow",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        ...(label ? { richText: toRichText(label) } : {}),
      },
      meta: { source: "cascade-connector", slug },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromShape.id as TLShapeId,
        type: "arrow",
        props: {
          terminal: "start",
          // Connect from bottom-center of the source so the elbow routing
          // pulls the arrow downward into the next tier of the cascade.
          normalizedAnchor: { x: 0.5, y: 1 },
          isExact: false,
          isPrecise: true,
        },
        meta: {},
      },
      {
        fromId: arrowId,
        toId: toShape.id as TLShapeId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0 },
          isExact: false,
          isPrecise: true,
        },
        meta: {},
      },
    ]);
    // Send to back so the arrow doesn't occlude card content; the
    // cards' z-order remains the visual priority.
    editor.sendToBack([arrowId]);
  } catch (err) {
    console.warn(
      `[cascade-connector-spawner] failed to create ${slug} arrow:`,
      err,
    );
  }
}
