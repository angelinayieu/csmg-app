-- ── F3 · App pairing for downstream-applications-as-pairs (D14) ──────
--
-- Activates the user-vision: a Twin (Subject) can have multiple
-- DOWNSTREAM APPLICATIONS that complement each other. The cognition
-- template ships with two paired apps:
--
--   • "Cognitive Game Development"  ──complements──>  "Cognitive Measurement"
--   • "Cognitive Measurement"       ──complements──>  "Cognitive Game Development"
--
-- Each app carries:
--   1. application_type — the broad role this app plays (game | measurement |
--      intervention | analysis | educational | clinical | other). Distinct
--      from app_type (dashboard | workflow | tool | monitor | integration)
--      which describes the app's UI shell. application_type is about
--      DOMAIN INTENT.
--   2. complementary_app_ids[] — explicit pointers to other apps in the
--      same space that this app is co-designed with. Populated bidirectionally
--      so both apps in a pair point at each other (so a tether can be drawn
--      from either end).
--
-- Why columns on `apps` rather than a junction table:
--   - Pairing is most often binary (A↔B). Higher-arity sets are rare and the
--     uuid[] handles them naturally.
--   - GIN-indexable for "find all apps complementary to X" without a JOIN.
--   - Append-only audit lives on the existing `app_changelog` if needed.
--
-- Why nullable application_type:
--   - Existing apps pre-D14 don't have a domain intent assignment. Keeping
--     the column nullable means we don't have to backfill them in a single
--     transaction. UI degrades to "(unspecified)" cleanly.
--
-- Soft-fail philosophy: missing complementary_app_ids → no tether
-- rendered (rather than an error). Apps remain singletons by default;
-- pairing is opt-in.

alter table public.apps
  add column if not exists application_type text;

alter table public.apps
  drop constraint if exists apps_application_type_check;

alter table public.apps
  add constraint apps_application_type_check
  check (
    application_type is null
    or application_type in (
      'game',
      'measurement',
      'intervention',
      'analysis',
      'educational',
      'clinical',
      'other'
    )
  );

alter table public.apps
  add column if not exists complementary_app_ids uuid[]
  not null default '{}'::uuid[];

-- ── Indexes ────────────────────────────────────────────────────────

-- Cheap "find all complementary apps in this space" lookup.
create index if not exists apps_complementary_app_ids_gin_idx
  on public.apps using gin (complementary_app_ids)
  where cardinality(complementary_app_ids) > 0;

-- Quick "show all games in this space" / "show all measurements" filter
-- the lab proposal wizard uses.
create index if not exists apps_application_type_idx
  on public.apps (space_id, application_type)
  where application_type is not null;

-- ── Comments ───────────────────────────────────────────────────────

comment on column public.apps.application_type is
  'Domain intent of this app: game | measurement | intervention | analysis | educational | clinical | other. Distinct from app_type (UI shell). NULL = unspecified (pre-D14 apps).';

comment on column public.apps.complementary_app_ids is
  'Bidirectional links to other apps this one is co-designed with. Drives the canvas tether visualization between paired apps (cognitive game ↔ cognitive measurement). Empty array = singleton app.';
