// ── Asset class registry (Phase A1.0) ──
//
// Single source of truth for which classes the library + drop handler
// know about. Each class lives in `library/classes/<name>.ts` and is
// imported here. Adding a 10th class = one new file + one import.
//
// The registry is order-sensitive: the order here determines the
// default tab order in the library drawer. Most-used first.

import type { AssetClass, AssetClassDefinition } from "./types";
import { entityAssetClass } from "./classes/entities";
import { reactionAssetClass } from "./classes/reactions";
import { strategyAssetClass } from "./classes/strategies";
import { appAssetClass } from "./classes/apps";
import { bridgeAssetClass } from "./classes/bridges";
import { cycleAssetClass } from "./classes/cycles";
import { claimAssetClass } from "./classes/claims";
import { axiomAssetClass } from "./classes/axioms";
import { convergentPointAssetClass } from "./classes/convergent-points";
import { intelligenceSignalAssetClass } from "./classes/intelligence-signals";
import { twinAssetClass } from "./classes/twins";
import { objectivesAssetClass } from "./classes/objectives";
import { sourcesAssetClass } from "./classes/sources";
import { filesAssetClass } from "./classes/files";
import { threadsAssetClass } from "./classes/threads";

/**
 * The full set of asset classes the library knows about. Order matters
 * — drives default tab order. Most-used → least-used.
 *
 * Adding a class:
 *   1. Create `library/classes/<name>.ts` with an `AssetClassDefinition`
 *   2. Import + push into this array
 *   3. If the class drops as a new tldraw shape type, register that
 *      shape util in `interaxis-canvas.tsx`'s `SHAPE_UTILS` array
 */
export const ASSET_CLASSES: AssetClassDefinition[] = [
  // Cast to the loose form so the array is heterogeneous-safe; concrete
  // typing is preserved per-file.
  entityAssetClass as unknown as AssetClassDefinition,
  reactionAssetClass as unknown as AssetClassDefinition,
  // Phase A1.2
  strategyAssetClass as unknown as AssetClassDefinition,
  appAssetClass as unknown as AssetClassDefinition,
  // Phase A1.3
  bridgeAssetClass as unknown as AssetClassDefinition,
  cycleAssetClass as unknown as AssetClassDefinition,
  // Phase A1.4a
  claimAssetClass as unknown as AssetClassDefinition,
  axiomAssetClass as unknown as AssetClassDefinition,
  // Phase A1.4b
  convergentPointAssetClass as unknown as AssetClassDefinition,
  intelligenceSignalAssetClass as unknown as AssetClassDefinition,
  // Phase A1.4c
  twinAssetClass as unknown as AssetClassDefinition,
  // Phase A1.7 — first class to populate the "views" section
  objectivesAssetClass as unknown as AssetClassDefinition,
  // Phase 2D — external inputs folder (data section, upstream of claims/axioms)
  sourcesAssetClass as unknown as AssetClassDefinition,
  // Phase 2D — files folder (ingested uploads + URLs + pasted text)
  filesAssetClass as unknown as AssetClassDefinition,
  // Phase 2D — threads folder (cross-canvas discussion inbox)
  threadsAssetClass as unknown as AssetClassDefinition,
];

/**
 * O(1) lookup keyed by class name. Built once at module load. Used by
 * the drop handler + drawer + context.
 */
export const ASSET_CLASS_BY_NAME: Record<string, AssetClassDefinition> =
  Object.fromEntries(ASSET_CLASSES.map((d) => [d.class, d]));

export function getAssetClass(
  name: string | AssetClass,
): AssetClassDefinition | undefined {
  return ASSET_CLASS_BY_NAME[name];
}
