// ── Focus Mode top progress bar ──
//
// 4 stages with diamond markers below each. Done stages get a gradient
// cyan→blue fill; the current stage has a subtle 1.5s pulse animation
// on its segment; future stages stay light gray. Clicking a done stage
// is a hint that the user could revisit it — for now we only allow
// going BACKWARD via this control (forward must use the Continue CTA so
// state validations get a chance to fire).

"use client";

import { ArrowDownToLine, Cog, HelpCircle, Sparkles } from "lucide-react";
import type { FocusStage } from "./use-focus-mode";

interface StageDef {
  num: FocusStage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STAGES: StageDef[] = [
  { num: 1, label: "Focus", icon: Sparkles },
  { num: 2, label: "Extract", icon: Cog },
  { num: 3, label: "Sharpen", icon: HelpCircle },
  { num: 4, label: "Publish", icon: ArrowDownToLine },
];

interface Props {
  stage: FocusStage;
  onJump?: (next: FocusStage) => void;
}

export function FocusModeProgress({ stage, onJump }: Props) {
  return (
    <div className="px-6 pt-4 pb-3">
      <div className="flex items-center gap-1.5">
        {STAGES.map((s) => {
          const done = stage > s.num;
          const current = stage === s.num;
          const future = stage < s.num;
          const canJump = done && !!onJump;
          return (
            <button
              key={s.num}
              disabled={!canJump}
              onClick={() => canJump && onJump(s.num)}
              className={[
                "h-1.5 flex-1 overflow-hidden rounded-full transition",
                done && "bg-gradient-to-r from-blue-500 to-cyan-400",
                current && "bg-gradient-to-r from-blue-400 to-cyan-300",
                future && "bg-gray-200",
                canJump && "cursor-pointer hover:opacity-90",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {current && (
                <div
                  className="h-full bg-white/30"
                  style={{ animation: "focusModePulse 1.6s ease-in-out infinite" }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {STAGES.map((s) => {
          const Icon = s.icon;
          const done = stage > s.num;
          const current = stage === s.num;
          return (
            <div key={s.num} className="flex flex-1 items-center gap-1.5">
              <div
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-full transition",
                  done
                    ? "bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm"
                    : current
                      ? "bg-blue-100 text-blue-700 ring-2 ring-blue-200"
                      : "bg-gray-100 text-gray-400",
                ].join(" ")}
              >
                <Icon className="h-2.5 w-2.5" />
              </div>
              <span
                className={[
                  "font-mono text-[9px] uppercase tracking-[0.15em]",
                  current ? "text-blue-700" : done ? "text-gray-700" : "text-gray-400",
                ].join(" ")}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <style jsx>{`
        @keyframes focusModePulse {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
