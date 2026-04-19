"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TieredListProps<T> {
  items: T[];
  heroCount?: number;
  secondaryCount?: number;
  renderHero: (item: T, index: number) => React.ReactNode;
  renderSecondary: (item: T, index: number) => React.ReactNode;
  renderCompact?: (item: T, index: number) => React.ReactNode;
  heroClassName?: string;
  secondaryClassName?: string;
  collapsedClassName?: string;
  label?: string;
  showSecondaryByDefault?: boolean;
}

export function TieredList<T>({
  items,
  heroCount = 3,
  secondaryCount = 5,
  renderHero,
  renderSecondary,
  renderCompact,
  heroClassName,
  secondaryClassName,
  collapsedClassName,
  label = "items",
  showSecondaryByDefault = true,
}: TieredListProps<T>) {
  const [showCollapsed, setShowCollapsed] = useState(false);

  if (items.length === 0) return null;

  const heroItems = items.slice(0, heroCount);
  const secondaryItems = items.slice(heroCount, heroCount + secondaryCount);
  const collapsedItems = items.slice(heroCount + secondaryCount);

  const renderCollapsedItem = renderCompact ?? renderSecondary;

  return (
    <div>
      {/* Hero tier */}
      {heroItems.length > 0 && (
        <div className={heroClassName}>
          {heroItems.map((item, i) => (
            <React.Fragment key={i}>{renderHero(item, i)}</React.Fragment>
          ))}
        </div>
      )}

      {/* Secondary tier */}
      {secondaryItems.length > 0 && showSecondaryByDefault && (
        <div className={secondaryClassName}>
          {secondaryItems.map((item, i) => (
            <React.Fragment key={heroCount + i}>
              {renderSecondary(item, heroCount + i)}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Collapsed tier */}
      {collapsedItems.length > 0 && (
        <>
          {showCollapsed && (
            <div className={collapsedClassName}>
              {collapsedItems.map((item, i) => (
                <React.Fragment key={heroCount + secondaryCount + i}>
                  {renderCollapsedItem(item, heroCount + secondaryCount + i)}
                </React.Fragment>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowCollapsed((v) => !v)}
            className={cn(
              "mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            )}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showCollapsed && "rotate-180"
              )}
            />
            {showCollapsed
              ? `Hide ${collapsedItems.length} ${label}`
              : `Show ${collapsedItems.length} more ${label}`}
          </button>
        </>
      )}
    </div>
  );
}
