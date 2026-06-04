"use client";

// ── Buy Credits modal ───────────────────────────────────────────────
// Claude-style intentional purchase surface. Opens in-context (over the
// board, via a portal) so the user never loses their canvas. Shows live
// balance, the one-time top-up packs (shared TOPUP_PACKS from plans.ts),
// and a path to the full monthly plans at /pricing. Reuses the exact
// checkout call the /app/credits page uses — no forked billing logic.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { appleVibe as av } from "@/lib/apple-vibe-tokens";
import { TOPUP_PACKS } from "@/lib/plans";

const ACCENT = "#0A84FF";

export function BuyCreditsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Live balance whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch("/api/credits/balance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.balance === "number") setBalance(d.balance);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  async function buy(packId: string) {
    setBuying(packId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setBuying(null);
    } catch {
      setBuying(null);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          style={{ fontFamily: av.font.stack }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(15,23,42,0.32)", backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />

          {/* panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Buy credits"
            className="relative w-full max-w-[440px] rounded-[24px] p-6"
            style={{
              background: "#ffffff",
              border: `1px solid ${av.stroke.soft}`,
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.9) inset, 0 32px 80px -24px rgba(11,18,40,0.45)",
            }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* header */}
            <div className="flex items-start justify-between">
              <div>
                <div
                  className="text-[18px] font-semibold"
                  style={{ color: av.text.primary }}
                >
                  Buy credits
                </div>
                <div
                  className="mt-0.5 text-[12.5px] leading-snug"
                  style={{ color: av.text.tertiary }}
                >
                  {balance === null ? (
                    "Top up any time — credits never expire."
                  ) : (
                    <>
                      You have{" "}
                      <span className="font-semibold" style={{ color: av.text.secondary }}>
                        {balance}
                      </span>{" "}
                      credit{balance === 1 ? "" : "s"}. They never expire.
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 transition-colors hover:bg-black/5"
                aria-label="Close"
              >
                <X className="h-4 w-4" style={{ color: av.text.tertiary }} />
              </button>
            </div>

            {/* packs */}
            <div className="mt-5 flex flex-col gap-2.5">
              {TOPUP_PACKS.map((pack) => (
                <div
                  key={pack.id}
                  className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{
                    background: pack.popular ? "rgba(10,132,255,0.05)" : av.surface.base,
                    border: pack.popular
                      ? "1px solid rgba(10,132,255,0.28)"
                      : `1px solid ${av.stroke.soft}`,
                  }}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[14px] font-semibold"
                        style={{ color: av.text.primary }}
                      >
                        {pack.credits} credits
                      </span>
                      {pack.popular && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-white"
                          style={{ background: ACCENT }}
                        >
                          Best value
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 text-[11.5px]"
                      style={{ color: av.text.faint }}
                    >
                      {pack.perCredit} per credit
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => buy(pack.id)}
                    disabled={buying !== null}
                    className="rounded-full px-4 py-1.5 text-[13px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                    style={{ background: pack.popular ? ACCENT : av.accent.primary }}
                  >
                    {buying === pack.id ? "…" : pack.priceLabel}
                  </button>
                </div>
              ))}
            </div>

            {/* footer → full plans */}
            <div
              className="mt-5 border-t pt-4 text-center"
              style={{ borderColor: av.stroke.hairline }}
            >
              <Link
                href="/pricing"
                className="text-[12.5px] font-medium transition-opacity hover:opacity-70"
                style={{ color: ACCENT }}
              >
                Need a higher weekly limit? See all plans →
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
