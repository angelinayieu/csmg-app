// ── Synergy Strategy Share Modal ──
//
// Opens from the Share button on the strategy doc header. Owner-side
// surface for minting / listing / revoking read-only share links
// pointing at /synergy/shared/[token].
//
// Modal sections:
//   1) Active links — table of (label, url, last viewed, expires, revoke)
//   2) "Create new link" — optional label + optional 7d/30d/90d/never expiry
//
// All mutations call the synergy client wrappers; we keep local state
// in sync optimistically so the user feels the new link appear without
// a refetch.

"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  Globe,
  Link2,
  Loader2,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import {
  createStrategyShare,
  listStrategyShares,
  revokeStrategyShare,
  type StrategyShareToken,
} from "@/lib/synergy/client";

interface Props {
  strategyId: string;
  open: boolean;
  onClose: () => void;
}

type ExpiryChoice = "never" | "7d" | "30d" | "90d";

function expiryToIso(choice: ExpiryChoice): string | undefined {
  if (choice === "never") return undefined;
  const days = { "7d": 7, "30d": 30, "90d": 90 }[choice];
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isActive(t: StrategyShareToken): boolean {
  if (t.revoked_at) return false;
  if (t.expires_at && Date.parse(t.expires_at) < Date.now()) return false;
  return true;
}

function formatRelativeFuture(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 1) return `in ${hours}h`;
  return `<1h`;
}

function formatRelativePast(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60 * 1000) return "just now";
  const min = Math.floor(ms / (60 * 1000));
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function urlFor(token: string): string {
  if (typeof window === "undefined") return `/synergy/shared/${token}`;
  return `${window.location.origin}/synergy/shared/${token}`;
}

export function SynergyStrategyShareModal({ strategyId, open, onClose }: Props) {
  const [shares, setShares] = useState<StrategyShareToken[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("30d");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    listStrategyShares(strategyId)
      .then((rows) => {
        if (!cancelled) setShares(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error("Couldn't load links", {
            description: (err as Error).message,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, strategyId]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const fresh = await createStrategyShare(strategyId, {
        label: label.trim() || undefined,
        expires_at: expiryToIso(expiry),
      });
      setShares((prev) => (prev ? [fresh, ...prev] : [fresh]));
      setLabel("");
      // Auto-copy the brand-new link — high-confidence "I want this".
      try {
        await navigator.clipboard.writeText(urlFor(fresh.token));
        setCopiedId(fresh.id);
        setTimeout(() => setCopiedId((id) => (id === fresh.id ? null : id)), 1800);
        toast.success("Link created · copied to clipboard");
      } catch {
        toast.success("Link created");
      }
    } catch (err) {
      toast.error("Couldn't create link", {
        description: (err as Error).message,
      });
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async (s: StrategyShareToken) => {
    try {
      await navigator.clipboard.writeText(urlFor(s.token));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((id) => (id === s.id ? null : id)), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };

  const onRevoke = async (s: StrategyShareToken) => {
    if (revokingId) return;
    if (
      !window.confirm(
        `Revoke this link? Anyone using it will see "no longer active".`,
      )
    ) {
      return;
    }
    setRevokingId(s.id);
    try {
      const updated = await revokeStrategyShare(strategyId, s.id);
      setShares((prev) =>
        prev ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev,
      );
      toast.success("Link revoked");
    } catch (err) {
      toast.error("Revoke failed", {
        description: (err as Error).message,
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (!open) return null;

  const active = (shares ?? []).filter(isActive);
  const inactive = (shares ?? []).filter((s) => !isActive(s));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Share strategy"
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
              <Share2 className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900">
                Share read-only link
              </h2>
              <p className="text-[11px] text-gray-500">
                Anyone with the link can view this strategy. No sign-in
                required.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Create new link ── */}
        <div className="border-b border-gray-100 bg-blue-50/30 px-6 py-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-blue-700">
            Create new link
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional) — e.g. 'investor preview'"
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              maxLength={80}
            />
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="7d">Expires in 7d</option>
              <option value="30d">Expires in 30d</option>
              <option value="90d">Expires in 90d</option>
              <option value="never">Never expires</option>
            </select>
            <button
              onClick={onCreate}
              disabled={creating}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:scale-[1.02] disabled:opacity-60"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create
            </button>
          </div>
        </div>

        {/* ── Active links ── */}
        <div className="px-6 py-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
            <Link2 className="h-3 w-3 text-blue-600" />
            Active links
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-700">
              {active.length}
            </span>
          </div>
          {loading && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-[12px] text-gray-500">
              <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
              Loading links…
            </div>
          )}
          {!loading && active.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center text-[12px] text-gray-500">
              <Globe className="mx-auto mb-2 h-4 w-4 text-gray-400" />
              No active links yet. Create one above to share this strategy.
            </div>
          )}
          {!loading && active.length > 0 && (
            <ul className="space-y-2">
              {active.map((s) => (
                <li
                  key={s.id}
                  className="rounded-xl border border-gray-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-[13px] font-semibold text-gray-900">
                          {s.label || "Untitled link"}
                        </h4>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-700">
                          active
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[10.5px] text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {s.view_count} view{s.view_count === 1 ? "" : "s"}
                          {s.last_viewed_at && (
                            <> · {formatRelativePast(s.last_viewed_at)}</>
                          )}
                        </span>
                        <span>
                          expires {formatRelativeFuture(s.expires_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => onCopy(s)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 hover:text-gray-900"
                        title="Copy link"
                      >
                        {copiedId === s.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />{" "}
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => onRevoke(s)}
                        disabled={revokingId === s.id}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:border-rose-400 disabled:opacity-60"
                        title="Revoke"
                      >
                        {revokingId === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Revoke
                      </button>
                    </div>
                  </div>
                  <code className="mt-2 block truncate rounded-md bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-700">
                    {urlFor(s.token)}
                  </code>
                </li>
              ))}
            </ul>
          )}

          {/* Inactive / revoked / expired — collapsed by default */}
          {!loading && inactive.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-wider text-gray-500 transition hover:text-gray-900">
                Past links · {inactive.length}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {inactive.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-[11px] text-gray-600"
                  >
                    <span className="truncate">{s.label || "Untitled"}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
                      {s.revoked_at ? "revoked" : "expired"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
