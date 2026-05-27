"use client";

// ── Deliverables Strip ────────────────────────────────────────────
//
// Top-level surface on the main canvas listing every elected variation
// across the space + the status of its three deliverable artifacts
// (description doc / mockup / export prompt). Drives the user's
// "ready to ship" workflow.
//
// Three primary affordances:
//   1. Per-row "Generate all" — fires the 3 routes for one variation.
//   2. Master "Generate everything pending" — loops over ready rows,
//      fires what's missing. Bounded concurrency (3 at a time) so we
//      don't hammer the LLM provider.
//   3. Master "Download bundle" — calls the export route + triggers
//      a browser download of one .md the user can paste into Claude.
//
// Per-row "Open" button opens the existing VariationDeliverablesModal
// (set as portal) so the user can read the artifacts inline.
//
// Visual treatment matches the other main-canvas strips (cross-room,
// concept-memory, canvas-decision) — soft tinted card, hairline
// border, 20px radius, compact rows. The accent here is the green
// "ready" pill so the user reads the strip as "the shippable layer."

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  FileText,
  Layout,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { VariationDeliverablesModal } from "./variation-deliverables-modal";

interface ReadyRow {
  entity_id: string;
  entity_name: string;
  sub_objective_id: string;
  sub_objective_title: string;
  variation_id: string;
  variation_name: string;
  variation_description: string;
  effectiveness_score?: number;
  evaluation_method?:
    | "heuristic"
    | "rubric"
    | "evidence"
    | "simulation"
    | "tested"
    | "ensemble";
  disposition: "elected" | "rejected" | "deferred" | null;
  gates: Record<"room" | "expanded" | "scored" | "method" | "elected", boolean>;
  ready: boolean;
  has_description_doc: boolean;
  has_mockup_fullscreen: boolean;
  has_mockup_thumbnail: boolean;
  has_export_prompt: boolean;
  has_export_prompt_optimized: boolean;
}

interface Props {
  spaceId: string;
}

// Bounded concurrency for the "generate everything" master button.
// 3 in flight is enough to feel fast without slamming the provider.
const CONCURRENCY = 3;

export function DeliverablesStrip({ spaceId }: Props) {
  const [rows, setRows] = useState<ReadyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [masterBusy, setMasterBusy] = useState(false);
  const [masterProgress, setMasterProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  // Modal state — keyed on entity_id + variation_id so the modal can
  // open any row's deliverables.
  const [modalOpenFor, setModalOpenFor] = useState<ReadyRow | null>(null);

  // ── Load rows on mount ──
  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/brainstorm/space/${spaceId}/deliverables/ready`,
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const j = (await res.json()) as { rows: ReadyRow[] };
      setRows(j.rows ?? []);
    } catch {
      // Soft-fail — strip stays empty.
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // ── Counts for the summary header ──
  const summary = useMemo(() => {
    const ready = rows.filter((r) => r.ready);
    const fullyGenerated = ready.filter(
      (r) =>
        r.has_description_doc &&
        r.has_mockup_fullscreen &&
        r.has_export_prompt,
    );
    const pending = ready.filter(
      (r) =>
        !r.has_description_doc ||
        !r.has_mockup_fullscreen ||
        !r.has_export_prompt,
    );
    const blocked = rows.filter((r) => !r.ready);
    return { ready, fullyGenerated, pending, blocked };
  }, [rows]);

  // ── Per-row "Generate all 3" ──
  // Fires doc + mockup (fullscreen) + export-prompt for one variation.
  // Each route is idempotent so re-running is safe if anything cached.
  const generateForRow = useCallback(
    async (row: ReadyRow) => {
      if (!row.ready) return;
      const key = `${row.entity_id}::${row.variation_id}`;
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      try {
        const payload = {
          entityId: row.entity_id,
          variationId: row.variation_id,
        };
        // Fire in parallel — they don't depend on each other.
        const [docRes, mockRes, promptRes] = await Promise.allSettled([
          row.has_description_doc
            ? Promise.resolve(null)
            : fetch("/api/brainstorm/item/variation/description-doc", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              }),
          row.has_mockup_fullscreen
            ? Promise.resolve(null)
            : fetch("/api/brainstorm/item/variation/mockup", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  ...payload,
                  format: "fullscreen",
                }),
              }),
          row.has_export_prompt
            ? Promise.resolve(null)
            : fetch("/api/brainstorm/item/variation/export-prompt", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              }),
        ]);
        // Re-fetch to refresh the dots from the source of truth.
        void docRes;
        void mockRes;
        void promptRes;
        await fetchRows();
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [fetchRows],
  );

  // ── Master "Generate everything pending" ──
  const generateAllPending = useCallback(async () => {
    if (masterBusy) return;
    const pending = summary.pending;
    if (pending.length === 0) return;
    setMasterBusy(true);
    setMasterProgress({ done: 0, total: pending.length });
    // Bounded concurrency — chunked pool.
    let idx = 0;
    let done = 0;
    const next = async () => {
      const my = idx++;
      if (my >= pending.length) return;
      await generateForRow(pending[my]);
      done++;
      setMasterProgress({ done, total: pending.length });
      await next();
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () =>
      next(),
    );
    await Promise.all(workers);
    setMasterBusy(false);
    setMasterProgress(null);
    await fetchRows();
  }, [masterBusy, summary.pending, generateForRow, fetchRows]);

  // ── Master "Download bundle" ──
  const downloadBundle = useCallback(async () => {
    if (downloadBusy) return;
    setDownloadBusy(true);
    try {
      const res = await fetch(
        `/api/brainstorm/space/${spaceId}/deliverables/export`,
      );
      if (!res.ok) return;
      const text = await res.text();
      // Browser download — convert to a blob URL + click an anchor.
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const datePart = new Date().toISOString().slice(0, 10);
      link.download = `canvas-deliverables-${datePart}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadBusy(false);
    }
  }, [downloadBusy, spaceId]);

  // ── Render ──
  // Hide entirely if there's nothing elected yet — strip is for the
  // user's committed direction.
  if (loading) return null;
  if (rows.length === 0) return null;

  const stripBg = "rgba(22,163,74,0.05)";
  const stripBorder = "rgba(22,163,74,0.20)";
  const accent = appleVibe.stage.outcomes;

  return (
    <div
      className="mb-5 rounded-2xl border"
      style={{
        background: stripBg,
        borderColor: stripBorder,
        borderRadius: appleVibe.radius.md,
      }}
    >
      {/* ── Strip header — always visible ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <Package
            className="h-3.5 w-3.5 flex-shrink-0"
            strokeWidth={2}
            style={{ color: accent }}
          />
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "rgba(20,83,45,0.95)" }}
          >
            Deliverables
          </span>
          <span
            className="text-[12.5px] font-medium"
            style={{ color: appleVibe.text.primary }}
          >
            {summary.fullyGenerated.length} / {summary.ready.length} ready · {summary.pending.length} pending
            {summary.blocked.length > 0 && ` · ${summary.blocked.length} blocked`}
          </span>
          {masterProgress && (
            <span
              className="ml-2 text-[10.5px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              generating {masterProgress.done}/{masterProgress.total}…
            </span>
          )}
        </button>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Generate everything pending */}
          {summary.pending.length > 0 && (
            <motion.button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void generateAllPending();
              }}
              disabled={masterBusy}
              whileHover={masterBusy ? undefined : { y: -1, transition: { duration: 0.15 } }}
              whileTap={masterBusy ? undefined : { y: 0.5, transition: { duration: 0.08 } }}
              className="inline-flex items-center gap-1.5 transition-[background,color] duration-150 ease-out hover:bg-[rgba(22,163,74,0.10)] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: accent,
                color: appleVibe.text.onAccent,
                border: `1px solid ${accent}`,
                borderRadius: appleVibe.radius.pill,
                padding: "4px 11px",
                fontSize: "10.5px",
                fontWeight: 600,
                letterSpacing: "0.02em",
                boxShadow: appleVibe.shadow.chip,
                fontFamily: appleVibe.font.stack,
              }}
              title={`Auto-generate ${summary.pending.length} pending deliverable${summary.pending.length === 1 ? "" : "s"}`}
            >
              {masterBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
              ) : (
                <Wand2 className="h-3 w-3" strokeWidth={2.4} />
              )}
              {masterBusy ? "Generating…" : "Generate pending"}
            </motion.button>
          )}
          {/* Download bundle */}
          {summary.fullyGenerated.length > 0 && (
            <motion.button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void downloadBundle();
              }}
              disabled={downloadBusy}
              whileHover={downloadBusy ? undefined : { y: -1, transition: { duration: 0.15 } }}
              whileTap={downloadBusy ? undefined : { y: 0.5, transition: { duration: 0.08 } }}
              className="inline-flex items-center gap-1.5 transition-[background,color] duration-150 ease-out hover:bg-[rgba(15,23,42,0.04)] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: appleVibe.surface.card,
                color: appleVibe.text.secondary,
                border: `1px solid ${appleVibe.stroke.medium}`,
                borderRadius: appleVibe.radius.pill,
                padding: "4px 11px",
                fontSize: "10.5px",
                fontWeight: 600,
                letterSpacing: "0.02em",
                boxShadow: appleVibe.shadow.chip,
                fontFamily: appleVibe.font.stack,
              }}
              title="Download all generated deliverables as one markdown file"
            >
              {downloadBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
              ) : (
                <Download className="h-3 w-3" strokeWidth={2.4} />
              )}
              Download .md
            </motion.button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full"
            style={{
              background: "rgba(22,163,74,0.12)",
              color: "rgba(20,83,45,0.95)",
            }}
            aria-label={expanded ? "Collapse deliverables" : "Expand deliverables"}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {/* ── Expanded — one row per elected variation ── */}
      {expanded && (
        <div
          className="border-t"
          style={{ borderColor: stripBorder }}
        >
          <ul className="flex flex-col">
            {rows.map((r) => (
              <DeliverableRow
                key={`${r.entity_id}::${r.variation_id}`}
                row={r}
                busy={busyIds.has(`${r.entity_id}::${r.variation_id}`)}
                onGenerate={() => void generateForRow(r)}
                onOpen={() => setModalOpenFor(r)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Modal for inspecting one row's deliverables in detail. */}
      {modalOpenFor && (
        <VariationDeliverablesModal
          open={!!modalOpenFor}
          onClose={() => {
            setModalOpenFor(null);
            // Re-fetch to refresh dots if the modal generated anything.
            void fetchRows();
          }}
          entityId={modalOpenFor.entity_id}
          variationId={modalOpenFor.variation_id}
          variationName={modalOpenFor.variation_name}
        />
      )}
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────

function DeliverableRow({
  row,
  busy,
  onGenerate,
  onOpen,
}: {
  row: ReadyRow;
  busy: boolean;
  onGenerate: () => void;
  onOpen: () => void;
}) {
  const missingGates = !row.ready
    ? Object.entries(row.gates)
        .filter(([k, v]) => !v && k !== "elected")
        .map(([k]) => k)
    : [];

  return (
    <li
      className="flex items-center gap-3 px-4 py-2.5"
      style={{
        borderTop: `1px solid rgba(22,163,74,0.10)`,
        background: row.ready
          ? "transparent"
          : "rgba(15,23,42,0.02)",
        opacity: row.ready ? 1 : 0.75,
      }}
    >
      {/* Variation name + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="truncate text-[12.5px] font-semibold"
            style={{ color: appleVibe.text.primary }}
            title={row.variation_name}
          >
            {row.variation_name}
          </span>
          <span
            className="flex-shrink-0 text-[10px] font-light"
            style={{ color: appleVibe.text.tertiary }}
            title={`In ${row.sub_objective_title}`}
          >
            · {row.entity_name} · {row.sub_objective_title}
          </span>
        </div>
        {row.ready ? (
          typeof row.effectiveness_score === "number" && (
            <p
              className="mt-0.5 text-[10.5px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              score {(row.effectiveness_score * 100).toFixed(0)}/100
              {row.evaluation_method && ` · method: ${row.evaluation_method}`}
            </p>
          )
        ) : (
          <p
            className="mt-0.5 text-[10.5px] font-light italic"
            style={{ color: "rgba(146,64,14,0.95)" }}
          >
            needs {missingGates.join(" · ")} before auto-gen
          </p>
        )}
      </div>

      {/* Status dots — doc / mockup / prompt */}
      <div className="flex flex-shrink-0 items-center gap-2">
        <StatusDot
          label="Description doc"
          icon={FileText}
          on={row.has_description_doc}
        />
        <StatusDot
          label="Interface mockup"
          icon={Layout}
          on={row.has_mockup_fullscreen}
        />
        <StatusDot
          label={
            row.has_export_prompt_optimized
              ? "Export prompt (tested + judged)"
              : "Export prompt"
          }
          icon={Sparkles}
          on={row.has_export_prompt}
          accent={row.has_export_prompt_optimized}
        />
      </div>

      {/* Row actions */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {row.ready && (
          <motion.button
            type="button"
            onClick={onGenerate}
            disabled={busy}
            whileHover={busy ? undefined : { y: -1, transition: { duration: 0.15 } }}
            whileTap={busy ? undefined : { y: 0.5, transition: { duration: 0.08 } }}
            className="inline-flex items-center gap-1 transition-[background,color] duration-150 ease-out hover:bg-[rgba(22,163,74,0.10)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: appleVibe.surface.card,
              color: appleVibe.stage.outcomes,
              border: `1px solid ${appleVibe.stage.outcomes}40`,
              borderRadius: appleVibe.radius.pill,
              padding: "3px 9px",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              fontFamily: appleVibe.font.stack,
            }}
            title="Generate the three artifacts for this variation"
          >
            {busy ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2.4} />
            ) : (
              <Wand2 className="h-2.5 w-2.5" strokeWidth={2.4} />
            )}
            {busy ? "Generating…" : "Generate all"}
          </motion.button>
        )}
        <motion.button
          type="button"
          onClick={onOpen}
          whileHover={{ y: -1, transition: { duration: 0.15 } }}
          whileTap={{ y: 0.5, transition: { duration: 0.08 } }}
          className="inline-flex items-center gap-1 transition-[background,color] duration-150 ease-out hover:bg-[rgba(15,23,42,0.04)]"
          style={{
            background: "transparent",
            color: appleVibe.text.secondary,
            border: `1px solid ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.pill,
            padding: "3px 9px",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.02em",
            fontFamily: appleVibe.font.stack,
          }}
        >
          Open
        </motion.button>
      </div>
    </li>
  );
}

function StatusDot({
  label,
  icon: Icon,
  on,
  accent = false,
}: {
  label: string;
  icon: typeof FileText;
  on: boolean;
  accent?: boolean;
}) {
  const color = on
    ? accent
      ? appleVibe.accent.primary
      : appleVibe.stage.outcomes
    : appleVibe.text.faint;
  const bg = on
    ? accent
      ? `${appleVibe.accent.primary}14`
      : `${appleVibe.stage.outcomes}14`
    : appleVibe.surface.chip;
  return (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-full"
      style={{
        background: bg,
        color,
        border: `1px solid ${color}30`,
      }}
      title={`${label}: ${on ? "generated" : "not yet"}`}
      aria-label={`${label}: ${on ? "generated" : "not yet"}`}
    >
      {on ? (
        <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
      ) : (
        <Icon className="h-2.5 w-2.5" strokeWidth={2.2} />
      )}
    </div>
  );
}
