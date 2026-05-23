"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid, FlaskConical, BookOpen, Database, Activity, Microscope } from "lucide-react";
import { IconDashboard } from "@/components/dashboard/glass-glyphs";
import { cn } from "@/lib/utils";

export interface SidebarItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  group: "overview" | "workspace" | "library";
  show_for_templates?: string[];
}

export interface FloatingGlassSidebarHandle {
  /** Returns the bounding rect of the currently-active button so the
   *  projection panel can sync its origin even when no click happened
   *  (URL-loaded routes, refreshes). */
  getActiveButtonRect: () => DOMRect | null;
}

export interface FloatingGlassSidebarProps {
  spaceId: string;
  useCaseTemplateId?: string | null;
  /** Fired when a button is activated by click. The whiteboard item
   *  passes `dismissProjection: true` so the parent knows to drop
   *  fullscreen state. */
  onActivate: (args: {
    rect: DOMRect;
    id: string;
    href: string;
    dismissProjection: boolean;
  }) => void;
  /** Auto-fires whenever the active route changes, so the parent can
   *  re-anchor the projection's tail and transform-origin without a
   *  user click. Distinct from onActivate because no navigation
   *  happened. */
  onActiveRectChange?: (rect: DOMRect | null) => void;
  /** When true the sidebar slides off the left edge with a fade. The
   *  hide animation lives on the motion element itself so the rail
   *  doesn't get a transformed ancestor (which would break
   *  position:fixed). */
  hidden?: boolean;
  /** Compact pill width (used when peeking inside a fullscreen
   *  projection so the rail stays narrow). */
  compact?: boolean;
  /** Whiteboard mode: collapse to a thin glass strip with section
   *  dots; expand to full pills only on hover. Also writes
   *  `--kg-rail-offset` to <html> so the canvas tool dock can slide
   *  out of the way with spring physics. */
  railMode?: boolean;
}

const EASE = [0.22, 1, 0.36, 1] as const;

const GROUP_LABEL: Record<SidebarItem["group"], string> = {
  overview: "Overview",
  workspace: "Workspace",
  library: "Library",
};

/**
 * Floating glassmorphism sidebar for the projection shell.
 *
 * Always positioned at the left edge, vertically centered. Visible on
 * every route including /whiteboard so the user can switch sections
 * without navigating "back". Clicking a non-whiteboard item projects a
 * card out from the button; clicking Whiteboard dismisses any open
 * projection so the bare canvas is visible underneath.
 */
export const FloatingGlassSidebar = forwardRef<
  FloatingGlassSidebarHandle,
  FloatingGlassSidebarProps
>(function FloatingGlassSidebar(
  {
    spaceId,
    useCaseTemplateId,
    onActivate,
    onActiveRectChange,
    hidden = false,
    compact = false,
    railMode = false,
  },
  ref,
) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/app/space/${spaceId}`;
  const buttonRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  // Rail mode: collapsed by default, expanded on hover. The expanded
  // state drives BOTH the visual swap (strip ↔ pills) and the CSS
  // variable that the canvas tool dock reads to slide right.
  const [railExpanded, setRailExpanded] = useState(false);

  const items: SidebarItem[] = useMemo(
    () => [
      {
        id: "dashboard",
        label: "Dashboard",
        href: base,
        icon: <IconDashboard className="h-[15px] w-[15px]" />,
        group: "overview",
      },
      {
        id: "whiteboard",
        label: "Whiteboard",
        href: `${base}/whiteboard`,
        icon: <LayoutGrid className="h-[15px] w-[15px]" />,
        group: "workspace",
      },
      {
        id: "triple-lab",
        label: "Synthesis Lab",
        href: `${base}/triple-lab`,
        icon: <Microscope className="h-[15px] w-[15px]" />,
        group: "workspace",
      },
      {
        id: "timeline",
        label: "Timeline",
        href: `${base}/timeline`,
        icon: <Activity className="h-[15px] w-[15px]" />,
        group: "workspace",
      },
      {
        id: "lab",
        label: "Lab",
        href: `${base}/lab`,
        icon: <FlaskConical className="h-[15px] w-[15px]" />,
        group: "workspace",
      },
      {
        id: "journal",
        label: "Journal",
        href: `${base}/journal`,
        icon: <BookOpen className="h-[15px] w-[15px]" />,
        group: "workspace",
        show_for_templates: ["journal_self_discovery", "relationship_dynamics"],
      },
      {
        id: "patterns",
        label: "Pattern Library",
        href: `/patterns`,
        icon: <Database className="h-[15px] w-[15px]" />,
        group: "library",
      },
    ],
    [base],
  );

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (!item.show_for_templates) return true;
        return useCaseTemplateId
          ? item.show_for_templates.includes(useCaseTemplateId)
          : false;
      }),
    [items, useCaseTemplateId],
  );

  const isActive = useCallback(
    (href: string) => {
      if (href === base) return pathname === base;
      return pathname.startsWith(href);
    },
    [pathname, base],
  );

  const activeId = useMemo(
    () => visible.find((item) => isActive(item.href))?.id ?? null,
    [visible, isActive],
  );

  // Auto-emit the active button's rect on mount + whenever the active
  // route changes. Lets the projection panel anchor its tail/origin to
  // the right button without a click. Includes a small RAF so the
  // measurement happens after the browser paints the (possibly newly-
  // animated-in) sidebar.
  useEffect(() => {
    if (!onActiveRectChange) return;
    if (!activeId) {
      onActiveRectChange(null);
      return;
    }
    let rafId: number;
    const measure = () => {
      const el = buttonRefs.current.get(activeId);
      onActiveRectChange(el?.getBoundingClientRect() ?? null);
    };
    rafId = requestAnimationFrame(() =>
      requestAnimationFrame(measure),
    );
    return () => cancelAnimationFrame(rafId);
  }, [activeId, onActiveRectChange, hidden]);

  useImperativeHandle(
    ref,
    () => ({
      getActiveButtonRect: () => {
        if (!activeId) return null;
        const el = buttonRefs.current.get(activeId);
        return el?.getBoundingClientRect() ?? null;
      },
    }),
    [activeId],
  );

  // Broadcast rail expansion to the canvas tool dock via a CSS var on
  // <html>. Only writes while in railMode; cleared on unmount or when
  // exiting railMode so the dock returns to its default left-4 inset.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!railMode) {
      root.style.removeProperty("--kg-rail-offset");
      return;
    }
    // Rail is at left-2 (8px). fixedExpanded pills are w-40 (160px).
    // Right edge = 168px. Dock = 1rem (16px) + 152px = 168px — flush.
    // Add 4px breathing gap → offset 156px → dock at 172px.
    root.style.setProperty(
      "--kg-rail-offset",
      railExpanded ? "156px" : "0px",
    );
    return () => {
      root.style.removeProperty("--kg-rail-offset");
    };
  }, [railMode, railExpanded]);

  // Group items in render order (Overview → Workspace → Library) with
  // a hairline divider between groups. Within each group items are
  // listed in their declared order.
  const grouped = useMemo(() => {
    const groups: Array<[SidebarItem["group"], SidebarItem[]]> = [
      ["overview", []],
      ["workspace", []],
      ["library", []],
    ];
    const map = new Map(groups);
    for (const item of visible) {
      map.get(item.group)!.push(item);
    }
    return groups
      .map(([g]) => [g, map.get(g)!] as const)
      .filter(([, list]) => list.length > 0);
  }, [visible]);

  // Rail-collapsed view = thin glass strip with one dot per section.
  // Active section's dot is accent-tinted and slightly larger. Hover
  // anywhere on the rail OR strip swaps to the full pill stack.
  const showStrip = railMode && !railExpanded;

  return (
    <motion.nav
      initial={{ opacity: 0, x: -16 }}
      animate={{
        opacity: hidden ? 0 : 1,
        x: hidden ? -120 : 0,
      }}
      transition={{ duration: 0.42, ease: EASE }}
      style={{ pointerEvents: hidden ? "none" : "auto" }}
      onMouseEnter={() => railMode && setRailExpanded(true)}
      onMouseLeave={() => railMode && setRailExpanded(false)}
      className={cn(
        "fixed top-1/2 z-50 -translate-y-1/2 select-none",
        railMode ? "left-2" : compact ? "left-3" : "left-5",
      )}
      aria-label="Space sections"
    >
      <AnimatePresence mode="wait" initial={false}>
        {showStrip ? (
          <motion.button
            key="rail-strip"
            type="button"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.28, ease: EASE }}
            // Clicking the strip also expands — accessibility + touch
            // devices that don't trigger hover.
            onClick={() => setRailExpanded(true)}
            aria-label="Expand navigation"
            className={cn(
              "group flex flex-col items-center gap-3 rounded-full",
              "border border-white/65 bg-white/55 px-1.5 py-3.5",
              "backdrop-blur-2xl backdrop-saturate-150",
              "shadow-[0_8px_24px_-10px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.95)]",
              "transition-[box-shadow,background,border-color] duration-300 ease-out",
              "hover:border-white/85 hover:bg-white/75",
              "hover:shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_0_24px_rgba(6,145,154,0.28),0_14px_36px_-12px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,1)]",
            )}
          >
            {visible.map((item) => {
              const active = activeId === item.id;
              return (
                <span
                  key={item.id}
                  className={cn(
                    "block rounded-full transition-all duration-300 ease-out",
                    active
                      ? "h-2 w-2 bg-[color:rgb(var(--accent-rgb,6_145_154))] shadow-[0_0_8px_rgba(6,145,154,0.55)]"
                      : "h-1.5 w-1.5 bg-slate-400/60 group-hover:bg-slate-500/80",
                  )}
                  aria-hidden
                />
              );
            })}
          </motion.button>
        ) : (
          <motion.div
            key="rail-pills"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="flex flex-col gap-2.5"
          >
            {grouped.map(([group, list], gi) => (
              <div key={group} className="flex flex-col gap-2">
                {gi > 0 && (
                  <div
                    className="mx-auto h-px w-6 bg-gradient-to-r from-transparent via-slate-300/60 to-transparent"
                    aria-hidden
                  />
                )}
                <div className="flex flex-col gap-2">
                  {list.map((item) => (
                    <SidebarButton
                      key={item.id}
                      item={item}
                      active={activeId === item.id}
                      compact={compact}
                      // In rail-expanded mode every pill has a fixed
                      // width + always-visible label so the tool dock
                      // offset (--kg-rail-offset) can be set precisely
                      // once. Without this the per-button hover-expand
                      // pushes pills wider than the offset and the dock
                      // ends up behind the pill.
                      fixedExpanded={railMode}
                      registerRef={(el) => {
                        if (el) buttonRefs.current.set(item.id, el);
                        else buttonRefs.current.delete(item.id);
                      }}
                      onActivate={(rect) => {
                        // Full-viewport destinations (whiteboard +
                        // triple-lab) tell the parent to drop the
                        // projection's fullscreen state — they own the
                        // viewport themselves and don't render inside
                        // the projection panel.
                        const isFullViewport =
                          item.id === "whiteboard" || item.id === "triple-lab";
                        onActivate({
                          rect,
                          id: item.id,
                          href: item.href,
                          dismissProjection: isFullViewport,
                        });
                        router.push(item.href);
                      }}
                      groupLabel={GROUP_LABEL[group]}
                    />
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
});

interface SidebarButtonProps {
  item: SidebarItem;
  active: boolean;
  compact: boolean;
  /** When true the pill has a fixed w-40 width and the label is always
   *  visible. Used in railMode-expanded so the dock offset can be set
   *  precisely once (no per-button hover-expand fighting the CSS var). */
  fixedExpanded?: boolean;
  registerRef: (el: HTMLAnchorElement | null) => void;
  onActivate: (rect: DOMRect) => void;
  groupLabel: string;
}

function SidebarButton({
  item,
  active,
  compact,
  fixedExpanded = false,
  registerRef,
  onActivate,
}: SidebarButtonProps) {
  const localRef = useRef<HTMLAnchorElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLAnchorElement | null) => {
      localRef.current = el;
      registerRef(el);
    },
    [registerRef],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = localRef.current?.getBoundingClientRect();
      if (rect) onActivate(rect);
    },
    [onActivate],
  );

  return (
    <Link
      ref={setRefs}
      href={item.href}
      onClick={handleClick}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "group relative flex items-center overflow-hidden rounded-full",
        "border bg-clip-padding backdrop-blur-2xl backdrop-saturate-150",
        "transition-[width,transform,background,box-shadow,border-color] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        // fixedExpanded: no hover-translate (pill is already at full
        // width so motion would look wrong); normal mode keeps the
        // subtle -1px nudge as the hover affordance.
        !fixedExpanded && "hover:-translate-x-[1px]",
        // Width —
        //   fixedExpanded: fixed w-40 (160px), no hover change
        //   normal compact: w-9 base, w-44 hover
        //   normal full:    w-[42px] base, w-44 hover
        fixedExpanded
          ? "w-40 h-[38px]"
          : compact
            ? "h-9 w-9 hover:w-44"
            : "h-[42px] w-[42px] hover:w-44",
        active
          ? [
              "border-white/85 bg-white/90 text-[color:rgb(var(--accent-rgb,6_145_154))]",
              "shadow-[0_8px_28px_-8px_rgba(6,145,154,0.45),inset_0_1px_0_rgba(255,255,255,1)]",
              "ring-1 ring-[color:rgb(var(--accent-rgb,6_145_154))]/25",
            ]
          : [
              "border-white/55 bg-white/55 text-[color:var(--muted-fg,#475569)]",
              "shadow-[0_8px_24px_-10px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]",
              "hover:border-white/75 hover:bg-white/80 hover:text-[color:var(--fg,#1d1d1f)]",
              "hover:shadow-[0_12px_30px_-10px_rgba(15,23,42,0.24),inset_0_1px_0_rgba(255,255,255,0.95)]",
            ],
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          fixedExpanded ? "h-[38px] w-[38px]" : compact ? "h-9 w-9" : "h-[42px] w-[42px]",
          "transition-colors",
        )}
      >
        {item.icon}
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-[12px] font-medium tracking-[-0.005em]",
          // fixedExpanded: always visible, tight right padding.
          // Normal mode: fade in on hover with more generous padding.
          fixedExpanded
            ? "pr-3 opacity-100"
            : "pr-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}
