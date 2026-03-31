export type { Database, Json } from "./database.types";

// Convenience aliases for row types
import type { Database } from "./database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Space = Database["public"]["Tables"]["spaces"]["Row"];
export type Entity = Database["public"]["Tables"]["entities"]["Row"];
export type Edge = Database["public"]["Tables"]["edges"]["Row"];
export type Cycle = Database["public"]["Tables"]["cycles"]["Row"];
export type Bridge = Database["public"]["Tables"]["bridges"]["Row"];
export type ReasoningResult =
  Database["public"]["Tables"]["reasoning_results"]["Row"];
export type Proposition = Database["public"]["Tables"]["propositions"]["Row"];
