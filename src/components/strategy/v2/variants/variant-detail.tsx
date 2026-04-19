"use client";

import { useState, useMemo } from "react";
import { Plus, RefreshCw, Box, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { VariantFlowchart } from "./variant-flowchart";
import { VariantInspector } from "./variant-inspector";
import { ApprovalBar } from "./approval-bar";
import type { VariantVM, FlowchartVM } from "../strategy-view-model";
import { buildFlowchart } from "../strategy-view-model";
import type { Entity } from "@/types";
import type { CausalChain } from "@/types/causal-chains";

interface VariantDetailProps {
  variant: VariantVM;
  causalChains: CausalChain[];
  entityMap: Map<string, Entity>;
  spaceId: string;
  isConfirmed: boolean;
  loading: boolean;
  onApprove: () => void;
  onRegenerate?: () => void;
}

type EditMode = "view" | "edit_nodes" | "edit_connections";

export function VariantDetail({
  variant,
  causalChains,
  entityMap,
  spaceId,
  isConfirmed,
  loading,
  onApprove,
  onRegenerate,
}: VariantDetailProps) {
  const [mode, setMode] = useState<EditMode>("view");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const fc: FlowchartVM = useMemo(
    () => buildFlowchart(variant.recommendation, causalChains, entityMap),
    [variant.recommendation, causalChains, entityMap],
  );

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const all = [
      ...fc.drivers,
      ...fc.rules,
      ...fc.actions,
      ...fc.outcomes,
      ...fc.proxies,
    ];
    return all.find((n) => n.id === selectedNodeId) ?? null;
  }, [fc, selectedNodeId]);

  // For the inspector: figure out which chain (if any) this node belongs to
  const traceChainId = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.sourceId?.startsWith("chain-")) return selectedNode.sourceId;
    // Otherwise try matching via entity
    if (selectedNode.entityId) {
      for (const chain of causalChains) {
        if (chain.entity_ids.includes(selectedNode.entityId)) return chain.id;
      }
    }
    return null;
  }, [selectedNode, causalChains]);

  const cascadeSummary = useMemo(() => {
    const p = variant.recommendation.perspectives.length;
    const t = (variant.recommendation.micro_tactics ?? []).length;
    return `${p} perspectives · ${t} micro-tactics · ${causalChains.length} causal trace${causalChains.length === 1 ? "" : "s"} verified`;
  }, [variant, causalChains.length]);

  return (
    <div
      className="mt-3.5 p-4 rounded-[12px]"
      style={{
        background: "rgba(247, 248, 250, 0.7)",
        border: "1px solid rgba(11,13,18,0.08)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3.5 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div
            className="font-mono mb-0.5 inline-flex items-center gap-1"
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "var(--accent-600)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            <span
              className="inline-block w-1 h-1 rounded-full"
              style={{ background: "var(--accent-600)" }}
            />
            {variant.crown ? "Top-ranked variant" : `Alternative variant #${variant.rank}`}
          </div>
          <h2
            className="font-bold"
            style={{
              fontSize: 16,
              color: "#0B0D12",
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
              marginBottom: 4,
            }}
          >
            {variant.title} · full decomposition
          </h2>
          <p
            style={{
              fontSize: 12,
              color: "rgba(11,13,18,0.74)",
              lineHeight: 1.5,
              maxWidth: 620,
            }}
          >
            Every node below maps back to your Knowledge Graph. Drivers (L4 atoms) → deliverable
            rules → concrete actions → measured outcomes → proxy indicators. Click any node to
            inspect its reasoning trace and linked assets.
          </p>
          {variant.tradeoff && (
            <p
              className="mt-2"
              style={{
                fontSize: 11,
                color: "rgba(11,13,18,0.48)",
                fontStyle: "italic",
              }}
            >
              Tradeoff vs top: {variant.tradeoff}
            </p>
          )}
        </div>

        <div className="flex gap-1.5 flex-shrink-0">
          {[
            { l: "Impact", v: variant.impact.display, up: variant.impact.numeric > 0 },
            { l: "Conf", v: `${variant.recommendation.confidence}%` },
            { l: "ROI", v: variant.roi.display },
          ].map((m) => (
            <div
              key={m.l}
              className="rounded-[8px] px-3 py-2"
              style={{
                background: "#fff",
                border: "1px solid rgba(11,13,18,0.08)",
                minWidth: 80,
              }}
            >
              <div
                className="font-mono mb-0.5"
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  color: "rgba(11,13,18,0.48)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                {m.l}
              </div>
              <div
                className="tabular-nums"
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: m.up ? "#047857" : "#0B0D12",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {m.v}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-2 mb-3 p-2 rounded-[8px] flex-wrap"
        style={{
          background: "#fff",
          border: "1px solid rgba(11,13,18,0.08)",
        }}
      >
        <span
          className="font-mono mr-0.5"
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "rgba(11,13,18,0.48)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Edit
        </span>
        <div
          className="inline-flex rounded-[6px] p-[2px]"
          style={{
            background: "rgba(247,248,250,0.8)",
            border: "1px solid rgba(11,13,18,0.08)",
          }}
        >
          {(["view", "edit_nodes", "edit_connections"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-2.5 py-1 rounded-[4px] text-[10.5px] font-semibold transition-colors capitalize",
                mode === m
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900 bg-transparent",
              )}
            >
              {m === "edit_nodes" ? "Edit nodes" : m === "edit_connections" ? "Edit connections" : "View"}
            </button>
          ))}
        </div>
        <span
          className="inline-block w-px h-3.5"
          style={{ background: "rgba(11,13,18,0.08)" }}
        />
        <button
          className="px-2.5 py-1.5 rounded-[6px] text-[10.5px] font-semibold hover:bg-gray-50 inline-flex items-center gap-1.5"
          style={{
            background: "#fff",
            border: "1px solid rgba(11,13,18,0.08)",
            color: "rgba(11,13,18,0.74)",
          }}
        >
          <Plus className="w-2.5 h-2.5" />
          Add node
        </button>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={loading}
            className="px-2.5 py-1.5 rounded-[6px] text-[10.5px] font-semibold hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-60"
            style={{
              background: "#fff",
              border: "1px solid rgba(11,13,18,0.08)",
              color: "rgba(11,13,18,0.74)",
            }}
          >
            <RefreshCw className={`w-2.5 h-2.5 ${loading ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        )}
        <div className="flex-1" />
        <span
          className="inline-flex items-center gap-1.5"
          style={{
            fontSize: 10,
            color: "rgba(11,13,18,0.48)",
            fontWeight: 600,
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "#10B981" }}
          />
          {isConfirmed ? "Locked (confirmed)" : "Auto-saved"}
        </span>
      </div>

      {/* Flowchart */}
      <VariantFlowchart fc={fc} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2.5 px-1 flex-wrap">
        {[
          { k: "driver", l: "Drivers (L4 atoms)", bg: "#FAF5FF", st: "#9333EA" },
          { k: "rule", l: "Deliverable rules", bg: "var(--accent-50)", st: "var(--accent-600)" },
          { k: "action", l: "Actions", bg: "#FFFBEB", st: "#D97706" },
          { k: "outcome", l: "Outcomes", bg: "#ECFDF5", st: "#059669" },
          { k: "proxy", l: "Proxies", bg: "#F7F8FA", st: "#6B7280" },
        ].map((leg) => (
          <span
            key={leg.k}
            className="inline-flex items-center gap-1.5"
            style={{
              fontSize: 10,
              color: "rgba(11,13,18,0.48)",
              fontWeight: 600,
            }}
          >
            <span
              className="inline-block"
              style={{
                width: 12,
                height: 9,
                borderRadius: 2,
                background: leg.bg,
                border: `1px solid ${leg.st}`,
              }}
            />
            {leg.l}
          </span>
        ))}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "rgba(11,13,18,0.34)",
            fontWeight: 500,
          }}
        >
          Click any node to inspect · drag to reorder (coming soon)
        </span>
      </div>

      {/* Inspector */}
      <div className="mt-3">
        <VariantInspector
          node={selectedNode}
          spaceId={spaceId}
          calculationTraceChainId={traceChainId}
          linkedAssetCount={selectedNode?.entityId ? 1 : 0}
        />
      </div>

      {/* Approval */}
      <ApprovalBar
        isConfirmed={isConfirmed}
        isTopRanked={variant.crown}
        loading={loading}
        onApprove={onApprove}
        onRegenerate={onRegenerate}
        cascadeSummary={cascadeSummary}
      />
    </div>
  );
}
