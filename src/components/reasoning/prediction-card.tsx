"use client";

import { Check, X } from "lucide-react";
import { Ring } from "@/components/ui/ring";

interface Prediction {
  source_id: string;
  target_id: string;
  relationship_type: string;
  dimension: string;
  confidence: number;
  reasoning: string;
}

interface PredictionCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  onAccept?: (prediction: Prediction) => void;
  onDismiss?: (prediction: Prediction) => void;
}

export function PredictionCards({
  result,
  onAccept,
  onDismiss,
}: PredictionCardProps) {
  const predictions = (result?.predictions ?? []) as Prediction[];

  if (predictions.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Predicted Connections
      </div>
      {predictions.map((p, i) => (
        <div
          key={i}
          className="rounded-lg border border-purple-200 bg-purple-50/30 p-3"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-gray-700">
              {p.source_id}
            </span>
            <span className="text-xs text-gray-400">→</span>
            <span className="font-mono text-xs font-semibold text-gray-700">
              {p.target_id}
            </span>
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-600">
              {p.relationship_type}
            </span>
            <div className="ml-auto">
              <Ring value={p.confidence} size={28} showValue />
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            {p.reasoning}
          </p>
          {(onAccept || onDismiss) && (
            <div className="mt-2 flex gap-1.5">
              {onAccept && (
                <button
                  onClick={() => onAccept(p)}
                  className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-600 hover:bg-green-100"
                >
                  <Check className="h-3 w-3" /> Accept
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={() => onDismiss(p)}
                  className="flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-100"
                >
                  <X className="h-3 w-3" /> Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
