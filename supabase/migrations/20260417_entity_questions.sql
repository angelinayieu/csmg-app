-- Entity-level questions
--
-- Promotes "I want to know X about entity Y" to a first-class object.
-- Synthesis already produces space-level open_questions; this table captures
-- user-authored node-level questions that (eventually) trigger targeted
-- research and resolve into claims/edges.
--
-- Status lifecycle:
--   open        — user typed the question, not yet researched
--   researching — an agent is processing (reserved for future automation)
--   answered    — a result has been produced (answer_text populated, result_refs optional)
--   dismissed   — user marked it no-longer-relevant

create table if not exists entity_questions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  /** The question text itself — free-form, user authored. */
  question_text text not null,
  status text not null default 'open'
    check (status in ('open', 'researching', 'answered', 'dismissed')),
  /** Optional free-form answer text when status='answered'. */
  answer_text text,
  /**
   * Optional references back into the KG: which claims/edges/entities were
   * generated in response to answering this question. JSON shape:
   *   { claim_ids?: string[], edge_ids?: string[], entity_ids?: string[] }
   */
  result_refs jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists idx_entity_questions_entity on entity_questions(entity_id);
create index if not exists idx_entity_questions_space on entity_questions(space_id);
create index if not exists idx_entity_questions_status on entity_questions(space_id, status);
create index if not exists idx_entity_questions_recent on entity_questions(space_id, created_at desc);

-- Keep updated_at in sync
create or replace function touch_entity_questions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists entity_questions_updated_at on entity_questions;
create trigger entity_questions_updated_at
  before update on entity_questions
  for each row execute function touch_entity_questions_updated_at();
