-- Phase 18 — Entity instrument parameters.
--
-- Per-entity tunable parameters used by the lab's control panel + Monte
-- Carlo throughput simulation. Stored as JSONB so the parameter set can
-- evolve without migrations. Default = null (the lab's parameter hook
-- resolves to category-specific defaults from src/lib/lab-formulas.ts).
--
-- Schema for the JSONB payload (validated client- and server-side at
-- write time):
--   {
--     "K":     number,   // slots / capacity (1..10)
--     "tau":   number,   // decay constant   (1..60)
--     "rho":   number,   // refresh rate     (0..3)
--     "alpha": number,   // attention bw     (1..5)
--   }
--
-- Future parameters can be added without a migration. Consumers read
-- defensively via getEntityParameters() in lab-formulas.ts.

alter table public.entities
  add column if not exists parameters jsonb;

-- Index isn't necessary today (we read parameters per-entity by id), but
-- a GIN index makes future "find entities with K > 5" queries cheap.
create index if not exists entities_parameters_gin_idx
  on public.entities using gin (parameters);
