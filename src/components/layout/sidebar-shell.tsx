"use client";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/store-provider";

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  return (
    <div
      className={cn(
        "relative flex-shrink-0 transition-all duration-300 p-3 pr-0",
        sidebarOpen
          ? "w-[calc(var(--sidebar-width)+1rem)]"
          : "w-[calc(var(--sidebar-width-collapsed)+1rem)]"
      )}
    >
      <div className="h-full">
        {children}
      </div>
    </div>
  );
}
