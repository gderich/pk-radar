create extension if not exists pgcrypto;
do $$ begin
  create type data_source as enum ('MANUAL','TIBIADATA','TIBIA_STALKER','TIBIARING','GUILDSTATS');
exception when duplicate_object then null; end $$;
do $$ begin
  create type confidence_level as enum ('LOW','MEDIUM','HIGH','CONFIRMED','REJECTED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type event_kind as enum ('LOGIN','LOGOUT','MASS_LOGIN','DEATH','PVP_KILL','LEVEL_UP','GUILD_CHANGE','NAME_CHANGE','DATA_UPDATE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type sync_status as enum ('IDLE','RUNNING','SUCCESS','ERROR','DISABLED');
exception when duplicate_object then null; end $$;

create table if not exists worlds(id uuid primary key default gen_random_uuid(),name text unique not null,location text,pvp_type text,created_at timestamptz not null default now());
create table if not exists guilds(id uuid primary key default gen_random_uuid(),world_id uuid references worlds(id) on delete set null,name text not null,active boolean not null default true,created_at timestamptz not null default now(),unique(name,world_id));
create table if not exists characters(id uuid primary key default gen_random_uuid(),name text unique not null,world_id uuid references worlds(id) on delete set null,guild_id uuid references guilds(id) on delete set null,level int,vocation text,online boolean not null default false,monitored boolean not null default true,archived boolean not null default false,tags text[] not null default '{}',notes text,data_state text not null default 'PENDENTE',confidence confidence_level not null default 'LOW',last_login_at timestamptz,last_event_at timestamptz,source data_source not null default 'MANUAL',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists online_events(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete cascade,kind event_kind not null,occurred_at timestamptz not null,source data_source not null,fetched_at timestamptz not null default now(),confidence confidence_level not null default 'MEDIUM',reference_url text,metadata jsonb not null default '{}',dedupe_key text unique not null);
create table if not exists death_events(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete cascade,occurred_at timestamptz not null,level int,killers jsonb not null default '[]',source data_source not null,fetched_at timestamptz not null default now(),confidence confidence_level not null default 'MEDIUM',reference_url text,raw_data jsonb,dedupe_key text unique not null);
create table if not exists pvp_events(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete set null,opponent_name text not null,role text not null,occurred_at timestamptz not null,source data_source not null,fetched_at timestamptz not null default now(),confidence confidence_level not null default 'MEDIUM',reference_url text,raw_data jsonb,dedupe_key text unique not null);
create table if not exists level_events(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete cascade,old_level int,new_level int not null,occurred_at timestamptz not null,source data_source not null,fetched_at timestamptz not null default now(),confidence confidence_level not null default 'MEDIUM',reference_url text,dedupe_key text unique not null);
create table if not exists guild_events(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete cascade,old_guild text,new_guild text,occurred_at timestamptz not null,source data_source not null,fetched_at timestamptz not null default now(),confidence confidence_level not null default 'MEDIUM',reference_url text,dedupe_key text unique not null);
create table if not exists player_relations(id uuid primary key default gen_random_uuid(),character_a_id uuid not null references characters(id) on delete cascade,character_b_id uuid not null references characters(id) on delete cascade,status confidence_level not null default 'LOW',confidence_score numeric(5,2) not null default 0,manual_note text,reviewed_at timestamptz,created_at timestamptz not null default now(),check(character_a_id<>character_b_id),unique(character_a_id,character_b_id));
create table if not exists relation_evidence(id uuid primary key default gen_random_uuid(),relation_id uuid not null references player_relations(id) on delete cascade,source data_source not null,evidence_type text not null,summary text not null,weight numeric(5,2) not null default 0,fetched_at timestamptz not null default now(),reference_url text,raw_data jsonb);
create table if not exists alerts(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete set null,title text not null,body text not null,triggered_at timestamptz not null default now(),read_at timestamptz,metadata jsonb not null default '{}',dedupe_key text unique not null);
create table if not exists alert_rules(id uuid primary key default gen_random_uuid(),name text not null,event_type event_kind not null,enabled boolean not null default true,character_id uuid references characters(id) on delete cascade,threshold int,window_minutes int,browser_notification boolean not null default true,sound_enabled boolean not null default false,future_channels jsonb not null default '{"telegram":false,"discord":false}',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists source_syncs(id uuid primary key default gen_random_uuid(),source data_source unique not null,enabled boolean not null default false,status sync_status not null default 'DISABLED',last_started_at timestamptz,last_success_at timestamptz,next_sync_at timestamptz,last_error text,request_count int not null default 0,backoff_until timestamptz,config jsonb not null default '{}',updated_at timestamptz not null default now());
create table if not exists source_observations(id uuid primary key default gen_random_uuid(),character_id uuid references characters(id) on delete cascade,source data_source not null,observation_type text not null,observed_value jsonb not null,fetched_at timestamptz not null default now(),confidence confidence_level not null default 'MEDIUM',reference_url text,raw_data jsonb,dedupe_key text unique not null);\ncreate table if not exists stalker_suggestions(id uuid primary key default gen_random_uuid(),character_id uuid not null references characters(id) on delete cascade,suggested_name text not null,match_count int not null default 0,first_match_date date,last_match_date date,relative_score numeric(5,2) not null default 0,fetched_at timestamptz not null default now(),raw_data jsonb not null default '{}',unique(character_id,suggested_name));
alter table characters enable row level security; alter table worlds enable row level security; alter table guilds enable row level security; alter table online_events enable row level security; alter table death_events enable row level security; alter table pvp_events enable row level security; alter table level_events enable row level security; alter table guild_events enable row level security; alter table player_relations enable row level security; alter table relation_evidence enable row level security; alter table alerts enable row level security; alter table alert_rules enable row level security; alter table source_syncs enable row level security; alter table source_observations enable row level security; alter table stalker_suggestions enable row level security;
do $$ declare t text; begin foreach t in array array['characters','worlds','guilds','online_events','death_events','pvp_events','level_events','guild_events','player_relations','relation_evidence','alerts','alert_rules','source_syncs','source_observations','stalker_suggestions'] loop execute format('drop policy if exists authenticated_all on %I',t); execute format('create policy authenticated_all on %I for all to authenticated using (true) with check (true)',t); end loop; end $$;
insert into characters(name) values
('Gjdebz'),
('Elmuerte'),
('Royal Creeds'),
('Villas Creeds'),
('Lord Lusius'),
('Guedes Proxy'),
('Jean Pusheen'),
('King of Tretas'),
('Rocha Vimprorush'),
('Arcon Dusing'),
('Malokeirah'),
('Madara Gestao Inteligente'),
('Repair Softboots'),
('Paldoni Karke'),
('Viciousback'),
('Ro Od Formidavel'),
('Awesome Ideals'),
('Salbaria Syfaladrel'),
('Pak Explicit'),
('Umobuga Feiditau'),
('Xxoxii'),
('Caneva Is Back'),
('Blaze Lostshell'),
('Levity Naverande'),
('No Pelu'),
('Adwino Rhys'),
('Lkbomb'),
('Tehde Leteo'),
('Harumasz'),
('Tiger Shadow'),
('Prensado Xuxuzao'),
('Xxoxi'),
('Muita Agua Xixica'),
('Brazillian Jiu Jitsu'),
('Tomasuakuu'),
('Lina Semneura'),
('Valheu'),
('Oisoueudenovo'),
('Atiradora de Dardos'),
('Rhashid'),
('Fjdebzz'),
('Hjdebz'),
('Lebesquedoh')
on conflict(name) do nothing;
insert into source_syncs(source,status,enabled) values
('MANUAL','SUCCESS',true),('TIBIADATA','IDLE',true),('TIBIA_STALKER','IDLE',true),('TIBIARING','DISABLED',false),('GUILDSTATS','DISABLED',false)
on conflict(source) do nothing;
create index if not exists characters_online_idx on characters(monitored,archived,online);
create index if not exists online_events_time_idx on online_events(occurred_at desc);
\ncreate index if not exists stalker_suggestions_character_score_idx on stalker_suggestions(character_id,relative_score desc,match_count desc);\n