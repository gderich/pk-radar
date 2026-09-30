create table if not exists identity_groups(
  id uuid primary key default gen_random_uuid(),
  label text not null,
  confidence confidence_level not null default 'CONFIRMED',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity_members(
  group_id uuid not null references identity_groups(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  source text not null default 'MANUAL',
  confidence_score numeric(5,2) not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  primary key(group_id,character_id),
  unique(character_id)
);

create table if not exists character_associations(
  character_a_id uuid not null references characters(id) on delete cascade,
  character_b_id uuid not null references characters(id) on delete cascade,
  co_online_count int not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  association_score numeric(5,2) not null default 0,
  notes text,
  primary key(character_a_id,character_b_id),
  check(character_a_id<>character_b_id)
);

alter table identity_groups enable row level security;
alter table identity_members enable row level security;
alter table character_associations enable row level security;

drop policy if exists authenticated_all on identity_groups;
drop policy if exists authenticated_all on identity_members;
drop policy if exists authenticated_all on character_associations;
create policy authenticated_all on identity_groups for all to authenticated using (true) with check (true);
create policy authenticated_all on identity_members for all to authenticated using (true) with check (true);
create policy authenticated_all on character_associations for all to authenticated using (true) with check (true);

insert into characters(name,monitored,source,data_state,confidence)
values ('Ninfaj',true,'MANUAL','ATUALIZADO','CONFIRMED')
on conflict(name) do update set monitored=true,archived=false;

do $$
declare g1 uuid; g2 uuid;
begin
  select id into g1 from identity_groups where label='Rhashid / Muita Agua Xixica / Brazillian Jiu Jitsu' limit 1;
  if g1 is null then
    insert into identity_groups(label,confidence,notes)
    values('Rhashid / Muita Agua Xixica / Brazillian Jiu Jitsu','CONFIRMED','Identidade confirmada por observação manual')
    returning id into g1;
  end if;
  insert into identity_members(group_id,character_id,source,confidence_score,notes)
  select g1,id,'MANUAL',100,'Confirmado por observação manual' from characters
  where lower(name) in ('rhashid','muita agua xixica','brazillian jiu jitsu')
  on conflict(character_id) do update set group_id=excluded.group_id,source='MANUAL',confidence_score=100,notes=excluded.notes;

  select id into g2 from identity_groups where label='Malokeirah / Ninfaj' limit 1;
  if g2 is null then
    insert into identity_groups(label,confidence,notes)
    values('Malokeirah / Ninfaj','CONFIRMED','Identidade confirmada por observação manual')
    returning id into g2;
  end if;
  insert into identity_members(group_id,character_id,source,confidence_score,notes)
  select g2,id,'MANUAL',100,'Confirmado por observação manual' from characters
  where lower(name) in ('malokeirah','ninfaj')
  on conflict(character_id) do update set group_id=excluded.group_id,source='MANUAL',confidence_score=100,notes=excluded.notes;
end $$;

create index if not exists identity_members_group_idx on identity_members(group_id);
create index if not exists character_associations_score_idx on character_associations(association_score desc);
