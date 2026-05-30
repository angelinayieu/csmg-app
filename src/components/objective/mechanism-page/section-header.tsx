"use client";

// ── Shared section header ─────────────────────────────────────────
//
// Numbered, titled, optional subtitle. Used by all 7 mechanism page
// sections so they have consistent visual identity.

interface Props {
  number: string;
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}

export function SectionHeader({ number, title, subtitle, rightSlot }: Props) {
  return (
    <div className="mb-6 flex items-baseline justify-between">
      <div>
        <div className="flex items-baseline gap-3">
          <span
            className="text-[11px] font-semibold tracking-wide"
            style={{ color: "rgba(15,23,42,0.35)" }}
          >
            §{number}
          </span>
          <h2
            className="text-[20px] font-semibold tracking-tight"
            style={{
              color: "rgba(15,23,42,0.92)",
              letterSpacing: "-0.015em",
            }}
          >
            {title}
          </h2>
        </div>
        {subtitle && (
          <p
            className="mt-1 text-[12.5px] font-light"
            style={{ color: "rgba(15,23,42,0.5)" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </div>
  );
}
