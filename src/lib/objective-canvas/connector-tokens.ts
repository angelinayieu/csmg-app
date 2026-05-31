// ── Connector grammar tokens ────────────────────────────────────────
//
// ONE source of truth for the connector visual language across the
// objective canvas — so the picker's card-to-card wires, the React Flow
// room/subsystem maps, and (coordinated later) the tldraw whiteboard
// arrows all read as the same thing: black node-editor wires with socket
// endpoints + curved beziers (per the node-editor reference).
//
// Keep this tiny + dependency-free so any surface (inline SVG, React Flow
// edges, tldraw shape utils) can import it.

/** The wire ink — solid near-black. The default connector color everywhere. */
export const CONNECTOR_INK = "#0F172A";

/** A softer ink for resting / low-emphasis wires. */
export const CONNECTOR_INK_SOFT = "rgba(15,23,42,0.5)";

/** Default wire thickness (px). Surfaces may scale up for emphasis. */
export const CONNECTOR_WIRE_WIDTH = 2;

/** Port-socket geometry — the dot that sits on a node/card edge. */
export const CONNECTOR_SOCKET_RADIUS = 4.5;
export const CONNECTOR_SOCKET_CORE = "#FFFFFF";
export const CONNECTOR_SOCKET_CORE_RADIUS = 1.7;
