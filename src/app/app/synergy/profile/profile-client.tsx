// ── Profile editor client ──
//
// Loads /api/synergy/profiles/me on mount (auto-bootstraps if missing),
// renders editable display_name + bio + matching_enabled toggle,
// PATCHes on save.

"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  Inbox,
  Loader2,
  Mail,
  Save,
  Send,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";

interface EmailNotifPrefs {
  new_request?: boolean;
  request_accepted?: boolean;
  weekly_digest?: boolean;
}

interface Profile {
  user_id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  matching_enabled: boolean;
  max_pending_requests: number;
  email_notifications?: EmailNotifPrefs;
  notification_email?: string | null;
}

export function SynergyProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [matchingEnabled, setMatchingEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/synergy/profiles/me")
      .then((r) => r.json())
      .then((body: { profile: Profile | null; error?: string }) => {
        if (cancelled) return;
        if (body.error) {
          toast.error("Couldn't load profile", { description: body.error });
          return;
        }
        if (body.profile) {
          setProfile(body.profile);
          setDisplayName(body.profile.display_name);
          setBio(body.profile.bio ?? "");
          setMatchingEnabled(body.profile.matching_enabled);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error("Couldn't load profile", {
            description: (e as Error).message,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    if (displayName.trim().length < 2) {
      toast.error("Display name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          bio,
          matching_enabled: matchingEnabled,
        }),
      });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !body.profile) {
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      setProfile(body.profile);
      toast.success("Profile saved");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-600" />
        <p className="mt-2 text-sm text-gray-500">Loading profile…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Preview card — what the other person will see */}
      <section className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/60 to-cyan-50/40 p-5">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-blue-700">
          <Sparkles className="h-3 w-3" /> Preview — what they&apos;ll see
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-white px-4 py-3">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-200 to-cyan-200 text-blue-800">
            <UserCircle2 className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-gray-900">
              {displayName || "(your display name)"}
            </div>
            {bio.trim() ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-700">
                {bio}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] italic text-gray-500">
                (no bio — optional but recommended)
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Editor */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="space-y-5">
          <div>
            <label
              htmlFor="display-name"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
            >
              Display name · 2-64 chars
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 64))}
              maxLength={64}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[14px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label
              htmlFor="bio"
              className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
            >
              <span>Bio · optional</span>
              <span>{400 - bio.length} chars left</span>
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 400))}
              rows={3}
              placeholder="What you work on, where you're based, what kind of collaborators you're looking for."
              maxLength={400}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={matchingEnabled}
                onChange={(e) => setMatchingEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-blue-600"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-gray-900">
                  Matching enabled
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">
                  When on, your matchable components appear in other users&apos;
                  discover feeds and you can receive connection requests.
                  Existing pending requests remain valid even if you toggle off.
                </p>
              </div>
            </label>
          </div>

          {profile && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/40 p-3 text-[11px] text-gray-600">
              <span className="font-mono uppercase tracking-wider text-gray-500">
                Pending request limit:
              </span>{" "}
              {profile.max_pending_requests} outgoing
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save profile
          </button>
        </div>
      </section>

      {/* Email section — anchored by id="email" so the email footer
          links land here directly. */}
      {profile && <EmailSection profile={profile} onUpdated={setProfile} />}
    </div>
  );
}

// ── Email preferences card ──
//
// Three opt-in toggles + an override-delivery email + a test-email
// button. Each toggle PATCHes immediately on change (optimistic
// rollback on error) so the user gets instant feedback — no need
// to wait for the larger Save profile button.

function EmailSection({
  profile,
  onUpdated,
}: {
  profile: Profile;
  onUpdated: (p: Profile) => void;
}) {
  const prefs = profile.email_notifications ?? {};
  const [overrideEmail, setOverrideEmail] = useState(
    profile.notification_email ?? "",
  );
  const [savingOverride, setSavingOverride] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const patchPref = async (key: keyof EmailNotifPrefs, value: boolean) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email_notifications: { [key]: value } }),
      });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !body.profile) {
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      onUpdated(body.profile);
    } catch (e) {
      toast.error("Couldn't update preference", {
        description: (e as Error).message,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const saveOverride = async () => {
    if (savingOverride) return;
    setSavingOverride(true);
    try {
      const value = overrideEmail.trim() || null;
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notification_email: value }),
      });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!res.ok || !body.profile) {
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      onUpdated(body.profile);
      toast.success(value ? "Override email saved" : "Override cleared");
    } catch (e) {
      toast.error("Couldn't save override", {
        description: (e as Error).message,
      });
    } finally {
      setSavingOverride(false);
    }
  };

  const sendTest = async () => {
    if (sendingTest) return;
    setSendingTest(true);
    try {
      const res = await fetch("/api/synergy/email/test", { method: "POST" });
      const body = (await res.json()) as {
        ok?: boolean;
        dry_run?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      if (body.dry_run) {
        toast.info("Test email dry-run", {
          description:
            "RESEND_API_KEY is not set — email contents logged to server console.",
        });
      } else {
        toast.success("Test email sent", {
          description: "Check your inbox in a few seconds.",
        });
      }
    } catch (e) {
      toast.error("Test send failed", {
        description: (e as Error).message,
      });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <section
      id="email"
      className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Mail className="h-4 w-4 text-blue-600" />
        <h2 className="text-[15px] font-semibold text-gray-900">
          Email notifications
        </h2>
      </div>

      {/* Per-event toggles */}
      <div className="space-y-2">
        <NotifToggle
          icon={Inbox}
          label="Someone requests to connect on my component"
          help="Sent as soon as a connection request lands in your inbox. Sender stays anonymous in the email — same as in the in-app inbox."
          checked={prefs.new_request !== false}
          busy={busyKey === "new_request"}
          onChange={(v) => patchPref("new_request", v)}
        />
        <NotifToggle
          icon={Sparkles}
          label="Someone accepts a request I sent"
          help="Sent when the receiver taps Accept on a request you sent. Includes their display name + bio (relationship is now mutual)."
          checked={prefs.request_accepted !== false}
          busy={busyKey === "request_accepted"}
          onChange={(v) => patchPref("request_accepted", v)}
        />
        <NotifToggle
          icon={Bell}
          label="Weekly digest of new matches"
          help="One email Monday morning summarizing matches surfaced across all your components. Off by default."
          checked={prefs.weekly_digest === true}
          busy={busyKey === "weekly_digest"}
          onChange={(v) => patchPref("weekly_digest", v)}
        />
      </div>

      {/* Delivery override */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <label
          htmlFor="notification-email"
          className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500"
        >
          Delivery address
        </label>
        <p className="mb-2 text-[11px] leading-relaxed text-gray-600">
          By default we send to your sign-up email. Set an override here if you
          want notifications to a different inbox (e.g. a work address).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="notification-email"
            type="email"
            value={overrideEmail}
            placeholder="(leave blank to use your sign-up email)"
            onChange={(e) => setOverrideEmail(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={saveOverride}
            disabled={savingOverride}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
          >
            {savingOverride ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save override
          </button>
        </div>
      </div>

      {/* Send test */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={sendTest}
          disabled={sendingTest}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
        >
          {sendingTest ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
          Send test email
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">
          Confirms delivery + your address.
        </span>
      </div>
    </section>
  );
}

function NotifToggle({
  icon: Icon,
  label,
  help,
  checked,
  busy,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  help: string;
  checked: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
        checked
          ? "border-blue-200 bg-blue-50/40"
          : "border-gray-200 bg-white hover:border-gray-300",
      ].join(" ")}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-gray-200">
        <Icon
          className={`h-4 w-4 ${checked ? "text-blue-600" : "text-gray-500"}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-gray-900">{label}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">
          {help}
        </p>
      </div>
      <div className="relative flex shrink-0 items-center">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        ) : (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
        )}
      </div>
    </label>
  );
}
