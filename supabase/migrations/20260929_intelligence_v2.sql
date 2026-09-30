create table if not exists character_sessions(
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  login_at timestamptz not null,
  logout_at timestamptz,
  duration_minutes int,
  source data_source not null default 'TIBIA_STALKER',
  dedupe_key text unique not null,
  created_at timestamptz not null default now()
);
alter table character_sessions enable row level security;
drop policy if exists authenticated_all on character_sessions;
create policy authenticated_all on character_sessions for all to authenticated using (true) with check (true);
create index if not exists character_sessions_character_time_idx on character_sessions(character_id,login_at desc);
create unique index if not exists relation_evidence_unique_signal on relation_evidence(relation_id,evidence_type,source);
update source_syncs set enabled=true,status='IDLE' where source in ('TIBIARING','GUILDSTATS');
