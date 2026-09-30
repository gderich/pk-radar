-- Reinicia SOMENTE o mapeamento de identidade.
-- Mantém todos os personagens existentes, eventos, kills, níveis e sessões.

delete from identity_members;
delete from identity_groups;
delete from player_relations;
delete from character_associations;
delete from stalker_suggestions;

update characters
set confidence='LOW'
where monitored=true
  and exists (
    select 1 from worlds w
    where w.id=characters.world_id and w.name='Jadebra'
  );
