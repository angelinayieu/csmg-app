"use client";

import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";
import type { Canvas } from "@/types";
import { getCanvasScopeColor } from "@/lib/design-tokens";

/**
 * Placeholder rendered for universal + objective canvases until Sprint 4
 * ships the real multi-frame editor. Communicates (a) the canvas exists,
 * (b) which scope, (c) that the editor is coming. Not a 404 — the row is
 * valid; only the surface is unfinished.
 */
export function UnivObjPlaceholder({ canvas }: { canvas: Canvas }) {
  const color = getCanvasScopeColor(
    canvas.scope as "universal" | "objective",
  );

  return (
    <div className="mx-auto max-w-2xl py-16">
      <Link
        href="/app/library"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to library
      </Link>

      <div
        className="mt-6 rounded-2xl border p-8"
        style={{
          background: color.tintBg,
          borderColor: color.tintBorder,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color.dot }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: color.text }}
          >
            {color.label} canvas
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-semibold text-gray-900">
          {canvas.title}
        </h1>
        {canvas.description && (
          <p className="mt-2 text-sm text-gray-600">{canvas.description}</p>
        )}

        <div className="mt-6 flex items-start gap-3 rounded-xl bg-white/70 p-4">
          <Construction className="h-5 w-5 flex-shrink-0 text-gray-500" />
          <div className="text-sm text-gray-700">
            The {color.label.toLowerCase()}-level canvas editor lands in Sprint
            4 (universal canvas as a live weave surface). Until then, this
            canvas is queued and will open automatically once the editor
            ships — no migration needed.
          </div>
        </div>
      </div>
    </div>
  );
}
