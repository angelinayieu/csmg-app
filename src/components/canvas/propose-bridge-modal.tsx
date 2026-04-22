"use client";

import { useState } from "react";
import { X, ArrowRight, ArrowLeftRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export type BridgeType = "identity" | "influence" | "structural";
export type CouplingStrength = "strong" | "moderate" | "weak";
export type CouplingDirection =
  | "source_to_target"
  | "target_to_source"
  | "bidirectional";

interface ProposeBridgeModalProps {
  draft: {
    source_entity_id: string;
    target_entity_id: string;
    source_entity_name: string;
    target_entity_name: string;
  };
  onCancel: () => void;
  onConfirm: (payload: {
    bridge_type: BridgeType;
    coupling_strength: CouplingStrength;
    coupling_direction: CouplingDirection;
    shared_variable_name: string;
    description?: string;
    rationale?: string;
  }) => Promise<void>;
}

const BRIDGE_TYPES: Array<{
  value: BridgeType;
  label: string;
  color: string;
  helper: string;
}> = [
  {
    value: "identity",
    label: "Identity",
    color: "#00ACC1",
    helper: "Same concept wearing two different names across canvases.",
  },
  {
    value: "influence",
    label: "Influence",
    color: "#AF52DE",
    helper: "One entity causally affects / constrains the other.",
  },
  {
    value: "structural",
    label: "Structural",
    color: "#FF9500",
    helper: "Shared scaffolding — same mechanism, same dependencies.",
  },
];

const STRENGTHS: CouplingStrength[] = ["weak", "moderate", "strong"];
const DIRECTIONS: Array<{
  value: CouplingDirection;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = [
  { value: "source_to_target", icon: ArrowRight, label: "A → B" },
  { value: "target_to_source", icon: ArrowLeft, label: "B → A" },
  { value: "bidirectional", icon: ArrowLeftRight, label: "A ⇄ B" },
];

export function ProposeBridgeModal({
  draft,
  onCancel,
  onConfirm,
}: ProposeBridgeModalProps) {
  const [bridgeType, setBridgeType] = useState<BridgeType>("identity");
  const [strength, setStrength] = useState<CouplingStrength>("moderate");
  const [direction, setDirection] = useState<CouplingDirection>(
    "bidirectional",
  );
  const [sharedName, setSharedName] = useState("");
  const [description, setDescription] = useState("");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && sharedName.trim().length >= 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        bridge_type: bridgeType,
        coupling_strength: strength,
        coupling_direction: direction,
        shared_variable_name: sharedName.trim(),
        description: description.trim() || undefined,
        rationale: rationale.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose bridge");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={submitting ? undefined : onCancel}
    >
      <div
        className="mx-4 w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-interaxis-600">
              New bridge
            </div>
            <div className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              <span className="truncate">{draft.source_entity_name}</span>
              <ArrowLeftRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <span className="truncate">{draft.target_entity_name}</span>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Bridge type */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {BRIDGE_TYPES.map((bt) => {
                const active = bridgeType === bt.value;
                return (
                  <button
                    key={bt.value}
                    type="button"
                    onClick={() => setBridgeType(bt.value)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-left transition-all",
                      active
                        ? "shadow-sm"
                        : "border-gray-200 hover:border-gray-300",
                    )}
                    style={
                      active
                        ? {
                            borderColor: bt.color,
                            background: `${bt.color}10`,
                          }
                        : undefined
                    }
                  >
                    <div
                      className="flex items-center gap-1.5 text-[12px] font-semibold"
                      style={{ color: active ? bt.color : "#1D1D1F" }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: bt.color }}
                      />
                      {bt.label}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] text-gray-500">
                      {bt.helper}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Strength + direction */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Strength
              </label>
              <div className="flex gap-1">
                {STRENGTHS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStrength(s)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1 text-[11px] capitalize",
                      strength === s
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Direction
              </label>
              <div className="flex gap-1">
                {DIRECTIONS.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDirection(d.value)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[11px]",
                        direction === d.value
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                      )}
                      title={d.label}
                    >
                      <Icon className="h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Shared variable name */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Shared variable
              <span className="ml-1 text-gray-400">
                — what exactly do they share?
              </span>
            </label>
            <input
              type="text"
              value={sharedName}
              onChange={(e) => setSharedName(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder="e.g. user_retention, onboarding_friction"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] placeholder-gray-400 focus:border-interaxis-600 focus:outline-none focus:ring-1 focus:ring-interaxis-600"
            />
          </div>

          {/* Description + rationale */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Description
                <span className="ml-1 text-gray-400">— optional</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] placeholder-gray-400 focus:border-interaxis-600 focus:outline-none focus:ring-1 focus:ring-interaxis-600"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Rationale
                <span className="ml-1 text-gray-400">— why you think so</span>
              </label>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] placeholder-gray-400 focus:border-interaxis-600 focus:outline-none focus:ring-1 focus:ring-interaxis-600"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </div>
          )}

          <div className="-mx-5 -mb-5 flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50/50 px-5 py-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "btn-gradient-outline px-4 py-1.5 text-[13px] font-semibold",
                !canSubmit && "cursor-not-allowed opacity-50",
              )}
            >
              {submitting ? "Creating…" : "Create bridge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
