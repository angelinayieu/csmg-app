"use client";

// ── Item Detail Drawer ──────────────────────────────────────────────
//
// Slides in from the right when the user clicks "Open detail" on a
// lane card. Five sections:
//
//   1. Definition           — LLM-deepened 2-3 sentence meaning
//   2. Inspiration          — per-item Tavily sources (real web)
//   3. Variations           — 3-5 alternative implementations
//   4. Planning             — assumes / depends on / risks
//   5. Linked chains        — which chains this item participates in
//
// Both LLM (expand) + Tavily (research) are lazy-loaded on first
// open and cached forever (entities.{expanded_detail,
// detail_research}). Re-opening is instant.
//
// ESC / backdrop / X all close. Width 480px on desktop, full-screen
// on mobile.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  ChevronRight,
  Compass,
  ExternalLink,
  Link2,
  RefreshCw,
  Shield,
  Sparkles as SparklesLucide,
  X,
} from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// ── Shared types (mirror the API contracts) ──

export interface ItemSource {
  title: string;
  url: string;
  snippet: string;
  score: number;
  informs: string;
}

interface ItemResearchBundle {
  sources?: ItemSource[];
  failed?: boolean;
  fetched_at?: string;
}

interface ItemVariation {
  name: string;
  description: string;
  tradeoff: string;
}

interface ItemPlanning {
  assumes: string[];
  depends_on: string[];
  risks: string[];
}

interface ExpandedItemDetail {
  definition?: string;
  variations?: ItemVariation[];
  planning?: ItemPlanning;
  generated_at?: string;
}

export interface LinkedChainRef {
  /** Display label for the linked chain — usually "Friction → Mechanism → Result". */
  label: string;
  /** Composite strength of the chain (0-100). */
  pct: number;
  /** Whether the chain is approved (both edges). */
  approved: boolean;
}

interface Props {
  /** The entity being shown. Pass null to close. */
  entityId: string | null;
  /** Item title (so the drawer renders instantly without waiting
   *  for the LLM expansion). */
  itemName: string;
  /** Which lane the item came from — drives the layer color band. */
  itemLayer: "pain" | "features" | "outcomes" | "objective";
  /** Cached existing detail, if any. Null = lazy-fetch on open. */
  initialExpandedDetail?: ExpandedItemDetail | null;
  initialDetailResearch?: ItemResearchBundle | null;
  /** Chains this item participates in (derived from edges by the
   *  parent room view). Empty array = item has no incoming or
   *  outgoing edges yet. */
  linkedChains: LinkedChainRef[];
  onClose: () => void;
}

const LANE_COLORS: Record<Props["itemLayer"], string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

const LANE_LABELS: Record<Props["itemLayer"], string> = {
  pain: "Problem",
  features: "Mechanism",
  outcomes: "Result",
  objective: "Objective",
};

export function ItemDetailDrawer({
  entityId,
  itemName,
  itemLayer,
  initialExpandedDetail,
  initialDetailResearch,
  linkedChains,
  onClose,
}: Props) {
  const reduce = useReducedMotion();
  const open = !!entityId;

  // ── Detail state ──
  const [expanded, setExpanded] = useState<ExpandedItemDetail | null>(
    initialExpandedDetail && hasDefinition(initialExpandedDetail)
      ? initialExpandedDetail
      : null,
  );
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);

  const [research, setResearch] = useState<ItemResearchBundle | null>(
    initialDetailResearch ?? null,
  );
  const [researchLoading, setResearchLoading] = useState(false);

  // ── ESC to close ──
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── Lazy-fetch detail on first open ──
  useEffect(() => {
    if (!entityId) return;

    // Always rehydrate from props on entity change so switching
    // between items works.
    setExpanded(
      initialExpandedDetail && hasDefinition(initialExpandedDetail)
        ? initialExpandedDetail
        : null,
    );
    setResearch(initialDetailResearch ?? null);
    setExpandError(null);

    const needsExpansion =
      !initialExpandedDetail || !hasDefinition(initialExpandedDetail);
    const needsResearch =
      !initialDetailResearch ||
      !(
        Array.isArray(initialDetailResearch.sources) &&
        (initialDetailResearch.sources.length > 0 ||
          initialDetailResearch.failed === true)
      );

    if (needsExpansion) {
      setExpandLoading(true);
      void fetch("/api/brainstorm/item/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) {
            setExpandError(json?.error ?? "Could not expand item.");
            return;
          }
          setExpanded(json.expanded_detail ?? null);
        })
        .catch((err) => {
          setExpandError(
            err instanceof Error ? err.message : "Network error.",
          );
        })
        .finally(() => setExpandLoading(false));
    }

    if (needsResearch) {
      setResearchLoading(true);
      void fetch("/api/brainstorm/item/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (res.ok) setResearch(json.detail_research ?? null);
        })
        .catch(() => {
          // Silent — research is optional; the drawer still renders.
        })
        .finally(() => setResearchLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // ── Regenerate (user-triggered) ──
  function regenerateExpansion() {
    if (!entityId) return;
    setExpandLoading(true);
    setExpandError(null);
    void fetch("/api/brainstorm/item/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId, mode: "force" }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setExpandError(json?.error ?? "Could not regenerate.");
          return;
        }
        setExpanded(json.expanded_detail ?? null);
      })
      .catch((err) =>
        setExpandError(err instanceof Error ? err.message : "Network error."),
      )
      .finally(() => setExpandLoading(false));
  }

  const laneColor = LANE_COLORS[itemLayer];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(15,23,42,0.32)" }}
            aria-hidden
          />

          {/* Drawer */}
          <motion.aside
            role="dialog"
            aria-label={`Detail for ${itemName}`}
            initial={
              reduce ? { x: 0, opacity: 0 } : { x: "100%", opacity: 0.8 }
            }
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "100%", opacity: 0 }}
            transition={{
              duration: reduce ? 0 : 0.36,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden md:w-[480px]"
            style={{
              background: appleVibe.surface.card,
              borderLeft: `1px solid ${appleVibe.stroke.hairline}`,
              fontFamily: appleVibe.font.stack,
              boxShadow: "0 0 40px -8px rgba(11,18,40,0.28)",
            }}
          >
            {/* Header */}
            <header
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{
                borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: laneColor }}
                    aria-hidden
                  />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: laneColor }}
                  >
                    {LANE_LABELS[itemLayer]}
                  </span>
                </div>
                <h2
                  className="mt-1 truncate text-[18px] font-semibold leading-tight tracking-tight"
                  style={{
                    color: appleVibe.text.primary,
                    fontFamily: appleVibe.font.display,
                    letterSpacing: "-0.015em",
                  }}
                  title={itemName}
                >
                  {itemName}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--home-chrome-fill,rgba(15,23,42,0.04))]"
                aria-label="Close detail"
                style={{ color: appleVibe.text.secondary }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            {/* Scrollable body */}
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {/* ── 1. DEFINITION ── */}
              <Section
                icon={<Sparkle className="h-3 w-3" />}
                title="Definition"
                action={
                  expanded ? (
                    <button
                      type="button"
                      onClick={regenerateExpansion}
                      disabled={expandLoading}
                      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
                      style={{
                        background: appleVibe.surface.chip,
                        color: appleVibe.text.tertiary,
                        cursor: expandLoading ? "wait" : "pointer",
                      }}
                      title="Regenerate the AI's interpretation"
                    >
                      <RefreshCw
                        className={`h-2.5 w-2.5 ${
                          expandLoading ? "animate-spin" : ""
                        }`}
                        strokeWidth={2}
                      />
                      Regenerate
                    </button>
                  ) : null
                }
              >
                {expandLoading && !expanded?.definition ? (
                  <SkeletonLines lines={3} />
                ) : expandError ? (
                  <ErrorRow message={expandError} />
                ) : expanded?.definition ? (
                  <p
                    className="text-[13px] font-light leading-relaxed"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {expanded.definition}
                  </p>
                ) : (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No definition yet.
                  </p>
                )}
              </Section>

              {/* ── 2. INSPIRATION (per-item research) ── */}
              <Section
                icon={<Compass className="h-3 w-3" strokeWidth={1.75} />}
                title="Inspiration"
                subtitle={
                  research?.sources && research.sources.length > 0
                    ? `${research.sources.length} sources`
                    : undefined
                }
              >
                {researchLoading && !research?.sources?.length ? (
                  <SkeletonLines lines={3} />
                ) : research?.failed ||
                  !research?.sources ||
                  research.sources.length === 0 ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No public sources found for this item. The
                    domain may be too specific.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {research.sources.map((s, i) => (
                      <li key={i}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex flex-col gap-1 rounded-2xl p-3 transition-colors hover:bg-[color:var(--home-chrome-fill,rgba(15,23,42,0.04))]"
                          style={{
                            border: `1px solid ${appleVibe.stroke.hairline}`,
                            background: "rgba(255,255,255,0.6)",
                            borderRadius: appleVibe.radius.md,
                          }}
                        >
                          <div className="flex items-baseline gap-1.5">
                            <span
                              className="line-clamp-1 flex-1 text-[12.5px] font-semibold"
                              style={{ color: appleVibe.text.primary }}
                            >
                              {s.title}
                            </span>
                            <ExternalLink
                              className="h-2.5 w-2.5 flex-shrink-0"
                              strokeWidth={2}
                              style={{ color: appleVibe.text.tertiary }}
                            />
                          </div>
                          {s.informs && (
                            <p
                              className="text-[11px] font-medium leading-snug"
                              style={{ color: laneColor }}
                            >
                              {s.informs}
                            </p>
                          )}
                          {s.snippet && (
                            <p
                              className="line-clamp-2 text-[11px] font-light leading-snug"
                              style={{ color: appleVibe.text.secondary }}
                            >
                              {s.snippet}
                            </p>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── 3. VARIATIONS ── */}
              <Section
                icon={
                  <SparklesLucide
                    className="h-3 w-3"
                    strokeWidth={1.75}
                  />
                }
                title="Variations"
                subtitle={
                  expanded?.variations && expanded.variations.length > 0
                    ? `${expanded.variations.length} ways`
                    : undefined
                }
              >
                {expandLoading && !expanded?.variations?.length ? (
                  <SkeletonLines lines={3} />
                ) : !expanded?.variations || expanded.variations.length === 0 ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No alternative implementations identified.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {expanded.variations.map((v, i) => (
                      <li
                        key={i}
                        className="rounded-2xl p-3"
                        style={{
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                          background: "rgba(255,255,255,0.6)",
                          borderRadius: appleVibe.radius.md,
                        }}
                      >
                        <div
                          className="text-[12.5px] font-semibold"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {v.name}
                        </div>
                        {v.description && (
                          <p
                            className="mt-1 text-[11.5px] font-light leading-snug"
                            style={{ color: appleVibe.text.secondary }}
                          >
                            {v.description}
                          </p>
                        )}
                        {v.tradeoff && (
                          <p
                            className="mt-1.5 text-[11px] font-light leading-snug"
                            style={{ color: appleVibe.text.tertiary }}
                          >
                            <span
                              className="text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                              style={{ color: appleVibe.text.tertiary }}
                            >
                              Tradeoff:
                            </span>{" "}
                            <span className="italic">{v.tradeoff}</span>
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── 4. PLANNING (assumes / depends_on / risks) ── */}
              <Section
                icon={<Shield className="h-3 w-3" strokeWidth={1.75} />}
                title="Planning"
              >
                {expandLoading && !expanded?.planning ? (
                  <SkeletonLines lines={3} />
                ) : !expanded?.planning ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    No planning surface yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {expanded.planning.assumes.length > 0 && (
                      <PlanningGroup
                        label="Assumes"
                        items={expanded.planning.assumes}
                        tone="info"
                      />
                    )}
                    {expanded.planning.depends_on.length > 0 && (
                      <PlanningGroup
                        label="Depends on"
                        items={expanded.planning.depends_on}
                        tone="neutral"
                      />
                    )}
                    {expanded.planning.risks.length > 0 && (
                      <PlanningGroup
                        label="Risks"
                        items={expanded.planning.risks}
                        tone="warn"
                      />
                    )}
                  </div>
                )}
              </Section>

              {/* ── 5. LINKED CHAINS ── */}
              <Section
                icon={<Link2 className="h-3 w-3" strokeWidth={1.75} />}
                title="In chains"
                subtitle={
                  linkedChains.length > 0
                    ? `${linkedChains.length} ${
                        linkedChains.length === 1 ? "chain" : "chains"
                      }`
                    : undefined
                }
              >
                {linkedChains.length === 0 ? (
                  <p
                    className="text-[12px] font-light italic"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Not yet part of a complete chain.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {linkedChains.slice(0, 8).map((c, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2"
                        style={{
                          background: c.approved
                            ? "rgba(22,163,74,0.04)"
                            : "rgba(255,255,255,0.6)",
                          border: `1px solid ${
                            c.approved
                              ? "rgba(22,163,74,0.22)"
                              : appleVibe.stroke.hairline
                          }`,
                          borderRadius: appleVibe.radius.md,
                        }}
                      >
                        <span
                          className="line-clamp-1 flex-1 text-[11.5px] font-medium"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {c.label}
                        </span>
                        <span
                          className="font-mono text-[10px]"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {c.pct}%
                        </span>
                        <ChevronRight
                          className="h-3 w-3 flex-shrink-0"
                          strokeWidth={2}
                          style={{ color: appleVibe.text.tertiary }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Footer — Commit B will add "Expand into sub-room" here */}
              <div
                className="pt-2"
                style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
              >
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl px-3 py-2.5 text-[12px] font-semibold opacity-60"
                  style={{
                    background: appleVibe.surface.chip,
                    color: appleVibe.text.tertiary,
                    borderRadius: appleVibe.radius.md,
                    cursor: "not-allowed",
                  }}
                  title="Coming in the next commit"
                >
                  <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
                  Expand into sub-room (Coming soon)
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function hasDefinition(d: ExpandedItemDetail | null | undefined): boolean {
  return !!d?.definition && d.definition.length > 0;
}

function Section({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span style={{ color: appleVibe.text.tertiary }}>{icon}</span>
          <h3
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {title}
          </h3>
          {subtitle && (
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.faint }}
            >
              · {subtitle}
            </span>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PlanningGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "info" | "neutral" | "warn";
}) {
  const tones: Record<
    typeof tone,
    { color: string; bg: string; border: string; icon?: React.ReactNode }
  > = {
    info: {
      color: "rgba(30,64,175,0.95)",
      bg: "rgba(37,99,235,0.06)",
      border: "rgba(37,99,235,0.18)",
    },
    neutral: {
      color: appleVibe.text.secondary,
      bg: "rgba(255,255,255,0.6)",
      border: appleVibe.stroke.hairline,
    },
    warn: {
      color: "rgba(127,29,29,0.95)",
      bg: "rgba(220,38,38,0.05)",
      border: "rgba(220,38,38,0.18)",
      icon: <AlertCircle className="h-2.5 w-2.5" strokeWidth={2} />,
    },
  };
  const t = tones[tone];
  return (
    <div>
      <div
        className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: t.color }}
      >
        {t.icon}
        {label}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((it, i) => (
          <li
            key={i}
            className="rounded-xl px-2.5 py-1.5 text-[11.5px] font-light leading-snug"
            style={{
              background: t.bg,
              border: `1px solid ${t.border}`,
              color: appleVibe.text.primary,
            }}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonLines({ lines }: { lines: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-md"
          style={{
            background: appleVibe.surface.chip,
            width: i === lines - 1 ? "70%" : "100%",
          }}
        />
      ))}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl px-3 py-2 text-[11px]"
      style={{
        background: "rgba(220,38,38,0.06)",
        border: "1px solid rgba(220,38,38,0.18)",
        color: "rgba(127,29,29,0.95)",
      }}
    >
      {message}
    </div>
  );
}
