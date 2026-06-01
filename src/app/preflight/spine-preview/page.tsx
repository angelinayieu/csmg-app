// Preview harness for PreRoomSpine — the v1→v2 decision bar that sits
// under the core objective before you enter a room. Renders the three
// states (skeleton ready / building / deepen-locked) with mock rooms,
// bypassing the authed canvas. The "Generate tech spec" + autopilot
// pill are live controls but point at routes that 401 here — fine for a
// visual check. Public route. SAFE TO DELETE.

"use client";

import { PreRoomSpine } from "@/components/objective/pre-room-spine";

const ROOMS = [
  { id: "1", title: "Accurate User Interest Matching" },
  { id: "2", title: "Enhanced User Privacy Perception" },
  { id: "3", title: "Efficient Data Processing" },
  { id: "4", title: "Scalable User Data Framework" },
];

const noop = () => {};

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(15,23,42,0.35)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export default function SpinePreview() {
  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#F7F8FA",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <h1
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "rgba(15,23,42,0.5)",
          margin: 0,
        }}
      >
        PreRoomSpine harness — v1→v2 bar: state line + Generate tech spec +
        Deepen → v2 (autopilot)
      </h1>

      <Block label="Skeleton ready (all rooms generated → deepen enabled)">
        <PreRoomSpine
          spaceId="preview"
          generatedRooms={ROOMS}
          totalRooms={ROOMS.length}
          onDeepenComplete={noop}
        />
      </Block>

      <Block label="Building (2 of 4 rooms → deepen still locked)">
        <PreRoomSpine
          spaceId="preview"
          generatedRooms={ROOMS.slice(0, 2)}
          totalRooms={ROOMS.length}
          onDeepenComplete={noop}
        />
      </Block>

      <Block label="Just approved (0 generated → deepen locked, spec available)">
        <PreRoomSpine
          spaceId="preview"
          generatedRooms={[]}
          totalRooms={ROOMS.length}
          onDeepenComplete={noop}
        />
      </Block>
    </div>
  );
}
