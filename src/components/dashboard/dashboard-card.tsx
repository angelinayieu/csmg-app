"use client";

import { useState } from "react";
import { ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  fullscreenable?: boolean;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
  /** Render something in the header's right side (e.g. controls) */
  headerRight?: React.ReactNode;
  /**
   * Optional render callback that receives fullscreen state.
   * When provided, this is rendered instead of `children` in the content area.
   * Allows modules to switch between compact/fullscreen layouts.
   */
  renderContent?: (isFullscreen: boolean) => React.ReactNode;
  /** Expose a way for children to request fullscreen (e.g., "View all →" buttons) */
  fullscreenTriggerRef?: React.MutableRefObject<(() => void) | null>;
}

export function DashboardCard({
  title,
  subtitle,
  icon,
  badge,
  defaultExpanded = true,
  collapsible = true,
  fullscreenable = false,
  className,
  contentClassName,
  children,
  headerRight,
  renderContent,
  fullscreenTriggerRef,
}: DashboardCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [fullscreen, setFullscreen] = useState(false);

  // Expose fullscreen trigger to parent via ref
  if (fullscreenTriggerRef) {
    fullscreenTriggerRef.current = () => {
      setFullscreen(true);
      if (!expanded) setExpanded(true);
    };
  }

  // In fullscreen mode, content should always be visible regardless of collapsed state
  const showContent = fullscreen || expanded;

  const handleFullscreenToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const goingFullscreen = !fullscreen;
    setFullscreen(goingFullscreen);
    // Auto-expand when entering fullscreen
    if (goingFullscreen && !expanded) {
      setExpanded(true);
    }
  };

  return (
    <>
      {/* Fullscreen backdrop */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-[39] bg-black/20 backdrop-blur-sm"
          onClick={() => setFullscreen(false)}
        />
      )}

      <div
        className={cn(
          "rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200",
          fullscreen && "fixed inset-4 z-40 flex flex-col overflow-hidden shadow-2xl",
          className
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 flex-shrink-0",
            collapsible && !fullscreen && "cursor-pointer select-none",
            showContent && "border-b border-gray-100"
          )}
          onClick={collapsible && !fullscreen ? () => setExpanded(!expanded) : undefined}
        >
          {icon && (
            <span className="flex h-5 w-5 items-center justify-center text-gray-400">
              {icon}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-800 truncate">
                {title}
              </h3>
              {badge}
            </div>
            {subtitle && (
              <p className="text-[13px] text-gray-400 truncate">{subtitle}</p>
            )}
          </div>
          {headerRight && (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {headerRight}
            </div>
          )}
          {fullscreenable && (
            <button
              onClick={handleFullscreenToggle}
              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {collapsible && !fullscreen && (
            <ChevronDown
              className={cn(
                "h-4 w-4 text-gray-300 transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          )}
        </div>

        {/* Content */}
        {showContent && (
          <div className={cn(
            "p-4",
            fullscreen && "flex-1 overflow-auto !p-2",
            contentClassName
          )}>
            {renderContent ? renderContent(fullscreen) : children}
          </div>
        )}
      </div>
    </>
  );
}
