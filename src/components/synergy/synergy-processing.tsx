// ── Synergy processing page (Phase 3) ──
//
// Composes ObjectiveCard + ComponentsCard + RabbitHoles. State for
// objective + components + scores lives here; the cards are pure
// presentation. Initial data comes pre-hydrated from the server page
// so the cards never flash through an empty state on mount.

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, Target } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  detectObjective,
  extractComponents,
  scorePromise,
  updateSession,
} from "@/lib/synergy/client";
import type {
  BrainstormComponent,
  BrainstormSession,
  DetectedObjective,
  PromiseScore,
} from "@/lib/synergy/types";
import { SynergyObjectiveCard } from "./synergy-objective-card";
import { SynergyComponentsCard } from "./synergy-components-card";
import { SynergyRabbitHoles } from "./synergy-rabbit-holes";

interface Props {
  session: BrainstormSession;
  initialNodeCount: number;
  initialComponents: BrainstormComponent[];
  initialScores: PromiseScore[];
}

export function SynergyProcessing({
  session: initialSession,
  initialNodeCount,
  initialComponents,
  initialScores,
}: Props) {
  const [session, setSession] = useState(initialSession);
  // components is null = "never extracted" (renders empty CTA);
  // [] = "extracted but produced nothing" (renders an empty card).
  const [components, setComponents] = useState<BrainstormComponent[] | null>(
    initialComponents.length > 0 ? initialComponents : null,
  );
  const [scores, setScores] = useState<PromiseScore[] | null>(
    initialScores.length > 0 ? initialScores : null,
  );

  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [scoring, setScoring] = useState(false);

  const hasObjective = !!session.objective_statement;
  const hasNodes = initialNodeCount > 0;

  const onDetect = async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      const obj = await detectObjective(session.id);
      if (!obj.statement) {
        toast.info("Board doesn't yet suggest a clear objective — add more nodes and try again.");
        return;
      }
      // Persist immediately. detected_at flips to a fresh timestamp,
      // signaling "AI-detected" provenance on the card.
      const updated = await updateSession(session.id, {
        objective_statement: obj.statement,
        objective_constraints: obj.constraints,
        objective_success_criteria: obj.success_criteria,
      });
      setSession(updated);
      // Clear stale scores — a new objective changes promise rankings.
      setScores(null);
      toast.success("Objective detected");
    } catch (e) {
      toast.error("Detection failed", { description: (e as Error).message });
    } finally {
      setDetecting(false);
    }
  };

  const onSaveObjective = async (next: DetectedObjective) => {
    if (saving) return;
    if (!next.statement) {
      toast.error("Objective can't be empty");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateSession(session.id, {
        objective_statement: next.statement,
        objective_constraints: next.constraints,
        objective_success_criteria: next.success_criteria,
      });
      // Set detected_at to null in local state so the UI shows
      // "user-edited" — the server has stamped it but we don't
      // re-trust that timestamp for provenance display after edit.
      setSession({ ...updated, objective_detected_at: null });
      setScores(null);
      toast.success("Objective saved");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const onExtract = async () => {
    if (extracting) return;
    setExtracting(true);
    try {
      const list = await extractComponents(session.id);
      setComponents(list);
      toast.success(`${list.length} components extracted`);
    } catch (e) {
      toast.error("Extraction failed", { description: (e as Error).message });
    } finally {
      setExtracting(false);
    }
  };

  const onScore = async () => {
    if (scoring) return;
    setScoring(true);
    try {
      const list = await scorePromise(session.id);
      setScores(list);
      toast.success("Promise scores updated");
    } catch (e) {
      toast.error("Scoring failed", { description: (e as Error).message });
    } finally {
      setScoring(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <header className="mb-6 flex items-center justify-between">
        <Link
          href={`/app/synergy/${session.id}`}
          className="inline-flex items-center gap-2 text-sm text-gray-600 transition hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to whiteboard
        </Link>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
          <Target className="h-3 w-3 text-blue-600" /> Processing
        </div>
      </header>

      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          {session.title}
        </h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-gray-500">
          {initialNodeCount} {initialNodeCount === 1 ? "node" : "nodes"} on the
          board
        </p>
      </div>

      {!hasNodes && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4" /> Empty board
          </div>
          <p className="mt-1">
            Head back to the whiteboard and add some nodes first — there&apos;s
            nothing to process yet.
          </p>
        </div>
      )}

      <div className="space-y-6">
        <SynergyObjectiveCard
          objective={{
            statement: session.objective_statement ?? "",
            constraints: session.objective_constraints ?? [],
            success_criteria: session.objective_success_criteria ?? [],
            detected_at: session.objective_detected_at,
          }}
          detecting={detecting}
          saving={saving}
          onDetect={onDetect}
          onSave={onSaveObjective}
        />

        <SynergyComponentsCard
          components={components}
          loading={extracting}
          hasNodes={hasNodes}
          onExtract={onExtract}
        />

        <SynergyRabbitHoles
          sessionId={session.id}
          scores={scores}
          loading={scoring}
          hasObjective={hasObjective}
          onScore={onScore}
        />
      </div>
    </div>
  );
}
