"use client";

// ── WelcomeOverlay ──
//
// Translucent first-visit modal that mounts over the whiteboard.
// Replaces the full-page /app/welcome flow. Three cards with mouse-
// tracked 3D tilt + gradient header band + floating glass icon tile,
// visual language modeled on Apple-Vision-Pro app cards. A single
// dark pill CTA dismisses; profile setup is an optional reveal under
// the CTA so the first frame is purely the welcome moment.
//
// Dismiss → POST /api/synergy/profiles/me/complete-onboarding (Skip
// path with empty body; Save path includes display_name + bio). The
// flag flips so the overlay only renders once.

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  Lightbulb,
  Loader2,
  Network,
  Shield,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";

interface Props {
  suggestedDisplayName: string;
  existingBio: string;
}

export function WelcomeOverlay({
  suggestedDisplayName,
  existingBio,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
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
        mode === "save" ? { display_name: displayName.trim(), bio } : {};
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
      setOpen(false);
      // Refresh so the server-side onboarding check no longer renders us.
      router.refresh();
    } catch (e) {
      toast.error("Couldn't finish setup", {
        description: (e as Error).message,
      });
      setSavingMode(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/25 px-4 py-10 backdrop-blur-2xl"
      style={{ perspective: "1600px" }}
    >
      {/* Ambient depth glow behind the modal — catches the scrim like a
          Vision-Pro window in space. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[80vh] w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(120,140,255,0.20), rgba(255,255,255,0) 70%)",
        }}
      />

      <div
        className="relative w-full max-w-3xl rounded-[2rem] border border-white/60 bg-white/80 p-8 shadow-[0_40px_80px_-20px_rgba(15,23,42,0.30),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-3xl sm:p-10"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* Subtle highlight sheen across the top — Vision-Pro window edge */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[2rem]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
          }}
        />

        {/* ── Header ── */}
        <header className="text-center">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-[40px]">
            Welcome to the world of ideas
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-slate-600">
            A whiteboard for thinking — with quiet matches when something&apos;s
            ready to share.
          </p>
        </header>

        {/* ── 3 tilt cards ── */}
        <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TiltCard
            category="Think"
            title="Think freely"
            body="Speak, sketch, sticky-note. AI maps your thinking into decompositions, variations, and research directions."
            gradient="linear-gradient(135deg, #fbbf24 0%, #f472b6 55%, #c084fc 100%)"
            icon={<Lightbulb className="h-6 w-6 text-amber-600" strokeWidth={2.25} />}
          />
          <TiltCard
            category="Connect"
            title="Share what's ready"
            body="Publish typed components when you want to. We surface collaborators whose pieces complement yours."
            gradient="linear-gradient(135deg, #38bdf8 0%, #6366f1 55%, #8b5cf6 100%)"
            icon={<Network className="h-6 w-6 text-sky-600" strokeWidth={2.25} />}
          />
          <TiltCard
            category="Quiet"
            title="Anonymous by default"
            body="Matches stay anonymous. Profiles only reveal when both sides accept — never before."
            gradient="linear-gradient(135deg, #6366f1 0%, #a855f7 55%, #ec4899 100%)"
            icon={<Shield className="h-6 w-6 text-indigo-600" strokeWidth={2.25} />}
          />
        </div>

        {/* ── CTA + profile reveal ── */}
        <div className="mt-9 flex flex-col items-center">
          <button
            type="button"
            onClick={() => complete(showProfile ? "save" : "skip")}
            disabled={!!savingMode}
            className="group inline-flex items-center gap-2 rounded-full bg-slate-950 px-7 py-3.5 text-[14px] font-semibold text-white shadow-[0_18px_36px_-12px_rgba(15,23,42,0.55),inset_0_1px_0_rgba(255,255,255,0.18)] transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60"
          >
            {savingMode ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            <span>
              {savingMode === "save"
                ? "Saving…"
                : savingMode === "skip"
                  ? "Opening…"
                  : showProfile
                    ? "Save & enter"
                    : "Enter the world of ideas"}
            </span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowProfile((s) => !s)}
            className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition hover:text-slate-800"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${
                showProfile ? "rotate-180" : ""
              }`}
            />
            {showProfile ? "Hide profile setup" : "Make yourself known (optional)"}
          </button>
        </div>

        {/* ── Profile reveal ── */}
        {showProfile ? (
          <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white/60 p-5 backdrop-blur-xl">
            <p className="text-[12px] leading-relaxed text-slate-600">
              How you&apos;ll appear to collaborators after a mutual accept.
              You can change this any time.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="welcome-overlay-display-name"
                  className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500"
                >
                  Display name
                </label>
                <input
                  id="welcome-overlay-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 64))}
                  maxLength={64}
                  placeholder="2–64 characters"
                  className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-[13px] outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <div>
                <label
                  htmlFor="welcome-overlay-bio"
                  className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500"
                >
                  <span>Bio · optional</span>
                  <span>{400 - bio.length}</span>
                </label>
                <textarea
                  id="welcome-overlay-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 400))}
                  rows={3}
                  maxLength={400}
                  placeholder="What you work on, where you're based, what kind of collaborators you're looking for."
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-[13px] leading-relaxed outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── TiltCard ──
//
// Mouse-tracked 3D tilt card. The header is a gradient band; a glass
// icon tile sits half-over the band edge, slightly raised on Z so it
// catches more light as the card tilts. Description copy sits below.

function TiltCard({
  category,
  title,
  body,
  gradient,
  icon,
}: {
  category: string;
  title: string;
  body: string;
  gradient: string;
  icon: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    // 12 deg max tilt — feels alive without going woozy.
    setTilt({ ry: (px - 0.5) * 12, rx: (0.5 - py) * 12 });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0 });

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.20),0_4px_10px_-6px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.9)]"
      style={{
        transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        transformStyle: "preserve-3d",
        transition: "transform 200ms cubic-bezier(0.2,0.8,0.2,1)",
      }}
    >
      {/* ── Gradient header band ── */}
      <div className="relative h-20" style={{ background: gradient }}>
        {/* Soft inner highlight at top — Vision-Pro window lip */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)",
          }}
        />
        {/* Floating glass icon tile, raised on Z */}
        <div
          className="absolute -bottom-5 left-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/90 shadow-[0_10px_24px_-10px_rgba(15,23,42,0.35),inset_0_1px_0_rgba(255,255,255,1)] backdrop-blur"
          style={{ transform: "translateZ(30px)" }}
        >
          {icon}
        </div>
      </div>

      {/* ── Body ── */}
      <div
        className="px-4 pb-5 pt-9"
        style={{ transform: "translateZ(12px)", transformStyle: "preserve-3d" }}
      >
        <span className="inline-flex rounded-full border border-slate-200/80 bg-white/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
          {category}
        </span>
        <h3 className="mt-2 text-[15px] font-semibold tracking-tight text-slate-900">
          {title}
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">
          {body}
        </p>
      </div>

      {/* Gloss sheen overlay — sweeps across on hover for a subtle
          "catches light" feel without going overboard. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 70%)",
        }}
      />
    </div>
  );
}
