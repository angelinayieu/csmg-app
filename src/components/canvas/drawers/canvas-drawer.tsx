"use client";

// ── Generic canvas drawer shell ──
//
// Right-side slide-in panel used by Synthesis / Intelligence / Inventory
// drawers. Renders tab bar + scrollable content area. Controlled via
// `useDrawerState`. Close on Escape + click-outside + explicit X.
//
// Width: 520px. Z-index sits above canvas chrome but below modals.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DrawerTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface CanvasDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tabs?: DrawerTab[];
  activeTab?: string | null;
  onTabChange?: (tabId: string) => void;
  children: React.ReactNode;
  widthPx?: number;
}

export function CanvasDrawer({
  open,
  onClose,
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  children,
  widthPx = 520,
}: CanvasDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Scrim */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/10 transition-opacity"
          onClick={onClose}
        />
      )}
      {/* Panel */}
      <aside
        ref={panelRef}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ width: widthPx }}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                {subtitle ?? "Drawer"}
              </div>
              <h2 className="truncate text-[15px] font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
              title="Close drawer (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Tabs */}
          {tabs && tabs.length > 0 && (
            <div className="mt-3 flex gap-0.5 overflow-x-auto">
              {tabs.map((t) => {
                const selected = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    onClick={() => onTabChange?.(t.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                      selected
                        ? "bg-interaxis-50 text-interaxis-700"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}
