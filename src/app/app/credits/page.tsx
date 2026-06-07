"use client";

// ── Credits dashboard ──
//
// Not a bare "buy" page — a calm, warm dashboard: what you can spend (the two
// buckets), how the week is flowing (activity from the token meter), and a
// quiet top-up rail. Visual language = akiboe: cream + terracotta-coral accent
// + the sun-ray motif, on the clean appleVibe glass base. No stock icons —
// every mark is bespoke inline SVG.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AkiboeLogo } from "@/components/brand/akiboe-logo";

// Warm akiboe palette (sun / terracotta) layered over the clean light base.
const sun = {
  ink: "#1b1a18",
  inkSoft: "#6b6258",
  faint: "#a89f93",
  cream: "#fdfaf4",
  card: "#ffffff",
  sand: "#f1e7d6",
  sandLine: "rgba(120,90,50,0.10)",
  coral: "#c2593b",
  coralDeep: "#a8472d",
  amber: "#e0a740",
  glow: "rgba(194,89,59,0.16)",
  glowAmber: "rgba(224,167,64,0.18)",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
};

interface BalanceResponse {
  balance: number;
  spendable?: number;
  plan?: string;
  allowanceRemaining?: number;
  weeklyAllowance?: number;
  weekAnchor?: string | null;
}
interface UsageResponse {
  weekCalls: number;
  weekTokens: number;
  daily: { d: string; calls: number; tokens: number }[];
  recent: { label: string; tokens: number; at: string }[];
}

const PACKS = [
  { id: "pack_10", name: "Starter", credits: 10, price: "$5", per: "$0.50 / credit" },
  { id: "pack_30", name: "Explorer", credits: 30, price: "$12", per: "$0.40 / credit", popular: true },
  { id: "pack_100", name: "Pro", credits: 100, price: "$35", per: "$0.35 / credit" },
];

// ── bespoke marks ───────────────────────────────────────────────────

/** A miniature akiboe sun — the recurring glyph (rays + one coral ray). */
function SunGlyph({ size = 16, ink = sun.inkSoft }: { size?: number; ink?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }} aria-hidden>
      <g fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round">
        <circle cx="50" cy="50" r="9" />
        <line x1="34" y1="50" x2="22" y2="50" />
        <line x1="38.7" y1="38.7" x2="30" y2="30" />
        <line x1="61.3" y1="38.7" x2="70" y2="30" />
        <line x1="38.7" y1="61.3" x2="30" y2="70" />
        <line x1="61.3" y1="61.3" x2="70" y2="70" />
      </g>
      <line x1="66" y1="50" x2="78" y2="50" stroke={sun.coral} strokeWidth={7} strokeLinecap="round" />
    </svg>
  );
}

/** Hand-drawn check (no icon lib). */
function Check({ size = 13, color = sun.coral }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M4 12.5 L9.5 18 L20 6" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Radial allowance gauge — a sun-arc that fills with the rounds left. */
function AllowanceGauge({ value, max, size = 104 }: { value: number; max: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2 - 1;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ display: "block", transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="allowGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={sun.amber} />
            <stop offset="100%" stopColor={sun.coral} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={sun.sand} strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="url(#allowGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 26, fontWeight: 700, color: sun.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <span style={{ fontSize: 10.5, color: sun.faint, marginTop: 2 }}>of {max}</span>
      </div>
    </div>
  );
}

/** Soft area sparkline for the 7-day activity. */
function Sparkline({ values, width = 184, height = 44 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pad = 3;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const pts = values.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = pts.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${pad + (n - 1) * stepX},${height - pad} L${pad},${height - pad} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sun.coral} stopOpacity={0.20} />
          <stop offset="100%" stopColor={sun.coral} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <path d={line} fill="none" stroke={sun.coral} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={sun.coral} />
      )}
    </svg>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 50) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

// ── page ────────────────────────────────────────────────────────────

function CreditsInner() {
  const [bal, setBal] = useState<BalanceResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const justPurchased = searchParams.get("success") === "1";
  const justSubscribed = searchParams.get("subscribed") === "1";

  useEffect(() => {
    fetch("/api/credits/balance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setBal)
      .catch(() => {});
    fetch("/api/credits/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsage)
      .catch(() => {});
  }, []);

  // ── Post-auth subscribe handoff ──
  // /auth/signup folds `?plan=` into `next=/app/credits?plan=X`. When we
  // land with that param, fire the subscribe flow once so the user
  // doesn't have to click again. Runs at most once per page load.
  const incomingPlan = searchParams.get("plan");
  useEffect(() => {
    if (incomingPlan !== "standard" && incomingPlan !== "pro") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stripe/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: incomingPlan }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        // Stash the configuration error on the portal-error slot so the user
        // sees why the auto-redirect didn't fire (typically: env price id
        // missing). The subscription panel renders portalError already.
        setPortalError(data?.error ?? "Could not start subscription checkout.");
      } catch {
        if (!cancelled) setPortalError("Network error — try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [incomingPlan]);

  async function handleBuy(packId: string) {
    setLoading(packId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setLoading(null);
    } catch {
      setLoading(null);
    }
  }

  // Open the Stripe Customer Portal — lets the user swap plan, update card,
  // cancel, download invoices. 409 means "no Stripe customer yet" (never paid
  // for anything); surface that as a soft hint rather than a hard error.
  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/stripe/billing-portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setPortalError(data?.error ?? "Could not open billing portal.");
    } catch {
      setPortalError("Network error — try again.");
    } finally {
      setPortalLoading(false);
    }
  }

  const purchased = bal?.balance ?? 0;
  const allowance = bal?.allowanceRemaining ?? 0;
  const weekly = bal?.weeklyAllowance ?? 0;
  const spendable = bal?.spendable ?? purchased + allowance;
  const plan = bal?.plan ?? "free";

  const resetsIn = useMemo(() => {
    if (!bal?.weekAnchor) return null;
    const anchor = new Date(bal.weekAnchor).getTime();
    const elapsed = (Date.now() - anchor) / 86_400_000;
    const left = Math.max(0, 7 - (elapsed % 7));
    return Math.ceil(left);
  }, [bal?.weekAnchor]);

  return (
    <div
      style={{ fontFamily: sun.font, color: sun.ink }}
      className="mx-auto max-w-2xl pb-16"
    >
      {/* header — quiet lockup, no shouty H1 */}
      <div className="flex items-center justify-between pt-1">
        <AkiboeLogo variant="lockup" size={19} />
        <span style={{ fontSize: 12.5, color: sun.faint }}>Credits</span>
      </div>

      {justPurchased && (
        <div
          className="mt-5 flex items-center gap-2.5 rounded-2xl px-4 py-3"
          style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.18)", color: "#15803d", fontSize: 13 }}
        >
          <Check size={14} color="#16a34a" />
          <span><b style={{ fontWeight: 650 }}>Top-up complete.</b> Your credits are ready.</span>
        </div>
      )}
      {justSubscribed && (
        <div
          className="mt-5 flex items-center gap-2.5 rounded-2xl px-4 py-3"
          style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.18)", color: "#15803d", fontSize: 13 }}
        >
          <Check size={14} color="#16a34a" />
          <span><b style={{ fontWeight: 650 }}>Subscription active.</b> Weekly allowance refreshes every Monday.</span>
        </div>
      )}

      {/* ── HERO: the two buckets ── */}
      <section
        className="relative mt-5 overflow-hidden"
        style={{
          borderRadius: 26,
          background: `linear-gradient(180deg, ${sun.cream} 0%, #ffffff 62%)`,
          border: `1px solid ${sun.sandLine}`,
          boxShadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 22px 50px -28px rgba(120,70,40,0.28)",
          padding: 24,
        }}
      >
        {/* sun glow blob, top-right */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -70,
            right: -50,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: `radial-gradient(circle at 30% 30%, ${sun.glowAmber}, ${sun.glow} 45%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        <div className="relative flex items-start justify-between">
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: sun.inkSoft, letterSpacing: "0.01em" }}>
              Available to spend
            </div>
            <div className="mt-1 flex items-end gap-2">
              <span style={{ fontSize: 52, fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                {spendable.toLocaleString()}
              </span>
              <span style={{ fontSize: 13, color: sun.inkSoft, marginBottom: 8 }}>rounds</span>
            </div>
          </div>
          <span
            className="capitalize"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              borderRadius: 999, padding: "5px 11px",
              background: "rgba(194,89,59,0.08)", border: "1px solid rgba(194,89,59,0.18)",
              color: sun.coralDeep, fontSize: 12, fontWeight: 600,
            }}
          >
            <SunGlyph size={13} ink={sun.coralDeep} />
            {plan} plan
          </span>
        </div>

        {/* two buckets */}
        <div className="relative mt-6 grid grid-cols-[auto_1px_1fr] items-center gap-5">
          {/* weekly allowance gauge */}
          <div className="flex items-center gap-3.5">
            <AllowanceGauge value={allowance} max={weekly || 1} />
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: sun.ink }}>Weekly allowance</div>
              <div style={{ fontSize: 11.5, color: sun.inkSoft, marginTop: 2 }}>
                {resetsIn !== null ? `Resets in ${resetsIn} day${resetsIn === 1 ? "" : "s"}` : "Refills weekly"}
              </div>
              <div style={{ fontSize: 11, color: sun.faint, marginTop: 1 }}>No rollover</div>
            </div>
          </div>

          <div style={{ height: 56, width: 1, background: sun.sandLine }} />

          {/* purchased credits */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: sun.ink }}>Purchased credits</div>
            <div className="mt-1 flex items-end gap-1.5">
              <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {purchased.toLocaleString()}
              </span>
              <span style={{ fontSize: 11.5, color: sun.inkSoft, marginBottom: 4 }}>rolls over</span>
            </div>
            <div style={{ fontSize: 11, color: sun.faint, marginTop: 2 }}>Spent after your weekly allowance</div>
          </div>
        </div>
      </section>

      {/* ── ACTIVITY ── */}
      <section
        className="mt-4"
        style={{ borderRadius: 22, background: sun.card, border: `1px solid ${sun.sandLine}`, boxShadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 14px 34px -22px rgba(120,70,40,0.22)", padding: 20 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: sun.inkSoft }}>This week</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {usage?.weekCalls ?? 0}
              </span>
              <span style={{ fontSize: 13, color: sun.inkSoft }}>AI moves</span>
            </div>
          </div>
          {usage && <Sparkline values={usage.daily.map((d) => d.calls)} />}
        </div>

        {/* recent */}
        <div className="mt-4" style={{ borderTop: `1px solid ${sun.sandLine}`, paddingTop: 4 }}>
          {usage && usage.recent.length > 0 ? (
            usage.recent.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2.5"
                style={{ borderBottom: i < usage.recent.length - 1 ? `1px solid ${sun.sandLine}` : "none" }}
              >
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                    background: "rgba(194,89,59,0.07)",
                  }}
                >
                  <SunGlyph size={14} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 550, color: sun.ink, flex: 1 }}>{r.label}</span>
                <span style={{ fontSize: 11.5, color: sun.faint, fontVariantNumeric: "tabular-nums" }}>
                  {fmtTokens(r.tokens)} tok
                </span>
                <span style={{ fontSize: 11.5, color: sun.faint, minWidth: 58, textAlign: "right" }}>
                  {timeAgo(r.at)}
                </span>
              </div>
            ))
          ) : (
            <div className="py-6 text-center" style={{ fontSize: 12.5, color: sun.faint }}>
              No moves yet this week — your activity will bloom here.
            </div>
          )}
        </div>
      </section>

      {/* ── SUBSCRIPTION ── */}
      <section
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        style={{
          borderRadius: 22,
          background: sun.card,
          border: `1px solid ${sun.sandLine}`,
          boxShadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 14px 34px -22px rgba(120,70,40,0.22)",
          padding: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: sun.inkSoft }}>Subscription</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className="capitalize"
              style={{ fontSize: 18, fontWeight: 700, color: sun.ink, lineHeight: 1.1 }}
            >
              {plan} plan
            </span>
            <span style={{ fontSize: 12, color: sun.inkSoft }}>
              · {weekly || 10} rounds refill weekly
            </span>
          </div>
          {plan === "free" ? (
            <div style={{ fontSize: 12, color: sun.faint, marginTop: 4 }}>
              Upgrade to Standard or Pro for a bigger weekly allowance.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: sun.faint, marginTop: 4 }}>
              Manage payment, swap plan, or cancel anytime.
            </div>
          )}
          {portalError && (
            <div
              className="mt-2 rounded-lg px-2.5 py-1.5"
              style={{
                background: "rgba(194,89,59,0.08)",
                color: sun.coralDeep,
                fontSize: 11.5,
                fontWeight: 550,
              }}
            >
              {portalError}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {plan === "free" ? (
            <a
              href="/pricing"
              className="transition-all"
              style={{
                borderRadius: 13,
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: sun.coral,
                color: "#fff",
                whiteSpace: "nowrap",
              }}
            >
              See plans
            </a>
          ) : (
            <>
              <a
                href="/pricing"
                className="transition-all"
                style={{
                  borderRadius: 13,
                  padding: "9px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "rgba(27,26,24,0.04)",
                  border: `1px solid ${sun.sandLine}`,
                  color: sun.ink,
                  whiteSpace: "nowrap",
                }}
              >
                Change plan
              </a>
              <button
                type="button"
                onClick={handleManage}
                disabled={portalLoading}
                className="transition-all"
                style={{
                  borderRadius: 13,
                  padding: "9px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: sun.coral,
                  color: "#fff",
                  cursor: portalLoading ? "default" : "pointer",
                  opacity: portalLoading ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {portalLoading ? "Opening…" : "Manage"}
              </button>
            </>
          )}
        </div>
      </section>

      {/* ── TOP-UP ── */}
      <div className="mt-7 flex items-center gap-2">
        <SunGlyph size={15} />
        <span style={{ fontSize: 13, fontWeight: 600, color: sun.ink }}>Top up</span>
        <span style={{ fontSize: 12, color: sun.faint }}>· credits never expire</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        {PACKS.map((p) => {
          const pop = !!p.popular;
          return (
            <div
              key={p.id}
              className="relative flex flex-col"
              style={{
                borderRadius: 20,
                padding: 16,
                background: pop ? `linear-gradient(180deg, ${sun.cream}, #ffffff 70%)` : sun.card,
                border: `1px solid ${pop ? "rgba(194,89,59,0.28)" : sun.sandLine}`,
                boxShadow: pop
                  ? `0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 38px -20px ${sun.glow}`
                  : "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 28px -22px rgba(120,70,40,0.2)",
              }}
            >
              {pop && (
                <span
                  style={{
                    position: "absolute", top: -9, left: 16,
                    borderRadius: 999, padding: "2px 9px",
                    background: sun.coral, color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
                  }}
                >
                  Most picked
                </span>
              )}
              <div style={{ fontSize: 12.5, fontWeight: 600, color: sun.inkSoft }}>{p.name}</div>
              <div className="mt-1 flex items-end gap-1">
                <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{p.credits}</span>
                <span style={{ fontSize: 11.5, color: sun.inkSoft, marginBottom: 4 }}>credits</span>
              </div>
              <div style={{ fontSize: 12, color: sun.faint, marginTop: 2 }}>{p.per}</div>

              <button
                type="button"
                onClick={() => handleBuy(p.id)}
                disabled={loading !== null}
                className="mt-4 w-full transition-all"
                style={{
                  borderRadius: 13, padding: "9px 12px",
                  fontSize: 13, fontWeight: 600,
                  background: pop ? sun.coral : "rgba(27,26,24,0.04)",
                  color: pop ? "#fff" : sun.ink,
                  border: pop ? "none" : `1px solid ${sun.sandLine}`,
                  cursor: loading !== null ? "default" : "pointer",
                  opacity: loading !== null && loading !== p.id ? 0.5 : 1,
                }}
              >
                {loading === p.id ? "Redirecting…" : `${p.price}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* what a move costs — quiet reference */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5" style={{ fontSize: 11.5, color: sun.faint }}>
        <span className="flex items-center gap-1.5"><Check /> Diverge → converge · 2</span>
        <span className="flex items-center gap-1.5"><Check /> Canvas analysis · 1</span>
        <span className="flex items-center gap-1.5"><Check /> Make technical · 2</span>
        <span className="flex items-center gap-1.5"><Check /> Deep synthesize · 3</span>
      </div>
    </div>
  );
}

export default function CreditsPage() {
  return (
    <Suspense fallback={null}>
      <CreditsInner />
    </Suspense>
  );
}
