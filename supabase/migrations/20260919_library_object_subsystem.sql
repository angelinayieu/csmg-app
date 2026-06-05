-- ── Persist the subsystem cluster on library objects ──────────────────
-- decompose-cards assigns every feature/variable a `subsystem`
-- ("Onboarding", "Retention Loop", …) but it was dropped after the
-- response (in-memory only). Storing it lets the grouping survive and
-- drive the per-variable cluster graph + Library clustering.
-- Additive + idempotent.

alter table public.library_objects
  add column if not exists subsystem text;

create index if not exists library_objects_subsystem
  on public.library_objects (space_id, subsystem);
