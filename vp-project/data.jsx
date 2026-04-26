/* global React */
const { useState, useEffect } = React;

const SECTIONS = [
  { group: "Overview", items: [
    { id: "dashboard", label: "Dashboard", icon: "grid", active: true, chev: true },
    { id: "objectives", label: "Objectives", icon: "target" },
  ]},
  { group: "Workspace", items: [
    { id: "lab", label: "Lab", icon: "flask" },
    { id: "whiteboard", label: "Whiteboard", icon: "board" },
    { id: "playground", label: "Playground", icon: "play" },
    { id: "brainstorm", label: "Brainstorm", icon: "bulb" },
  ]},
  { group: "Core", items: [
    { id: "kg", label: "Knowledge Graph", icon: "graph" },
    { id: "prob", label: "Probability Spaces", icon: "prob" },
    { id: "twin", label: "Digital Twin", icon: "twin" },
    { id: "op", label: "Operating Twin", icon: "gear2" },
    { id: "layers", label: "Knowledge Layers", icon: "layers" },
    { id: "entity", label: "Entity Inventory", icon: "box" },
    { id: "strategy", label: "Strategy", icon: "chess" },
    { id: "causal", label: "Causal Chains", icon: "chain" },
    { id: "radar", label: "Intelligence Radar", icon: "radar" },
  ]},
];

const RAIL_ICONS = [
  { id: "home", icon: "bolt", active: true },
  { id: "grid", icon: "grid" },
  { id: "alert", icon: "alert" },
  { id: "plus", icon: "plus" },
  { id: "link", icon: "link" },
  { id: "tree", icon: "tree" },
  { id: "branch", icon: "branch" },
  { id: "stack", icon: "stack" },
  { id: "bar", icon: "bar" },
  { id: "info", icon: "info" },
  { id: "gear", icon: "gear" },
];

const RAIL_AVATARS = [
  { id: "a", label: "A", color: "#1a7aff" },
  { id: "c", label: "C", color: "#0a6aee" },
  { id: "yi", label: "YI", color: "#f5a623" },
];

const COLLABORATORS = [
  { id: "1", label: "H", name: "Herbert", sub: "Knowledge", color: "#e07a3f" },
  { id: "2", label: "R", name: "Ryo",      sub: "Designer", color: "#8a56cc" },
  { id: "3", label: "M", name: "Marek",    sub: "K / Exec",  color: "#3b82f6" },
  { id: "4", label: "J", name: "Jenny",    sub: "Data",      color: "#10b981" },
  { id: "5", label: "A", name: "Alejandro",sub: "Designer",  color: "#ef4444" },
];

const CHECKIN_UPDATES = [
  { app: "mail",    bg: "#34d399", label: "3", text: <>3 <b>new messages</b> for approval</> },
  { app: "chrome",  bg: "#eab308", label: "6", text: <>6 <b>New research proposals</b> available</> },
  { app: "sheets",  bg: "#ef4444", label: "4", text: <>4 <b>New combination proposals</b></> },
  { app: "notes",   bg: "#60a5fa", label: "5", text: <>5 <b>New emails</b> prepared</> },
  { app: "slack",   bg: "linear-gradient(135deg, #f59e0b, #ef4444, #8b5cf6, #10b981)", label: "" , text: "" },
];

const AGENT_PERF = [
  { id: "A", points: [[0,68],[14,55],[28,45],[42,40],[56,38],[70,36],[84,35],[100,34.5]], value: "$8,007", sub: "0.763", meta: [["3 Monthly","0.25"],["Base Rate","0.10"]] },
  { id: "B", points: [[0,72],[14,58],[28,46],[42,39],[56,35],[70,33],[84,32],[100,31.5]], value: "$112,134", sub: "0.842", meta: [["3 Monthly","0.30"],["Base Rate","0.10"]] },
];

Object.assign(window, { SECTIONS, RAIL_ICONS, RAIL_AVATARS, COLLABORATORS, CHECKIN_UPDATES, AGENT_PERF });
