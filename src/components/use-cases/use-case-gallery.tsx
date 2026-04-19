"use client";

// ── Use-case gallery ──
//
// Card grid of available templates. Grouped by category (personal /
// professional / research / strategic / relational). Click a card →
// creates a space from that template and routes to the template's
// default surface.

import React, { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Rocket,
  Microscope,
  TrendingUp,
  BookMarked,
  Users,
  Users2,
  ArrowRight,
  Loader2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATE_LIST } from "@/lib/use-cases/library";
import type { UseCaseTemplate, UseCaseId } from "@/types/use-case";

// Icon lookup — templates specify a lucide icon name; we map it here.
const ICON_MAP: Record<string, LucideIcon> = {
  BookOpen,
  Rocket,
  Microscope,
  TrendingUp,
  BookMarked,
  Users,
  Users2,
};

const CATEGORY_ORDER: UseCaseTemplate["category"][] = [
  "personal",
  "professional",
  "research",
  "strategic",
  "relational",
];

const CATEGORY_LABEL: Record<UseCaseTemplate["category"], string> = {
  personal: "Personal",
  professional: "Professional",
  research: "Research & Learning",
  strategic: "Strategic",
  relational: "Relational",
};

export function UseCaseGallery() {
  const router = useRouter();
  const [creatingId, setCreatingId] = useState<UseCaseId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byCategory = new Map<UseCaseTemplate["category"], UseCaseTemplate[]>();
    for (const t of TEMPLATE_LIST) {
      const arr = byCategory.get(t.category) ?? [];
      arr.push(t);
      byCategory.set(t.category, arr);
    }
    return byCategory;
  }, []);

  const createSpaceFromTemplate = useCallback(
    async (template: UseCaseTemplate) => {
      setCreatingId(template.id);
      setError(null);
      try {
        const res = await fetch("/api/use-cases/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ template_id: template.id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          // Server includes `hint` for known migration-not-applied cases.
          // Surface it inline so the user sees the exact fix.
          const base = err.error ?? `HTTP ${res.status}`;
          const details = err.db_error ? ` (${err.db_error})` : "";
          const hint = err.hint ? ` — ${err.hint}` : "";
          throw new Error(`${base}${details}${hint}`);
        }
        const json = await res.json() as {
          space: { id: string };
          default_surface: string;
        };

        // Route based on template's default surface
        const spaceId = json.space.id;
        let targetPath = `/app/space/${spaceId}/graph`;
        switch (json.default_surface) {
          case "journal":
            targetPath = `/app/space/${spaceId}/journal`;
            break;
          case "whiteboard_overview":
            targetPath = `/app/space/${spaceId}/whiteboard`;
            break;
          case "whiteboard_playground":
            // Playground retired in route consolidation; fall through to whiteboard.
            targetPath = `/app/space/${spaceId}/whiteboard`;
            break;
          case "reading_import":
            targetPath = `/app/space/${spaceId}/whiteboard`;
            break;
          default:
            targetPath = `/app/space/${spaceId}/graph`;
        }

        router.push(targetPath);
      } catch (err) {
        console.error("[UseCaseGallery] Create failed:", err);
        setError(err instanceof Error ? err.message : "Failed to create space");
      } finally {
        setCreatingId(null);
      }
    },
    [router],
  );

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-slate-100">
      {/* Header */}
      <div className="px-8 py-8 border-b border-gray-200 bg-white/60 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-indigo-600 mb-2">
            <Sparkles className="h-3 w-3" />
            Use-case library
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            What are you trying to think through?
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Each use case is a pre-configured workspace: starter structure for your graph, a lens
            for extraction, and a surface designed for that kind of thinking. Everything you capture
            still flows into your memory and synthesis pipeline.
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-8 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Gallery body */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-5xl mx-auto space-y-10">
          {CATEGORY_ORDER.map((category) => {
            const templates = grouped.get(category);
            if (!templates || templates.length === 0) return null;
            return (
              <section key={category}>
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">
                  {CATEGORY_LABEL[category]}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      creating={creatingId === template.id}
                      disabled={creatingId !== null && creatingId !== template.id}
                      onClick={() => createSpaceFromTemplate(template)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Template card ──

function TemplateCard({
  template,
  creating,
  disabled,
  onClick,
}: {
  template: UseCaseTemplate;
  creating: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = ICON_MAP[template.icon] ?? Sparkles;
  const seedCount = template.seed_entities.length;
  const questionCount = template.question_library.length;

  return (
    <button
      onClick={onClick}
      disabled={creating || disabled}
      className={cn(
        "text-left rounded-xl border bg-white p-5 transition-all group",
        creating ? "cursor-wait border-gray-200" : "hover:shadow-md hover:border-gray-300 border-gray-200",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      style={{
        boxShadow: creating ? undefined : `0 1px 2px rgba(0,0,0,0.02)`,
      }}
    >
      {/* Icon + name */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex-shrink-0 w-10 h-10 rounded-lg grid place-items-center"
          style={{ background: template.accent_color_light, color: template.accent_color }}
        >
          {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-gray-900 leading-tight">{template.name}</h3>
          <p
            className="mt-0.5 text-[12px] font-medium leading-snug"
            style={{ color: template.accent_color }}
          >
            {template.tagline}
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-600 leading-relaxed line-clamp-3 mb-3">
        {template.description}
      </p>

      {/* Footer metadata */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          {seedCount > 0 && (
            <span>
              <span className="font-semibold text-gray-700">{seedCount}</span> seed{seedCount === 1 ? "" : "s"}
            </span>
          )}
          {questionCount > 0 && (
            <span>
              <span className="font-semibold text-gray-700">{questionCount}</span> prompt{questionCount === 1 ? "" : "s"}
            </span>
          )}
          <span
            className="inline-flex items-center rounded px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider"
            style={{ background: template.accent_color_light, color: template.accent_color }}
          >
            {template.default_surface.replace(/_/g, " ")}
          </span>
        </div>
        <ArrowRight
          className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-800 group-hover:translate-x-0.5 transition-all"
        />
      </div>
    </button>
  );
}
