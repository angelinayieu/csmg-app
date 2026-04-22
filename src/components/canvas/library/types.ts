// ── Universal Asset Catalog — types (Phase A1.0) ──
//
// The whiteboard's library used to be entity-only. A1 expands it to
// every meaningful object class in the dashboard system: entities,
// reactions, apps, strategies, axioms, claims, bridges, cycles,
// convergent points, intelligence signals, twins.
//
// One MIME envelope, one drop dispatcher, one registry. Adding a new
// class = one new file under `library/classes/`.

import type { LucideIcon } from "lucide-react";

/**
 * Every domain object class the library can surface. Strings are
 * intentionally short + lowercase + hyphenated where needed so they
 * appear cleanly in MIME payloads + tldraw shape types if reused.
 *
 * IMPORTANT: when adding a new class here, also add a registry entry
 * in `library/classes/<name>.ts` and import it into the registry.
 */
export type AssetClass =
  | "entity"
  | "reaction"
  | "app"
  | "strategy"
  | "axiom"
  | "claim"
  | "bridge"
  | "cycle"
  | "convergent-point"
  | "intelligence-signal"
  | "twin"
  | "objective"
  | "source"
  | "file"
  | "thread";

/**
 * Library sections (Phase A1.6). The drawer groups asset classes into
 * tiered sections by abstraction level. Matches the reference design
 * `VIEWS / GRAPHS / REASONING / EXPERIMENTS / DATA / PRIMITIVES /
 * TEMPLATES`. Order here is the default section order in the drawer.
 *
 * Not every group is populated yet — `views`, `experiments`, `primitives`,
 * `templates` are reserved for asset classes shipping in later phases.
 */
export type AssetClassGroup =
  | "views"
  | "graphs"
  | "reasoning"
  | "experiments"
  | "data"
  | "primitives"
  | "templates";

/**
 * Human-readable labels for the section headers. Kept next to the type
 * so anyone adding a new group edits one place.
 */
export const ASSET_CLASS_GROUP_LABEL: Record<AssetClassGroup, string> = {
  views: "Views",
  graphs: "Graphs",
  reasoning: "Reasoning",
  experiments: "Experiments",
  data: "Data",
  primitives: "Primitives",
  templates: "Templates",
};

/**
 * Drawer section order — lower number renders first. Kept here (not on
 * each class) so the sections themselves have a stable ordering even
 * when no classes in a group are registered yet.
 */
export const ASSET_CLASS_GROUP_ORDER: Record<AssetClassGroup, number> = {
  views: 0,
  graphs: 1,
  reasoning: 2,
  experiments: 3,
  data: 4,
  primitives: 5,
  templates: 6,
};

/**
 * The single MIME envelope for every library drag. The drop handler in
 * the canvas dispatches on `class` to the registered constructor.
 *
 * Backwards-compat note: the legacy entity-only MIME
 * (`application/x-interaxis-entity`) keeps working for one phase via a
 * compat branch in the canvas drop handler. Phase A1.5 removes that.
 */
export const LIBRARY_ASSET_MIME = "application/x-interaxis-asset";

export interface LibraryAssetPayload {
  class: AssetClass;
  /** Primary key in the source table for the class. */
  id: string;
  /** Source space — kept on the payload so cross-space drags remember origin. */
  spaceId: string;
  /** Minimal preview that lets a shape render even before its context loads. */
  preview: {
    title: string;
    subtitle?: string | null;
    /** Hex / CSS color the shape can use as a left rail / accent. */
    accent?: string | null;
  };
  /** Class-specific extras. Shape constructors interpret as they need. */
  extras?: Record<string, unknown>;
}

/**
 * One row in the library list. The drawer renders these without
 * knowing or caring which class they came from.
 */
export interface LibraryRow {
  /** Stable identity = `${class}:${id}`. */
  key: string;
  class: AssetClass;
  id: string;
  title: string;
  subtitle?: string | null;
  /** Right-aligned mini-stat (e.g. "72%", "active", "L2"). */
  stat?: string | null;
  /** Hex accent shown as left bar. */
  accent: string;
  /** Already placed on the current canvas — drawer renders a check. */
  isPlaced?: boolean;
  /** When provided, the row's "open" gesture goes here. Optional —
   *  drag is the primary verb. */
  href?: string | null;
}

/**
 * Filter primitive surfaced by a registry definition. Each filter has
 * a stable key, a label, an extractor (item → value), and optional
 * preset values. The drawer renders these as toggle chips per tab.
 *
 * Keep the type loose intentionally — every class has different
 * filter shapes (string enums, numeric ranges, booleans). The library
 * UI treats them uniformly.
 */
export interface LibraryFilterDef<T> {
  key: string;
  label: string;
  /** Returns the user-visible value(s) of the filter for a given item. */
  extract: (item: T) => string | string[] | boolean | null | undefined;
  /** Optional preset chip values. When omitted, values are inferred
   *  from the loaded items. */
  presets?: string[];
}

/**
 * Registry definition for one asset class. Lives in
 * `library/classes/<name>.ts`. Imported into the registry's
 * `ASSET_CLASSES` array.
 *
 * The shape util registration (passing the util into tldraw) happens
 * separately at the canvas root — the registry only carries the
 * SHAPE TYPE STRING so we can construct shapes via `editor.createShape`.
 */
export interface AssetClassDefinition<T = unknown> {
  /** The discriminator used in MIME payloads + registry lookups. */
  class: AssetClass;
  /** User-visible label for the tab and headers. */
  label: string;
  /** Plural label, e.g. "Reactions". Used for empty states / counts. */
  pluralLabel: string;
  /** Lucide icon for the tab + drag handle. */
  icon: LucideIcon;
  /** Hex accent color used in the library and the shape's left rail. */
  accent: string;
  /**
   * Drawer section this class lives under (Phase A1.6). The drawer
   * groups classes by `group` and sorts within a section by
   * `groupOrder` ascending. See `AssetClassGroup` for semantics.
   */
  group: AssetClassGroup;
  /**
   * Position within the section. Lower numbers render higher in the
   * section list. Ties break by class name alphabetically.
   */
  groupOrder: number;
  /** The tldraw shape type string this class drops as. Empty string
   *  means "not droppable yet" (placeholder while we wire the shape). */
  shapeType: string;
  /**
   * Lazy fetcher for one space's worth of items. Called once per
   * (spaceId, class) the first time someone needs it; cached in the
   * unified context.
   */
  fetchForSpace: (spaceId: string) => Promise<T[]>;
  /** Project an item to a uniform LibraryRow shape for the drawer. */
  toLibraryRow: (item: T, ctx: { spaceId: string; isPlaced: boolean }) => LibraryRow;
  /** Build the MIME payload to set on dragstart. */
  toDragPayload: (item: T, ctx: { spaceId: string }) => LibraryAssetPayload;
  /**
   * Construct the partial tldraw shape (without `id`/`x`/`y`) that
   * `editor.createShape` will use when this asset is dropped. Returning
   * null is allowed — the drop handler will warn and skip.
   */
  toShapeProps: (
    payload: LibraryAssetPayload,
  ) => null | {
    type: string;
    props: Record<string, unknown>;
    /** Default w/h. Drop handler centers the shape on the cursor. */
    w: number;
    h: number;
  };
  /**
   * Optional class-specific filter chips. Drawer renders one chip row
   * per filter; each chip toggles a value on/off.
   */
  filters?: Array<LibraryFilterDef<T>>;
  /**
   * For the catalog's "isPlaced" check — given an item, return the
   * stable identity the canvas uses to deduplicate. For entities this
   * is the entity id; for shapes whose tldraw id encodes the asset id
   * (e.g. `kg-${id}`), the helper translates.
   */
  shapeIdForItem?: (id: string) => string;
}

/**
 * Loose superclass — the catalog stores items as this type internally.
 * Class-specific code casts to the concrete shape via the registry.
 */
export type CatalogItem = Record<string, unknown> & { id: string };
