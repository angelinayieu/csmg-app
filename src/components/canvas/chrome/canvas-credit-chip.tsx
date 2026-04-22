"use client";

// ── Canvas credit chip ──
//
// Small balance indicator in the canvas top bar. Fetches GET
// /api/credits/balance on mount + refetches after any pipeline run
// terminates (so a credit deduction is visible immediately) + every
// 30s as a backstop.
//
// Click → /app/credits for pack purchase. Non-blocking: if the fetch
// fails (rare), the chip just shows "—" and doesn't disrupt the bar.
//
// Tone changes based on remaining runs:
//   • ≥ 10 standard runs left  → gray (healthy)
//   • 3–9 standard runs        → amber (getting low)
//   • < 3 standard runs        → red (buy CTA)
// Uses the `tiers.standard.credits` value from the response so it
// adapts to any future tier-price change without a UI tweak.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface BalanceResponse {
  balance: number;
  tiers: {
    quick: number;
    standard: number;
    deep: number;
    comprehensive: number;
  };
}

const POLL_INTERVAL_MS = 30_000;

export interface CanvasCreditChipProps {
  /** Bump this (e.g., via useState counter) after a run completes so
   *  the chip refetches without waiting for the 30s poll. */
  refreshKey?: number;
}

export function CanvasCreditChip({ refreshKey }: CanvasCreditChipProps) {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch("/api/credits/balance", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as BalanceResponse;
      setData(json);
    } catch {
      // Non-fatal — chip stays at previous state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBalance();
    const t = setInterval(() => {
      void fetchBalance();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchBalance]);

  useEffect(() => {
    if (refreshKey !== undefined) void fetchBalance();
  }, [refreshKey, fetchBalance]);

  const balance = data?.balance ?? null;
  const standardCost = data?.tiers.standard ?? 3;
  const runsRemaining =
    balance !== null && standardCost > 0 ? Math.floor(balance / standardCost) : null;

  let tone = "text-gray-500 hover:bg-gray-100 hover:text-gray-700";
  if (runsRemaining !== null) {
    if (runsRemaining < 3) {
      tone = "text-red-700 bg-red-50 ring-1 ring-red-200 hover:bg-red-100";
    } else if (runsRemaining < 10) {
      tone =
        "text-amber-700 bg-amber-50 ring-1 ring-amber-200 hover:bg-amber-100";
    }
  }

  return (
    <Link
      href="/app/credits"
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors",
        tone,
      )}
      title={
        balance === null
          ? "Credits — click to view"
          : `${balance} credits · ~${runsRemaining} standard runs remaining · click to add more`
      }
    >
      <Zap className="h-3 w-3" />
      <span className="font-mono tabular-nums">
        {loading && balance === null ? "—" : balance}
      </span>
      <span className="opacity-70">credits</span>
    </Link>
  );
}
