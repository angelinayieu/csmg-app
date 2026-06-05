"use client";

// ── Share board modal ─────────────────────────────────────────────
//
// Owner-facing share surface for the objective whiteboard. Invite by
// email with an Editor/Viewer role, see current members + pending
// invites, copy an invite link, and revoke access. Non-owners get a
// read-only roster (they can see who's collaborating but not invite).
//
// Backed by:
//   GET    /api/objective/[spaceId]/members
//   POST   /api/objective/[spaceId]/share          { email, role }
//   DELETE /api/objective/[spaceId]/members/[userId]

import { useCallback, useEffect, useState } from "react";
import { Share2, X, Copy, Check, Trash2 } from "lucide-react";
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

export function ShareBoardLauncher({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share this board"
        aria-label="Share this board"
        style={{
          // Right toolbar baseline — sits just inside the style palette as
          // the ONE filled/accent action in the otherwise-glass top row.
          position: "absolute",
          top: 16,
          right: 56,
          zIndex: 70,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 13px",
          borderRadius: 999,
          border: `1px solid ${appleVibe.accent.primary}`,
          background: appleVibe.accent.primary,
          color: appleVibe.text.onAccent,
          fontSize: 12,
          fontWeight: 650,
          cursor: "pointer",
          fontFamily: appleVibe.font.stack,
          boxShadow: "0 8px 24px -10px rgba(124,58,237,0.45)",
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
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

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
        setNotice(json.error ?? `Invite failed (${res.status}).`);
      } else {
        setNotice(
          json.dry_run
            ? `Invite created. Email delivery is off in this environment — copy the link below to share it.`
            : `Invite sent to ${email.trim()}.`,
        );
        if (json.invite_url) {
          setCopiedUrl(`${window.location.origin}${json.invite_url}`);
        }
        setEmail("");
        void load();
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Network error.");
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

  function copy(url: string) {
    void navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl((c) => (c === url ? null : c)), 1500);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(11,18,40,0.32)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          overflow: "auto",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 30px 80px -24px rgba(11,18,40,0.45)",
          padding: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Share2 className="h-4 w-4" style={{ color: appleVibe.accent.primary }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: appleVibe.text.primary }}>
              Share whiteboard
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: appleVibe.text.secondary }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isOwner ? (
          <form onSubmit={invite} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@email.com"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
                style={{
                  padding: "9px 10px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  fontSize: 13,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={busy}
              style={{
                alignSelf: "flex-start",
                padding: "8px 16px",
                borderRadius: 999,
                border: "none",
                background: busy ? "#9ca3af" : appleVibe.accent.primary,
                color: "#fff",
                fontSize: 13,
                fontWeight: 650,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "Sending…" : "Send invite"}
            </button>
          </form>
        ) : (
          <p style={{ fontSize: 13, color: appleVibe.text.secondary, margin: "0 0 8px" }}>
            You&apos;re collaborating on this board. Only the owner can invite others.
          </p>
        )}

        {notice && (
          <p
            style={{
              marginTop: 10,
              fontSize: 12.5,
              color: appleVibe.text.secondary,
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: 10,
              padding: "8px 10px",
            }}
          >
            {notice}
            {copiedUrl && (
              <button
                type="button"
                onClick={() => copy(copiedUrl)}
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  border: "none",
                  background: "none",
                  color: appleVibe.accent.primary,
                  cursor: "pointer",
                  fontWeight: 650,
                }}
              >
                {copiedUrl ? <Copy className="h-3 w-3" /> : null}
                Copy link
              </button>
            )}
          </p>
        )}

        {/* Roster */}
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: appleVibe.text.tertiary,
              marginBottom: 8,
            }}
          >
            People with access
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(data?.members ?? []).map((m) => (
              <RosterRow
                key={m.userId}
                label={m.name || m.email || "Unknown"}
                sub={m.email && (m.name ? m.email : null)}
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
          </div>
        </div>
      </div>
    </div>
  );
}

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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 10px",
        borderRadius: 10,
        background: pending ? "#fafafa" : "#f8fafc",
        border: "1px solid #eef2f7",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: appleVibe.text.primary,
            opacity: pending ? 0.7 : 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: appleVibe.text.tertiary }}>{sub}</div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: appleVibe.text.secondary,
            textTransform: "capitalize",
          }}
        >
          {role}
        </span>
        {canRevoke && onRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            aria-label="Remove"
            title="Remove access"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {pending && <Check className="h-3.5 w-3.5" style={{ color: "#9ca3af" }} />}
      </div>
    </div>
  );
}
