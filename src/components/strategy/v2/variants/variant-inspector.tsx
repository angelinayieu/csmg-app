"use client";

import Link from "next/link";
import { ChevronRight, FileText, Box } from "lucide-react";
import type { FlowNode } from "../strategy-view-model";

interface VariantInspectorProps {
  node: FlowNode | null;
  spaceId: string;
  linkedAssetCount?: number;
  calculationTraceChainId?: string | null;
}

export function VariantInspector({
  node,
  spaceId,
  linkedAssetCount = 0,
  calculationTraceChainId,
}: VariantInspectorProps) {
  if (!node) {
    return (
      <div
        className="rounded-[10px] px-4 py-3 text-[11.5px]"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: "1px dashed rgba(11,13,18,0.14)",
          color: "rgba(11,13,18,0.48)",
        }}
      >
        Click any flowchart node to inspect its reasoning trace and linked assets.
      </div>
    );
  }

  const columnLabel = {
    driver: "L4 Driver",
    rule: "Deliverable Rule",
    action: "Action",
    outcome: "Measured Outcome",
    proxy: "Proxy Indicator",
  }[node.column];

  return (
    <div
      className="rounded-[10px] px-3.5 py-3.5 flex items-start gap-3"
      style={{
        background: "#fff",
        border: "1px solid rgba(11,13,18,0.14)",
      }}
    >
      <div
        className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0 text-white"
        style={{ background: "var(--accent-600)" }}
      >
        <FileText className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="font-mono mb-1"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent-700)",
          }}
        >
          Selected · {columnLabel}
        </div>
        <div
          className="font-bold mb-1"
          style={{
            fontSize: "12.5px",
            color: "#0B0D12",
            letterSpacing: "-0.01em",
          }}
        >
          {node.title}
        </div>
        {node.sub && (
          <div
            className="mb-2"
            style={{
              fontSize: 11,
              color: "rgba(11,13,18,0.74)",
              lineHeight: 1.45,
            }}
          >
            {node.sub}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-2">
          {calculationTraceChainId && (
            <Link
              href={`/app/space/${spaceId}/trace/${calculationTraceChainId}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
              style={{ background: "#0B0D12", color: "#fff" }}
            >
              Reasoning trace
              <ChevronRight className="w-2 h-2" />
            </Link>
          )}
          {node.entityId && (
            <Link
              href={`/app/space/${spaceId}/graph?entity=${node.entityId}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold hover:bg-gray-50"
              style={{
                background: "#fff",
                border: "1px solid rgba(11,13,18,0.08)",
                color: "rgba(11,13,18,0.74)",
              }}
            >
              <span
                className="inline-block w-1 h-1 rounded-full"
                style={{ background: "#7C3AED" }}
              />
              Entity in KG
              <ChevronRight className="w-2 h-2" />
            </Link>
          )}
          {calculationTraceChainId && (
            <Link
              href={`/app/space/${spaceId}/trace/${calculationTraceChainId}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold hover:bg-gray-50"
              style={{
                background: "#fff",
                border: "1px solid rgba(11,13,18,0.08)",
                color: "rgba(11,13,18,0.74)",
              }}
            >
              <span
                className="inline-block w-1 h-1 rounded-full"
                style={{ background: "#B45309" }}
              />
              Calculation trace
              <ChevronRight className="w-2 h-2" />
            </Link>
          )}
          {linkedAssetCount > 0 && (
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold hover:bg-gray-50"
              style={{
                background: "#fff",
                border: "1px solid rgba(11,13,18,0.08)",
                color: "rgba(11,13,18,0.74)",
              }}
            >
              <Box className="w-2.5 h-2.5" />
              View {linkedAssetCount} linked asset{linkedAssetCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
