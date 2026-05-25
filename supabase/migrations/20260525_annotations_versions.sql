-- ── improvement_goals.annotations_versions ──────────────────────────
--
-- Append-only history of annotation versions. Powers the
-- Deepen / Compare / Synthesize loop on the Objective Canvas's
-- core-objective card.
--
-- Shape (jsonb array, max ~10 entries to bound row size):
--   [
--     {
--       "id": "v1-<uuid>",
--       "generated_at": "<iso>",
--       "generator": "initial" | "deepen" | "synthesis",
--       "parent_version_ids": ["v1-..."] | null,   -- for synthesis: the two compared
--       "annotations": [ObjectiveAnnotation, ...],
--       "arbitration_record": [                     -- only for synthesis
--         { phrase, picked_from: "v1" | "v2", why, kept_from_other: string | null }
--       ] | null
--     }
--   ]
--
-- `improvement_goals.annotations` stays as the active version
-- (denormalized for fast read). Setting active = copy that version's
-- `annotations` into the column.

alter table public.improvement_goals
  add column if not exists annotations_versions jsonb not null default '[]'::jsonb;

comment on column public.improvement_goals.annotations_versions is
  'Append-only history of annotation versions powering the Deepen / Compare / Synthesize loop. Each entry carries id, generator (initial|deepen|synthesis), parent version ids, the annotations snapshot, and (for synthesis) per-annotation arbitration records explaining which version was chosen and why. Capped at ~10 entries to bound row size.';
