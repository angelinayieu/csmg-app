"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  Star,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Columns,
  LayoutList,
  Clock,
  Shield,
  Link2,
  FileCode,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import type { TestLabResult, TestVariant } from "@/types/execution-brief";

// ── Props ──

export interface TestLabPanelProps {
  testLab: TestLabResult | null;
  loading: boolean;
  error: string | null;
  savingPreference: boolean;
  onGenerate: () => void;
  onSetPreferred: (index: number | null) => void;
  className?: string;
}

// ── Helpers ──

const testTypeLabels: Record<string, { label: string; description: string }> = {
  prompt_comparison: {
    label: "Prompt Comparison",
    description: "Comparing modified prompt variants with simulated outputs",
  },
  strategy_comparison: {
    label: "Strategy Comparison",
    description: "Evaluating alternative strategic approaches",
  },
  scenario_simulation: {
    label: "Scenario Simulation",
    description: "Simulating different implementation scenarios",
  },
};

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide",
        className
      )}
    >
      {children}
    </span>
  );
}

// ── Variant Card ──

function VariantCard({
  variant,
  index,
  isPreferred,
  savingPreference,
  onSetPreferred,
  isActive,
  onSelect,
}: {
  variant: TestVariant;
  index: number;
  isPreferred: boolean;
  savingPreference: boolean;
  onSetPreferred: (index: number | null) => void;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border transition-all cursor-pointer",
        isPreferred
          ? "border-amber-300 bg-amber-50/30 ring-1 ring-amber-200"
          : isActive
            ? "border-indigo-200 bg-indigo-50/20"
            : "border-gray-200 bg-white hover:border-gray-300"
      )}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold flex-shrink-0",
              isPreferred
                ? "bg-amber-400 text-white"
                : "bg-gray-200 text-gray-600"
            )}
          >
            {index + 1}
          </span>
          <span className="text-[11px] font-semibold text-gray-800 truncate">
            {variant.label}
          </span>
          {isPreferred && (
            <Badge className="bg-amber-100 text-amber-700">
              Preferred
            </Badge>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetPreferred(isPreferred ? null : index);
          }}
          disabled={savingPreference}
          className={cn(
            "flex-shrink-0 rounded-md p-1 transition-colors",
            isPreferred
              ? "text-amber-500 hover:text-amber-600"
              : "text-gray-300 hover:text-amber-400"
          )}
          title={isPreferred ? "Remove preference" : "Set as preferred"}
        >
          <Star
            className={cn("h-3.5 w-3.5", isPreferred && "fill-amber-400")}
          />
        </button>
      </div>

      {/* Description */}
      <div className="px-3 pb-2">
        <p className="text-[10px] leading-[1.5] text-gray-600">
          {variant.description}
        </p>
      </div>

      {/* Pros/Cons */}
      <div className="mx-3 mb-2 grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5">
          {variant.pros.slice(0, 3).map((pro, i) => (
            <div key={i} className="flex items-start gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-gray-600 leading-snug">
                {pro}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-0.5">
          {variant.cons.slice(0, 3).map((con, i) => (
            <div key={i} className="flex items-start gap-1">
              <XCircle className="h-3 w-3 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-gray-500 leading-snug">
                {con}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Metadata row */}
      <div className="mx-3 mb-2 flex flex-wrap items-center gap-1.5">
        {variant.estimated_improvement && (
          <Badge className="bg-green-50 text-green-700">
            {variant.estimated_improvement}
          </Badge>
        )}
        {variant.timeline && (
          <div className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5 text-gray-400" />
            <span className="text-[9px] text-gray-500">{variant.timeline}</span>
          </div>
        )}
        {variant.risk_assessment && (
          <div className="flex items-center gap-0.5">
            <Shield className="h-2.5 w-2.5 text-amber-400" />
            <span className="text-[9px] text-amber-600 truncate max-w-[120px]">
              {variant.risk_assessment}
            </span>
          </div>
        )}
      </div>

      {/* Dependencies */}
      {variant.dependencies && variant.dependencies.length > 0 && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-1">
          <Link2 className="h-2.5 w-2.5 text-gray-400" />
          {variant.dependencies.map((dep, i) => (
            <span
              key={i}
              className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[8px] text-gray-500"
            >
              {dep}
            </span>
          ))}
        </div>
      )}

      {/* Prompt Diff (for prompt_comparison) */}
      {variant.prompt_diff && (
        <div className="mx-3 mb-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowOutput(!showOutput);
            }}
            className="flex items-center gap-1 text-[9px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            <FileCode className="h-2.5 w-2.5" />
            {showOutput ? "Hide prompt diff" : "Show prompt diff"}
            <ChevronDown
              className={cn(
                "h-2 w-2 transition-transform",
                showOutput && "rotate-180"
              )}
            />
          </button>
          {showOutput && (
            <pre className="mt-1.5 rounded-md bg-gray-900 px-3 py-2 text-[9px] leading-relaxed text-green-300 overflow-x-auto max-h-32 scrollbar-thin">
              {variant.prompt_diff}
            </pre>
          )}
        </div>
      )}

      {/* Sample Output */}
      {variant.sample_output && (
        <div className="border-t border-gray-100 mx-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowOutput(!showOutput);
            }}
            className={cn(
              "flex items-center gap-1 py-2 text-[9px] font-medium transition-colors",
              showOutput
                ? "text-indigo-600"
                : "text-gray-400 hover:text-indigo-500"
            )}
          >
            <Sparkles className="h-2.5 w-2.5" />
            {showOutput ? "Hide sample output" : "View sample output"}
            <ChevronDown
              className={cn(
                "h-2 w-2 transition-transform",
                showOutput && "rotate-180"
              )}
            />
          </button>
          {showOutput && (
            <div className="pb-2.5 rounded-md bg-gray-50 border border-gray-100 px-3 py-2 text-[10px] leading-[1.6] text-gray-700 max-h-40 overflow-y-auto scrollbar-thin">
              {variant.sample_output}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Side-by-Side Comparison ──

function SideBySideComparison({
  variants,
  preferredIndex,
  savingPreference,
  onSetPreferred,
}: {
  variants: TestVariant[];
  preferredIndex: number | null;
  savingPreference: boolean;
  onSetPreferred: (index: number | null) => void;
}) {
  // Show up to 3 variants in side-by-side
  const displayVariants = variants.slice(0, 3);

  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${displayVariants.length}, 1fr)`,
      }}
    >
      {displayVariants.map((variant, i) => {
        const isPreferred = preferredIndex === i;
        return (
          <div
            key={i}
            className={cn(
              "rounded-lg border p-2.5 space-y-2",
              isPreferred
                ? "border-amber-300 bg-amber-50/30"
                : "border-gray-200 bg-white"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold",
                    isPreferred
                      ? "bg-amber-400 text-white"
                      : "bg-gray-200 text-gray-600"
                  )}
                >
                  {i + 1}
                </span>
                <span className="text-[10px] font-semibold text-gray-800 truncate">
                  {variant.label}
                </span>
              </div>
              <button
                onClick={() => onSetPreferred(isPreferred ? null : i)}
                disabled={savingPreference}
                className={cn(
                  "rounded p-0.5 transition-colors",
                  isPreferred
                    ? "text-amber-500"
                    : "text-gray-300 hover:text-amber-400"
                )}
              >
                <Star
                  className={cn(
                    "h-3 w-3",
                    isPreferred && "fill-amber-400"
                  )}
                />
              </button>
            </div>

            {/* Description */}
            <p className="text-[9px] leading-[1.5] text-gray-500">
              {variant.description}
            </p>

            {/* Pros */}
            <div className="space-y-0.5">
              {variant.pros.slice(0, 2).map((pro, pi) => (
                <div key={pi} className="flex items-start gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[8px] text-gray-600 leading-snug">
                    {pro}
                  </span>
                </div>
              ))}
            </div>

            {/* Cons */}
            <div className="space-y-0.5">
              {variant.cons.slice(0, 2).map((con, ci) => (
                <div key={ci} className="flex items-start gap-1">
                  <XCircle className="h-2.5 w-2.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[8px] text-gray-500 leading-snug">
                    {con}
                  </span>
                </div>
              ))}
            </div>

            {/* Improvement badge */}
            {variant.estimated_improvement && (
              <Badge className="bg-green-50 text-green-700">
                {variant.estimated_improvement}
              </Badge>
            )}

            {/* Sample output preview */}
            {variant.sample_output && (
              <div className="rounded bg-gray-50 border border-gray-100 px-2 py-1.5 text-[8px] leading-[1.5] text-gray-600 max-h-24 overflow-y-auto scrollbar-thin">
                {variant.sample_output.slice(0, 300)}
                {variant.sample_output.length > 300 && "..."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Skeleton ──

function TestLabSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 text-purple-500 animate-spin" />
        <span className="text-[11px] font-medium text-gray-500">
          Generating test lab variants...
        </span>
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-gray-200" />
              <div className="h-3 w-32 rounded bg-gray-200" />
            </div>
            <div className="h-2.5 w-full rounded bg-gray-200" />
            <div className="h-2.5 w-3/4 rounded bg-gray-200" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-8 rounded bg-gray-100" />
              <div className="h-8 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
        <FlaskConical className="h-3 w-3" />
        This may take 30-60 seconds for prompt comparisons
      </div>
    </div>
  );
}

// ── Main Panel ──

export function TestLabPanel({
  testLab,
  loading,
  error,
  savingPreference,
  onGenerate,
  onSetPreferred,
  className,
}: TestLabPanelProps) {
  const [viewMode, setViewMode] = useState<"list" | "side-by-side">("list");
  const [activeVariant, setActiveVariant] = useState(0);

  // ── Loading ──
  if (loading) {
    return (
      <div className={cn("rounded-xl border border-purple-100 bg-purple-50/20 p-4", className)}>
        <TestLabSkeleton />
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className={cn("rounded-xl border border-red-200 bg-red-50/50 p-3", className)}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-red-700">
              Test lab failed
            </p>
            <p className="text-[10px] text-red-500 mt-0.5">{error}</p>
          </div>
          <button
            onClick={onGenerate}
            className="flex-shrink-0 rounded-md bg-red-100 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-200 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty ──
  if (!testLab) {
    return (
      <div className={cn("rounded-xl border border-dashed border-purple-200 bg-purple-50/20 p-4", className)}>
        <div className="flex flex-col items-center gap-2 py-2">
          <FlaskConical className="h-5 w-5 text-purple-300" />
          <div className="text-center">
            <p className="text-[11px] font-medium text-gray-600">
              Test Lab
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              Generate comparative variants to see which approach produces better results
            </p>
          </div>
          <button
            onClick={onGenerate}
            className="flex items-center gap-1.5 rounded-md bg-purple-100 px-3 py-1.5 text-[10px] font-medium text-purple-700 hover:bg-purple-200 transition-colors"
          >
            <FlaskConical className="h-3 w-3" />
            Run Test Lab
          </button>
        </div>
      </div>
    );
  }

  // ── Loaded ──
  const typeConfig = testTypeLabels[testLab.test_type] ?? testTypeLabels.scenario_simulation;
  const preferredIndex = testLab.preferred_variant_index ?? null;

  return (
    <div className={cn("rounded-xl border border-purple-200 bg-white p-4 space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-purple-600">
            {typeConfig.label}
          </span>
          <Badge className="bg-purple-50 text-purple-500">
            {testLab.variants.length} variants
          </Badge>
          {preferredIndex !== null && (
            <Badge className="bg-amber-50 text-amber-600">
              <Star className="h-2 w-2 fill-amber-400 mr-0.5" />
              #{preferredIndex + 1} preferred
            </Badge>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "rounded px-1.5 py-0.5 transition-colors",
              viewMode === "list"
                ? "bg-white text-gray-700 shadow-sm"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            <LayoutList className="h-3 w-3" />
          </button>
          <button
            onClick={() => setViewMode("side-by-side")}
            className={cn(
              "rounded px-1.5 py-0.5 transition-colors",
              viewMode === "side-by-side"
                ? "bg-white text-gray-700 shadow-sm"
                : "text-gray-400 hover:text-gray-600"
            )}
          >
            <Columns className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-[10px] text-gray-400">{typeConfig.description}</p>

      {/* Content */}
      {viewMode === "side-by-side" ? (
        <SideBySideComparison
          variants={testLab.variants}
          preferredIndex={preferredIndex}
          savingPreference={savingPreference}
          onSetPreferred={onSetPreferred}
        />
      ) : (
        <div className="space-y-2">
          {testLab.variants.map((variant, i) => (
            <VariantCard
              key={i}
              variant={variant}
              index={i}
              isPreferred={preferredIndex === i}
              savingPreference={savingPreference}
              onSetPreferred={onSetPreferred}
              isActive={activeVariant === i}
              onSelect={() => setActiveVariant(i)}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <span className="text-[9px] text-gray-400">
          Generated {testLab.generated_at ? new Date(testLab.generated_at).toLocaleString() : "recently"}
        </span>
        <button
          onClick={onGenerate}
          className="flex items-center gap-1 text-[9px] font-medium text-purple-500 hover:text-purple-700 transition-colors"
        >
          <ArrowRight className="h-2.5 w-2.5" />
          Regenerate
        </button>
      </div>
    </div>
  );
}
