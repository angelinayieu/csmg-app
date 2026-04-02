"use client";

import { useState } from "react";
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

export default function CreditsPage() {
  const [loading, setLoading] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Buy Credits</h1>
      <p className="mt-1 text-sm text-gray-600">
        Credits are used to run analyses. Choose a pack that fits your needs.
      </p>

      {/* Credit usage reference */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Credit usage
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs text-gray-600">
          <div>
            <span className="font-medium">Quick</span>
            <span className="text-gray-400 ml-1">1 cr/area</span>
          </div>
          <div>
            <span className="font-medium">Standard</span>
            <span className="text-gray-400 ml-1">2 cr/area</span>
          </div>
          <div>
            <span className="font-medium">Deep</span>
            <span className="text-gray-400 ml-1">3 cr/area</span>
          </div>
          <div>
            <span className="font-medium">Weaving</span>
            <span className="text-gray-400 ml-1">+2 cr</span>
          </div>
          <div>
            <span className="font-medium">Synthesis</span>
            <span className="text-gray-400 ml-1">+2 cr</span>
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
