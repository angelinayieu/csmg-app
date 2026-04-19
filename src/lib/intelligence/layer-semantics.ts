/**
 * Layer Semantics — Centralized Knowledge Layer Classification
 *
 * Replaces scattered `=== "internal"` and `!== "external"` checks with
 * semantic helpers that correctly handle the 4-value knowledge_layer enum:
 *   "internal"    — KG 1: User Assets (from decomposition, user input)
 *   "conceptual"  — KG 2: Concept Model (from expansion materialization)
 *   "external"    — KG 3: Deep Research (from research pipelines)
 *   "bridge"      — Cross-layer connections
 *
 * All layer filters should use these helpers instead of raw string comparisons
 * to ensure new layer values are handled correctly.
 */

import type { KnowledgeLayer, LayerProfile } from "@/types/layer";

// ── Layer Sets ──

/** All layers that represent the user's system (KG 1 + KG 2) */
export const USER_SYSTEM_LAYERS: ReadonlySet<string> = new Set([
  "internal",
  "conceptual",
]);

/** All layers that should be included in structural analysis (excludes external) */
export const ANALYZABLE_LAYERS: ReadonlySet<string> = new Set([
  "internal",
  "conceptual",
  "bridge",
]);

/** All valid knowledge layer values */
export const ALL_LAYERS: ReadonlySet<string> = new Set([
  "internal",
  "conceptual",
  "external",
  "bridge",
]);

// ── Layer Predicates ──

/** True for user-created entities (KG 1: decomposition, user input, chat) */
export function isUserLayer(layer: string | null | undefined): boolean {
  return (layer ?? "internal") === "internal";
}

/** True for system-derived conceptual entities (KG 2: expansion sub-components) */
export function isConceptualLayer(layer: string | null | undefined): boolean {
  return layer === "conceptual";
}

/** True for KG 1 or KG 2 (the user's system, including derived mechanisms) */
export function isUserOrConceptualLayer(
  layer: string | null | undefined
): boolean {
  return USER_SYSTEM_LAYERS.has(layer ?? "internal");
}

/** True for everything except external research (KG 1 + KG 2 + bridges) */
export function isAnalyzableLayer(
  layer: string | null | undefined
): boolean {
  return ANALYZABLE_LAYERS.has(layer ?? "internal");
}

/** True for external research entities (KG 3) */
export function isExternalLayer(layer: string | null | undefined): boolean {
  return layer === "external";
}

/** True for cross-layer bridge edges */
export function isBridgeLayer(layer: string | null | undefined): boolean {
  return layer === "bridge";
}

// ── Display Helpers ──

/** Human-readable label for a knowledge layer */
export function getLayerLabel(layer: string | null | undefined): string {
  switch (layer) {
    case "internal":
      return "User Assets";
    case "conceptual":
      return "Concept Model";
    case "external":
      return "Research";
    case "bridge":
      return "Bridge";
    default:
      return "Unknown";
  }
}

/** Short label for inline tags */
export function getLayerTag(layer: string | null | undefined): string {
  switch (layer) {
    case "internal":
      return "INT";
    case "conceptual":
      return "CON";
    case "external":
      return "EXT";
    case "bridge":
      return "BRG";
    default:
      return "?";
  }
}

/** CSS-safe color key for a layer */
export function getLayerColorKey(
  layer: string | null | undefined
): "indigo" | "teal" | "amber" | "green" | "gray" {
  switch (layer) {
    case "internal":
      return "indigo";
    case "conceptual":
      return "teal";
    case "external":
      return "amber";
    case "bridge":
      return "green";
    default:
      return "gray";
  }
}

// ── Cross-Layer Helpers ──

/** Determine if two layers constitute a cross-layer connection */
export function isCrossLayer(
  layerA: string | null | undefined,
  layerB: string | null | undefined
): boolean {
  const a = layerA ?? "internal";
  const b = layerB ?? "internal";
  return a !== b;
}

/** Build a LayerProfile from two entity layers */
export function buildLayerProfile(
  sourceLayer: string | null | undefined,
  targetLayer: string | null | undefined
): LayerProfile {
  const src = (sourceLayer ?? "internal") as KnowledgeLayer;
  const tgt = (targetLayer ?? "internal") as KnowledgeLayer;
  const layers = [...new Set([src, tgt])] as KnowledgeLayer[];
  return {
    source_layer: src,
    target_layer: tgt,
    is_cross_layer: src !== tgt,
    layers_involved: layers,
  };
}

/** Format a cross-layer pair key (canonical order for dedup) */
export function crossLayerKey(
  layerA: string,
  layerB: string
): string {
  const sorted = [layerA, layerB].sort();
  return `${sorted[0]}↔${sorted[1]}`;
}
