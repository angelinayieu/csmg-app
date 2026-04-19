"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Plus, GitBranch, Network, BarChart3, Settings,
  ChevronLeft, LogOut, Coins, Brain, FlaskConical, Sparkles, Target, Database,
  LayoutGrid,
} from "lucide-react";
import { useAppStore } from "@/stores/store-provider";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import type { Space } from "@/types";

// Sidebar nav — grouped by section so new global routes don't clutter the
// existing shell. Sections carry an optional `label` rendered as a tiny
// uppercase header above their first item.

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  // Optional section label rendered above this item (signals new section)
  sectionLabel?: string;
};

const navItems: NavItem[] = [
  // ── Capture ──
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/library", label: "Canvas Library", icon: LayoutGrid },
  { href: "/app/lab", label: "Universal Lab", icon: FlaskConical },
  { href: "/app/brainstorm", label: "Brainstorm", icon: FlaskConical },
  { href: "/app/analyze", label: "New Analysis", icon: Plus },

  // ── Explore ──
  { href: "/app/use-cases", label: "Use Cases", icon: Sparkles, sectionLabel: "Explore" },
  { href: "/app/weave", label: "Weave", icon: GitBranch },
  { href: "/app/bridges", label: "Bridges", icon: Network },

  // ── Review ──
  { href: "/app/objectives/inbox", label: "Objectives Inbox", icon: Target, sectionLabel: "Review" },
  { href: "/app/patterns", label: "Pattern Library", icon: Database },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },

  // ── Admin ──
  { href: "/app/settings", label: "Settings", icon: Settings, sectionLabel: "Admin" },
];

// Deterministic avatar gradient based on letter
const AVATAR_GRADIENTS = [
  "linear-gradient(145deg, #4fa3ff, #0051ff)",
  "linear-gradient(145deg, #6a7cff, #3c44d9)",
  "linear-gradient(145deg, #2d8cff, #003bc4)",
  "linear-gradient(145deg, #8b9dff, #5562e6)",
  "linear-gradient(145deg, #5fbaff, #1a7aff)",
];

function getAvatarGradient(letter: string) {
  const idx = letter.charCodeAt(0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

export function SpaceSidebar({
  userEmail,
  creditBalance = 0,
}: {
  userEmail: string;
  creditBalance?: number;
}) {
  const pathname = usePathname();
  const spaces = useAppStore((s) => s.spaces);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const collapsed = !sidebarOpen;

  const rootSpaces = useMemo(
    () => spaces.filter((s) => !s.parent_space_id),
    [spaces]
  );

  const initials = userEmail
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="glass-sidebar flex h-full flex-col overflow-hidden">
      {/* ── Brand row ── */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2.5">
          {/* Logo mark — brand identity, fixed navy + white */}
          <InterAxisLogo
            className="h-8 w-8 flex-shrink-0"
            style={{
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px rgba(11, 18, 40, 0.35)",
              borderRadius: 8,
            }}
          />
          <span
            className={cn(
              "text-base font-bold tracking-tight text-gray-900 transition-opacity duration-300",
              collapsed && "opacity-0 pointer-events-none"
            )}
          >
            InterAxis
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/60 border border-gray-200 text-gray-400 transition-all hover:bg-white hover:text-gray-600"
        >
          <ChevronLeft
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-300",
              collapsed && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex flex-col gap-0.5 px-3 pb-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/app" && pathname.startsWith(item.href));

          return (
            <div key={item.href}>
              {/* Section header (only when sectionLabel is present) */}
              {item.sectionLabel && (
                <div
                  className={cn(
                    "px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 transition-opacity duration-300",
                    collapsed && "opacity-0 pointer-events-none h-2",
                  )}
                >
                  {item.sectionLabel}
                </div>
              )}

              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-all duration-200",
                  isActive
                    ? "sidebar-nav-active text-interaxis-700 font-semibold"
                    : "text-gray-600 hover:bg-white/60 hover:text-gray-900"
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.8} />
                <span
                  className={cn(
                    "whitespace-nowrap transition-opacity duration-300",
                    collapsed && "opacity-0 pointer-events-none"
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </div>
          );
        })}
      </nav>

      {/* ── Spaces section ── */}
      <div
        className={cn(
          "px-4 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 transition-opacity duration-300",
          collapsed && "opacity-0"
        )}
      >
        Spaces
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        {spaces.length === 0 ? (
          <p
            className={cn(
              "px-3 py-2 text-xs text-gray-400 transition-opacity duration-300",
              collapsed && "opacity-0"
            )}
          >
            No spaces yet.
          </p>
        ) : (
          <>
            {(collapsed ? rootSpaces.slice(0, 5) : rootSpaces).map((space) => (
              <SpaceItem
                key={space.id}
                space={space}
                isActive={pathname === `/app/space/${space.id}` || pathname.startsWith(`/app/space/${space.id}/`)}
                collapsed={collapsed}
              />
            ))}
            {collapsed && rootSpaces.length > 5 && (
              <div className="mt-1 flex justify-center">
                <span className="rounded-full bg-white/60 px-2 py-0.5 text-[9.5px] font-semibold text-gray-500 ring-1 ring-white/70">
                  +{rootSpaces.length - 5}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-white/40 px-3 py-3">
        {/* User card */}
        <div className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-pink-600 text-[11px] font-bold text-white shadow-sm">
            {initials}
          </div>
          <div
            className={cn(
              "min-w-0 flex-1 transition-opacity duration-300",
              collapsed && "opacity-0 pointer-events-none"
            )}
          >
            <p className="truncate text-[11px] font-semibold text-gray-800">
              {userEmail}
            </p>
            <p className="text-[10px] text-gray-500">Pro plan</p>
          </div>
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-opacity duration-300",
              collapsed && "opacity-0 pointer-events-none"
            )}
            style={{
              background: "rgba(var(--accent-rgb), 0.12)",
              border: "1px solid rgba(var(--accent-rgb), 0.25)",
              color: "var(--accent-700)",
            }}
          >
            <Coins className="h-2.5 w-2.5" />
            {creditBalance}
          </div>
        </div>

        {/* Sign out */}
        <div
          className={cn(
            "mt-2 transition-opacity duration-300",
            collapsed && "opacity-0 pointer-events-none"
          )}
        >
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/60 border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-all hover:bg-white hover:text-gray-800"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/* ── Space item ── */
function SpaceItem({
  space,
  isActive,
  collapsed,
}: {
  space: Space;
  isActive: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={`/app/space/${space.id}`}
      className={cn(
        "mb-0.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-all duration-200",
        isActive ? "bg-white/80 shadow-sm" : "hover:bg-white/60 hover:translate-x-0.5"
      )}
      title={collapsed ? space.name : undefined}
    >
      {/* Avatar */}
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] text-[12px] font-bold text-white shadow-sm"
        style={{
          background: getAvatarGradient(space.space_prefix),
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.4), 0 3px 8px rgba(0,50,180,0.18)",
        }}
      >
        {space.space_prefix}
      </div>

      {/* Body */}
      <div
        className={cn(
          "min-w-0 flex-1 transition-opacity duration-300",
          collapsed && "opacity-0 pointer-events-none"
        )}
      >
        <p className="truncate text-[12.5px] font-semibold text-gray-800">
          {space.name}
        </p>
        <p className="truncate text-[10.5px] text-gray-500">
          {space.entity_count} entities · {space.edge_count} edges
        </p>
      </div>

      {/* Status dot */}
      <div
        className={cn(
          "flex items-center gap-1 text-[9.5px] font-semibold text-green-600 transition-opacity duration-300",
          collapsed && "opacity-0"
        )}
      >
        <span
          className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(36,195,110,0.6)]"
          style={{ animation: "pulse-status 2.4s infinite" }}
        />
        <span className={cn(collapsed && "hidden")}>Active</span>
      </div>
    </Link>
  );
}
