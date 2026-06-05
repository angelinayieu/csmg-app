"use client";

import Link from "next/link";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";

const NAV_ITEMS = [
  { label: "Platform", href: "#platform" },
  { label: "Solutions", href: "#solutions" },
  { label: "Resources", href: "#resources" },
  { label: "Pricing", href: "#pricing" },
  { label: "Company", href: "#company" },
];

export function LandingMarketingNav() {
  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-50 flex items-center justify-between px-8 py-5">
      <Link href="/" className="flex items-center gap-2">
        <InterAxisLogo className="h-7 w-7" size={56} />
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">
          akiboe
        </span>
      </Link>

      <nav
        aria-label="Primary"
        className="hidden items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 px-2 py-1.5 backdrop-blur-md md:flex"
      >
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-full px-3.5 py-1 text-[13px] font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <a
          href="#signin"
          className="text-[13px] font-medium text-slate-600 hover:text-slate-900"
        >
          Log in
        </a>
        <a
          href="#signup"
          className="rounded-full bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] hover:bg-slate-800"
        >
          Get started
        </a>
      </div>
    </header>
  );
}
