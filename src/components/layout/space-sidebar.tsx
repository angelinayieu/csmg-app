"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Plus,
  GitBranch,
  Network,
  Layers,
} from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { useAppStore } from "@/stores/store-provider";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/decompose", label: "New Decomposition", icon: Plus },
  { href: "/app/weave", label: "Weave", icon: GitBranch, disabled: true },
  { href: "/app/meta", label: "Meta-Graph", icon: Network, disabled: true },
];

export function SpaceSidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const spaces = useAppStore((s) => s.spaces);

  return (
    <aside className="flex h-full w-[var(--sidebar-width)] flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-4 dark:border-gray-800">
        <Layers className="h-5 w-5 text-blue-600" />
        <span className="font-semibold">CSMG</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/app" && pathname.startsWith(item.href));

            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 dark:text-gray-600"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <span className="ml-auto text-xs">Soon</span>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
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
            <p className="mt-2 px-3 text-xs text-gray-400 dark:text-gray-500">
              No spaces yet. Decompose your first concept.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {spaces.map((space) => (
                <Link
                  key={space.id}
                  href={`/app/space/${space.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    pathname === `/app/space/${space.id}`
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  )}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-100 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    {space.space_prefix}
                  </span>
                  <span className="truncate">{space.name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
        <p className="mb-2 truncate text-xs text-gray-500">{userEmail}</p>
        <LogoutButton />
      </div>
    </aside>
  );
}
