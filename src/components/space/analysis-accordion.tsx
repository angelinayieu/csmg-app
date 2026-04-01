"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity, Edge, Cycle, Proposition } from "@/types";
import { AnalysisContent } from "./analysis-content";
import { CycleCard } from "./cycle-card";

interface AnalysisAccordionProps {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  propositions: Proposition[];
}

export function AnalysisAccordion({
  entities,
  edges,
  cycles,
  propositions,
}: AnalysisAccordionProps) {
  // Group entities by layer
  const layers = new Map<string, Entity[]>();
  for (const entity of entities) {
    const layer = entity.layer ?? "uncategorized";
    if (!layers.has(layer)) {
      layers.set(layer, []);
    }
    layers.get(layer)!.push(entity);
  }

  // Build entity UUID lookup map for edge display
  const entityMap = new Map<string, Entity>();
  for (const entity of entities) {
    entityMap.set(entity.id, entity);
  }

  const layerEntries = Array.from(layers.entries());
  const [openTiers, setOpenTiers] = useState<Set<string>>(
    new Set(layerEntries.length > 0 ? [layerEntries[0][0]] : [])
  );

  function toggleTier(layer: string) {
    setOpenTiers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }

  const formatLayerName = (layer: string) =>
    layer
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      {/* Entity tiers */}
      {layerEntries.length === 0 ? (
        <p className="text-sm text-gray-500">No structured entities found.</p>
      ) : (
        <div className="space-y-2">
          {layerEntries.map(([layer, layerEntities]) => {
            const isOpen = openTiers.has(layer);
            return (
              <div
                key={layer}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden"
              >
                <button
                  onClick={() => toggleTier(layer)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <Layers className="h-4 w-4 text-interaxis-500" />
                  <span className="flex-1 font-medium text-gray-800">
                    {formatLayerName(layer)}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {layerEntities.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-gray-400 transition-transform duration-200",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-gray-100 px-4 py-4">
                        <AnalysisContent
                          entities={layerEntities}
                          edges={edges}
                          entityMap={entityMap}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Cycles section */}
      {cycles.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Feedback Cycles
          </h3>
          <div className="space-y-3">
            {cycles.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </div>
      )}

      {/* Propositions section */}
      {propositions.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Propositions
          </h3>
          <div className="space-y-2">
            {propositions.map((prop) => (
              <div
                key={prop.id}
                className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2"
              >
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-medium text-gray-500">
                  {prop.proposition_id}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{prop.statement}</p>
                  <span className="text-[10px] uppercase tracking-wider text-gray-400">
                    {prop.proposition_type} · confidence{" "}
                    {Math.round(prop.confidence * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
