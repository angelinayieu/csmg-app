"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutGrid, FlaskConical } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";

interface TabDef {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  matches: (pathname: string) => boolean;
}

const TABS: TabDef[] = [
  {
    href: "/app/objective",
    label: "Objective Canvas",
    icon: LayoutGrid,
    matches: (p) => p.startsWith("/app/objective"),
  },
  {
    href: "/app",
    label: "Synergy",
    icon: Sparkle,
    matches: (p) => p === "/app" || p.startsWith("/app?"),
  },
  {
    href: "/app/strategy-lab",
    label: "Strategy Lab",
    icon: FlaskConical,
    matches: (p) => p.startsWith("/app/strategy-lab"),
  },
];

export function HomeTabNav() {
  const pathname = usePathname() ?? "/app";
  const searchParams = useSearchParams();

  // When a route is rendered INSIDE a spatial window (the whiteboard's
  // CanvasWorkspaceRoomFullscreen iframes it with ?embed=1), the window
  // supplies its own chrome — so the app's top tab nav would be
  // redundant/recursive. Hide it. This is the single embed touchpoint;
  // no content route page needs to change.
  if (searchParams?.get("embed") === "1") return null;

  return (
    <nav
      className="pointer-events-auto fixed inset-x-0 top-3 z-50 flex justify-center"
      aria-label="Primary home tabs"
    >
      <div
        className="flex items-center gap-1 rounded-full p-1 backdrop-blur-xl"
        style={{
          background: "rgba(255,255,255,0.72)",
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)",
        }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.matches(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="group flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition-all"
              style={{
                background: active ? "rgba(15,23,42,0.92)" : "transparent",
                color: active ? "white" : "rgba(15,23,42,0.62)",
                letterSpacing: active ? "-0.005em" : "0",
              }}
            >
              <Icon
                className="h-3 w-3"
                strokeWidth={active ? 2 : 1.75}
              />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
