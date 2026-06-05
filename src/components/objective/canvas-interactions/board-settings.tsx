"use client";

// ── BoardSettingsLauncher ─────────────────────────────────────────
//
// The board's account popover, opened from the top-right nav gear. Shows
// who you're signed in as, a link out to the full Profile page
// (/app/profile — identity, plan, appearance, privacy), and a quick sign
// out. Matches the board's glass chrome. Self-contained.

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Settings, X, LogOut, Loader2, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** Fired by the top-right nav bar to open this panel (the launcher's own left
 *  pill is retired — the nav bar is the single trigger). */
export const OPEN_BOARD_SETTINGS_EVENT = "board:open-settings";

export function BoardSettingsLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  // Opened from the consolidated nav bar (top-right).
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_BOARD_SETTINGS_EVENT, openIt);
    return () => window.removeEventListener(OPEN_BOARD_SETTINGS_EVENT, openIt);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.displayName) setName(d.displayName as string);
      })
      .catch(() => {});
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (alive && data.user?.email) setEmail(data.user.email);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

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

  // The left-edge launcher pill is retired — the top-right nav bar opens this.
  if (!open) return null;

  return (
    <>
      <div onPointerDown={() => setOpen(false)} style={backdrop} />
      <div onPointerDown={(e) => e.stopPropagation()} style={panel}>
        <div style={head}>
          <Settings style={{ width: 15, height: 15, color: appleVibe.text.secondary }} strokeWidth={2.2} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: appleVibe.text.primary }}>Settings</span>
          <button type="button" title="Close" onClick={() => setOpen(false)} style={iconBtn}>
            <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ padding: "14px 16px 16px" }}>
          <div style={overline}>Signed in as</div>
          <div style={{ marginTop: 4, fontSize: 14, fontWeight: 650, color: appleVibe.text.primary }}>
            {name || "You"}
          </div>
          {email && (
            <div style={{ marginTop: 2, fontSize: 12.5, color: appleVibe.text.tertiary }}>{email}</div>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/app/profile");
            }}
            style={profileBtn}
          >
            <Settings style={{ width: 14, height: 14, color: appleVibe.text.tertiary }} strokeWidth={2.2} />
            Profile settings
            <ChevronRight
              style={{ marginLeft: "auto", width: 15, height: 15, color: appleVibe.text.faint }}
              strokeWidth={2.2}
            />
          </button>

          <button type="button" onClick={signOut} disabled={signingOut} style={signOutBtn}>
            {signingOut ? (
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
            ) : (
              <LogOut style={{ width: 14, height: 14 }} strokeWidth={2.2} />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── styles ──
const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(11,18,40,0.22)",
};
const panel: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 101,
  width: "min(360px, calc(100vw - 32px))",
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 32px 70px -24px rgba(11,18,40,0.45)",
  fontFamily: appleVibe.font.stack,
};
const head: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 13px 10px",
  borderBottom: "1px solid var(--glass-border)",
};
const iconBtn: CSSProperties = {
  marginLeft: "auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
};
const overline: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: appleVibe.text.faint,
};
const profileBtn: CSSProperties = {
  marginTop: 16,
  width: "100%",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  borderRadius: appleVibe.radius.md,
  border: `1px solid ${appleVibe.stroke.soft}`,
  background: appleVibe.surface.card,
  color: appleVibe.text.primary,
  fontSize: 12.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const signOutBtn: CSSProperties = {
  marginTop: 10,
  width: "100%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "9px 12px",
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.chip,
  color: appleVibe.text.primary,
  fontSize: 12.5,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
