"use client";

// ── Layout-utility widgets ─────────────────────────────────────────────
//
// Always-available widgets that don't need domain data:
//   - text_block    → markdown-light prose block (title + body + tone)
//   - divider       → horizontal rule with optional caption
//   - __unknown__   → fallback for unregistered widget types (visible so
//                     broken manifests surface obviously in dev)
//
// Keeping these in a separate file makes the registry bootstrap cleaner
// and prevents domain widgets from depending on the placeholder.

import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import { cn } from "@/lib/utils";

// ── text_block ─────────────────────────────────────────────────────────

interface TextBlockConfig {
  title?: string;
  body?: string;
  tone?: "muted" | "emphasis" | "default";
}

export function TextBlock({
  instance,
}: WidgetComponentProps<TextBlockConfig>) {
  const cfg = instance.config ?? {};
  return (
    <div
      className={cn(
        "rounded-2xl border backdrop-blur-xl",
        cfg.tone === "emphasis"
          ? "border-blue-200/70 bg-blue-50/50"
          : cfg.tone === "muted"
          ? "border-dashed border-gray-200/70 bg-gray-50/40"
          : "border-gray-200/70 bg-white/60",
        "px-5 py-4"
      )}
    >
      {cfg.title && (
        <div className="text-[13px] font-semibold tracking-tight text-gray-800">
          {cfg.title}
        </div>
      )}
      {cfg.body && (
        <div
          className={cn(
            "whitespace-pre-wrap text-[12.5px] leading-[1.6]",
            cfg.tone === "muted" ? "text-gray-500" : "text-gray-700"
          )}
        >
          {cfg.body}
        </div>
      )}
    </div>
  );
}

// ── divider ────────────────────────────────────────────────────────────

export function Divider({
  instance,
}: WidgetComponentProps<{ caption?: string }>) {
  const caption = instance.config?.caption;
  if (!caption) {
    return <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />;
  }
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gray-200" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
        {caption}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gray-200" />
    </div>
  );
}

// ── __unknown__ fallback ───────────────────────────────────────────────

export function UnknownWidget({
  instance,
}: WidgetComponentProps<Record<string, unknown>>) {
  return (
    <div className="rounded-2xl border border-dashed border-amber-300/70 bg-amber-50/40 px-4 py-3 text-[11.5px] text-amber-700">
      <div className="font-semibold">Unknown widget</div>
      <div className="text-amber-600/80">
        id: <span className="font-mono">{instance.id}</span>
      </div>
    </div>
  );
}
