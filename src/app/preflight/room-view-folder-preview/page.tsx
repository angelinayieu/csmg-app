// Preview harness for the RoomViewFolder chrome (the folder-tab view
// switcher). Mounts the REAL RoomViewFolder with mock body content for
// each sub-tab so the folder label tab, the lip sub-tabs, and the body
// can be eyeballed without the app shell / room route compile.
// Public dev route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import {
  RoomViewFolder,
  type RoomViewKey,
} from "@/components/objective/room-view-folder";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const BODY: Record<RoomViewKey, { label: string; blurb: string }> = {
  map: {
    label: "Map",
    blurb:
      "The system — every stage, item, and feedback loop in one causal-loop diagram.",
  },
  categories: {
    label: "Chains",
    blurb: "One Problem → Mechanism → Result experiment frame at a time.",
  },
  variables: {
    label: "Grid",
    blurb: "The raw 3-lane layout + correlations, for the power user.",
  },
  subsystems: {
    label: "Subsystems",
    blurb: "How the mechanisms interlock — composition + conflicts.",
  },
};

export default function RoomViewFolderPreview() {
  const [view, setView] = useState<RoomViewKey>("map");
  const body = BODY[view];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: appleVibe.surface.base,
        padding: 40,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          Room view folder — chrome harness
        </h1>
        <p
          style={{
            fontSize: 12.5,
            color: "rgba(15,23,42,0.6)",
            marginBottom: 24,
            maxWidth: "70ch",
          }}
        >
          The protruding tab carries the system title; Map · Chains · Grid ·
          Subsystems are sub-tabs on the folder lip; the active view renders in
          the white folder body.
        </p>

        <RoomViewFolder
          title="Goal-Driven Knowledge Pathways"
          value={view}
          onChange={setView}
        >
          <div style={{ minHeight: 220 }}>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: appleVibe.text.primary,
                marginBottom: 6,
              }}
            >
              {body.label}
            </h2>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: appleVibe.text.secondary,
                maxWidth: "60ch",
              }}
            >
              {body.blurb}
            </p>
          </div>
        </RoomViewFolder>
      </div>
    </div>
  );
}
