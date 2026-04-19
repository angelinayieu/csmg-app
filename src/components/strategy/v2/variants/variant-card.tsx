"use client";

import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VariantVM } from "../strategy-view-model";

interface VariantCardProps {
  variant: VariantVM;
  active: boolean;
  onClick: () => void;
}

export function VariantCard({ variant, active, onClick }: VariantCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative text-left rounded-[10px] cursor-pointer transition-all",
        active
          ? "px-[15.5px] py-[13.5px]"
          : "px-4 py-3.5 hover:bg-gray-50",
      )}
      style={
        active
          ? {
              background: "#fff",
              border: "1.5px solid var(--accent-600)",
              boxShadow: "0 4px 12px rgba(var(--accent-rgb), 0.12)",
            }
          : {
              background: "#fff",
              border: "1px solid rgba(11,13,18,0.08)",
            }
      }
    >
      {active && (
        <span
          className="absolute -top-px left-0 right-0 rounded-t-[10px]"
          style={{ height: 3, background: "var(--accent-600)" }}
        />
      )}

      {variant.crown && (
        <span
          className="absolute -top-2 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8.5px] font-bold uppercase text-white"
          style={{
            background: "var(--accent-600)",
            letterSpacing: "0.12em",
          }}
        >
          <Crown className="w-2 h-2" />
          Top ranked
        </span>
      )}

      <div
        className="font-mono mb-1"
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(11,13,18,0.48)",
        }}
      >
        Variant {String.fromCharCode(64 + variant.rank)} · #{variant.rank}
      </div>
      <div
        className="font-bold mb-1"
        style={{
          fontSize: 13,
          color: "#0B0D12",
          letterSpacing: "-0.015em",
          lineHeight: 1.3,
        }}
      >
        {variant.title}
      </div>
      <p
        className="mb-2.5"
        style={{
          fontSize: 11,
          color: "rgba(11,13,18,0.74)",
          lineHeight: 1.45,
        }}
      >
        {variant.approach}
      </p>
      <div
        className="grid grid-cols-3 gap-2 pt-2"
        style={{ borderTop: "1px solid rgba(11,13,18,0.08)" }}
      >
        {[
          { l: "Impact", v: variant.impact.display, up: variant.impact.numeric > 0 },
          { l: "Risk", v: variant.risk.display },
          { l: "ROI", v: variant.roi.display },
        ].map((m) => (
          <div key={m.l} className="text-left">
            <div
              className="font-mono mb-0.5"
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(11,13,18,0.48)",
              }}
            >
              {m.l}
            </div>
            <div
              className="tabular-nums"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: m.up ? "#047857" : "#0B0D12",
                letterSpacing: "-0.02em",
              }}
            >
              {m.v}
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}
