"use client";

// ── Tab-sync connect ──
//
// Shows the user's pairing token + the steps to load the akiboe tab-sync
// extension. The token is pasted into the extension popup once; thereafter
// "Sync tabs" pushes open tabs to /api/tabs/sync, which surfaces them in the
// chatbox + the homepage "tabs synced" row.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export function TabsConnect({ pairingToken }: { pairingToken: string }) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"token" | "origin" | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  async function copy(value: string, which: "token" | "origin") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-[640px] py-10"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      <button
        type="button"
        onClick={() => router.push("/app")}
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] font-semibold transition-opacity hover:opacity-70"
        style={{ color: appleVibe.text.tertiary }}
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Back to home
      </button>

      <h1
        className="text-[26px] font-semibold tracking-tight"
        style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
      >
        Sync your browser tabs
      </h1>
      <p
        className="mt-2 text-[14px] font-light leading-relaxed"
        style={{ color: appleVibe.text.secondary }}
      >
        Install the akiboe tab-sync extension and pull your open research
        tabs straight into the objective chatbox as context.
      </p>

      {/* Pairing token */}
      <Field label="Your pairing token">
        <CopyRow
          value={pairingToken || "—"}
          onCopy={() => copy(pairingToken, "token")}
          copied={copied === "token"}
          mono
        />
      </Field>

      {/* App URL */}
      <Field label="App URL (for the extension)">
        <CopyRow
          value={origin || "…"}
          onCopy={() => copy(origin, "origin")}
          copied={copied === "origin"}
          mono
        />
      </Field>

      {/* Steps */}
      <ol className="mt-8 space-y-3">
        {[
          "Open chrome://extensions, enable Developer mode (top-right).",
          'Click "Load unpacked" and select the extension/ folder from this repo.',
          "Open the akiboe Tab Sync popup, paste the token + App URL above.",
          'Click "Sync tabs" — your open tabs appear in the chatbox’s "tabs" chip.',
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
              style={{ background: appleVibe.surface.chip, color: appleVibe.text.secondary }}
            >
              {i + 1}
            </span>
            <span
              className="pt-0.5 text-[13.5px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div
        className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function CopyRow({
  value,
  onCopy,
  copied,
  mono,
}: {
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.card,
      }}
    >
      <span
        className="truncate text-[13px]"
        style={{
          color: appleVibe.text.primary,
          fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy"
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors"
        style={{ background: appleVibe.surface.chip, color: appleVibe.text.secondary }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" style={{ color: appleVibe.stage.outcomes }} />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
