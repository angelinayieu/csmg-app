"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BridgeDisplay } from "./bridge-display";
import { useWeave } from "@/lib/hooks/use-weave";
import { GitBranch } from "lucide-react";
import type { Space } from "@/types";

interface WeavingPanelProps {
  spaces: Space[];
}

export function WeavingPanel({ spaces }: WeavingPanelProps) {
  const [spaceAId, setSpaceAId] = useState("");
  const [spaceBId, setSpaceBId] = useState("");
  const { loading, error, bridges, contradictions, bridgesSaved, weave } =
    useWeave();

  const canWeave =
    spaceAId && spaceBId && spaceAId !== spaceBId && !loading;

  function handleWeave() {
    if (canWeave) {
      weave(spaceAId, spaceBId);
    }
  }

  if (spaces.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <GitBranch className="h-12 w-12 text-gray-300" />
        <h2 className="mt-4 text-lg font-semibold">
          Need at least 2 spaces to weave
        </h2>
        <p className="mt-1 max-w-sm text-sm text-gray-500">
          Analyze two or more situations first, then come back here to
          discover shared variables and hidden connections between them.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Weave Spaces</h1>
      <p className="mt-1 text-sm text-gray-600">
        Select two spaces to discover shared variables, cross-domain
        connections, and contradictions between them.
      </p>

      <div className="mt-6 flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wider">
            Space A
          </label>
          <select
            value={spaceAId}
            onChange={(e) => setSpaceAId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-interaxis-500 focus:outline-none focus:ring-2 focus:ring-interaxis-500/20"
            disabled={loading}
          >
            <option value="">Select a space...</option>
            {spaces
              .filter((s) => s.id !== spaceBId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.space_prefix} — {s.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex items-end pb-1">
          <svg className="h-5 w-8 text-gray-300" viewBox="0 0 32 20" fill="none">
            <path
              d="M4 10h24M22 4l6 6-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wider">
            Space B
          </label>
          <select
            value={spaceBId}
            onChange={(e) => setSpaceBId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-interaxis-500 focus:outline-none focus:ring-2 focus:ring-interaxis-500/20"
            disabled={loading}
          >
            <option value="">Select a space...</option>
            {spaces
              .filter((s) => s.id !== spaceAId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.space_prefix} — {s.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <Button
          onClick={handleWeave}
          disabled={!canWeave}
          loading={loading}
          className="w-full"
        >
          <GitBranch className="mr-2 h-4 w-4" />
          {loading ? "Discovering bridges..." : "Discover Bridges"}
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {(bridges.length > 0 || contradictions.length > 0) && (
        <div className="mt-6">
          <BridgeDisplay
            bridges={bridges}
            contradictions={contradictions}
            bridgesSaved={bridgesSaved}
          />
        </div>
      )}
    </div>
  );
}
