"use client";

// ── Share board modal ─────────────────────────────────────────────
//
// Owner-facing share surface for the objective whiteboard. Invite by
// email with an Editor/Viewer role, copy a sharable link, see current
// members + pending invites, and revoke access.
//
// Bug fix: tldraw renders the canvas inside CSS-transformed ancestors,
// which breaks `position: fixed` for descendants — the modal was
// positioning relative to the transformed canvas and "flying out" to
// the top-right. We now portal the modal to `document.body` so it
// truly overlays the viewport and centers correctly.
//
// Backed by:
//   GET    /api/objective/[spaceId]/members
//   POST   /api/objective/[spaceId]/share          { email, role }
//   DELETE /api/objective/[spaceId]/members/[userId]

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Share2,
  X,
  Copy,
  Check,
  Trash2,
  Link as LinkIcon,
  Mail,
  UserPlus,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Member {
  userId: string;
  email: string | null;
  name: string | null;
  role: "owner" | "editor" | "viewer";
  isOwner: boolean;
}
interface MembersResponse {
  myRole: "owner" | "editor" | "viewer";
  ownerId: string | null;
  members: Member[];
  invites: Array<{ email: string; role: string }>;
  shared: boolean;
}

export function ShareBoardLauncher({
  spaceId,
  variant,
}: {
  spaceId: string;
  /** "bar" → an in-flow accent pill for BoardTopRightBar; default floats. */
  variant?: "bar";
}) {
  const [open, setOpen] = useState(false);
  const inBar = variant === "bar";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share this board"
        aria-label="Share this board"
        style={{
          ...(inBar
            ? {}
            : { position: "absolute", top: 16, right: 56, zIndex: 70 }),
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: inBar ? "6px 12px" : "7px 13px",
          borderRadius: 999,
          border: `1px solid ${appleVibe.accent.primary}`,
          background: appleVibe.accent.primary,
          color: appleVibe.text.onAccent,
          fontSize: inBar ? 11.5 : 12,
          fontWeight: 650,
          cursor: "pointer",
          fontFamily: appleVibe.font.stack,
          boxShadow: inBar
            ? "0 6px 16px -8px rgba(15,23,42,0.32)"
            : "0 8px 24px -10px rgba(15,23,42,0.32)",
        }}
      >
        <Share2 className="h-3.5 w-3.5" strokeWidth={2.4} />
        Share
      </button>
      {open && <ShareModal spaceId={spaceId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareModal({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "ok" | "warn" | "error";
    text: string;
  } | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [boardLinkBusy, setBoardLinkBusy] = useState(false);

  // The portal target. SSR-safe: we only render once mounted on the client.
  const portalTarget = useMemo(
    () => (typeof document === "undefined" ? null : document.body),
    [],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/objective/${spaceId}/members`, {
        cache: "no-store",
      });
      if (res.ok) setData((await res.json()) as MembersResponse);
    } catch {
      /* soft-fail — modal still renders the invite form */
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc closes the modal — feels right for any well-built overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isOwner = data?.myRole === "owner";

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/objective/${spaceId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        dry_run?: boolean;
        invite_url?: string;
      };
      if (!res.ok || !json.ok) {
        setNotice({
          kind: "error",
          text: json.error ?? `Invite failed (${res.status}).`,
        });
      } else {
        setNotice({
          kind: json.dry_run ? "warn" : "ok",
          text: json.dry_run
            ? `Invite created. Email delivery is off here — copy the link to share it.`
            : `Invite sent to ${email.trim()}.`,
        });
        if (json.invite_url) {
          setLastInviteUrl(`${window.location.origin}${json.invite_url}`);
        }
        setEmail("");
        void load();
      }
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    try {
      await fetch(`/api/objective/${spaceId}/members/${userId}`, {
        method: "DELETE",
      });
      void load();
    } catch {
      /* soft-fail */
    }
  }

  function copy(key: string, url: string) {
    void navigator.clipboard?.writeText(url);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
  }

  // "Copy board link" mints (or reuses) an OPEN invite at the current
  // role and copies the resulting /invite/[token] URL. Copying
  // window.location.href grants no access — the recipient lands on a
  // blank board because spaces / objective_boards RLS is member-scoped.
  // The share-link endpoint is idempotent per (space, role) so the URL
  // is stable across clicks. See [[project_collaborative_whiteboard]].
  async function copyBoardLink() {
    if (boardLinkBusy) return;
    setBoardLinkBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/objective/${spaceId}/share-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        invite_url?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.invite_url) {
        setNotice({
          kind: "error",
          text: json.error ?? `Could not create link (${res.status}).`,
        });
        return;
      }
      copy("board-link", `${window.location.origin}${json.invite_url}`);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setBoardLinkBusy(false);
    }
  }

  const memberCount =
    (data?.members?.length ?? 0) + (data?.invites?.length ?? 0);

  if (!portalTarget) return null;

  const modal = (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share whiteboard"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(11,18,40,0.36)",
        backdropFilter: "blur(6px) saturate(1.1)",
        WebkitBackdropFilter: "blur(6px) saturate(1.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: appleVibe.font.stack,
        animation: "shareFadeIn 160ms ease-out both",
      }}
    >
      <style>{`
        @keyframes shareFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes sharePop {
          from { opacity: 0; transform: translateY(8px) scale(0.985) }
          to   { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 32px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 22,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 32px 80px -28px rgba(11,18,40,0.42), 0 12px 32px -16px rgba(11,18,40,0.18)",
          animation: "sharePop 220ms cubic-bezier(0.2,0.8,0.2,1) both",
        }}
      >
        {/* Header — title, member count, close. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px 14px",
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: appleVibe.surface.chip,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: appleVibe.text.primary,
              }}
            >
              <Share2 className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: appleVibe.text.primary,
                  letterSpacing: "-0.01em",
                }}
              >
                Share whiteboard
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: appleVibe.text.tertiary,
                  marginTop: 1,
                }}
              >
                {memberCount === 0
                  ? "Only you have access"
                  : `${memberCount} ${memberCount === 1 ? "person" : "people"} with access`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: appleVibe.surface.chip,
              border: "none",
              cursor: "pointer",
              color: appleVibe.text.secondary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = appleVibe.surface.chipHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = appleVibe.surface.chip;
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          style={{
            overflow: "auto",
            padding: "16px 20px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {data === null ? (
            <InviteFormSkeleton />
          ) : isOwner ? (
            <form
              onSubmit={invite}
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              {/* Email + role + send — one tight cluster, segmented inside a soft pill. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  borderRadius: 14,
                  background: appleVibe.surface.chip,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                    paddingLeft: 8,
                  }}
                >
                  <Mail
                    className="h-3.5 w-3.5"
                    style={{ color: appleVibe.text.tertiary, flexShrink: 0 }}
                  />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teammate@email.com"
                    style={{
                      flex: 1,
                      width: "100%",
                      padding: "7px 0",
                      border: "none",
                      background: "transparent",
                      fontSize: 13,
                      fontFamily: appleVibe.font.stack,
                      color: appleVibe.text.primary,
                      outline: "none",
                    }}
                  />
                </div>
                <RoleSegmented value={role} onChange={setRole} />
                <button
                  type="submit"
                  disabled={busy || !email.trim()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: "none",
                    background:
                      busy || !email.trim()
                        ? "rgba(15,23,42,0.32)"
                        : appleVibe.accent.primary,
                    color: "#fff",
                    fontSize: 12.5,
                    fontWeight: 650,
                    cursor: busy || !email.trim() ? "default" : "pointer",
                    fontFamily: appleVibe.font.stack,
                    letterSpacing: "-0.01em",
                    transition: "background 0.15s ease",
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" strokeWidth={2.4} />
                  {busy ? "Sending…" : "Invite"}
                </button>
              </div>

              {/* Sharable link — mints (or reuses) an OPEN-link invite
                  at the current role so the URL actually grants access. */}
              <CopyLinkRow
                onCopy={copyBoardLink}
                copied={copiedKey === "board-link"}
                busy={boardLinkBusy}
              />
            </form>
          ) : (
            <p
              style={{
                fontSize: 12.5,
                color: appleVibe.text.secondary,
                margin: 0,
                padding: "10px 12px",
                background: appleVibe.surface.chip,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                borderRadius: 12,
              }}
            >
              You&apos;re collaborating on this board. Only the owner can
              invite others.
            </p>
          )}

          {notice && (
            <NoticeBanner
              kind={notice.kind}
              text={notice.text}
              inviteUrl={lastInviteUrl}
              onCopy={() =>
                lastInviteUrl && copy("invite-link", lastInviteUrl)
              }
              copied={copiedKey === "invite-link"}
            />
          )}

          {/* Roster */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: appleVibe.text.tertiary,
                marginTop: 2,
              }}
            >
              People with access
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              {(data?.members ?? []).map((m) => (
                <RosterRow
                  key={m.userId}
                  label={m.name || m.email || "Unknown"}
                  sub={m.email && m.name ? m.email : null}
                  role={m.role}
                  canRevoke={isOwner && !m.isOwner}
                  onRevoke={() => revoke(m.userId)}
                />
              ))}
              {(data?.invites ?? []).map((inv) => (
                <RosterRow
                  key={`inv-${inv.email}`}
                  label={inv.email}
                  sub="Pending invite"
                  role={inv.role as "editor" | "viewer"}
                  canRevoke={false}
                  pending
                />
              ))}
              {!data && (
                <RosterSkeleton />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalTarget);
}

// ── Role segmented control ───────────────────────────────────────
function RoleSegmented({
  value,
  onChange,
}: {
  value: "editor" | "viewer";
  onChange: (v: "editor" | "viewer") => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 2,
        borderRadius: 999,
        background: "#fff",
        border: `1px solid ${appleVibe.stroke.hairline}`,
      }}
    >
      {(["editor", "viewer"] as const).map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              border: "none",
              background: active ? appleVibe.accent.primary : "transparent",
              color: active
                ? appleVibe.text.onAccent
                : appleVibe.text.secondary,
              fontSize: 11.5,
              fontWeight: 650,
              cursor: "pointer",
              fontFamily: appleVibe.font.stack,
              letterSpacing: "-0.01em",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            {opt === "editor" ? "Edit" : "View"}
          </button>
        );
      })}
    </div>
  );
}

// ── Copy invite link row ─────────────────────────────────────────
function CopyLinkRow({
  onCopy,
  copied,
  busy = false,
}: {
  onCopy: () => void;
  copied: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        background: "#fff",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.65 : 1,
        fontFamily: appleVibe.font.stack,
        textAlign: "left",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!busy) e.currentTarget.style.background = appleVibe.surface.chip;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: appleVibe.surface.chip,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: appleVibe.text.primary,
          }}
        >
          <LinkIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </div>
        <div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 650,
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
            }}
          >
            Copy board link
          </div>
          <div
            style={{
              fontSize: 11,
              color: appleVibe.text.tertiary,
              marginTop: 1,
            }}
          >
            Anyone you&apos;ve invited can sign in to open it
          </div>
        </div>
      </div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11.5,
          fontWeight: 650,
          color: copied ? "#16A34A" : appleVibe.text.secondary,
        }}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            Copied
          </>
        ) : busy ? (
          "Preparing…"
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" strokeWidth={2.2} />
            Copy
          </>
        )}
      </span>
    </button>
  );
}

// ── Inline notice banner ─────────────────────────────────────────
function NoticeBanner({
  kind,
  text,
  inviteUrl,
  onCopy,
  copied,
}: {
  kind: "ok" | "warn" | "error";
  text: string;
  inviteUrl: string | null;
  onCopy: () => void;
  copied: boolean;
}) {
  const palette = {
    ok: { bg: "#ECFDF5", border: "#A7F3D0", fg: "#065F46" },
    warn: { bg: "#FFFBEB", border: "#FDE68A", fg: "#92400E" },
    error: { bg: "#FEF2F2", border: "#FECACA", fg: "#991B1B" },
  }[kind];
  return (
    <div
      style={{
        fontSize: 12.5,
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div>{text}</div>
      {inviteUrl && (
        <button
          type="button"
          onClick={onCopy}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            borderRadius: 999,
            border: `1px solid ${palette.border}`,
            background: "#fff",
            color: palette.fg,
            fontSize: 11.5,
            fontWeight: 650,
            cursor: "pointer",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" strokeWidth={2.4} />
              Copied invite link
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" strokeWidth={2.2} />
              Copy invite link
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── Roster row ───────────────────────────────────────────────────
function RosterRow({
  label,
  sub,
  role,
  canRevoke,
  onRevoke,
  pending,
}: {
  label: string;
  sub?: string | null;
  role: "owner" | "editor" | "viewer";
  canRevoke: boolean;
  onRevoke?: () => void;
  pending?: boolean;
}) {
  const initials = (label || "?")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        borderRadius: 12,
        background: "transparent",
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = appleVibe.surface.chip;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
            background: pending
              ? appleVibe.surface.chip
              : avatarBg(label),
            color: pending ? appleVibe.text.tertiary : "#fff",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: pending
              ? `1px dashed ${appleVibe.stroke.medium}`
              : "none",
            flexShrink: 0,
            opacity: pending ? 0.85 : 1,
          }}
        >
          {initials || "?"}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: appleVibe.text.primary,
              opacity: pending ? 0.75 : 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              letterSpacing: "-0.01em",
            }}
          >
            {label}
          </div>
          {sub && (
            <div
              style={{
                fontSize: 11,
                color: appleVibe.text.tertiary,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sub}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 650,
            padding: "3px 9px",
            borderRadius: 999,
            background:
              role === "owner"
                ? appleVibe.accent.primary
                : appleVibe.surface.chip,
            color:
              role === "owner"
                ? appleVibe.text.onAccent
                : appleVibe.text.secondary,
            textTransform: "capitalize",
            letterSpacing: "-0.01em",
          }}
        >
          {role}
        </span>
        {canRevoke && onRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            aria-label="Remove access"
            title="Remove access"
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: appleVibe.text.tertiary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#FEF2F2";
              e.currentTarget.style.color = "#DC2626";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = appleVibe.text.tertiary;
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function InviteFormSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 6,
        borderRadius: 14,
        background: appleVibe.surface.chip,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        opacity: 0.55,
        height: 44,
      }}
      aria-hidden="true"
    />
  );
}

function RosterSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            opacity: 0.55,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: appleVibe.surface.chip,
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                width: "55%",
                height: 10,
                borderRadius: 6,
                background: appleVibe.surface.chip,
                marginBottom: 6,
              }}
            />
            <div
              style={{
                width: "35%",
                height: 8,
                borderRadius: 6,
                background: appleVibe.surface.chip,
              }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

// Stable, pleasant avatar color from the label string.
function avatarBg(s: string): string {
  const palette = [
    "#0F766E",
    "#0369A1",
    "#7C3AED",
    "#DB2777",
    "#C2410C",
    "#15803D",
    "#1D4ED8",
    "#A21CAF",
  ];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
