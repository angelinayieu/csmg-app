"use client";

// ── Subject picker (left rail) ────────────────────────────────────
//
// Shows the active subject as a card with icon + name + meta line,
// plus a click-to-open dropdown listing all archetypes.
// Below the card: source-citation strip.

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { Archetype } from "../lib/types";

export interface SubjectPickerProps {
  subject: Archetype;
  archetypes: Archetype[];
  onChange: (id: string) => void;
}

export function SubjectPicker({
  subject,
  archetypes,
  onChange,
}: SubjectPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="border-b border-black/[0.05] p-4">
      <div className="mb-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Subject
        </div>
      </div>

      {/* Subject card (button) */}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-black/[0.05] bg-[#fbfbfd] p-3 text-left transition-colors hover:bg-[#f2f2f4]"
        >
          <div
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-[9px] text-[18px]"
            style={{ background: "#e8f1fe" }}
          >
            {subject.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#1d1d1f]">
              {subject.name}
            </div>
            <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#6e6e73]">
              Age {subject.age} · K={subject.K.mean.toFixed(1)}±
              {subject.K.sd.toFixed(1)}
            </div>
          </div>
          <ChevronDown
            className={
              "h-3.5 w-3.5 flex-shrink-0 text-[#86868b] transition-transform " +
              (open ? "rotate-180" : "")
            }
          />
        </button>

        {/* Dropdown menu */}
        {open && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[420px] overflow-y-auto rounded-[10px] border border-black/[0.08] bg-white p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.10),0_8px_20px_rgba(0,0,0,0.06)]"
          >
            {archetypes.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2.5 rounded-[7px] p-2 text-left transition-colors " +
                  (a.id === subject.id
                    ? "bg-[#e8f1fe]"
                    : "hover:bg-[#f2f2f4]")
                }
              >
                <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-[#f2f2f4] text-[16px]">
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold leading-[1.2] text-[#1d1d1f]">
                    {a.name}
                  </div>
                  <div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#6e6e73]">
                    {a.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Source citation */}
      <div className="mt-2 rounded-md border border-black/[0.05] bg-[#fbfbfd] px-2.5 py-1.5 text-[10px] leading-[1.35] text-[#86868b]">
        <b className="font-semibold text-[#424245]">Source. </b>
        {subject.source}
      </div>
    </div>
  );
}
