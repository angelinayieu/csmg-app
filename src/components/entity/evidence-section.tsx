"use client";

import { useState } from "react";
import { ChevronDown, FileText, Beaker, TrendingUp, HelpCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import type { Claim } from "@/types";

const CLAIM_TYPE_CONFIG: Record<string, {
  label: string;
  borderColor: string;
  icon: typeof FileText;
  iconColor: string;
}> = {
  mechanism: {
    label: "Mechanism",
    borderColor: "border-l-red-400",
    icon: Beaker,
    iconColor: "text-red-500",
  },
  assertion: {
    label: "Assertion",
    borderColor: "border-l-blue-400",
    icon: FileText,
    iconColor: "text-blue-500",
  },
  prediction: {
    label: "Prediction",
    borderColor: "border-l-amber-400",
    icon: TrendingUp,
    iconColor: "text-amber-500",
  },
  assumption: {
    label: "Assumption",
    borderColor: "border-l-pink-400",
    icon: HelpCircle,
    iconColor: "text-pink-500",
  },
  finding: {
    label: "Finding",
    borderColor: "border-l-green-400",
    icon: Search,
    iconColor: "text-green-500",
  },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  proposed: { label: "Proposed", color: "text-gray-500 bg-gray-50 border-gray-200" },
  supported: { label: "Supported", color: "text-green-700 bg-green-50 border-green-200" },
  contested: { label: "Contested", color: "text-amber-700 bg-amber-50 border-amber-200" },
  refuted: { label: "Refuted", color: "text-red-700 bg-red-50 border-red-200" },
};

interface EvidenceSectionProps {
  claims: Claim[];
  /** Number of claims to show before "show all" */
  initialLimit?: number;
}

export function EvidenceSection({ claims, initialLimit = 2 }: EvidenceSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const displayClaims = expanded ? claims : claims.slice(0, initialLimit);

  if (claims.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2.5">
        <p className="text-[11px] text-gray-400">No evidence basis generated for this entity</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayClaims.map((claim, i) => {
        const typeConfig = CLAIM_TYPE_CONFIG[claim.claim_type] ?? CLAIM_TYPE_CONFIG.assertion;
        const statusConfig = STATUS_CONFIG[claim.status] ?? STATUS_CONFIG.proposed;
        const Icon = typeConfig.icon;

        return (
          <div
            key={claim.id ?? i}
            className={cn(
              "rounded-lg border border-gray-100 border-l-[3px] bg-white px-3 py-2.5 transition-colors hover:bg-gray-50/50",
              typeConfig.borderColor
            )}
          >
            {/* Header row: type + confidence */}
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Icon className={cn("h-3 w-3", typeConfig.iconColor)} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {typeConfig.label}
                </span>
                <span
                  className={cn(
                    "rounded border px-1 py-0.5 text-[9px] font-semibold",
                    statusConfig.color
                  )}
                >
                  {statusConfig.label}
                </span>
              </div>
              <Ring
                value={claim.confidence}
                size={24}
                showValue={false}
              />
            </div>

            {/* Claim text */}
            <p className="text-[12px] leading-[1.5] text-gray-800">
              {claim.claim_text}
            </p>

            {/* Source quote / inference tag — distinguishes grounded quotes from inferences */}
            {claim.source_quote && (() => {
              const q = claim.source_quote;
              const isImplicit = q.startsWith("IMPLICIT:");
              const isAssumed = q.startsWith("ASSUMED:");
              const prefix = isImplicit ? "IMPLICIT" : isAssumed ? "ASSUMED" : null;
              const body = prefix ? q.slice(prefix.length + 1).trim() : q;

              return (
                <div
                  className={cn(
                    "mt-2 rounded-md border-l-2 px-2 py-1 text-[11px] leading-[1.45]",
                    isImplicit && "border-l-amber-300 bg-amber-50/40 text-amber-800",
                    isAssumed && "border-l-gray-300 bg-gray-50 text-gray-600 italic",
                    !prefix && "border-l-blue-400 bg-blue-50/40 text-gray-700"
                  )}
                >
                  {prefix ? (
                    <>
                      <span className="font-semibold">{prefix}:</span>{" "}
                      {body}
                    </>
                  ) : (
                    <>&ldquo;{body}&rdquo;</>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* Show all toggle */}
      {claims.length > initialLimit && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-100 bg-gray-50/50 px-2 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          {expanded ? "Show fewer" : `Show all ${claims.length} claims`}
          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
