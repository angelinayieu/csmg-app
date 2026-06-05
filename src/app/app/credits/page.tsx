"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Check, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const PACKS = [
  {
    id: "pack_10",
    name: "Starter",
    credits: 10,
    price: "$5",
    perCredit: "$0.50",
    features: ["10 analysis credits", "All depth levels", "Cross-space weaving"],
    popular: false,
  },
  {
    id: "pack_30",
    name: "Explorer",
    credits: 30,
    price: "$12",
    perCredit: "$0.40",
    features: ["30 analysis credits", "All depth levels", "Cross-space weaving", "Strategic synthesis"],
    popular: true,
  },
  {
    id: "pack_100",
    name: "Pro",
    credits: 100,
    price: "$35",
    perCredit: "$0.35",
    features: [
      "100 analysis credits",
      "All depth levels",
      "Cross-space weaving",
      "Strategic synthesis",
      "Best value per credit",
    ],
    popular: false,
  },
];

interface BalanceResponse {
  balance: number;
  /** Two-bucket model (Phase 3): allowance + purchased, what's actually spendable. */
  spendable?: number;
  plan?: string;
  allowanceRemaining?: number;
  weeklyAllowance?: number;
  tiers: {
    quick: number;
    standard: number;
    deep: number;
    comprehensive: number;
  };
}

export default function CreditsPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [balanceData, setBalanceData] = useState<BalanceResponse | null>(null);
  const searchParams = useSearchParams();
  const justPurchased = searchParams.get("success") === "1";

  useEffect(() => {
    fetch("/api/credits/balance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setBalanceData(data))
      .catch(() => {});
  }, []);

  async function handleBuy(packId: string) {
    setLoading(packId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("No checkout URL returned:", data);
        setLoading(null);
      }
    } catch (err) {
      console.error("Checkout failed:", err);
      setLoading(null);
    }
  }

  const tiers = balanceData?.tiers;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Buy Credits</h1>
      <p className="mt-1 text-sm text-gray-600">
        Credits are used to run analyses. Choose a pack that fits your needs.
      </p>

      {/* Post-purchase success confirmation. The Stripe webhook has
          already added the credits server-side by the time the user
          lands here with ?success=1; we just surface the fact. */}
      {justPurchased && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <span className="font-semibold">Purchase complete.</span> Your
          balance has been updated. Head back to a whiteboard to run your
          analysis.
        </div>
      )}

      {/* Current balance card — drives urgency + confirms state after
          a purchase. Shows ~runs-remaining at each tier so the user
          can immediately see what they can afford. */}
      {balanceData !== null && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-4">
          <div className="flex items-baseline gap-2">
            <Zap className="h-4 w-4 text-indigo-600" />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-700">
              Current balance
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums text-indigo-900">
              {balanceData.balance}
            </span>
            <span className="text-[12px] text-indigo-700">
              purchased {balanceData.balance === 1 ? "credit" : "credits"} · rolls over
            </span>
          </div>
          {/* Weekly plan allowance — the other bucket. Resets every 7 days, no
              rollover. Spent BEFORE purchased credits. */}
          {typeof balanceData.weeklyAllowance === "number" &&
            balanceData.weeklyAllowance > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-indigo-800">
                <span className="rounded-full bg-white/70 px-2 py-0.5 font-semibold capitalize">
                  {balanceData.plan ?? "free"} plan
                </span>
                <span>
                  <span className="font-mono font-semibold tabular-nums">
                    {balanceData.allowanceRemaining ?? 0}
                  </span>
                  {" / "}
                  <span className="font-mono tabular-nums">
                    {balanceData.weeklyAllowance}
                  </span>{" "}
                  weekly rounds left
                </span>
                {typeof balanceData.spendable === "number" && (
                  <span className="text-indigo-700/70">
                    ·{" "}
                    <span className="font-mono font-semibold tabular-nums">
                      {balanceData.spendable}
                    </span>{" "}
                    total spendable
                  </span>
                )}
              </div>
            )}
          {tiers && (
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-indigo-700/80">
              <span>
                ≈{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {Math.floor(balanceData.balance / tiers.quick)}
                </span>{" "}
                quick
              </span>
              <span>
                ·{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {Math.floor(balanceData.balance / tiers.standard)}
                </span>{" "}
                standard
              </span>
              <span>
                ·{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {Math.floor(balanceData.balance / tiers.deep)}
                </span>{" "}
                deep
              </span>
              <span>
                ·{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {Math.floor(balanceData.balance / tiers.comprehensive)}
                </span>{" "}
                comprehensive
              </span>
            </div>
          )}
        </div>
      )}

      {/* Credit usage reference. Reads tier costs from the actual
          TIERS config (via /api/credits/balance) so numbers always
          match what pre-flight reservation requires. */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Cost per analysis
        </div>
        <div className="grid grid-cols-4 gap-3 text-xs text-gray-600">
          <div>
            <span className="font-medium">Quick</span>
            <span className="text-gray-400 ml-1">{tiers?.quick ?? "?"} cr</span>
          </div>
          <div>
            <span className="font-medium">Standard</span>
            <span className="text-gray-400 ml-1">{tiers?.standard ?? "?"} cr</span>
          </div>
          <div>
            <span className="font-medium">Deep</span>
            <span className="text-gray-400 ml-1">{tiers?.deep ?? "?"} cr</span>
          </div>
          <div>
            <span className="font-medium">Comprehensive</span>
            <span className="text-gray-400 ml-1">{tiers?.comprehensive ?? "?"} cr</span>
          </div>
        </div>
      </div>

      {/* Packs */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PACKS.map((pack) => (
          <div
            key={pack.id}
            className={cn(
              "relative rounded-xl border p-5 transition-shadow",
              pack.popular
                ? "border-interaxis-400 shadow-md"
                : "border-gray-200 hover:shadow-sm"
            )}
          >
            {pack.popular && (
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-interaxis-500 px-3 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wider">
                Most popular
              </div>
            )}
            <div className="text-sm font-medium text-gray-900">{pack.name}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold">{pack.price}</span>
              <span className="text-sm text-gray-400">/ {pack.credits} credits</span>
            </div>
            <div className="mt-1 text-xs text-gray-400">{pack.perCredit} per credit</div>

            <ul className="mt-4 space-y-2">
              {pack.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                  <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button
              className="mt-5 w-full"
              variant={pack.popular ? "primary" : "secondary"}
              onClick={() => handleBuy(pack.id)}
              disabled={loading !== null}
            >
              {loading === pack.id ? (
                "Redirecting..."
              ) : (
                <>
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                  Buy {pack.credits} credits
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
