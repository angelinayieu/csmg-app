"use client";

import { useMemo, useState, useCallback } from "react";
import type { Entity, Edge, Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type {
  InteractionMetadata,
  StrategicCorridor,
  TensionZone,
  FieldIntersection,
  InteractionField,
} from "@/types/interactions";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Route,
  Swords,
  Layers,
  Radio,
  Eye,
  Zap,
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Shield,
  Gauge,
  Radar,
  ChevronUp,
} from "lucide-react";

// ── Props ──

export interface MechanismIntelligenceProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  synthesisData: SynthesisData | null;
  onEntityClick?: (entity: Entity) => void;
}

// ── Hidden signal shape (from research agent, stored in synthesis_data JSONB) ──

interface HiddenSignal {
  signal_name: string;
  signal_type:
    | "mediating_variable"
    | "analogous_dynamic"
    | "structural_risk"
    | "missing_metric";
  description: string;
  trajectory_impact: number;
  related_internal_entities?: string[];
  detection_method: string;
  analogous_precedent?: string | null;
  discovered_at?: string;
}

// ── Helpers ──

const POLARITY_COLORS = {
  enabling: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", bar: "bg-emerald-500" },
  constraining: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", bar: "bg-red-500" },
  complex: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", bar: "bg-amber-500" },
} as const;

const CLASSIFICATION_COLORS = {
  synergistic: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
  antagonistic: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300" },
  complex: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
} as const;

const SIGNAL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  mediating_variable: { label: "MEDIATOR", color: "text-violet-600 bg-violet-50 border-violet-200" },
  analogous_dynamic: { label: "ANALOGY", color: "text-blue-600 bg-blue-50 border-blue-200" },
  structural_risk: { label: "RISK", color: "text-red-600 bg-red-50 border-red-200" },
  missing_metric: { label: "BLIND SPOT", color: "text-amber-600 bg-amber-50 border-amber-200" },
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function strengthBar(value: number, colorClass: string, width = "w-16") {
  return (
    <div className={cn("h-1.5 rounded-full bg-gray-100", width)}>
      <div
        className={cn("h-full rounded-full transition-all", colorClass)}
        style={{ width: `${Math.max(4, value * 100)}%` }}
      />
    </div>
  );
}

// ── Section wrapper ──

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = false,
  children,
  accentColor = "text-gray-500",
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  accentColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-gray-50/60 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
        )}
        <Icon className={cn("h-3.5 w-3.5 shrink-0", accentColor)} />
        <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">
          {title}
        </span>
        <span className="ml-auto text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">
          {count}
        </span>
      </button>
      {open && <div className="px-3 pb-2.5 pt-0.5">{children}</div>}
    </div>
  );
}

// ── Section 1: Strategic Corridors ──

function CorridorCard({
  corridor,
  entityMap,
  onEntityClick,
}: {
  corridor: StrategicCorridor;
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  const colors = POLARITY_COLORS[corridor.polarity];

  return (
    <div className={cn("rounded border p-2 mb-1.5 last:mb-0", colors.bg, colors.border)}>
      {/* Header badges */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", colors.bg, colors.text, colors.border, "border")}>
          {corridor.polarity}
        </span>
        {corridor.amplified && (
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
            <Zap className="h-2.5 w-2.5 inline -mt-px mr-0.5" />
            AMPLIFIED
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-gray-500">STR</span>
          {strengthBar(corridor.total_strength, colors.bar, "w-12")}
          <span className={cn("text-[9px] font-mono font-semibold", colors.text)}>
            {pct(corridor.total_strength)}
          </span>
        </div>
      </div>

      {/* Path chain */}
      <div className="flex flex-wrap items-center gap-0.5">
        {corridor.path_names.map((name, i) => {
          const entityId = corridor.path[i];
          const entity = entityMap.get(entityId);
          const isBottleneck = entityId === corridor.bottleneck_at;

          return (
            <span key={entityId + "-" + i} className="flex items-center gap-0.5">
              <button
                onClick={() => entity && onEntityClick?.(entity)}
                disabled={!entity}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors",
                  isBottleneck
                    ? "bg-red-100 text-red-800 border border-red-300 ring-1 ring-red-200"
                    : "bg-white/70 text-gray-700 border border-gray-200 hover:bg-white hover:border-gray-300",
                  entity && "cursor-pointer"
                )}
                title={isBottleneck ? `Bottleneck: ${name}` : name}
              >
                {isBottleneck && <AlertTriangle className="h-2.5 w-2.5 inline -mt-px mr-0.5 text-red-500" />}
                {name}
              </button>
              {i < corridor.path_names.length - 1 && (
                <ArrowRight className={cn("h-2.5 w-2.5 shrink-0", colors.text)} />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CorridorsSection({
  corridors,
  entityMap,
  onEntityClick,
}: {
  corridors: StrategicCorridor[];
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  return (
    <div className="space-y-0">
      {corridors.map((c, i) => (
        <CorridorCard key={i} corridor={c} entityMap={entityMap} onEntityClick={onEntityClick} />
      ))}
    </div>
  );
}

// ── Section 2: Tension Zones ──

function TensionCard({
  zone,
  entityMap,
  onEntityClick,
}: {
  zone: TensionZone;
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  const entity = entityMap.get(zone.entity_id);
  const magPct = Math.min(zone.tension_magnitude * 100, 100);
  const magColor =
    zone.tension_magnitude > 0.7
      ? "bg-red-500"
      : zone.tension_magnitude > 0.4
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="rounded border border-gray-200 bg-white p-2 mb-1.5 last:mb-0">
      {/* Tension bar */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className="h-1 flex-1 rounded-full bg-gray-100">
          <div
            className={cn("h-full rounded-full transition-all", magColor)}
            style={{ width: `${Math.max(4, magPct)}%` }}
          />
        </div>
        <span className="text-[9px] font-mono font-semibold text-gray-500">
          {zone.tension_magnitude.toFixed(2)}
        </span>
      </div>

      {/* Tug-of-war layout */}
      <div className="flex items-center gap-1.5">
        {/* Positive drivers (left) */}
        <div className="flex-1 flex flex-wrap justify-end gap-0.5">
          {zone.positive_drivers.map((id) => {
            const e = entityMap.get(id);
            return (
              <button
                key={id}
                onClick={() => e && onEntityClick?.(e)}
                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors font-medium truncate max-w-[90px]"
                title={e?.name ?? id}
              >
                {e?.name ?? id}
              </button>
            );
          })}
          {zone.positive_drivers.length > 0 && (
            <TrendingUp className="h-3 w-3 text-emerald-500 shrink-0" />
          )}
        </div>

        {/* Center entity */}
        <button
          onClick={() => entity && onEntityClick?.(entity)}
          className="text-[10px] font-bold px-2 py-1 rounded bg-gray-100 text-gray-800 border border-gray-300 shrink-0 hover:bg-gray-200 transition-colors"
        >
          <ArrowLeftRight className="h-2.5 w-2.5 inline -mt-px mr-0.5 text-gray-500" />
          {entity?.name ?? zone.entity_name}
        </button>

        {/* Negative drivers (right) */}
        <div className="flex-1 flex flex-wrap gap-0.5">
          {zone.negative_drivers.length > 0 && (
            <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
          )}
          {zone.negative_drivers.map((id) => {
            const e = entityMap.get(id);
            return (
              <button
                key={id}
                onClick={() => e && onEntityClick?.(e)}
                className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors font-medium truncate max-w-[90px]"
                title={e?.name ?? id}
              >
                {e?.name ?? id}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TensionSection({
  zones,
  entityMap,
  onEntityClick,
}: {
  zones: TensionZone[];
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  return (
    <div className="space-y-0">
      {zones.map((z, i) => (
        <TensionCard key={z.entity_id + "-" + i} zone={z} entityMap={entityMap} onEntityClick={onEntityClick} />
      ))}
    </div>
  );
}

// ── Section 3: Field Intersections ──

function IntersectionCard({
  intersection,
  entityMap,
  onEntityClick,
}: {
  intersection: FieldIntersection;
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  const cc = CLASSIFICATION_COLORS[intersection.classification];

  return (
    <div className={cn("rounded border p-2 mb-1.5 last:mb-0", cc.bg, cc.border)}>
      {/* Header: two entities + classification */}
      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
        <EntityPill
          id={intersection.entity_a_id}
          name={intersection.entity_a_name}
          entityMap={entityMap}
          onEntityClick={onEntityClick}
          variant="neutral"
        />
        <Layers className="h-2.5 w-2.5 text-gray-400 shrink-0" />
        <EntityPill
          id={intersection.entity_b_id}
          name={intersection.entity_b_name}
          entityMap={entityMap}
          onEntityClick={onEntityClick}
          variant="neutral"
        />
        <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ml-auto", cc.text, cc.bg, cc.border)}>
          {intersection.classification}
        </span>
      </div>

      {/* Overlap zone */}
      {intersection.overlap_names.length > 0 && (
        <div className="flex items-start gap-1 mb-1">
          <span className="text-[9px] text-gray-500 mt-0.5 shrink-0">OVERLAP:</span>
          <div className="flex flex-wrap gap-0.5">
            {intersection.overlap_names.map((name, idx) => {
              const id = intersection.overlap_entities[idx];
              return (
                <EntityPill
                  key={id ?? name}
                  id={id}
                  name={name}
                  entityMap={entityMap}
                  onEntityClick={onEntityClick}
                  variant="overlap"
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Insight + influence */}
      <div className="flex items-start gap-1.5">
        <p className="text-[10px] text-gray-600 leading-tight flex-1 line-clamp-2">
          {intersection.insight}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Gauge className="h-2.5 w-2.5 text-gray-400" />
          <span className="text-[9px] font-mono font-semibold text-gray-500">
            {pct(intersection.combined_influence)}
          </span>
        </div>
      </div>
    </div>
  );
}

function IntersectionsSection({
  intersections,
  entityMap,
  onEntityClick,
}: {
  intersections: FieldIntersection[];
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  return (
    <div className="space-y-0">
      {intersections.map((ix, i) => (
        <IntersectionCard
          key={`${ix.entity_a_id}-${ix.entity_b_id}-${i}`}
          intersection={ix}
          entityMap={entityMap}
          onEntityClick={onEntityClick}
        />
      ))}
    </div>
  );
}

// ── Section 4: Influence Drivers ──

function InfluenceDriverCard({
  field,
  entityMap,
  onEntityClick,
}: {
  field: InteractionField;
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const entity = entityMap.get(field.entity_id);
  const isDriver = field.autonomy_ratio > 1;

  return (
    <div className="rounded border border-gray-200 bg-white p-2 mb-1.5 last:mb-0">
      {/* Main row */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => entity && onEntityClick?.(entity)}
          className="text-[10px] font-semibold text-gray-800 hover:text-blue-700 transition-colors truncate max-w-[120px]"
          title={field.entity_name}
        >
          {field.entity_name}
        </button>

        {/* Badges */}
        <span
          className={cn(
            "text-[8px] font-bold uppercase px-1 py-0.5 rounded border shrink-0",
            isDriver
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-gray-50 text-gray-500 border-gray-200"
          )}
        >
          {isDriver ? "DRIVER" : "DRIVEN"}
        </span>
        {field.amplification_factor > 1 && (
          <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 shrink-0">
            <Zap className="h-2 w-2 inline -mt-px" />
            {field.amplification_factor.toFixed(1)}x
          </span>
        )}

        {/* Strength bar + reach */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[9px] text-gray-400">STR</span>
          {strengthBar(field.field_strength, "bg-blue-500", "w-10")}
          <span className="text-[9px] font-mono text-gray-500">{pct(field.field_strength)}</span>
          <span className="text-[9px] text-gray-300">|</span>
          <Radio className="h-2.5 w-2.5 text-gray-400" />
          <span className="text-[9px] font-mono text-gray-500">{field.field_reach}</span>
        </div>

        {/* Expand */}
        {field.top_influences.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-gray-100 rounded transition-colors shrink-0"
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3 text-gray-400" />
            ) : (
              <ChevronDown className="h-3 w-3 text-gray-400" />
            )}
          </button>
        )}
      </div>

      {/* Receptivity + autonomy micro-stats */}
      <div className="flex items-center gap-3 mt-1">
        <span className="text-[9px] text-gray-400">
          RCP <span className="font-mono text-gray-500">{pct(field.receptivity)}</span>
        </span>
        <span className="text-[9px] text-gray-400">
          AUT <span className="font-mono text-gray-500">{field.autonomy_ratio.toFixed(2)}</span>
        </span>
        <span className="text-[9px] text-gray-400">
          AMP <span className="font-mono text-gray-500">{field.amplification_factor.toFixed(2)}</span>
        </span>
      </div>

      {/* Expanded: top influences */}
      {expanded && field.top_influences.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-1">
          {field.top_influences.map((inf, j) => {
            const target = entityMap.get(inf.target_entity_id);
            const isPositive = inf.net_influence >= 0;
            return (
              <div key={inf.target_entity_id + "-" + j} className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-[9px] font-mono font-semibold w-8 text-right shrink-0",
                    isPositive ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {isPositive ? "+" : ""}
                  {inf.net_influence.toFixed(2)}
                </span>
                <ArrowRight className="h-2 w-2 text-gray-300 shrink-0" />
                <button
                  onClick={() => target && onEntityClick?.(target)}
                  className="text-[9px] text-gray-700 hover:text-blue-700 transition-colors truncate"
                >
                  {inf.target_name}
                </button>
                <span className="text-[8px] text-gray-400 ml-auto truncate max-w-[100px]" title={inf.pathway}>
                  {inf.pathway}
                </span>
                {inf.hops > 1 && (
                  <span className="text-[8px] text-gray-300">{inf.hops}h</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfluenceSection({
  fields,
  entityMap,
  onEntityClick,
}: {
  fields: InteractionField[];
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
}) {
  return (
    <div className="space-y-0">
      {fields.map((f, i) => (
        <InfluenceDriverCard key={f.entity_id + "-" + i} field={f} entityMap={entityMap} onEntityClick={onEntityClick} />
      ))}
    </div>
  );
}

// ── Section 5: Hidden Signals ──

function SignalCard({ signal }: { signal: HiddenSignal }) {
  const typeInfo = SIGNAL_TYPE_LABELS[signal.signal_type] ?? {
    label: signal.signal_type,
    color: "text-gray-600 bg-gray-50 border-gray-200",
  };
  const impactPct = Math.min(Math.abs(signal.trajectory_impact) * 100, 100);
  const impactColor =
    signal.trajectory_impact > 0.5
      ? "bg-red-500"
      : signal.trajectory_impact > 0.25
        ? "bg-amber-500"
        : "bg-blue-500";

  return (
    <div className="rounded border border-gray-200 bg-white p-2 mb-1.5 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn("text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border", typeInfo.color)}>
          {typeInfo.label}
        </span>
        <span className="text-[10px] font-semibold text-gray-800 truncate flex-1">
          {signal.signal_name}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] text-gray-400">IMP</span>
          <div className="h-1.5 w-10 rounded-full bg-gray-100">
            <div
              className={cn("h-full rounded-full", impactColor)}
              style={{ width: `${Math.max(4, impactPct)}%` }}
            />
          </div>
          <span className="text-[9px] font-mono text-gray-500">{signal.trajectory_impact.toFixed(2)}</span>
        </div>
      </div>
      <p className="text-[10px] text-gray-600 leading-tight line-clamp-2">{signal.description}</p>
      {signal.analogous_precedent && (
        <p className="text-[9px] text-gray-400 mt-0.5 leading-tight italic truncate">
          Precedent: {signal.analogous_precedent}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[8px] text-gray-400 truncate">
          via {signal.detection_method}
        </span>
      </div>
    </div>
  );
}

function HiddenSignalsSection({ signals }: { signals: HiddenSignal[] }) {
  return (
    <div className="space-y-0">
      {signals.map((s, i) => (
        <SignalCard key={s.signal_name + "-" + i} signal={s} />
      ))}
    </div>
  );
}

// ── Shared micro-components ──

function EntityPill({
  id,
  name,
  entityMap,
  onEntityClick,
  variant = "neutral",
}: {
  id?: string;
  name: string;
  entityMap: Map<string, Entity>;
  onEntityClick?: (entity: Entity) => void;
  variant?: "neutral" | "overlap";
}) {
  const entity = id ? entityMap.get(id) : undefined;
  return (
    <button
      onClick={() => entity && onEntityClick?.(entity)}
      disabled={!entity}
      className={cn(
        "text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors border",
        variant === "overlap"
          ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
        entity && "cursor-pointer"
      )}
      title={name}
    >
      {name}
    </button>
  );
}

// ── Main component ──

export default function MechanismIntelligenceModule({
  space,
  entities,
  edges,
  synthesisData,
  onEntityClick,
}: MechanismIntelligenceProps) {
  // Build entity lookup
  const entityMap = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) {
      map.set(e.entity_id, e);
    }
    return map;
  }, [entities]);

  // Extract interaction_metadata from synthesisData (JSONB, not typed)
  const interactionMetadata = useMemo<InteractionMetadata | null>(() => {
    if (!synthesisData) return null;
    const raw = (synthesisData as unknown as Record<string, unknown>).interaction_metadata;
    if (!raw || typeof raw !== "object") return null;
    return raw as InteractionMetadata;
  }, [synthesisData]);

  // Extract hidden_signals
  const hiddenSignals = useMemo<HiddenSignal[]>(() => {
    if (!synthesisData) return [];
    const raw = (synthesisData as unknown as Record<string, unknown>).hidden_signals;
    if (!Array.isArray(raw)) return [];
    return raw as HiddenSignal[];
  }, [synthesisData]);

  const corridors = interactionMetadata?.strategic_corridors ?? [];
  const tensionZones = interactionMetadata?.tension_zones ?? [];
  const intersections = interactionMetadata?.intersections ?? [];
  const fields = interactionMetadata?.fields ?? [];

  const hasData = corridors.length > 0 || tensionZones.length > 0 || intersections.length > 0 || fields.length > 0 || hiddenSignals.length > 0;

  // Summary stats
  const totalBottlenecks = corridors.filter((c) => c.bottleneck_at).length;
  const amplifiedCount = corridors.filter((c) => c.amplified).length;
  const highTension = tensionZones.filter((z) => z.tension_magnitude > 0.6).length;
  const driverCount = fields.filter((f) => f.autonomy_ratio > 1).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Module header */}
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/40">
        <div className="flex items-center gap-1.5">
          <Radar className="h-3.5 w-3.5 text-indigo-500" />
          <h3 className="text-[11px] font-bold text-gray-800 uppercase tracking-wider">
            System Mechanisms
          </h3>
        </div>
        {hasData && (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[9px] text-gray-400">
              <Route className="h-2.5 w-2.5 inline -mt-px mr-0.5" />
              {corridors.length} corridors
            </span>
            <span className="text-[9px] text-gray-400">
              <Swords className="h-2.5 w-2.5 inline -mt-px mr-0.5" />
              {tensionZones.length} tensions
            </span>
            <span className="text-[9px] text-gray-400">
              <Layers className="h-2.5 w-2.5 inline -mt-px mr-0.5" />
              {intersections.length} intersections
            </span>
            <span className="text-[9px] text-gray-400">
              <Radio className="h-2.5 w-2.5 inline -mt-px mr-0.5" />
              {fields.length} fields
            </span>
            {hiddenSignals.length > 0 && (
              <span className="text-[9px] text-gray-400">
                <Eye className="h-2.5 w-2.5 inline -mt-px mr-0.5" />
                {hiddenSignals.length} signals
              </span>
            )}
          </div>
        )}
        {/* Quick-stat pills */}
        {hasData && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {totalBottlenecks > 0 && (
              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                {totalBottlenecks} BOTTLENECK{totalBottlenecks > 1 ? "S" : ""}
              </span>
            )}
            {amplifiedCount > 0 && (
              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-200">
                {amplifiedCount} CYCLE-AMPLIFIED
              </span>
            )}
            {highTension > 0 && (
              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                {highTension} HIGH TENSION
              </span>
            )}
            {driverCount > 0 && (
              <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                {driverCount} DRIVER{driverCount > 1 ? "S" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!hasData && (
        <div className="px-4 py-8 text-center">
          <Radar className="h-6 w-6 text-gray-300 mx-auto mb-2" />
          <p className="text-[11px] text-gray-400">
            Run synthesis to compute system mechanisms
          </p>
        </div>
      )}

      {/* Sections */}
      {hasData && (
        <div>
          <CollapsibleSection
            title="Strategic Corridors"
            icon={Route}
            count={corridors.length}
            defaultOpen={true}
            accentColor="text-indigo-500"
          >
            <CorridorsSection corridors={corridors} entityMap={entityMap} onEntityClick={onEntityClick} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Tension Zones"
            icon={Swords}
            count={tensionZones.length}
            defaultOpen={false}
            accentColor="text-amber-500"
          >
            <TensionSection zones={tensionZones} entityMap={entityMap} onEntityClick={onEntityClick} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Field Intersections"
            icon={Layers}
            count={intersections.length}
            defaultOpen={false}
            accentColor="text-violet-500"
          >
            <IntersectionsSection intersections={intersections} entityMap={entityMap} onEntityClick={onEntityClick} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Influence Drivers"
            icon={Radio}
            count={fields.length}
            defaultOpen={false}
            accentColor="text-blue-500"
          >
            <InfluenceSection fields={fields} entityMap={entityMap} onEntityClick={onEntityClick} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Hidden Signals"
            icon={Eye}
            count={hiddenSignals.length}
            defaultOpen={false}
            accentColor="text-rose-500"
          >
            <HiddenSignalsSection signals={hiddenSignals} />
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
