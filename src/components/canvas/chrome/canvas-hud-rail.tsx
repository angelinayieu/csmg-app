"use client";

import { Sparkles, Link2, HelpCircle, Zap, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import type { StickyNoteShape } from "../shapes/types";

// Lightweight entity shape the rail needs. Ambient results satisfy this
// and so does Entity — the cast between them in the orchestrator is safe.
export interface HudRailEntity {
  id: string;
  name: string;
  description?: string | null;
  entity_category?: string | null;
  space_id?: string;
  space_name?: string;
}

export interface HudRailContext {
  activeShape: StickyNoteShape | null;
  selectedEntity: Entity | null;
  relatedEntities: HudRailEntity[];
  suggestedQuestions: string[];
  canDecompose: boolean;
  loading: boolean;
}

export interface CanvasHudRailProps {
  ctx: HudRailContext;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDecompose: () => void;
  onJumpToEntity: (e: HudRailEntity) => void;
  onAppendQuestion: (q: string) => void;
}

export function CanvasHudRail({
  ctx,
  collapsed,
  onToggleCollapsed,
  onDecompose,
  onJumpToEntity,
  onAppendQuestion,
}: CanvasHudRailProps) {
  const hasContent =
    ctx.activeShape ||
    ctx.selectedEntity ||
    ctx.relatedEntities.length > 0 ||
    ctx.suggestedQuestions.length > 0;

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="pointer-events-auto absolute right-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl border border-gray-200/70 bg-white/85 text-blue-500 shadow-md backdrop-blur-md transition-transform hover:scale-105"
        title="Open AI companion"
      >
        <Sparkles className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute right-4 top-28 bottom-24 z-30 flex w-[320px] flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/90 shadow-lg backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-100 to-purple-100">
            <Sparkles className="h-3 w-3 text-blue-600" />
          </div>
          <div>
            <div className="text-[12px] font-bold tracking-tight text-gray-900">AI companion</div>
            <div className="text-[10px] text-gray-500">{ctx.loading ? "Thinking…" : "Ambient"}</div>
          </div>
        </div>
        <button
          onClick={onToggleCollapsed}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!hasContent && (
          <div className="px-3 pt-4 text-center text-[11.5px] text-gray-400">
            Select a shape or start typing in a sticky note to get ambient suggestions.
          </div>
        )}

        {ctx.activeShape && (
          <Section
            icon={<Sparkles className="h-3 w-3" />}
            label="Active sticky"
            accent="from-blue-50 to-purple-50"
          >
            <div className="rounded-lg bg-white px-3 py-2 text-[12px] font-medium text-gray-800 shadow-sm">
              {ctx.activeShape.props.text || <span className="text-gray-400 italic">Empty…</span>}
            </div>
            {ctx.canDecompose && (
              <button
                onClick={onDecompose}
                disabled={ctx.loading}
                className={cn(
                  "mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-[11.5px] font-semibold text-white shadow-sm transition-colors hover:bg-blue-700",
                  ctx.loading && "opacity-60",
                )}
              >
                <Zap className="h-3 w-3" />
                Decompose into nodes
              </button>
            )}
          </Section>
        )}

        {ctx.relatedEntities.length > 0 && (
          <Section
            icon={<Link2 className="h-3 w-3" />}
            label={`${ctx.relatedEntities.length} related in KG`}
            accent="from-emerald-50 to-teal-50"
          >
            <ul className="flex flex-col gap-1">
              {ctx.relatedEntities.slice(0, 6).map((entity) => (
                <li key={entity.id}>
                  <button
                    onClick={() => onJumpToEntity(entity)}
                    className="group flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-left shadow-sm transition-shadow hover:shadow"
                  >
                    <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[11.5px] font-semibold text-gray-900">
                        {entity.name}
                      </div>
                      <div className="truncate text-[10px] text-gray-500">
                        {(entity.entity_category as string) ?? "concept"}
                      </div>
                    </div>
                    <ChevronRight className="h-3 w-3 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ctx.suggestedQuestions.length > 0 && (
          <Section
            icon={<HelpCircle className="h-3 w-3" />}
            label="Probe further"
            accent="from-amber-50 to-orange-50"
          >
            <ul className="flex flex-col gap-1">
              {ctx.suggestedQuestions.slice(0, 4).map((q, i) => (
                <li key={i}>
                  <button
                    onClick={() => onAppendQuestion(q)}
                    className="w-full rounded-lg bg-white px-3 py-2 text-left text-[11.5px] text-gray-700 shadow-sm transition-shadow hover:shadow hover:text-gray-900"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  label,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <div className={cn("flex h-4 w-4 items-center justify-center rounded-md bg-gradient-to-br text-gray-600", accent)}>
          {icon}
        </div>
        <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-500">
          {label}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
