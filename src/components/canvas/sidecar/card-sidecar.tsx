"use client";

// ── CardSidecar (Arc 5B.2) ─────────────────────────────────────────────
//
// Right-edge panel that auto-surfaces AI context for the currently-selected
// shape. Three tabs: Insights, Knowledge, Web. Thread-aware when the
// selected shape is a ThreadNoteShape (walks the ancestor chain).
//
// Visual language: Apple Vision Pro clean white.
//   • Glass surface (backdrop-blur-xl, bg-white/82)
//   • No left border — subtle inset shadow for the clean edge
//   • Slide-in 220ms ease-out (reduced-motion → fade only)
//   • Segmented tab bar with accent pill active state
//
// Mount: InteraxisCanvas renders this once and passes the selected shape
// + editor + spaceId. The sidecar hides itself when no shape is selected.

import { useState, useEffect, useMemo } from "react";
import { type TLShape, type Editor } from "tldraw";
import {
  Sparkles,
  GitBranch,
  Globe,
  X,
  MessageSquare,
  StickyNote as StickyNoteIcon,
  Network,
  Layers,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useCardSidecarContext } from "../hooks/use-card-sidecar-context";
import { SidecarTabInsights } from "./sidecar-tab-insights";
import { SidecarTabKnowledge } from "./sidecar-tab-knowledge";
import { SidecarTabWeb } from "./sidecar-tab-web";
import { CardChatbox } from "./card-chatbox";
import { RailAmbientMode } from "./rail-ambient-mode";
import type {
  ThreadNoteShape,
  StickyNoteShape,
  KGNodeShape,
  StrategyShape,
  RootCauseTreeShape,
} from "../shapes/types";

type TabId = "insights" | "knowledge" | "web";

interface Props {
  editor: Editor | null;
  selectedShape: TLShape | null;
  spaceId: string;
  /** Close gesture — user clicks the X. Parent may choose to just deselect. */
  onClose: () => void;
}

/** Extract a display title + icon descriptor for the header chip. */
function describeShape(shape: TLShape | null): {
  title: string;
  kind: string;
  Icon: typeof Sparkles;
  tint: string;
} {
  if (!shape) {
    return { title: "", kind: "", Icon: Sparkles, tint: "rgba(99,102,241,0.12)" };
  }
  if (shape.type === "thread-note") {
    const t = shape as ThreadNoteShape;
    return {
      title: t.props.text || "Empty thread",
      kind: t.props.depth === 0 ? "Root thread" : `Reply · depth ${t.props.depth}`,
      Icon: MessageSquare,
      tint: "rgba(99,102,241,0.14)",
    };
  }
  if (shape.type === "sticky-note") {
    const s = shape as StickyNoteShape;
    return {
      title: s.props.text || "Empty sticky",
      kind: s.props.dimension ? `Sticky · ${s.props.dimension}` : "Sticky note",
      Icon: StickyNoteIcon,
      tint: "rgba(245,158,11,0.18)",
    };
  }
  if (shape.type === "kg-node") {
    const k = shape as KGNodeShape;
    return {
      title: k.props.name,
      kind: `${k.props.category} · ${k.props.layer}`,
      Icon: Network,
      tint: "rgba(6,182,212,0.14)",
    };
  }
  if (shape.type === "strategy-card") {
    const s = shape as StrategyShape;
    return {
      title: s.props.title || "Strategy card",
      kind: `Strategy · ${s.props.label}`,
      Icon: Layers,
      tint: "rgba(16,185,129,0.14)",
    };
  }
  if (shape.type === "root-cause-tree") {
    // Root-cause tree carries summary counters in its props. Surface
    // the two metrics the user cares about most — convergence points
    // (keystone roots) and user-controllable driver count — directly
    // in the header chip so a glance tells them whether this tree has
    // actionable leverage or is dominated by external factors.
    const t = shape as RootCauseTreeShape;
    const levers = t.props.userControllableCount;
    const convs = t.props.convergencePoints;
    return {
      title: t.props.title || "Root-cause tree",
      kind:
        `${convs} converge · ${levers} lever${levers === 1 ? "" : "s"}`,
      Icon: Target,
      tint: "rgba(124,58,237,0.14)",
    };
  }
  return {
    title: `${shape.type} shape`,
    kind: shape.type,
    Icon: Sparkles,
    tint: "rgba(99,102,241,0.12)",
  };
}

export function CardSidecar({ editor, selectedShape, spaceId, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<TabId>("insights");
  const [mounted, setMounted] = useState(false);
  // Arc 5C: chatbox visibility. When true, the chat history panel overlays
  // the tab content. Clicking a tab or the close button returns to ambient.
  const [chatHistoryVisible, setChatHistoryVisible] = useState(false);
  // Arc 5C.7: ephemeral pre-fill buffer for probe-promotion. Reset to null
  // after the chatbox consumes it.
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);

  // Trigger the slide-in animation once per mount. Kept simple — a single
  // transition class toggle keyed on mount, so the animation fires whenever
  // the sidecar appears from hidden.
  useEffect(() => {
    if (selectedShape) {
      setMounted(true);
    } else {
      // Give the slide-out a brief moment before fully unmounting. Matches
      // the 220ms transition duration so the panel fades out gracefully.
      const t = window.setTimeout(() => setMounted(false), reducedMotion ? 0 : 220);
      return () => window.clearTimeout(t);
    }
  }, [selectedShape, reducedMotion]);

  const ctx = useCardSidecarContext({ editor, selectedShape });
  const desc = useMemo(() => describeShape(selectedShape), [selectedShape]);
  const isCardSelected = !!selectedShape;
  // Ambient mode is the new always-visible state — when no card is
  // selected the rail surfaces KG snapshot + active strategy + locked
  // insights + live items instead of disappearing. Card mode (the
  // existing 3-tab UI) takes over when a shape is selected.
  const isVisible = true;

  // Always mount on first render — Ambient mode wants to be visible
  // from canvas mount, not deferred until selection.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted && !isVisible) return null;

  return (
    <aside
      role="complementary"
      aria-label={isCardSelected ? "Card insights" : "Ambient rail"}
      className={cn(
        "pointer-events-auto absolute top-0 right-0 bottom-0 z-30 flex w-[340px] flex-col",
        "bg-white/82 backdrop-blur-xl",
        "shadow-[inset_1px_0_0_rgba(148,163,184,0.18),_0_4px_24px_rgba(15,23,42,0.06)]",
        !reducedMotion && "transition-[transform,opacity] duration-220 ease-out",
        // Always positioned in-view — ambient mode is persistent.
        "translate-x-0 opacity-100",
      )}
      style={{
        // Custom duration — Tailwind doesn't ship 220ms by default.
        transitionDuration: reducedMotion ? "0ms" : "220ms",
      }}
    >
      {/* Header — only shows the card-context chip when a card is
          selected; in ambient mode the header is minimal so the rail
          content has more breathing room. */}
      <header className="flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-gray-100/70 px-4">
        {isCardSelected ? (
          <>
            <span
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: desc.tint }}
            >
              <desc.Icon className="h-3.5 w-3.5 text-slate-700" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-none">
              <span className="truncate text-[13px] font-semibold text-slate-900">
                {desc.title || "Select a card"}
              </span>
              <span className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
                {desc.kind || ""}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close card sidecar"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-gray-100/80 hover:text-slate-700",
                !reducedMotion && "transition-colors duration-150",
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-between">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.16em]"
              style={{ color: "rgba(85,100,121,0.85)" }}
            >
              Right rail
            </span>
            <span className="text-[10px] text-slate-400">
              Select a card for insights
            </span>
          </div>
        )}
      </header>

      {/* Tab bar — shown only in Card mode. Ambient mode has no tabs;
          its content is a single scrollable rail. */}
      {isCardSelected && (
        <nav
          role="tablist"
          aria-label="Sidecar sections"
          className="flex flex-shrink-0 gap-1 border-b border-gray-100/70 px-3 py-2"
        >
          <SidecarTabButton
            label="Insights"
            icon={<Sparkles className="h-3 w-3" />}
            active={activeTab === "insights" && !chatHistoryVisible}
            reducedMotion={reducedMotion}
            onClick={() => {
              setActiveTab("insights");
              setChatHistoryVisible(false);
            }}
          />
          <SidecarTabButton
            label="Knowledge"
            icon={<GitBranch className="h-3 w-3" />}
            active={activeTab === "knowledge" && !chatHistoryVisible}
            reducedMotion={reducedMotion}
            onClick={() => {
              setActiveTab("knowledge");
              setChatHistoryVisible(false);
            }}
          />
          <SidecarTabButton
            label="Web"
            icon={<Globe className="h-3 w-3" />}
            active={activeTab === "web" && !chatHistoryVisible}
            reducedMotion={reducedMotion}
            onClick={() => {
              setActiveTab("web");
              setChatHistoryVisible(false);
            }}
          />
        </nav>
      )}

      {/* Content — Ambient when no selection, Card tabs when something
          is selected. Ambient mode skips the chatbox padding because
          the chat input is hidden in that state. */}
      <section
        role="tabpanel"
        className={cn(
          "flex-1 overflow-y-auto",
          isCardSelected ? "px-4 py-4 pb-20" : "p-0",
        )}
        aria-label={
          isCardSelected ? `${activeTab} tab content` : "Ambient rail content"
        }
      >
        {!isCardSelected && <RailAmbientMode spaceId={spaceId} />}
        {isCardSelected && !ctx && (
          <EmptyState
            title="No context yet"
            body="The selected shape is loading its context. If this persists, the shape may not have an entity attached."
          />
        )}
        {isCardSelected && ctx && activeTab === "insights" && (
          <SidecarTabInsights
            context={ctx}
            spaceId={spaceId}
            onAskProbe={(question) => setChatPrefill(question)}
          />
        )}
        {isCardSelected && ctx && activeTab === "knowledge" && (
          <SidecarTabKnowledge context={ctx} spaceId={spaceId} />
        )}
        {isCardSelected && ctx && activeTab === "web" && (
          <SidecarTabWeb context={ctx} spaceId={spaceId} />
        )}
      </section>

      {/* Arc 5C: Chatbox — history overlay + bottom input bar. Hidden
          in Ambient mode since there's no card to chat about. */}
      {isCardSelected && (
        <CardChatbox
          spaceId={spaceId}
          context={ctx}
          historyVisible={chatHistoryVisible}
          onHistoryVisibleChange={setChatHistoryVisible}
          prefillText={chatPrefill}
          onPrefillConsumed={() => setChatPrefill(null)}
        />
      )}
    </aside>
  );
}

function SidecarTabButton({
  label,
  icon,
  active,
  reducedMotion,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  reducedMotion: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold",
        !reducedMotion && "transition-colors duration-180",
        active
          ? "bg-indigo-500 text-white shadow-[0_1px_2px_rgba(99,102,241,0.25)]"
          : "text-slate-500 hover:bg-slate-100/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <Sparkles className="h-8 w-8 text-slate-300" aria-hidden />
      <p className="text-[12.5px] font-semibold text-slate-700">{title}</p>
      <p className="max-w-[240px] text-[11.5px] leading-relaxed text-slate-500">
        {body}
      </p>
    </div>
  );
}
