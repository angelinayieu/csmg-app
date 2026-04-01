import type { Entity, Edge } from "@/types";
import { EntityBadge } from "./entity-badge";
import { EdgeLine } from "./edge-line";

interface AnalysisContentProps {
  entities: Entity[];
  edges: Edge[];
  entityMap: Map<string, Entity>;
}

export function AnalysisContent({ entities, edges, entityMap }: AnalysisContentProps) {
  // Get entity UUIDs for this tier to filter related edges
  const tierEntityIds = new Set(entities.map((e) => e.id));
  const relatedEdges = edges.filter(
    (edge) =>
      tierEntityIds.has(edge.source_entity_id) ||
      tierEntityIds.has(edge.target_entity_id)
  );

  return (
    <div className="space-y-4">
      {/* Entities grid */}
      <div className="grid gap-2 sm:grid-cols-2">
        {entities.map((entity) => (
          <EntityBadge key={entity.id} entity={entity} />
        ))}
      </div>

      {/* Related edges */}
      {relatedEdges.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">
            Relationships
          </h4>
          <div className="space-y-1">
            {relatedEdges.map((edge) => (
              <EdgeLine key={edge.id} edge={edge} entityMap={entityMap} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
