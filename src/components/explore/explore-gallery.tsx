"use client";

// ── Explore gallery ──
//
// Research-grade template gallery. Currently surfaces one template
// (mind-body cognition) with a rich card showing what gets seeded;
// "Use this template" → /api/explore/create → routes to the new
// space's whiteboard with everything pre-painted.
//
// Layout (per UI sketch):
//   - Header strip with breadcrumb + intro copy
//   - Featured cognition template card (full-width hero)
//   - "Coming soon" placeholder row for future templates
//   - "Or start from a blank whiteboard" footer link
//
// Loading state: stage-by-stage progress shown in a centered modal
// while the create endpoint runs (3-15 seconds typical).

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Moon,
  Sparkles,
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RESEARCH_TEMPLATE_LIST,
  MIND_BODY_COGNITION_TEMPLATE,
} from "@/lib/templates/mind-body-cognition/seed";
import type {
  ResearchTemplate,
  ExploreCreateResponse,
} from "@/types/research-template";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Brain,
  Moon,
  Sparkles,
};

// Pretty per-template eyebrow shown above the card title. Falls back
// to the first domain tag if a template's slug isn't recognized.
const TEMPLATE_EYEBROW: Record<string, string> = {
  mind_body_cognition: "Cognition · Mind-body",
  sleep_optimization: "Sleep · Recovery",
};

export function ExploreGallery() {
  const router = useRouter();
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<number>(0);
  // When the server returns warnings (e.g. a sub-insert failed), we
  // pause the redirect and surface them so the user understands what
  // partially succeeded before clicking through to the workspace.
  const [pendingResult, setPendingResult] = useState<
    | null
    | {
        space_id: string;
        target: string;
        warnings: string[];
        counts: ExploreCreateResponse["counts"];
      }
  >(null);

  const handleUseTemplate = useCallback(
    async (template: ResearchTemplate) => {
      setCreatingSlug(template.slug);
      setError(null);
      setProgressStage(0);

      // Animate progress stages while the request runs.
      // Real materialization happens server-side; these are visual
      // milestones the user sees during the ~3-15s wait.
      const stageTimers: ReturnType<typeof setTimeout>[] = [];
      const stages = [
        { ms: 300, label: "Materializing layer ontology" },
        { ms: 1100, label: "Painting entities" },
        { ms: 2400, label: "Linking evidence to edges" },
        { ms: 3500, label: "Generating starter subjects" },
        { ms: 4500, label: "Configuring labs" },
      ];
      stages.forEach((_, idx) => {
        stageTimers.push(
          setTimeout(() => setProgressStage(idx + 1), stages[idx].ms),
        );
      });

      try {
        const res = await fetch("/api/explore/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ template_slug: template.slug }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            `${errBody.error ?? `HTTP ${res.status}`}${
              errBody.db_error ? ` (${errBody.db_error})` : ""
            }`,
          );
        }

        const json = (await res.json()) as ExploreCreateResponse;
        const target = json.primary_subject_id
          ? `/app/space/${json.space.id}/whiteboard?subject=${json.primary_subject_id}`
          : `/app/space/${json.space.id}/whiteboard`;

        // If the server reported partial-success warnings, pause and
        // surface them so the user sees exactly what failed (e.g.
        // "subjects insert: relation 'subjects' does not exist") and
        // can decide whether to continue. Otherwise route immediately.
        if (json.warnings && json.warnings.length > 0) {
          setCreatingSlug(null);
          setPendingResult({
            space_id: json.space.id,
            target,
            warnings: json.warnings,
            counts: json.counts,
          });
          return;
        }

        router.push(target);
      } catch (err) {
        console.error("[ExploreGallery] create failed:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create space",
        );
        setCreatingSlug(null);
      } finally {
        for (const t of stageTimers) clearTimeout(t);
      }
    },
    [router],
  );

  return (
    <div className="flex h-full flex-col bg-gradient-to-br from-gray-50 via-slate-50 to-purple-50/30">
      {/* Header strip */}
      <header className="border-b border-gray-200/70 bg-white/70 px-8 py-8 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-purple-600">
            <Sparkles className="h-3 w-3" />
            Research-grade templates
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Explore
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
            Pick a template to scaffold a research workspace with a pre-built
            knowledge graph, layer ontology, starter subjects, intervention
            catalog, and a configured lab — ready to use, ready to extend.
          </p>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-8 py-2.5">
          <div className="mx-auto flex max-w-5xl items-center gap-2 text-sm text-rose-800">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-10">
          {/* All registered research templates */}
          {RESEARCH_TEMPLATE_LIST.map((template) => (
            <FeaturedTemplateCard
              key={template.slug}
              template={template}
              creating={creatingSlug === template.slug}
              disabled={
                creatingSlug !== null && creatingSlug !== template.slug
              }
              onUse={() => handleUseTemplate(template)}
            />
          ))}

          {/* Coming soon */}
          <ComingSoonRow />

          {/* Footer escape hatch */}
          <BlankWhiteboardLink />
        </div>
      </div>

      {/* Loading modal */}
      {creatingSlug && (
        <CreatingOverlay
          template={
            RESEARCH_TEMPLATE_LIST.find((t) => t.slug === creatingSlug) ??
            MIND_BODY_COGNITION_TEMPLATE
          }
          stage={progressStage}
        />
      )}

      {/* Partial-success modal — server reported the space materialized
          but with warnings (e.g. subjects didn't insert). Show what
          succeeded vs what failed so the user can act before routing. */}
      {pendingResult && (
        <PartialSuccessOverlay
          warnings={pendingResult.warnings}
          counts={pendingResult.counts}
          onContinue={() => {
            const target = pendingResult.target;
            setPendingResult(null);
            router.push(target);
          }}
          onDismiss={() => setPendingResult(null)}
        />
      )}
    </div>
  );
}

// ── Partial-success overlay ───────────────────────────────────────

function PartialSuccessOverlay({
  warnings,
  counts,
  onContinue,
  onDismiss,
}: {
  warnings: string[];
  counts: ExploreCreateResponse["counts"];
  onContinue: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm">
      <div className="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl border border-amber-200 bg-white p-7 shadow-xl">
        <div className="mb-4 flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-gray-900">
              Space created with warnings
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
              The materialization endpoint reported sub-step failures. Most
              likely cause: a Supabase migration hasn't been applied to the
              target environment (subjects / lab_scaffolds / evidence_registries
              tables). The space + entities + edges are still usable.
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-[12px]">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            What materialized
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-700">
            <div>
              <span className="font-semibold tabular-nums">{counts.layers}</span>{" "}
              layers
            </div>
            <div>
              <span className="font-semibold tabular-nums">{counts.entities}</span>{" "}
              entities
            </div>
            <div>
              <span className="font-semibold tabular-nums">{counts.edges}</span>{" "}
              edges
            </div>
            <div>
              <span className="font-semibold tabular-nums">{counts.evidence}</span>{" "}
              evidence
            </div>
            <div>
              <span className="font-semibold tabular-nums">{counts.subjects}</span>{" "}
              subjects
            </div>
            <div>
              <span className="font-semibold tabular-nums">
                {counts.lab_scaffolds}
              </span>{" "}
              lab scaffolds
            </div>
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-600">
            Warnings ({warnings.length})
          </div>
          <ul className="space-y-1.5">
            {warnings.map((w, idx) => (
              <li
                key={idx}
                className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] font-mono leading-snug text-amber-900"
              >
                {w}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onDismiss}
            className="text-[12px] font-medium text-gray-500 hover:text-gray-800"
          >
            Stay on this page
          </button>
          <button
            onClick={onContinue}
            className="rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm hover:-translate-y-px hover:shadow-md"
          >
            Continue to whiteboard →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Featured template card ────────────────────────────────────────

function FeaturedTemplateCard({
  template,
  creating,
  disabled,
  onUse,
}: {
  template: ResearchTemplate;
  creating: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  const Icon = ICON_MAP[template.icon] ?? Sparkles;
  const entityCount = template.seed_nodes.length;
  const edgeCount = template.seed_edges.length;
  const layerCount = template.ontology_layers.length;
  const subjectCount = template.seed_subjects.length;
  const interventionCount = template.seed_interventions.length;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white shadow-sm transition-all",
        creating
          ? "cursor-wait border-purple-200 ring-2 ring-purple-200"
          : "border-gray-200 hover:border-gray-300 hover:shadow-md",
        disabled && "opacity-50",
      )}
    >
      {/* Top — accent strip + icon + title */}
      <div className="relative overflow-hidden rounded-t-2xl border-b border-gray-100">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            background: `radial-gradient(ellipse at top right, ${template.accent_color}, transparent 60%)`,
          }}
          aria-hidden
        />
        <div className="relative flex items-start gap-4 p-7">
          <div
            className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl shadow-sm"
            style={{
              background: template.accent_color_light,
              color: template.accent_color,
            }}
          >
            <Icon className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="mb-1 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: template.accent_color }}
            >
              {TEMPLATE_EYEBROW[template.slug] ??
                template.domain_tags[0] ??
                "Research template"}
            </div>
            <h2 className="text-2xl font-bold leading-tight tracking-tight text-gray-900">
              {template.title}
            </h2>
            <p className="mt-1.5 text-sm font-medium leading-snug text-gray-600">
              {template.tagline}
            </p>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="px-7 pt-6">
        <p className="text-[13px] leading-relaxed text-gray-700">
          {template.description}
        </p>
      </div>

      {/* Stat strip */}
      <div className="mx-7 mt-6 grid grid-cols-3 gap-3">
        <Stat label="Entities" value={entityCount} sub={`across ${layerCount} layers`} />
        <Stat label="Edges" value={edgeCount} sub="effect-size backed" />
        <Stat label="Layers" value={layerCount} sub={firstLastLayer(template)} />
      </div>

      {/* Subjects + interventions list */}
      <div className="grid grid-cols-1 gap-4 px-7 pt-6 md:grid-cols-2">
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Starter subjects ({subjectCount})
          </div>
          <ul className="space-y-1.5">
            {template.seed_subjects.map((s) => (
              <li
                key={s.seed_id}
                className="flex items-start gap-2 text-[12px] leading-snug text-gray-700"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ background: template.accent_color }}
                  aria-hidden
                />
                <span>
                  <span className="font-semibold text-gray-900">{s.name}</span>
                  <span className="text-gray-500">
                    {" "}
                    · {summarizeConditions(s.conditions)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Intervention catalog ({interventionCount})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {template.seed_interventions.map((iv) => (
              <span
                key={iv.seed_id}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                title={`${iv.mechanism} · d=${iv.effect_size.toFixed(2)}`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: iv.color }}
                  aria-hidden
                />
                {iv.name}
              </span>
            ))}
          </div>
          <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Cognitive instruments ({template.seed_instruments.length})
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {template.seed_instruments.map((inst) => (
              <span
                key={inst.seed_id}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700"
              >
                {inst.modality && (
                  <span
                    className="rounded bg-gray-100 px-1 py-px text-[8.5px] font-bold uppercase text-gray-600"
                    aria-hidden
                  >
                    {inst.modality}
                  </span>
                )}
                {inst.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Source citations */}
      <div className="px-7 pt-6">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Source basis
        </div>
        <p className="text-[11px] leading-relaxed text-gray-600">
          {template.source_citations.slice(0, 3).join(" · ")}
          {template.source_citations.length > 3 &&
            ` · +${template.source_citations.length - 3} more`}
        </p>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between border-t border-gray-100 px-7 py-5 mt-7">
        <div className="text-[11px] text-gray-500">
          {creating ? "Building your research space…" : "One click → fully populated whiteboard + lab"}
        </div>
        <button
          onClick={onUse}
          disabled={creating || disabled}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold shadow-sm transition-all",
            creating
              ? "cursor-wait bg-gray-100 text-gray-500"
              : "bg-gradient-to-br from-purple-600 to-blue-600 text-white hover:-translate-y-px hover:shadow-md",
            disabled && "cursor-not-allowed",
          )}
        >
          {creating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Building…
            </>
          ) : (
            <>
              Use this template
              <ArrowRight className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>
    </article>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-gray-900">
        {value}
      </div>
      <div className="text-[11px] text-gray-500">{sub}</div>
    </div>
  );
}

function firstLastLayer(template: ResearchTemplate): string {
  const layers = [...template.ontology_layers].sort(
    (a, b) => a.ordinal - b.ordinal,
  );
  if (layers.length === 0) return "—";
  return `${layers[0].label} → ${layers[layers.length - 1].label}`;
}

function summarizeConditions(conditions: Record<string, number>): string {
  const parts: string[] = [];
  if ("sleep_h" in conditions) parts.push(`sleep ${conditions.sleep_h}h`);
  if ("stress_0_10" in conditions)
    parts.push(`stress ${conditions.stress_0_10}`);
  if ("caffeine_mg" in conditions && conditions.caffeine_mg > 0)
    parts.push(`caffeine ${conditions.caffeine_mg}mg`);
  if ("time_of_day_24h" in conditions)
    parts.push(`${formatHour(conditions.time_of_day_24h)}`);
  return parts.join(" · ");
}

function formatHour(h: number): string {
  const hh = Math.floor(h).toString().padStart(2, "0");
  const mm = Math.round((h - Math.floor(h)) * 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}`;
}

// ── Coming soon ───────────────────────────────────────────────────

function ComingSoonRow() {
  const upcoming = [
    "Nutrition & Metabolic",
    "Stress & Recovery",
    "Athletic Performance",
    "Hormone Balance",
  ];
  return (
    <section>
      <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">
        Coming soon
      </div>
      <div className="flex flex-wrap gap-2">
        {upcoming.map((label) => (
          <span
            key={label}
            className="inline-flex items-center rounded-md border border-dashed border-gray-300 bg-white/40 px-3 py-1.5 text-[11.5px] font-medium text-gray-500"
          >
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

// ── Blank whiteboard escape hatch ─────────────────────────────────

function BlankWhiteboardLink() {
  return (
    <div className="flex flex-col items-center gap-2 border-t border-gray-200/60 pt-6 text-center">
      <a
        href="/app"
        className="text-[12px] font-medium text-gray-500 transition-colors hover:text-gray-800"
      >
        Or start from a blank whiteboard →
      </a>
      <a
        href="/app/use-cases"
        className="text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-700"
      >
        Looking for personal templates (journaling, career pivots, reading synthesis)? Browse use cases →
      </a>
    </div>
  );
}

// ── Loading overlay ───────────────────────────────────────────────

function CreatingOverlay({
  template,
  stage,
}: {
  template: ResearchTemplate;
  stage: number;
}) {
  const stages = [
    { label: "Materializing layer ontology" },
    { label: "Painting entities" },
    { label: "Linking evidence to edges" },
    { label: "Generating starter subjects" },
    { label: "Configuring labs" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm">
      <div className="w-[420px] rounded-2xl border border-gray-200 bg-white p-7 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: template.accent_color }}
          />
          <h3 className="text-[15px] font-bold text-gray-900">
            Building your research space
          </h3>
        </div>

        <ul className="space-y-2.5">
          {stages.map((s, idx) => {
            const done = idx < stage;
            const active = idx === stage;
            return (
              <li
                key={s.label}
                className={cn(
                  "flex items-center gap-3 text-[13px] transition-colors",
                  done
                    ? "text-emerald-700"
                    : active
                      ? "font-semibold text-gray-900"
                      : "text-gray-400",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full",
                    done
                      ? "bg-emerald-100"
                      : active
                        ? "bg-purple-100"
                        : "bg-gray-100",
                  )}
                >
                  {done ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : active ? (
                    <Loader2 className="h-3 w-3 animate-spin text-purple-600" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                  )}
                </span>
                {s.label}
              </li>
            );
          })}
        </ul>

        <p className="mt-5 text-[11px] text-gray-500">
          This usually takes 5–15 seconds. We're inserting layer rows,
          entities, edges with effect sizes, evidence rows with full
          provenance, subjects, and lab scaffolds — then routing you in.
        </p>
      </div>
    </div>
  );
}
