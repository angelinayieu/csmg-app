"use client";

// ── Insight Lab · header bar ──────────────────────────────────────────
//
// Top strip with: back to /app/lab, lab branding, space picker dropdown.
// No state-toggle here (that's preflight-only).

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Beaker, ChevronDown } from "lucide-react";
import type { SpaceSummary } from "./insight-lab-page";

export function HeaderBar({
  spaces,
  activeSpace,
  onSpaceChange,
}: {
  spaces: SpaceSummary[];
  activeSpace: SpaceSummary;
  onSpaceChange: (id: string) => void;
}) {
  return (
    <header className="relative z-10 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/70 px-5 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <Link
          href="/app/lab"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Lab</span>
        </Link>
        <div className="h-4 w-px bg-slate-200" />
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <Beaker className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Insight Lab
            </div>
            <div className="text-[13px] font-semibold leading-none text-slate-900">
              Algorithm stacks
            </div>
          </div>
        </div>
        <div className="h-4 w-px bg-slate-200" />
        <SpacePicker
          spaces={spaces}
          active={activeSpace}
          onChange={onSpaceChange}
        />
      </div>

      <div className="flex items-center gap-3 text-[10.5px] text-slate-500">
        <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold uppercase tracking-wider text-violet-700">
          v0 · goal-match
        </span>
      </div>
    </header>
  );
}

function SpacePicker({
  spaces,
  active,
  onChange,
}: {
  spaces: SpaceSummary[];
  active: SpaceSummary;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[280px] items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
      >
        <span className="truncate">{active.name}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close picker"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {spaces.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 ${
                  s.id === active.id
                    ? "bg-slate-50 font-medium text-slate-900"
                    : "text-slate-700"
                }`}
              >
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                  {s.entity_count ?? 0}E · {s.edge_count ?? 0}e
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
