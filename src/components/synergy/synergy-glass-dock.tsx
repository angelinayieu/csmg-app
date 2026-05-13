// ── Synergy glass dock ──
//
// Floating bottom navigation pill — 5 icons, always reachable. The
// bell icon shows the pending-incoming count badge (re-uses the
// existing SynergyBellBadge logic).
//
// Visual stack:
//   - Background: glass (rgba(255,255,255,0.65) + backdrop-blur-xl)
//   - Inner top hairline (inset 0 1px 0 rgba(255,255,255,0.7))
//   - Outer: triple shadow (contact + ambient + cyan glow)
//   - Active icon: gradient background tile + dot underneath
//   - Hover: scale 1.1 + soft glow

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Compass,
  FileText,
  Home,
  Layers,
} from "lucide-react";
import { getNotificationCount } from "@/lib/synergy/match-client";

interface DockItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (pathname: string) => boolean;
  showBadge?: boolean;
}

const ITEMS: DockItem[] = [
  {
    href: "/app",
    label: "Home",
    icon: Home,
    match: (p) => p === "/app" || p === "/app/",
  },
  {
    href: "/app/synergy",
    label: "Brainstorms",
    icon: Layers,
    match: (p) =>
      p.startsWith("/app/synergy") &&
      !p.startsWith("/app/synergy/discover") &&
      !p.startsWith("/app/synergy/requests"),
  },
  {
    href: "/app/strategy/new",
    label: "Strategies",
    icon: FileText,
    match: (p) => p.startsWith("/app/strategy"),
  },
  {
    href: "/app/synergy/discover",
    label: "Discover",
    icon: Compass,
    match: (p) => p.startsWith("/app/synergy/discover"),
  },
  {
    href: "/app/synergy/requests",
    label: "Inbox",
    icon: Bell,
    match: (p) => p.startsWith("/app/synergy/requests"),
    showBadge: true,
  },
];

export function SynergyGlassDock() {
  const pathname = usePathname() ?? "/app";
  const [inboxCount, setInboxCount] = useState(0);

  // Poll the bell-badge count every 60s while the dock is mounted.
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const n = await getNotificationCount();
        if (!cancelled) setInboxCount(n);
      } catch {
        // soft-fail
      }
    };
    void fetchCount();
    const interval = window.setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <nav
        aria-label="Synergy navigation"
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full p-1.5"
        style={{
          background: "rgba(255, 255, 255, 0.65)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: [
            "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
            "0 1px 2px rgba(15, 23, 42, 0.06)",
            "0 12px 32px -8px rgba(15, 23, 42, 0.12)",
            "0 0 40px -10px rgba(6, 182, 212, 0.25)",
          ].join(", "),
          border: "1px solid rgba(255, 255, 255, 0.5)",
        }}
      >
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200"
              style={{
                background: active
                  ? "linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(99, 102, 241, 0.12))"
                  : "transparent",
                transform: active ? "scale(1)" : undefined,
              }}
            >
              <span
                style={{ transform: active ? "scale(1.05)" : undefined }}
                className="inline-flex"
              >
                <Icon
                  className={[
                    "h-4 w-4 transition-all",
                    active ? "text-blue-700" : "text-gray-500 group-hover:text-gray-900",
                  ].join(" ")}
                />
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute -bottom-1 left-1/2 inline-block h-1 w-1 -translate-x-1/2 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500"
                />
              )}
              {item.showBadge && inboxCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 px-1 font-mono text-[9px] font-semibold text-white shadow-sm"
                  style={{
                    animation: "synergyDockBellPulse 1.8s ease-in-out infinite",
                  }}
                >
                  {inboxCount > 9 ? "9+" : inboxCount}
                </span>
              )}
              <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <style jsx>{`
        @keyframes synergyDockBellPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.18); }
        }
      `}</style>
    </div>
  );
}
