create table if not exists stalker_suggestions(
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  suggested_name text not null,
  match_count int not null default 0,
  first_match_date date,
  last_match_date date,
  relative_score numeric(5,2) not null default 0,
  fetched_at timestamptz not null default now(),
  raw_data jsonb not null default '{}',
  unique(character_id,suggested_name)
);
alter table stalker_suggestions enable row level security;
drop policy if exists authenticated_all on stalker_suggestions;
create policy authenticated_all on stalker_suggestions for all to authenticated using (true) with check (true);
create index if not exists stalker_suggestions_character_score_idx on stalker_suggestions(character_id,relative_score desc,match_count desc);

delete from characters where lower(name) in ('gjdebz','hjdebz');
