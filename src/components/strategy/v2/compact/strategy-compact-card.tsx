"use client";

import Link from "next/link";
import { useState } from "react";
import { Zap, Sparkles, ChevronRight, Crown, RefreshCw, CheckCircle2 } from "lucide-react";
import { useStrategyViewModel } from "@/lib/hooks/use-strategy-view-model";
import { useSpaceData } from "@/contexts/space-data-context";

interface StrategyCompactCardProps {
  className?: string;
}

export function StrategyCompactCard({ className }: StrategyCompactCardProps) {
  const ctx = useSpaceData();
  const { vm, recommendation, flags, actions } = useStrategyViewModel();
  const [showAlts, setShowAlts] = useState(false);

  const base = `/app/space/${ctx.space.id}`;

  if (!flags.hasSynthesis) {
    return (
      <div
        className={className}
        style={{
          background: "rgba(255, 255, 255, 0.6)",
          border: "1px dashed rgba(11,13,18,0.14)",
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div className="text-[11px] font-semibold" style={{ color: "rgba(11,13,18,0.48)" }}>
          Strategy
        </div>
        <p className="mt-1 text-[12px]" style={{ color: "rgba(11,13,18,0.48)" }}>
          Run synthesis to generate a strategic recommendation.
        </p>
      </div>
    );
  }

  if (!recommendation || !vm) {
    return (
      <div
        className={className}
        style={{
          background: "rgba(var(--accent-rgb), 0.04)",
          border: "1px solid rgba(var(--accent-rgb), 0.18)",
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div
          className="font-mono mb-2"
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent-700)",
          }}
        >
          Ready to generate
        </div>
        <p className="text-[12px] mb-3" style={{ color: "rgba(11,13,18,0.74)" }}>
          Synthesis is complete. Generate strategic recommendations and ranked alternatives.
        </p>
        <button
          onClick={actions.generate}
          disabled={flags.loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--accent-600)" }}
        >
          {flags.loading ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Zap className="h-3.5 w-3.5" /> Generate Strategy
            </>
          )}
        </button>
      </div>
    );
  }

  const top = vm.topVariant;

  return (
    <div
      className={className}
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: "1px solid rgba(11,13,18,0.14)",
        borderRadius: 14,
        padding: 18,
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(var(--accent-rgb), 0.1)",
      }}
    >
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0 text-white"
          style={{ background: "var(--accent-600)" }}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="font-mono"
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: "var(--accent-700)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Strategy
            </span>
            <span
              className="inline-block w-1 h-1 rounded-full"
              style={{ background: "rgba(11,13,18,0.22)" }}
            />
            <span
              style={{
                fontSize: 10.5,
                color: "rgba(11,13,18,0.48)",
                fontWeight: 600,
              }}
            >
              {vm.hero.postureLabel} · {vm.hero.confidence}% conf
            </span>
            {flags.confirmed && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold"
                style={{
                  fontSize: 8.5,
                  background: "#ECFDF5",
                  color: "#047857",
                  border: "1px solid #A7F3D0",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                <CheckCircle2 className="w-2 h-2" />
                Confirmed
              </span>
            )}
          </div>
          <h3
            className="font-bold mt-1 truncate"
            style={{
              fontSize: 14,
              color: "#0B0D12",
              letterSpacing: "-0.015em",
              lineHeight: 1.3,
            }}
            title={vm.hero.title}
          >
            {vm.hero.title}
          </h3>
          <p
            className="mt-1 line-clamp-2"
            style={{
              fontSize: 11.5,
              color: "rgba(11,13,18,0.74)",
              lineHeight: 1.45,
            }}
          >
            {vm.hero.summary}
          </p>
        </div>
      </div>

      {/* Top variant row */}
      {top && (
        <div
          className="mt-3 flex items-center gap-2.5 p-2.5 rounded-[10px]"
          style={{
            background: "rgba(var(--accent-rgb), 0.04)",
            border: "1px solid rgba(var(--accent-rgb), 0.14)",
          }}
        >
          <Crown
            className="w-3 h-3 flex-shrink-0"
            style={{ color: "var(--accent-600)" }}
          />
          <div className="flex-1 min-w-0">
            <div
              className="font-bold truncate"
              style={{
                fontSize: 12,
                color: "#0B0D12",
                letterSpacing: "-0.01em",
              }}
              title={top.title}
            >
              {top.title}
            </div>
            <div
              className="font-mono flex items-center gap-2 mt-0.5 flex-wrap"
              style={{ fontSize: 10 }}
            >
              <span style={{ color: "#047857", fontWeight: 700 }}>
                {top.impact.display} impact
              </span>
              <span style={{ color: "rgba(11,13,18,0.22)" }}>·</span>
              <span style={{ color: "rgba(11,13,18,0.48)", fontWeight: 600 }}>
                risk {top.risk.display.toLowerCase()}
              </span>
              <span style={{ color: "rgba(11,13,18,0.22)" }}>·</span>
              <span style={{ color: "rgba(11,13,18,0.48)", fontWeight: 600 }}>
                ROI {top.roi.display}
              </span>
            </div>
          </div>
          {vm.variants.length > 1 && (
            <button
              onClick={() => setShowAlts((v) => !v)}
              className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold hover:bg-white/60 transition-colors"
              style={{
                background: "#fff",
                border: "1px solid rgba(11,13,18,0.08)",
                color: "rgba(11,13,18,0.74)",
              }}
            >
              +{vm.variants.length - 1} alt{vm.variants.length > 2 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {showAlts && vm.variants.length > 1 && (
        <div className="mt-2 flex flex-col gap-1">
          {vm.variants.slice(1).map((v) => (
            <button
              key={v.rank}
              onClick={() => actions.selectAlternative(v.rank)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] hover:bg-white transition-colors text-left"
              style={{
                background: "rgba(255,255,255,0.5)",
                border: "1px solid rgba(11,13,18,0.06)",
              }}
            >
              <span
                className="font-mono"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "rgba(11,13,18,0.48)",
                  letterSpacing: "0.14em",
                }}
              >
                #{v.rank}
              </span>
              <span
                className="flex-1 truncate"
                style={{ fontSize: 11.5, color: "#0B0D12", fontWeight: 600 }}
              >
                {v.title}
              </span>
              <span
                className="font-mono tabular-nums"
                style={{ fontSize: 10, color: "#047857", fontWeight: 700 }}
              >
                {v.impact.display}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Action row */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {!flags.confirmed && top && (
          <button
            onClick={() => {
              actions.confirm();
              ctx.setStrategyApproved(true);
            }}
            disabled={flags.loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold text-white disabled:opacity-50"
            style={{ background: "#059669" }}
          >
            <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2.5} />
            Confirm
          </button>
        )}
        <Link
          href={`${base}/strategy`}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold hover:bg-white/60 transition-colors"
          style={{
            background: "#fff",
            border: "1px solid rgba(11,13,18,0.08)",
            color: "var(--accent-700)",
            letterSpacing: "-0.005em",
          }}
        >
          View full strategy
          <ChevronRight className="w-2.5 h-2.5" />
        </Link>
      </div>
    </div>
  );
}
