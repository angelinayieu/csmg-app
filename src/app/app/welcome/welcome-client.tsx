// ── Welcome onboarding client ──
//
// Single scrollable column on a soft pastel mesh (drawn by page.tsx).
// Everything inside is Vision Pro glass: rgba(255,255,255,0.55-0.65)
// + backdrop-blur-2xl + saturate(180%) + 1px white border + triple
// slate-tinted shadow.
//
// Sections, top to bottom:
//   - Hero glass card ("Welcome to InterAxis Synergy")
//   - 3 explainer chips (Anonymous matching / Components / Co-edit)
//   - Use-case selector: "What will you use Synergy for?" — multi-
//     select pill toggles + "Add your own" custom input
//   - Inline profile setup (display_name + bio)
//   - Save / Skip CTAs
//
// Both Save and Skip call /complete-onboarding so the flag flips and
// the user never sees this screen again. After completion, navigates
// to /app/synergy/new.

"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Compass,
  Loader2,
  Lock,
  Microscope,
  Minus,
  Network,
  Plus,
  Rocket,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  suggestedDisplayName: string;
  existingBio: string;
  existingUseCases: string[];
}

// ── Use-case options ──
//
// Predefined choices the user can toggle. Each maps to a lucide icon
// + a soft gradient orb (license-clean alternative to the character
// avatars in the inspiration mock). Custom entries the user types
// later get a generic gradient + Sparkles icon.

interface UseCaseOption {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
}

const USE_CASE_OPTIONS: UseCaseOption[] = [
  {
    label: "for Work",
    icon: Briefcase,
    gradient: "linear-gradient(135deg, #c7d2fe, #a5b4fc)",
  },
  {
    label: "for Side Projects",
    icon: Rocket,
    gradient: "linear-gradient(135deg, #fbcfe8, #f9a8d4)",
  },
  {
    label: "for Learning",
    icon: BookOpen,
    gradient: "linear-gradient(135deg, #bae6fd, #7dd3fc)",
  },
  {
    label: "for Research",
    icon: Microscope,
    gradient: "linear-gradient(135deg, #bbf7d0, #86efac)",
  },
  {
    label: "for Strategy",
    icon: Compass,
    gradient: "linear-gradient(135deg, #fed7aa, #fdba74)",
  },
  {
    label: "Just exploring",
    icon: Sparkles,
    gradient: "linear-gradient(135deg, #e9d5ff, #d8b4fe)",
  },
];

const USE_CASE_MAX = 10;
const USE_CASE_VALUE_MAX = 40;

export function SynergyWelcomeClient({
  suggestedDisplayName,
  existingBio,
  existingUseCases,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(suggestedDisplayName);
  const [bio, setBio] = useState(existingBio);
  const [useCases, setUseCases] = useState<string[]>(existingUseCases);
  const [customDraft, setCustomDraft] = useState("");
  const [savingMode, setSavingMode] = useState<null | "save" | "skip">(null);

  // Custom (user-added) entries are anything not in the predefined list
  // — surface them as their own pills below the standard options.
  const predefinedLabels = useMemo(
    () => new Set(USE_CASE_OPTIONS.map((o) => o.label.toLowerCase())),
    [],
  );
  const customSelected = useMemo(
    () => useCases.filter((v) => !predefinedLabels.has(v.toLowerCase())),
    [useCases, predefinedLabels],
  );

  const toggleUseCase = (label: string) => {
    const lower = label.toLowerCase();
    setUseCases((prev) => {
      const has = prev.some((v) => v.toLowerCase() === lower);
      if (has) return prev.filter((v) => v.toLowerCase() !== lower);
      if (prev.length >= USE_CASE_MAX) {
        toast.error(`Up to ${USE_CASE_MAX} reasons — remove one first`);
        return prev;
      }
      return [...prev, label];
    });
  };

  const addCustom = () => {
    const trimmed = customDraft.trim().slice(0, USE_CASE_VALUE_MAX);
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (useCases.some((v) => v.toLowerCase() === lower)) {
      setCustomDraft("");
      return;
    }
    if (useCases.length >= USE_CASE_MAX) {
      toast.error(`Up to ${USE_CASE_MAX} reasons — remove one first`);
      return;
    }
    setUseCases((prev) => [...prev, trimmed]);
    setCustomDraft("");
  };

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
          ? {
              display_name: displayName.trim(),
              bio,
              use_cases: useCases,
            }
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
    <div className="space-y-5">
      {/* ── Hero ── */}
      <section className="overflow-hidden rounded-[28px] p-8 text-center" style={GLASS_SURFACE}>
        <div
          className="mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.55))",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.95), 0 6px 18px -4px rgba(15,23,42,0.18)",
          }}
        >
          <Sparkles className="h-7 w-7 text-slate-700" />
        </div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
          Welcome to InterAxis Synergy
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-slate-600">
          A whiteboard for solo brainstorming that quietly matches your ideas
          with complementary collaborators — without ever revealing your full
          board.
        </p>
      </section>

      {/* ── 3-up explainer chips ── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ExplainCard
          icon={Sparkles}
          title="Brainstorm freely"
          body="Speak, sticky-note, sketch. AI augments your thinking with decompositions and research directions."
        />
        <ExplainCard
          icon={Network}
          title="Match on components"
          body="Publish typed components when ready. We pair you with users whose pieces complement yours."
        />
        <ExplainCard
          icon={Lock}
          title="Anonymous until accept"
          body="Profiles reveal only when both sides accept a connection — never before."
        />
      </section>

      {/* ── Use-case selector ── */}
      <section className="rounded-[28px] p-7" style={GLASS_SURFACE}>
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">
          <Sparkles className="h-3 w-3" />
          Tell us a little
        </div>
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
          What will you use Synergy for?
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
          Pick as many as fit — or add your own. Helps us tune matches and
          surface the right kind of collaborators.
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          {USE_CASE_OPTIONS.map((opt) => {
            const selected = useCases.some(
              (v) => v.toLowerCase() === opt.label.toLowerCase(),
            );
            return (
              <UseCasePill
                key={opt.label}
                label={opt.label}
                icon={opt.icon}
                gradient={opt.gradient}
                selected={selected}
                onToggle={() => toggleUseCase(opt.label)}
              />
            );
          })}

          {customSelected.map((label) => (
            <UseCasePill
              key={`custom:${label}`}
              label={label}
              icon={Sparkles}
              gradient="linear-gradient(135deg, #e0e7ff, #c7d2fe)"
              selected
              onToggle={() => toggleUseCase(label)}
            />
          ))}
        </div>

        {/* Custom input */}
        <div className="mt-4 flex items-center gap-2">
          <div
            className="flex flex-1 items-center gap-2 rounded-full px-3.5 py-2"
            style={{
              background: "rgba(255,255,255,0.5)",
              backdropFilter: "blur(16px) saturate(180%)",
              WebkitBackdropFilter: "blur(16px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.7)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
            }}
          >
            <Plus className="h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={customDraft}
              onChange={(e) =>
                setCustomDraft(e.target.value.slice(0, USE_CASE_VALUE_MAX))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              maxLength={USE_CASE_VALUE_MAX}
              placeholder="Add your own…"
              className="flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={addCustom}
            disabled={!customDraft.trim()}
            className="inline-flex h-9 items-center justify-center rounded-full px-4 text-[12px] font-medium text-slate-700 transition disabled:opacity-40"
            style={{
              background: "rgba(255,255,255,0.65)",
              backdropFilter: "blur(16px) saturate(180%)",
              WebkitBackdropFilter: "blur(16px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.7)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,23,42,0.05)",
            }}
          >
            Add
          </button>
        </div>
      </section>

      {/* ── Profile setup ── */}
      <section className="rounded-[28px] p-7" style={GLASS_SURFACE}>
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">
          <UserCircle2 className="h-3 w-3" />
          Set up your profile · optional
        </div>
        <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
          How you&apos;ll appear to accepted collaborators
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
          Only revealed after a match is mutually accepted. Editable later
          from <span className="font-mono text-slate-700">/app/synergy/profile</span>.
        </p>

        {/* Preview */}
        <div
          className="mt-5 flex items-start gap-3 rounded-2xl p-3.5"
          style={{
            background: "rgba(255,255,255,0.45)",
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
          }}
        >
          <div
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700"
            style={{
              background:
                "linear-gradient(135deg, rgba(186,230,253,0.9), rgba(252,211,224,0.85))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
            }}
          >
            <UserCircle2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-slate-900">
              {displayName.trim() || "(display name)"}
            </div>
            {bio.trim() ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-slate-700">
                {bio}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] italic text-slate-500">
                (no bio — totally optional)
              </p>
            )}
          </div>
        </div>

        {/* Inputs */}
        <div className="mt-5 space-y-4">
          <GlassField
            id="welcome-display-name"
            label="Display name · 2-64 chars"
          >
            <input
              id="welcome-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 64))}
              maxLength={64}
              placeholder="How collaborators will see you"
              className="w-full bg-transparent px-3.5 py-2.5 text-[14px] text-slate-900 outline-none placeholder:text-slate-400"
            />
          </GlassField>
          <GlassField
            id="welcome-bio"
            label={
              <>
                <span>Bio · optional</span>
                <span>{400 - bio.length} chars left</span>
              </>
            }
          >
            <textarea
              id="welcome-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              placeholder="What you work on, where you're based, what kind of collaborators you're looking for."
              className="w-full resize-none bg-transparent px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
            />
          </GlassField>
        </div>
      </section>

      {/* ── CTAs ── */}
      <section className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
        <button
          onClick={() => complete("skip")}
          disabled={!!savingMode}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-medium text-slate-700 transition disabled:opacity-60"
          style={{
            background: "rgba(255,255,255,0.55)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,23,42,0.05)",
          }}
        >
          {savingMode === "skip" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Skip — go to whiteboard
        </button>
        <button
          onClick={() => complete("save")}
          disabled={!!savingMode}
          className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-[13.5px] font-semibold text-slate-900 transition hover:scale-[1.015] active:scale-[0.99] disabled:opacity-60"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.7))",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.85)",
            boxShadow: [
              "inset 0 1px 0 rgba(255,255,255,0.95)",
              "0 1px 2px rgba(15,23,42,0.06)",
              "0 12px 28px -8px rgba(15,23,42,0.18)",
            ].join(", "),
          }}
        >
          {savingMode === "save" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 text-slate-700" />
          )}
          {savingMode === "save" ? "Saving…" : "Save & start brainstorming"}
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </button>
      </section>

      <p className="text-center text-[11px] leading-relaxed text-slate-500">
        You can change anything here later from{" "}
        <span className="font-mono text-slate-700">/app/synergy/profile</span>.
        Skipping won&apos;t hide you from matching — components still publish
        anonymously until someone reaches out.
      </p>
    </div>
  );
}

// ── Shared visual primitives ──

const GLASS_SURFACE: CSSProperties = {
  background: "rgba(255,255,255,0.6)",
  backdropFilter: "blur(28px) saturate(180%)",
  WebkitBackdropFilter: "blur(28px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.7)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.85)",
    "0 1px 2px rgba(15,23,42,0.04)",
    "0 18px 40px -16px rgba(15,23,42,0.18)",
  ].join(", "),
};

function ExplainCard({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.7)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,23,42,0.04), 0 10px 24px -12px rgba(15,23,42,0.14)",
      }}
    >
      <div
        className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-700"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.55))",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.95), 0 2px 6px -2px rgba(15,23,42,0.1)",
        }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-slate-900">
        {title}
      </h3>
      <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600">
        {body}
      </p>
    </div>
  );
}

function GlassField({
  id,
  label,
  children,
}: {
  id: string;
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500"
      >
        {label}
      </label>
      <div
        className="rounded-2xl transition focus-within:ring-2 focus-within:ring-slate-300/40"
        style={{
          background: "rgba(255,255,255,0.5)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.75)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(15,23,42,0.04)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function UseCasePill({
  label,
  icon: Icon,
  gradient,
  selected,
  onToggle,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="group inline-flex items-center gap-2 rounded-full pl-1.5 pr-3.5 py-1.5 text-[13px] font-medium transition hover:scale-[1.02] active:scale-[0.98]"
      style={
        selected
          ? {
              color: "#0f172a",
              background: "rgba(255,255,255,0.85)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.9)",
              boxShadow: [
                "inset 0 1px 0 rgba(255,255,255,0.95)",
                "0 1px 2px rgba(15,23,42,0.06)",
                "0 8px 20px -8px rgba(15,23,42,0.18)",
              ].join(", "),
            }
          : {
              color: "#475569",
              background: "rgba(255,255,255,0.18)",
              backdropFilter: "blur(12px) saturate(180%)",
              WebkitBackdropFilter: "blur(12px) saturate(180%)",
              border: "1px dashed rgba(100,116,139,0.45)",
            }
      }
    >
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-700"
        style={{
          background: gradient,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.85), 0 1px 2px rgba(15,23,42,0.08)",
        }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="tracking-[-0.005em]">{label}</span>
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full"
        style={
          selected
            ? {
                background:
                  "linear-gradient(135deg, #60a5fa, #3b82f6)",
                color: "white",
                boxShadow: "0 1px 2px rgba(15,23,42,0.15)",
              }
            : {
                background: "rgba(148,163,184,0.25)",
                color: "#64748b",
              }
        }
      >
        {selected ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      </span>
    </button>
  );
}

