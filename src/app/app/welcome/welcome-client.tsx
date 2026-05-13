// ── Welcome onboarding client ──
//
// Stitches together a single scrollable column:
//   - Hero card (gradient blue→cyan) with "welcome to Synergy"
//   - 3 quick-explainer cards (Anonymous matching / Components / Co-edit)
//   - Inline profile setup (display_name + bio + matching toggle)
//   - Two CTAs at bottom: Save & continue / Skip
//
// Both Save and Skip call /complete-onboarding (Skip sends an empty
// body; Save includes profile fields) so the flag flips and the user
// never sees this screen again. After completion, navigates to
// /app/synergy/new (fresh whiteboard) so they land in the product.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Lock,
  Network,
  Sparkles,
  UserCircle2,
  Users,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  suggestedDisplayName: string;
  existingBio: string;
}

export function SynergyWelcomeClient({
  suggestedDisplayName,
  existingBio,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(suggestedDisplayName);
  const [bio, setBio] = useState(existingBio);
  const [savingMode, setSavingMode] = useState<null | "save" | "skip">(null);

  const complete = async (mode: "save" | "skip") => {
    if (savingMode) return;
    if (mode === "save" && displayName.trim().length < 2) {
      toast.error("Display name must be at least 2 characters");
      return;
    }
    setSavingMode(mode);
    try {
      const body =
        mode === "save"
          ? { display_name: displayName.trim(), bio }
          : {};
      const res = await fetch(
        "/api/synergy/profiles/me/complete-onboarding",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `${res.status} ${res.statusText}`);
      }
      if (mode === "save") {
        toast.success("Profile saved", {
          description: "Opening a fresh whiteboard for you…",
        });
      }
      router.push("/app/synergy/new");
    } catch (e) {
      toast.error("Couldn't complete onboarding", {
        description: (e as Error).message,
      });
      setSavingMode(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <section className="overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-cyan-50/60 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-md">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          Welcome to InterAxis Synergy
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-gray-700">
          A whiteboard for solo brainstorming that also matches your ideas with
          complementary collaborators across the community — without revealing
          your full board.
        </p>
      </section>

      {/* ── 3-up explainer cards ── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ExplainCard
          icon={Sparkles}
          tone="blue"
          title="Brainstorm freely"
          body="Speak, sticky-note, sketch. AI augments your thinking with decompositions, variations, and research directions."
        />
        <ExplainCard
          icon={Network}
          tone="emerald"
          title="Match on components"
          body="When you're ready, publish typed components (upstream needs / downstream outputs). We match you with users whose components complement yours."
        />
        <ExplainCard
          icon={Lock}
          tone="amber"
          title="Anonymous until accept"
          body="Match suggestions stay anonymous. Profiles reveal only when both sides accept a connection — never before."
        />
      </section>

      {/* ── Profile setup (optional) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
          <UserCircle2 className="h-3 w-3 text-blue-600" />
          Set up your profile · optional
        </div>
        <h2 className="text-[20px] font-semibold tracking-tight text-gray-900">
          How you&apos;ll appear to accepted collaborators
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          You can fill this now or later from{" "}
          <span className="font-mono text-gray-700">/app/synergy/profile</span>.
          Only revealed after a match is mutually accepted.
        </p>

        {/* Preview */}
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-200 to-cyan-200 text-blue-800">
            <UserCircle2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-gray-900">
              {displayName.trim() || "(display name)"}
            </div>
            {bio.trim() ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-700">
                {bio}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] italic text-gray-500">
                (no bio — totally optional)
              </p>
            )}
          </div>
        </div>

        {/* Inputs */}
        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="welcome-display-name"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
            >
              Display name · 2-64 chars
            </label>
            <input
              id="welcome-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 64))}
              maxLength={64}
              placeholder="How collaborators will see you"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[14px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label
              htmlFor="welcome-bio"
              className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
            >
              <span>Bio · optional</span>
              <span>{400 - bio.length} chars left</span>
            </label>
            <textarea
              id="welcome-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              placeholder="What you work on, where you're based, what kind of collaborators you're looking for."
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      </section>

      {/* ── CTAs ── */}
      <section className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
        <button
          onClick={() => complete("skip")}
          disabled={!!savingMode}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-60"
        >
          {savingMode === "skip" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Skip — go to whiteboard
        </button>
        <button
          onClick={() => complete("save")}
          disabled={!!savingMode}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(6,182,212,0.5)] transition hover:scale-[1.02] disabled:opacity-60"
        >
          {savingMode === "save" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {savingMode === "save"
            ? "Saving…"
            : "Save & start brainstorming"}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </section>

      <p className="text-center text-[11px] text-gray-500">
        You can change anything here later from{" "}
        <span className="font-mono text-gray-700">/app/synergy/profile</span>.
        Skipping won&apos;t hide you from matching — your components still
        publish anonymously until someone reaches out.
      </p>
    </div>
  );
}

// ── Per-card explainer ──

function ExplainCard({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "blue" | "emerald" | "amber";
  title: string;
  body: string;
}) {
  const toneClasses = {
    blue: {
      ring: "ring-blue-100",
      grad: "from-blue-100 to-cyan-100 text-blue-700",
    },
    emerald: {
      ring: "ring-emerald-100",
      grad: "from-emerald-100 to-cyan-100 text-emerald-700",
    },
    amber: {
      ring: "ring-amber-100",
      grad: "from-amber-100 to-orange-100 text-amber-700",
    },
  }[tone];
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 ring-1 ${toneClasses.ring}`}
    >
      <div
        className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${toneClasses.grad}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{body}</p>
    </div>
  );
}

// Suppress unused import — Users is forward-compat for an "Activity"
// section we might add later.
void Users;
