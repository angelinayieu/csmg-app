"use client";

// ── ProfileSettings ───────────────────────────────────────────────
//
// The clean, minimal Profile page for the new build (route /app/profile).
// Replaces the dead-end board "sign out" popover and the heavy retired
// /app/settings page as the thing both the home dropdown and the board
// gear point at. Four focused sections, glass chrome (appleVibe):
//
//   1. Identity   — initials avatar, editable display name, email (read-only)
//   2. Plan       — tier badge + credit balance, link out to /app/credits
//   3. Appearance — color scheme (reuses the app-store colorScheme)
//   4. Privacy    — the data-consent toggles (PUT /api/user/consent)
//   + Sign out
//
// Reuses the canonical endpoints — no new backend:
//   • name  → PATCH /api/synergy/profiles/me  (writes synergy_profiles,
//     which is what the home + /api/me/profile read; the old form wrote
//     to `profiles`, a different table, so name edits never showed up)
//   • consent → PUT /api/user/consent
//   • theme   → useAppStore colorScheme
//   • sign out → supabase client auth.signOut()

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Coins,
  Palette,
  ShieldCheck,
  LogOut,
  Check,
  Loader2,
  ChevronRight,
  Camera,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar, removeAvatar } from "@/lib/avatar-upload";
import { toast } from "@/lib/hooks/use-toast";
import { useAppStore } from "@/stores/store-provider";
import { THEMES, type ThemeId } from "@/lib/themes";
import {
  ALL_DATA_CATEGORIES,
  DATA_CATEGORY_META,
  type DataCategory,
} from "@/types/consent";
import { invalidateConsentMap } from "@/lib/hooks/use-consent-map";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface ProfileSettingsProps {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  tier: string;
  creditBalance: number;
  initialConsentMap: Record<DataCategory, boolean>;
}

const TIER_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
};

export function ProfileSettings({
  userId,
  email,
  displayName: initialName,
  avatarUrl: initialAvatarUrl,
  tier,
  creditBalance,
  initialConsentMap,
}: ProfileSettingsProps) {
  const router = useRouter();

  // ── identity ──
  const [name, setName] = useState(initialName ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const initial = (name || email || "Y").trim().charAt(0).toUpperCase();
  const dirty = name.trim() !== (initialName ?? "").trim();

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError("Name must be at least 2 characters.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: trimmed }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
      router.refresh();
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSavingName(false);
    }
  }

  // ── appearance ──
  const colorScheme = useAppStore((s) => s.colorScheme);
  const setColorScheme = useAppStore((s) => s.setColorScheme);

  // ── privacy / consent ──
  const [consentMap, setConsentMap] =
    useState<Record<DataCategory, boolean>>(initialConsentMap);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  async function toggleConsent(cat: DataCategory, next: boolean) {
    setConsentMap((m) => ({ ...m, [cat]: next }));
    setConsentSaving(true);
    setConsentError(null);
    try {
      const res = await fetch("/api/user/consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_map: { [cat]: next } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidateConsentMap();
      router.refresh();
    } catch (err) {
      // revert on failure
      setConsentMap((m) => ({ ...m, [cat]: !next }));
      setConsentError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setConsentSaving(false);
    }
  }

  // ── sign out ──
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      router.push("/auth/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div
      className="mx-auto max-w-xl pb-16"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* back + heading */}
      <button
        type="button"
        onClick={() => router.push("/app")}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-black/[0.04]"
        style={{ color: appleVibe.text.tertiary }}
      >
        <ArrowLeft style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        Home
      </button>

      <h1
        className="mt-3 text-[26px] font-semibold tracking-tight"
        style={{ color: appleVibe.text.primary, fontFamily: appleVibe.font.display }}
      >
        Profile
      </h1>
      <p className="mt-1 text-[13.5px]" style={{ color: appleVibe.text.tertiary }}>
        Your account, appearance, and privacy.
      </p>

      <div className="mt-7 space-y-4">
        {/* ── Identity ── */}
        <section style={card}>
          <SectionHead icon={<InitialBadge initial={initial} />} title="Identity" />
          <div style={{ padding: "4px 18px 18px" }}>
            <div className="flex items-start gap-4">
              <AvatarControl
                userId={userId}
                url={avatarUrl}
                initial={initial}
                onChange={setAvatarUrl}
              />
              <div className="min-w-0 flex-1">
                <label style={fieldLabel}>Display name</label>
                <div className="flex items-center gap-2">
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    placeholder="Your name"
                    maxLength={64}
                    style={textInput}
                    onFocus={(e) => (e.currentTarget.style.borderColor = appleVibe.stroke.medium)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = appleVibe.stroke.soft)}
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={!dirty || savingName}
                    style={{
                      ...primaryBtn,
                      opacity: !dirty || savingName ? 0.45 : 1,
                      cursor: !dirty || savingName ? "default" : "pointer",
                    }}
                  >
                    {savingName ? (
                      <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
                    ) : nameSaved ? (
                      <Check style={{ width: 14, height: 14 }} strokeWidth={2.4} />
                    ) : (
                      "Save"
                    )}
                  </button>
                </div>
                {nameError && <p style={errText}>{nameError}</p>}

                <label style={{ ...fieldLabel, marginTop: 16 }}>Email</label>
                <div style={readonlyRow}>
                  <Mail style={{ width: 15, height: 15, color: appleVibe.text.faint }} strokeWidth={2} />
                  <span className="truncate text-[13px]" style={{ color: appleVibe.text.tertiary }}>
                    {email || "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Plan & credits ── */}
        <section style={card}>
          <SectionHead
            icon={<Coins style={iconStyle} strokeWidth={2.2} />}
            title="Plan & credits"
          />
          <div
            style={{ padding: "4px 18px 18px" }}
            className="flex items-center justify-between gap-4"
          >
            <div>
              <div style={overline}>Plan</div>
              <span
                className="mt-1.5 inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: appleVibe.surface.chip, color: appleVibe.text.secondary }}
              >
                {TIER_LABEL[tier] ?? "Free"}
              </span>
            </div>
            <div className="text-right">
              <div style={overline}>Credits</div>
              <div
                className="mt-1 text-[22px] font-bold tabular-nums"
                style={{ color: appleVibe.text.primary }}
              >
                {creditBalance.toLocaleString()}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/app/credits")}
            className="flex w-full items-center justify-between px-[18px] py-3 text-[13px] font-medium transition-colors hover:bg-black/[0.025]"
            style={{ color: appleVibe.text.secondary, borderTop: `1px solid ${appleVibe.stroke.soft}` }}
          >
            Manage credits & billing
            <ChevronRight style={{ width: 16, height: 16, color: appleVibe.text.faint }} strokeWidth={2.2} />
          </button>
        </section>

        {/* ── Appearance ── */}
        <section style={card}>
          <SectionHead icon={<Palette style={iconStyle} strokeWidth={2.2} />} title="Appearance" />
          <div style={{ padding: "4px 18px 18px" }}>
            <div style={overline}>Color scheme</div>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {(Object.entries(THEMES) as [ThemeId, (typeof THEMES)[ThemeId]][]).map(
                ([id, theme]) => {
                  const active = colorScheme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setColorScheme(id)}
                      className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 transition-all"
                      style={{
                        background: active ? appleVibe.surface.chip : "transparent",
                        border: `1px solid ${active ? appleVibe.stroke.medium : appleVibe.stroke.soft}`,
                      }}
                    >
                      <span
                        className="h-6 w-6 rounded-full"
                        style={{
                          background: theme.swatch,
                          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
                        }}
                      />
                      <span
                        className="text-[12.5px] font-semibold"
                        style={{ color: active ? appleVibe.text.primary : appleVibe.text.tertiary }}
                      >
                        {theme.label}
                      </span>
                      {active && (
                        <Check style={{ width: 14, height: 14, color: appleVibe.text.primary }} strokeWidth={2.6} />
                      )}
                    </button>
                  );
                },
              )}
            </div>
          </div>
        </section>

        {/* ── Privacy ── */}
        <section style={card}>
          <SectionHead
            icon={<ShieldCheck style={iconStyle} strokeWidth={2.2} />}
            title="Data & privacy"
            trailing={
              consentSaving ? (
                <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: appleVibe.text.faint }} />
              ) : null
            }
          />
          <div style={{ padding: "0 18px 8px" }}>
            <p className="text-[12.5px] leading-relaxed" style={{ color: appleVibe.text.tertiary }}>
              Choose which kinds of personal data akiboe can use in your
              strategies. You can change these anytime.
            </p>
            {consentError && <p style={errText}>{consentError}</p>}
          </div>
          <div style={{ padding: "0 8px 10px" }}>
            {ALL_DATA_CATEGORIES.map((cat) => {
              const meta = DATA_CATEGORY_META[cat];
              const checked = consentMap[cat] ?? false;
              return (
                <div
                  key={cat}
                  className="flex items-start gap-3 rounded-xl px-2.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium" style={{ color: appleVibe.text.primary }}>
                        {meta.label}
                      </span>
                      {meta.sensitivity === "high" && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
                          style={{ background: "rgba(245,158,11,0.12)", color: "#B45309" }}
                        >
                          Sensitive
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: appleVibe.text.tertiary }}>
                      {meta.description}
                    </p>
                  </div>
                  <Toggle checked={checked} onChange={(v) => toggleConsent(cat, v)} />
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Sign out ── */}
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-semibold transition-colors hover:bg-black/[0.03]"
          style={{
            background: appleVibe.surface.card,
            border: `1px solid ${appleVibe.stroke.soft}`,
            color: appleVibe.text.secondary,
            boxShadow: appleVibe.shadow.chip,
          }}
        >
          {signingOut ? (
            <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} />
          ) : (
            <LogOut style={{ width: 15, height: 15 }} strokeWidth={2.2} />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

// ── small building blocks ──

function SectionHead({
  icon,
  title,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-[18px] pb-2 pt-[18px]">
      {icon}
      <span className="text-[13.5px] font-semibold" style={{ color: appleVibe.text.primary }}>
        {title}
      </span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </div>
  );
}

function InitialBadge({ initial }: { initial: string }) {
  return (
    <div
      className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-semibold text-white"
      style={{ background: appleVibe.stage.features }}
    >
      {initial}
    </div>
  );
}

function AvatarControl({
  userId,
  url,
  initial,
  onChange,
}: {
  userId: string;
  url: string | null;
  initial: string;
  onChange: (next: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file re-fires
    if (!file) return;
    setBusy(true);
    try {
      const next = await uploadAvatar(file, userId);
      onChange(next);
      toast.success("Photo updated");
    } catch (err) {
      toast.error("Upload failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (busy || !url) return;
    setBusy(true);
    try {
      await removeAvatar(userId, url);
      onChange(null);
      toast.success("Photo removed");
    } catch (err) {
      toast.error("Remove failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => !busy && inputRef.current?.click()}
        disabled={busy}
        title={url ? "Replace photo" : "Upload photo"}
        className="group relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[20px] font-semibold text-white"
        style={{ background: appleVibe.stage.features, boxShadow: appleVibe.shadow.chip }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/35">
            <Loader2 className="animate-spin" style={{ width: 18, height: 18, color: "white" }} />
          </span>
        ) : (
          <span className="absolute inset-x-0 bottom-0 flex h-5 items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera style={{ width: 12, height: 12, color: "white" }} strokeWidth={2.2} />
          </span>
        )}
      </button>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={busy}
          className="text-[11px] font-semibold disabled:opacity-50"
          style={{ color: appleVibe.text.tertiary }}
        >
          {url ? "Replace" : "Upload"}
        </button>
        {url && (
          <>
            <span style={{ color: appleVibe.text.faint }}>·</span>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50"
              style={{ color: appleVibe.text.faint }}
            >
              <Trash2 style={{ width: 11, height: 11 }} strokeWidth={2.2} />
              Remove
            </button>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        className="hidden"
      />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative mt-0.5 inline-flex h-[22px] w-[38px] flex-shrink-0 items-center rounded-full transition-colors"
      style={{
        background: checked ? appleVibe.accent.primary : "rgba(15,23,42,0.14)",
      }}
    >
      <span
        className="inline-block h-[18px] w-[18px] rounded-full bg-white transition-transform"
        style={{
          transform: checked ? "translateX(18px)" : "translateX(2px)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        }}
      />
    </button>
  );
}

// ── styles ──
const card: CSSProperties = {
  borderRadius: appleVibe.radius.xl,
  background: appleVibe.surface.card,
  border: `1px solid ${appleVibe.stroke.soft}`,
  boxShadow: appleVibe.shadow.card,
  overflow: "hidden",
};
const iconStyle: CSSProperties = { width: 17, height: 17, color: appleVibe.text.secondary };
const overline: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: appleVibe.text.faint,
};
const fieldLabel: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.faint,
};
const textInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  borderRadius: appleVibe.radius.sm,
  border: `1px solid ${appleVibe.stroke.soft}`,
  background: appleVibe.surface.base,
  padding: "9px 12px",
  fontSize: 13.5,
  color: appleVibe.text.primary,
  outline: "none",
  transition: "border-color 120ms",
};
const readonlyRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  borderRadius: appleVibe.radius.sm,
  border: `1px solid ${appleVibe.stroke.soft}`,
  background: appleVibe.surface.chip,
  padding: "9px 12px",
};
const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 58,
  height: 36,
  padding: "0 14px",
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: appleVibe.accent.primary,
  color: "white",
  fontSize: 12.5,
  fontWeight: 650,
};
const errText: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "#DC2626",
};
