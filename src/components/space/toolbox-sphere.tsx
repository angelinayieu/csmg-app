"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { TOOLS, SPHERE_SIZE, type ToolId, type ToolDef } from "@/lib/tools";
import { dispatchToolboxEvent } from "@/lib/toolbox-events";
import { cn } from "@/lib/utils";

interface ToolboxSphereProps {
  /** Open the comment modal — owned by parent (app-layout) */
  onOpenComment: () => void;
}

export function ToolboxSphere({ onOpenComment }: ToolboxSphereProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onSpacePage = pathname?.startsWith("/app/space/") ?? false;

  // Filter tools: only show space-required tools when on a space page
  const visibleTools = TOOLS.filter((t) => !t.requiresSpace || onSpacePage);

  const clearCollapse = useCallback(() => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearCollapse();
    collapseTimer.current = window.setTimeout(() => {
      setOpen(false);
      setActiveTool(null);
    }, 260);
  }, [clearCollapse]);

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearCollapse();
        setOpen(false);
        setActiveTool(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [clearCollapse]);

  // Click-outside closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        clearCollapse();
        setOpen(false);
        setActiveTool(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, clearCollapse]);

  // Keyboard shortcuts: Shift + letter
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const tool = visibleTools.find((t) => t.kbd.toUpperCase() === e.key.toUpperCase());
      if (tool) {
        e.preventDefault();
        handleToolClick(tool);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTools]);

  useEffect(() => () => clearCollapse(), [clearCollapse]);

  function handleToolClick(tool: ToolDef) {
    switch (tool.id) {
      case "chat":
        if (onSpacePage) dispatchToolboxEvent({ type: "open-chat" });
        else router.push("/app");
        break;
      case "comment":
        onOpenComment();
        break;
      case "reevaluate":
        dispatchToolboxEvent({ type: "reevaluate", depth: "deep" });
        break;
      case "refresh_strategy":
        dispatchToolboxEvent({ type: "refresh-strategy" });
        break;
      case "quick_check":
        dispatchToolboxEvent({ type: "quick-check" });
        break;
      case "quick_decompose":
        dispatchToolboxEvent({ type: "quick-decompose" });
        break;
      case "research":
        dispatchToolboxEvent({ type: "research" });
        break;
    }
    clearCollapse();
    setOpen(false);
    setActiveTool(null);
  }

  // Container — fixed bottom-right of viewport.
  // Pills stack in a clean VERTICAL column above the sphere, right-aligned to a fixed edge.
  // This guarantees no pill-to-pill overlap and a predictable bounding box.
  const PILL_HEIGHT = 36;
  const PILL_GAP = 10;
  const PILL_STEP = PILL_HEIGHT + PILL_GAP; // 46px between pill centers
  const PILL_RIGHT_OFFSET = 12; // horizontal gap between pill right-edge and sphere
  const STACK_BOTTOM_OFFSET = SPHERE_SIZE + 16; // lift whole stack above the sphere

  const stackHeight = visibleTools.length * PILL_STEP + STACK_BOTTOM_OFFSET;
  const stackWidth = 260; // max pill width budget
  const containerWidth = stackWidth + SPHERE_SIZE + PILL_RIGHT_OFFSET + 24;
  const containerHeight = stackHeight + 40;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed z-[40]"
      style={{
        right: 20,
        bottom: 20,
        width: containerWidth,
        height: containerHeight,
      }}
      onMouseEnter={clearCollapse}
      onMouseLeave={scheduleCollapse}
    >
      {/* Soft radial glow that expands with the fan */}
      <div
        className={cn(
          "toolbox-glow absolute pointer-events-none transition-all duration-500 ease-out",
          open ? "opacity-100" : "opacity-0"
        )}
        style={{
          right: -40,
          bottom: -40,
          width: containerWidth + 80,
          height: containerHeight + 80,
        }}
      />

      {/* Tool pills — vertical stack, right-aligned, lowest pill closest to sphere */}
      {visibleTools.map((tool, idx) => {
        // idx=0 is the "closest" tool (nearest sphere). We want it closest visually,
        // so stack grows upward from bottom. Pill 0 sits just above the sphere.
        const verticalOffset = STACK_BOTTOM_OFFSET + idx * PILL_STEP;
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;

        return (
          <button
            key={tool.id}
            onMouseEnter={() => {
              clearCollapse();
              setActiveTool(tool.id);
            }}
            onMouseLeave={() => setActiveTool(null)}
            onClick={() => handleToolClick(tool)}
            className={cn(
              "toolbox-pill group absolute flex h-[36px] items-center gap-2 rounded-full px-3 pr-2 whitespace-nowrap",
              "transition-[transform,opacity,box-shadow,background,border-color] duration-[460ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
              isActive && "toolbox-pill--active"
            )}
            style={{
              // Right-align each pill to a fixed vertical edge, so widths vary without breaking alignment.
              right: SPHERE_SIZE + PILL_RIGHT_OFFSET,
              bottom: verticalOffset,
              transformOrigin: "right bottom",
              transform: open
                ? `translateY(0) scale(1)`
                : `translateY(${verticalOffset - 8}px) scale(0.85)`,
              opacity: open ? 1 : 0,
              transitionDelay: open ? `${idx * 40}ms` : "0ms",
              pointerEvents: open ? "auto" : "none",
            }}
            title={`${tool.label} (Shift+${tool.kbd})`}
          >
            <Icon className="h-[15px] w-[15px] flex-shrink-0 text-white/90" strokeWidth={2} />
            <span className="text-[12.5px] font-medium text-white/95 whitespace-nowrap">
              {tool.label}
            </span>
            <span className="kbd-badge ml-1 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10.5px] font-semibold text-white/85">
              {tool.kbd}
            </span>
          </button>
        );
      })}

      {/* The sphere — bottom-right anchor of container */}
      <button
        onMouseEnter={() => {
          clearCollapse();
          setOpen(true);
        }}
        onClick={() => setOpen((o) => !o)}
        aria-label="Toolbox"
        className={cn(
          "toolbox-sphere-v2 absolute flex items-center justify-center rounded-full",
          open && "toolbox-sphere-v2--active"
        )}
        style={{
          right: 0,
          bottom: 0,
          width: SPHERE_SIZE,
          height: SPHERE_SIZE,
          pointerEvents: "auto",
        }}
      >
        <LayoutGrid
          className={cn(
            "h-[22px] w-[22px] text-white transition-transform duration-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]",
            open && "scale-110 rotate-[8deg]"
          )}
          strokeWidth={2.4}
        />
      </button>
    </div>
  );
}
