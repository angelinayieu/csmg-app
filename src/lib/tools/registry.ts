// ── Tool registry ──
//
// Single source of truth for which connectors the app can call. New
// connectors plug in by importing their instance here. The registry
// exposes:
//   - `getTool(id)` — fetch a connector by id
//   - `listTools({ domain?, requiresAuth? })` — filtered catalog
//   - `runTool(id, input)` — shortcut + soft-fails when id missing
//
// Kept deliberately small in v1. Query planning (query → per-tool
// subqueries) and cross-tool dedup are scoped separately and consume
// this registry rather than living inside it.

import type {
  ToolConnector,
  ToolDomain,
  ToolInput,
  ToolResult,
} from "./types";
import { wikidataConnector } from "./connectors/wikidata";
import { crossrefConnector } from "./connectors/crossref";

const CONNECTORS: ToolConnector[] = [
  wikidataConnector,
  crossrefConnector,
];

const CONNECTORS_BY_ID = new Map<string, ToolConnector>(
  CONNECTORS.map((c) => [c.id, c]),
);

export function getTool(id: string): ToolConnector | null {
  return CONNECTORS_BY_ID.get(id) ?? null;
}

export interface ListToolsFilter {
  domain?: ToolDomain;
  requiresAuth?: boolean;
}

export function listTools(filter: ListToolsFilter = {}): ToolConnector[] {
  return CONNECTORS.filter((c) => {
    if (filter.domain && c.domain !== filter.domain) return false;
    if (
      filter.requiresAuth !== undefined &&
      c.requiresAuth !== filter.requiresAuth
    )
      return false;
    return true;
  });
}

export async function runTool(
  id: string,
  input: ToolInput,
): Promise<ToolResult> {
  const tool = CONNECTORS_BY_ID.get(id);
  if (!tool) {
    return {
      toolId: id,
      hits: [],
      error: `Unknown tool: ${id}`,
      durationMs: 0,
    };
  }
  return tool.call(input);
}

/** Public metadata — safe to expose to client components / catalogs. */
export function describeTools(): Array<{
  id: string;
  domain: ToolDomain;
  label: string;
  description: string;
  requiresAuth: boolean;
}> {
  return CONNECTORS.map((c) => ({
    id: c.id,
    domain: c.domain,
    label: c.label,
    description: c.description,
    requiresAuth: c.requiresAuth,
  }));
}
