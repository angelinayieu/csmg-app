"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { User, Mail, CreditCard, BarChart3, Shield, Save, Loader2, Check, Palette, ShieldCheck } from "lucide-react";
import { useAppStore } from "@/stores/store-provider";
import { THEMES, type ThemeId } from "@/lib/themes";
import {
  ALL_DATA_CATEGORIES,
  DATA_CATEGORY_META,
  type DataCategory,
} from "@/types/consent";
import { invalidateConsentMap } from "@/lib/hooks/use-consent-map";

interface SettingsFormProps {
  userId: string;
  email: string;
  displayName: string;
  tier: "free" | "pro" | "team";
  creditBalance: number;
  usageCount: number;
  /** Phase 4a: initial consent map for the Data I'm comfortable sharing section. */
  initialConsentMap?: Record<DataCategory, boolean>;
}

export function SettingsForm({
  userId,
  email,
  displayName: initialDisplayName,
  tier,
  creditBalance,
  usageCount,
  initialConsentMap,
}: SettingsFormProps) {
  const [firstName, setFirstName] = useState(
    initialDisplayName?.split(" ")[0] ?? ""
  );
  const [lastName, setLastName] = useState(
    initialDisplayName?.split(" ").slice(1).join(" ") ?? ""
  );
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // ── Phase 4a: data preferences ──
  const [consentMap, setConsentMap] = useState<Record<DataCategory, boolean>>(
    () => {
      const base = {} as Record<DataCategory, boolean>;
      for (const cat of ALL_DATA_CATEGORIES) {
        base[cat] = DATA_CATEGORY_META[cat].default_allow;
      }
      return { ...base, ...(initialConsentMap ?? {}) };
    }
  );
  const [consentSavedAt, setConsentSavedAt] = useState<number | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);

  async function toggleConsent(cat: DataCategory, next: boolean) {
    const optimistic = { ...consentMap, [cat]: next };
    setConsentMap(optimistic);
    setConsentSaving(true);
    setConsentError(null);
    try {
      const res = await fetch("/api/user/consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_map: { [cat]: next } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConsentSavedAt(Date.now());
      // Phase 4c-next: drop any cached consent map so open strategy pages
      // re-rank tracker proposals against the new allowed-categories set
      // without requiring a full page reload.
      invalidateConsentMap();
      router.refresh();
    } catch (err) {
      // Revert on failure
      setConsentMap((prev) => ({ ...prev, [cat]: !next }));
      setConsentError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setConsentSaving(false);
    }
  }

  async function handleSave() {
    const displayName = [firstName.trim(), lastName.trim()]
      .filter(Boolean)
      .join(" ");

    const supabase = createClient();
    // Supabase-ssr's typed update() narrows to `never` when the generated
    // Database type doesn't include an explicit Update type for this table.
    // Cast to `any` locally — the query is well-formed at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("profiles") as any)
      .update({ display_name: displayName || null })
      .eq("id", userId);

    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      startTransition(() => {
        router.refresh();
      });
    }
  }

  const colorScheme = useAppStore((s) => s.colorScheme);
  const setColorScheme = useAppStore((s) => s.setColorScheme);

  const tierLabels = { free: "Free", pro: "Pro", team: "Team" };
  const tierColors = {
    free: "bg-gray-100 text-gray-700",
    pro: "bg-interaxis-100 text-interaxis-700",
    team: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="mt-8 space-y-8">
      {/* Profile Section */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <User className="h-5 w-5 text-interaxis-600" />
          <h2 className="text-lg font-semibold">Profile</h2>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
                First Name
              </label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter first name"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-800 outline-none transition-colors focus:border-interaxis-300 focus:bg-white focus:ring-2 focus:ring-interaxis-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
                Last Name
              </label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter last name"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-800 outline-none transition-colors focus:border-interaxis-300 focus:bg-white focus:ring-2 focus:ring-interaxis-100"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
              Email
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-100 px-3.5 py-2.5">
              <Mail className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-500">{email}</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Email cannot be changed here. Contact support if needed.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={isPending}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-interaxis-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-interaxis-600 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saved ? "Saved" : "Save Changes"}
          </button>
        </div>
      </section>

      {/* Account Section */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-interaxis-600" />
          <h2 className="text-lg font-semibold">Account</h2>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Plan
              </p>
              <div className="mt-1.5">
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tierColors[tier]}`}
                >
                  {tierLabels[tier]}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Credits
              </p>
              <p className="mt-1.5 text-2xl font-bold text-gray-800">
                {creditBalance}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Analyses Run
              </p>
              <p className="mt-1.5 text-2xl font-bold text-gray-800">
                {usageCount}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Usage & Analytics */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-interaxis-600" />
          <h2 className="text-lg font-semibold">Preferences</h2>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
              Default Analysis Tier
            </label>
            <p className="text-sm text-gray-600">
              Your default tier is determined by your plan. Upgrade to access
              deeper analysis tiers.
            </p>
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
              Notifications
            </label>
            <p className="text-sm text-gray-600">
              Email notifications for completed analyses are enabled by default.
            </p>
          </div>
        </div>
      </section>

      {/* Data I'm comfortable sharing — Phase 4a */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-interaxis-600" />
          <h2 className="text-lg font-semibold">Data I'm comfortable sharing</h2>
          {consentSaving && (
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          )}
          {!consentSaving && consentSavedAt && Date.now() - consentSavedAt < 4000 && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-gray-600">
            Choose which kinds of personal data InterAxis can track in your strategies.
            When you confirm a strategy, metrics tied to categories you haven&apos;t
            allowed will be skipped automatically. You can change these anytime.
          </p>
          {consentError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {consentError}
            </div>
          )}
          <div className="space-y-2">
            {ALL_DATA_CATEGORIES.map((cat) => {
              const meta = DATA_CATEGORY_META[cat];
              const checked = consentMap[cat] ?? false;
              return (
                <label
                  key={cat}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-gray-200 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleConsent(cat, e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-interaxis-600 focus:ring-interaxis-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {meta.label}
                      </span>
                      {meta.sensitivity === "high" && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                          Sensitive
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Palette className="h-5 w-5 text-interaxis-600" />
          <h2 className="text-lg font-semibold">Appearance</h2>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="mb-3 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Color Scheme
          </label>
          <div className="flex gap-4">
            {(Object.entries(THEMES) as [ThemeId, (typeof THEMES)[ThemeId]][]).map(
              ([id, theme]) => (
                <button
                  key={id}
                  onClick={() => setColorScheme(id)}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 px-5 py-4 transition-all ${
                    colorScheme === id
                      ? "border-interaxis-500 bg-interaxis-50/50 shadow-sm"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div
                    className="h-10 w-10 rounded-full shadow-inner"
                    style={{ background: theme.swatch }}
                  />
                  <span className="text-xs font-semibold text-gray-700">
                    {theme.label}
                  </span>
                  {colorScheme === id && (
                    <span className="text-[10px] font-medium text-interaxis-600">
                      Active
                    </span>
                  )}
                </button>
              )
            )}
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Choose a color scheme for the entire application. Changes apply
            instantly.
          </p>
        </div>
      </section>

      {/* Danger Zone */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-red-500" />
          <h2 className="text-lg font-semibold text-red-600">Danger Zone</h2>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6">
          <p className="text-sm text-gray-600">
            Deleting your account will permanently remove all spaces, analyses,
            and data. This action cannot be undone.
          </p>
          <button className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50">
            Delete Account
          </button>
        </div>
      </section>
    </div>
  );
}
