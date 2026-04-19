"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface ProvenanceChipProps {
  label: string;
  count?: number;
  countSuffix?: string;
  dotColor: string;
  href?: string;
  showArrow?: boolean;
  title?: string;
}

export function ProvenanceChip({
  label,
  count,
  countSuffix,
  dotColor,
  href,
  showArrow,
  title,
}: ProvenanceChipProps) {
  const body = (
    <>
      <span
        className="inline-block w-[5px] h-[5px] rounded-full flex-shrink-0"
        style={{ background: dotColor }}
      />
      <span>{label}</span>
      {count !== undefined && (
        <span className="text-gray-400 font-medium">
          · {count}
          {countSuffix ? ` ${countSuffix}` : ""}
        </span>
      )}
    </>
  );

  const wrapperClass =
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all";
  const wrapperStyle = {
    background: "rgba(255,255,255,0.6)",
    border: "1px solid rgba(11,13,18,0.08)",
    color: "rgba(11,13,18,0.74)",
  } as const;

  if (href) {
    return (
      <Link
        href={href}
        className={`${wrapperClass} hover:-translate-y-px hover:bg-white hover:shadow-sm hover:text-gray-900`}
        style={wrapperStyle}
        title={title}
      >
        {body}
      </Link>
    );
  }

  return (
    <span className={wrapperClass} style={wrapperStyle} title={title}>
      {body}
      {showArrow && <ChevronRight className="h-2.5 w-2.5 text-gray-400" />}
    </span>
  );
}

export function ChainArrow() {
  return (
    <ChevronRight
      className="h-2.5 w-2.5 flex-shrink-0"
      style={{ color: "rgba(11,13,18,0.22)" }}
    />
  );
}
