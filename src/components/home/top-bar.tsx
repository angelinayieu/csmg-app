"use client";

// ── TopBar ──
//
// Single navigation surface for the immersive home — replaces the
// legacy left sidebar entirely. Left cluster: brand + primary
// destinations (Whiteboards, Lab, Explore). Right cluster: Overview
// dropdown (Objectives Inbox / Pattern Library / Analytics), Settings,
// Agent activity bell, ⌘K, and a profile chip with credits + sign-out.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Coins,
  Command,
  Database,
  FlaskConical,
  LayoutGrid,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
  Target,
} from "lucide-react";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import { AgentActivityBell } from "@/components/agent-pulse/agent-activity-bell";

export interface TopBarProps {
  userEmail: string;
  userId?: string | null;
  creditBalance?: number;
  whiteboardCount?: number;
  onViewLibrary?: () => void;
}

const overviewItems: Array<{
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  {
    href: "/app/objectives/inbox",
    label: "Objectives Inbox",
    desc: "Triage router-proposed objectives",
    icon: Target,
  },
  {
    href: "/app/patterns",
    label: "Pattern Library",
    desc: "Institutional patterns from analyses",
    icon: Database,
  },
  {
    href: "/app/analytics",
    label: "Analytics",
    desc: "KG metrics + loop history",
    icon: BarChart3,
  },
];

export function TopBar({
  userEmail,
  userId,
  creditBalance = 0,
  whiteboardCount,
  onViewLibrary,
}: TopBarProps) {
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const overviewRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close popovers on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (overviewRef.current && !overviewRef.current.contains(e.target as Node)) {
        setOverviewOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const initials = userEmail.split("@")[0].slice(0, 2).toUpperCase();

  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-6 pt-5">
      {/* ── Left cluster: brand + primary destinations ── */}
      <div className="flex items-center gap-2.5">
        <Link
          href="/app"
          className="flex items-center gap-2 rounded-full px-1 py-1 transition-opacity hover:opacity-80"
          title="InterAxis home"
        >
          <InterAxisLogo
            className="h-7 w-7 flex-shrink-0"
            style={{
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px rgba(11,18,40,0.35)",
              borderRadius: 8,
            }}
          />
          <span className="text-[13px] font-bold tracking-tight text-[color:var(--home-text)]">
            InterAxis
          </span>
        </Link>

        <span className="mx-1 h-4 w-px bg-[color:var(--home-chrome-stroke)]" />

        {onViewLibrary && (
          <ChromeButton
            onClick={onViewLibrary}
            icon={<LayoutGrid className="h-3 w-3" strokeWidth={1.75} />}
            title="View your whiteboards library"
          >
            {whiteboardCount && whiteboardCount > 0
              ? `${whiteboardCount} whiteboard${whiteboardCount === 1 ? "" : "s"}`
              : "Whiteboards"}
          </ChromeButton>
        )}

        <ChromeLink
          href="/app/lab"
          icon={<FlaskConical className="h-3 w-3" strokeWidth={1.75} />}
          title="Universal Lab — cross-space knowledge reactor"
        >
          Lab
        </ChromeLink>

        <ChromeLink
          href="/app/explore"
          icon={<Sparkles className="h-3 w-3" strokeWidth={1.75} />}
          title="Explore — research-grade templates with pre-built KG, evidence-backed edges, starter twins, and configured labs"
        >
          Explore
        </ChromeLink>
      </div>

      {/* ── Right cluster: overview / settings / bell / ⌘K / profile ── */}
      <div className="flex items-center gap-2">
        {/* Overview dropdown */}
        <div ref={overviewRef} className="relative">
          <ChromeButton
            onClick={() => setOverviewOpen((v) => !v)}
            icon={<Target className="h-3 w-3" strokeWidth={1.75} />}
            title="Overview — objectives, patterns, analytics"
            active={overviewOpen}
          >
            Overview
          </ChromeButton>
          {overviewOpen && (
            <div
              className="absolute right-0 mt-2 w-[260px] overflow-hidden rounded-2xl backdrop-blur-md"
              style={{
                border: "1px solid var(--home-chrome-stroke)",
                background: "rgba(255,255,255,0.92)",
                boxShadow: "0 12px 28px -8px rgba(11,18,40,0.18)",
              }}
            >
              {overviewItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOverviewOpen(false)}
                    className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-[color:var(--home-chrome-fill-hover)]"
                  >
                    <div
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "var(--home-chrome-fill)",
                        border: "1px solid var(--home-chrome-stroke)",
                      }}
                    >
                      <Icon
                        className="h-3.5 w-3.5 text-[color:var(--home-text-mid)]"
                        strokeWidth={1.75}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-[color:var(--home-text)]">
                        {item.label}
                      </div>
                      <div className="mt-0.5 text-[10.5px] font-light leading-snug text-[color:var(--home-text-mid)]">
                        {item.desc}
                      </div>
                    </div>
                    <ArrowRight className="mt-1 h-3 w-3 flex-shrink-0 text-[color:var(--home-text-faint)]" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <ChromeLink
          href="/app/settings"
          icon={<SettingsIcon className="h-3 w-3" strokeWidth={1.75} />}
          title="Settings"
          iconOnly
        />

        {userId && (
          <div
            className="flex h-[26px] items-center justify-center rounded-full px-1"
            style={{
              border: "1px solid var(--home-chrome-stroke)",
              background: "var(--home-chrome-fill)",
            }}
          >
            <AgentActivityBell userId={userId} collapsed />
          </div>
        )}

        <button
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium backdrop-blur-sm transition-colors"
          style={{
            border: "1px solid var(--home-chrome-stroke)",
            background: "var(--home-chrome-fill)",
            color: "var(--home-chrome-text)",
          }}
          title="Command palette"
          onClick={() => {
            const evt = new KeyboardEvent("keydown", {
              key: "k",
              metaKey: true,
              bubbles: true,
            });
            document.dispatchEvent(evt);
          }}
        >
          <Command className="h-3 w-3" />
          <span>K</span>
        </button>

        {/* Profile chip */}
        <div ref={profileRef} className="relative">
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 backdrop-blur-sm transition-colors"
            style={{
              border: "1px solid var(--home-chrome-stroke)",
              background: profileOpen
                ? "var(--home-chrome-fill-hover)"
                : "var(--home-chrome-fill)",
            }}
            title={userEmail}
          >
            <div
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-pink-600 text-[9.5px] font-bold text-white shadow-sm"
            >
              {initials}
            </div>
            <span
              className="inline-flex items-center gap-1 text-[10.5px] font-bold"
              style={{ color: "var(--accent-700)" }}
            >
              <Coins className="h-2.5 w-2.5" />
              {creditBalance}
            </span>
          </button>

          {profileOpen && (
            <div
              className="absolute right-0 mt-2 w-[240px] overflow-hidden rounded-2xl backdrop-blur-md"
              style={{
                border: "1px solid var(--home-chrome-stroke)",
                background: "rgba(255,255,255,0.95)",
                boxShadow: "0 12px 28px -8px rgba(11,18,40,0.18)",
              }}
            >
              <div className="flex items-center gap-2.5 px-3 py-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-300 to-pink-600 text-[12px] font-bold text-white shadow-sm">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-gray-800">
                    {userEmail}
                  </p>
                  <p className="text-[10.5px] text-gray-500">Pro plan</p>
                </div>
              </div>
              <div
                className="flex items-center justify-between px-3 py-2"
                style={{ borderTop: "1px solid var(--glass-hairline)" }}
              >
                <span className="text-[10.5px] font-medium text-gray-500">
                  Credits
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                  style={{
                    background: "rgba(var(--accent-rgb), 0.12)",
                    border: "1px solid rgba(var(--accent-rgb), 0.25)",
                    color: "var(--accent-700)",
                  }}
                >
                  <Coins className="h-2.5 w-2.5" />
                  {creditBalance}
                </span>
              </div>
              <div
                className="px-2 pb-2 pt-1"
                style={{ borderTop: "1px solid var(--glass-hairline)" }}
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
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared chrome primitives ──────────────────────────────────────

function ChromeButton({
  onClick,
  icon,
  children,
  title,
  active,
}: {
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm transition-all"
      style={{
        border: "1px solid var(--home-chrome-stroke)",
        background: active
          ? "var(--home-chrome-fill-hover)"
          : "var(--home-chrome-fill)",
        color: active
          ? "var(--home-chrome-text-hover)"
          : "var(--home-chrome-text)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--home-chrome-fill-hover)";
        e.currentTarget.style.color = "var(--home-chrome-text-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active
          ? "var(--home-chrome-fill-hover)"
          : "var(--home-chrome-fill)";
        e.currentTarget.style.color = active
          ? "var(--home-chrome-text-hover)"
          : "var(--home-chrome-text)";
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function ChromeLink({
  href,
  icon,
  children,
  title,
  iconOnly,
}: {
  href: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  title?: string;
  iconOnly?: boolean;
}) {
  return (
    <Link
      href={href}
      title={title}
      className="group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm transition-all"
      style={{
        border: "1px solid var(--home-chrome-stroke)",
        background: "var(--home-chrome-fill)",
        color: "var(--home-chrome-text)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--home-chrome-fill-hover)";
        e.currentTarget.style.color = "var(--home-chrome-text-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--home-chrome-fill)";
        e.currentTarget.style.color = "var(--home-chrome-text)";
      }}
    >
      {icon}
      {!iconOnly && children && <span>{children}</span>}
    </Link>
  );
}
