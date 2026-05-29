// Lightweight static stand-in for a real room route, used as the iframe
// target when verifying the window shell (no animation / heavy imports,
// so screenshots settle). In the live app the window iframes the real
// /sub/[subId] etc. SAFE TO DELETE.

export const dynamic = "force-static";

export default function Page() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#ffffff",
        padding: "40px 48px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
        color: "rgba(15,23,42,0.92)",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(15,23,42,0.45)", fontWeight: 600 }}>
        Real route (iframed)
      </div>
      <h1 style={{ marginTop: 6, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
        Goal-Driven Knowledge Pathways
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, color: "rgba(15,23,42,0.6)", maxWidth: 560, lineHeight: 1.5 }}>
        This is a stand-in for the actual room route the window iframes in
        production. The window shell (glow, magic-move, stack, glide) is
        the part under test — the content is just whatever route loads here.
      </p>
      <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 720 }}>
        {[
          "Excessive Passive Browsing → Intentional Prompter",
          "Undefined objectives → Goal Tracker",
          "Irrelevant content → Relevance Filter",
          "Privacy concern → Data controls",
        ].map((t) => (
          <div key={t} style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 16, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t}</div>
            <div style={{ marginTop: 4, fontSize: 11, color: "rgba(15,23,42,0.45)" }}>80% composite</div>
          </div>
        ))}
      </div>
    </div>
  );
}
