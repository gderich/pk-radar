insert into worlds(name) values ('Jadebra') on conflict(name) do nothing;

update characters
set world_id=(select id from worlds where name='Jadebra'),
    monitored=true
where world_id is null
  and source='MANUAL';

update identity_members im
set notes=coalesce(im.notes,'') || case when coalesce(im.notes,'')='' then '' else ' · ' end || 'Servidor base: Jadebra'
where exists (
  select 1 from characters c
  join worlds w on w.id=c.world_id
  where c.id=im.character_id and w.name='Jadebra'
)
and coalesce(im.notes,'') not like '%Servidor base: Jadebra%';
