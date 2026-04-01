"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Plus, GitBranch, Network } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { SpaceDetailCard } from "@/components/space/space-detail-card";
import { useAppStore } from "@/stores/store-provider";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

const navItems = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/analyze", label: "New Analysis", icon: Plus },
  { href: "/app/weave", label: "Weave", icon: GitBranch },
  { href: "/app/meta", label: "Meta-Graph", icon: Network },
];

export function SpaceSidebar({ userEmail, creditBalance = 0 }: { userEmail: string; creditBalance?: number }) {
  const pathname = usePathname();
  const spaces = useAppStore((s) => s.spaces);

  // Group spaces: root spaces and their sub-spaces
  const { rootSpaces, subSpaceMap } = useMemo(() => {
    const roots = spaces.filter((s) => !s.parent_space_id);
    const subs = new Map<string, typeof spaces>();
    for (const s of spaces) {
      if (s.parent_space_id) {
        const list = subs.get(s.parent_space_id) ?? [];
        list.push(s);
        subs.set(s.parent_space_id, list);
      }
    }
    return { rootSpaces: roots, subSpaceMap: subs };
  }, [spaces]);

  return (
    <aside className="flex h-full w-[var(--sidebar-width)] flex-col border-r border-gray-200 bg-gray-50">
      {/* Logo */}
      <div className="flex items-center border-b border-gray-200 px-4 py-4">
        <span className="text-lg font-bold tracking-tight">InterAxis</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/app" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-interaxis-50 text-interaxis-700"
                    : "text-gray-700 hover:bg-gray-100"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Spaces list */}
        <div className="mt-6">
          <h3 className="px-3 text-xs font-medium uppercase tracking-wider text-gray-500">
            Spaces
          </h3>
          {spaces.length === 0 ? (
            <p className="mt-2 px-3 text-xs text-gray-400">
              No spaces yet. Analyze your first concept.
            </p>
          ) : (
            <div className="mt-2 space-y-0.5">
              {rootSpaces.map((space) => (
                <SpaceDetailCard
                  key={space.id}
                  space={space}
                  isActive={pathname === `/app/space/${space.id}`}
                  subSpaces={subSpaceMap.get(space.id)}
                />
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="truncate text-xs text-gray-500">{userEmail}</p>
          <div className="flex items-center gap-1 rounded-full bg-interaxis-50 px-2 py-0.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-interaxis-600">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="6" cy="6" r="2" fill="currentColor" />
            </svg>
            <span className="text-[10px] font-semibold text-interaxis-700">{creditBalance}</span>
          </div>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
