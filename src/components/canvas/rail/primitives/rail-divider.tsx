"use client";

// Rail divider — separates State from Live zones.
//
// Two-dot pattern, not a solid line. Reads as a *cognitive boundary*
// rather than a fence. Solid hairlines are for inside zones; the
// zone-to-zone divider is intentionally airier.

export interface RailDividerProps {
  /** Optional label rendered between the dots (e.g., "live"). */
  label?: string;
}

export function RailDivider({ label }: RailDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label ?? "section divider"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        margin: "16px 0",
        color: "rgba(85,100,121,0.5)",
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 3,
          height: 3,
          borderRadius: "50%",
          background: "currentColor",
          opacity: 0.6,
        }}
      />
      {label && <span>{label}</span>}
      <span
        aria-hidden
        style={{
          flex: label ? "0 0 32px" : "0 0 64px",
          height: 1,
          background:
            "linear-gradient(90deg, transparent 0%, currentColor 50%, transparent 100%)",
          opacity: 0.35,
        }}
      />
      {label && (
        <span
          aria-hidden
          style={{
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: "currentColor",
            opacity: 0.6,
          }}
        />
      )}
    </div>
  );
}
