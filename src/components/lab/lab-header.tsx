"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Activity, ChevronRight, Sparkles, X } from "lucide-react";
import type { Entity } from "@/types";
import { LabModeSwitcher, type LabMode } from "./lab-mode-switcher";

export interface LabBreadcrumbItem {
  label: string;
  href?: string;
}

export interface LabHeaderProps {
  spaceId: string;
  spaceName: string;
  focal: Entity;
  entityCount: number;
  bondCount: number;
  reactionCount: number;
  mode: LabMode;
  onModeChange: (m: LabMode) => void;
  /**
   * Phase 17: fractal breadcrumb (Universe › Space › Entity). When
   * omitted, falls back to the single "back to space" link.
   */
  breadcrumb?: LabBreadcrumbItem[];
  /**
   * Phase 28: explicit exit target. The lab pages render full-viewport
   * (bypassing SpaceShell) so we give the user a prominent × button and
   * ESC key handler to leave cleanly. If omitted, falls back to the
   * parent space's canvas (or `/app` when spaceId isn't available).
   */
  closeHref?: string;
}

export function LabHeader({
  spaceId,
  spaceName,
  focal,
  entityCount,
  bondCount,
  reactionCount,
  mode,
  onModeChange,
  breadcrumb,
  closeHref,
}: LabHeaderProps) {
  const router = useRouter();
  const confidencePct = Math.round(((focal.confidence as number | null) ?? 0.8) * 100);
  const layerLabel = focal.layer ?? "thread";
  const category = (focal.entity_category as string) ?? "concept";
  // Phase 47: default Exit target is the Whiteboard (the merged, unified
  // canvas surface). Previously this sent users to the space dashboard,
  // which is a different view and broke the focus + rings handoff.
  const exitHref =
    closeHref ?? (spaceId ? `/app/space/${spaceId}/whiteboard` : "/app");

  // Phase 28: ESC closes the lab. The lab occupies the full viewport so
  // this matches the "zoom out" mental model the user asked for.
  // Phase 29: guard against firing from inputs/contentEditable/open dialogs
  // so users clearing a slider value or dismissing a popover don't get
  // yanked out of the whole lab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          t.isContentEditable
        ) {
          return;
        }
        // If any open dialog/popover is in the tree, let it handle ESC.
        if (document.querySelector('[role="dialog"], [data-state="open"]')) {
          return;
        }
      }
      e.preventDefault();
      router.push(exitHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitHref, router]);

  return (
    <header
      className="relative flex h-[52px] items-center gap-4 border-b border-[var(--lab-border)] bg-[var(--lab-panel-bg)] px-4"
      style={{
        boxShadow: "inset 0 -1px 0 rgba(74,222,128,0.15)",
      }}
    >
      {/* Brand mark */}
      <div className="flex items-center gap-2.5">
        <div
          className="relative grid h-7 w-7 place-items-center rounded-full border border-[var(--lab-accent)]"
          style={{
            background: "radial-gradient(circle, rgba(74,222,128,0.15), transparent)",
          }}
        >
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--lab-accent)] shadow-[0_0_10px_var(--lab-accent)]" />
          <div
            className="absolute inset-[3px] rounded-full border border-dashed border-[var(--lab-accent)] opacity-40"
            style={{ animation: "lab-spin 18s linear infinite" }}
          />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-none tracking-tight text-[var(--lab-text)]">
            InterAxis Lab
          </div>
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--lab-accent)]">
            Knowledge Graph
          </div>
        </div>
      </div>

      <div className="h-6 w-px bg-[var(--lab-border-strong)]" />

      {/* Breadcrumb (Phase 17) or fallback back-link */}
      {breadcrumb && breadcrumb.length > 0 ? (
        <div className="flex items-center gap-1 text-[11px] font-medium">
          {breadcrumb.map((item, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={`${item.label}-${i}`} className="flex items-center gap-1">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="rounded px-1 py-0.5 text-[var(--lab-text-mid)] transition-colors hover:bg-[var(--lab-panel-raised)] hover:text-[var(--lab-text)]"
                  >
                    {item.label.length > 24 ? item.label.slice(0, 24) + "…" : item.label}
                  </Link>
                ) : (
                  <span
                    className={
                      isLast
                        ? "px-1 font-semibold text-[var(--lab-text)]"
                        : "px-1 text-[var(--lab-text-mid)]"
                    }
                    title={item.label}
                  >
                    {item.label.length > 24 ? item.label.slice(0, 24) + "…" : item.label}
                  </span>
                )}
                {!isLast && <ChevronRight className="h-3 w-3 text-[var(--lab-text-faint)]" />}
              </span>
            );
          })}
        </div>
      ) : (
        <Link
          href={`/app/space/${spaceId}`}
          className="group flex items-center gap-1.5 text-[11px] font-semibold text-[var(--lab-text-mid)] transition-colors hover:text-[var(--lab-text)]"
          title={`Back to ${spaceName}`}
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
          {spaceName}
        </Link>
      )}

      <div className="h-6 w-px bg-[var(--lab-border-strong)]" />

      {/* Specimen info */}
      <div className="flex flex-1 items-center gap-3.5">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--lab-text-dim)]">
            Specimen
          </div>
          <div
            className="text-[17px] font-bold leading-none tracking-tight text-[var(--lab-text)]"
            title={focal.name}
          >
            {focal.name.length > 44 ? focal.name.slice(0, 44) + "…" : focal.name}
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px] font-medium text-[var(--lab-text-mid)]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lab-accent)] shadow-[0_0_8px_var(--lab-accent)]" />
            <b className="font-semibold text-[var(--lab-text)]">LIVE</b>
          </span>
          <span>
            CLASS · <b className="font-semibold text-[var(--lab-text)]">{category}</b>
          </span>
          <span>
            LAYER · <b className="font-semibold text-[var(--lab-text)]">{layerLabel}</b>
          </span>
          <span>
            χ · <b className="font-semibold text-[var(--lab-text)]">{confidencePct}%</b>
          </span>
        </div>
      </div>

      {/* Mode switcher */}
      <LabModeSwitcher mode={mode} onChange={onModeChange} />

      {/* Right-side stats pill — Phase 33: reactor-glass primitive */}
      <div
        className="reactor-glass flex items-center gap-3 px-3 py-1.5"
        style={{ borderRadius: 8 }}
        data-tint="green"
      >
        <StatMini label="Subunits" value={entityCount.toString()} accent="#4ade80" />
        <div className="h-4 w-px bg-[var(--lab-border-strong)]" />
        <StatMini label="Bonds" value={bondCount.toString()} accent="#22d3ee" />
        <div className="h-4 w-px bg-[var(--lab-border-strong)]" />
        <StatMini label="Reactions" value={reactionCount.toString()} accent="#a78bfa" />
      </div>

      {/* Phase 36 — link to the Synthesis Feed for this space. Lands
          users where reactions accumulate over time. Only shown when we
          have a real spaceId (universe lab has writeTargetSpace's id). */}
      {spaceId && (
        <Link
          href={`/app/space/${spaceId}/synthesis/feed`}
          className="group flex h-8 items-center gap-1.5 rounded-md border border-[var(--lab-accent)] bg-[var(--lab-accent-tint)] px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-accent)] transition-colors hover:border-[var(--lab-accent)] hover:bg-[var(--lab-accent-tint)]"
          title="Synthesis Feed · your thinking over time"
        >
          <Sparkles className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
          <span>Feed</span>
        </Link>
      )}

      {/* Activity ping */}
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] text-[var(--lab-text-mid)]">
        <Activity className="h-3.5 w-3.5" />
      </div>

      {/* Phase 28: exit button. Prominent × so users can zoom out of
          the lab without hunting for the breadcrumb. ESC also works. */}
      <Link
        href={exitHref}
        className="group flex h-8 items-center gap-1.5 rounded-md border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-mid)] transition-colors hover:border-[var(--lab-danger)] hover:bg-[var(--lab-danger-tint)] hover:text-[var(--lab-text)]"
        title="Exit lab (ESC)"
        aria-label="Exit lab"
      >
        <X className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
        <span>Exit</span>
        <span className="rounded-sm border border-[var(--lab-border-strong)] bg-[var(--lab-panel-inset)] px-1 py-0.5 font-mono text-[8px] tracking-normal text-[var(--lab-text-dim)]">
          ESC
        </span>
      </Link>
    </header>
  );
}

function StatMini({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
        {label}
      </span>
      <span className="font-mono text-[13px] font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
