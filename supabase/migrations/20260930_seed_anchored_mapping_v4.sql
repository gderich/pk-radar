-- V4: reancora o radar somente nos PKs-semente fornecidos pelo usuário.
-- Preserva personagens, eventos, kills, sessões e níveis; limpa apenas conclusões de identidade.

delete from identity_members;
delete from identity_groups;
delete from player_relations;
delete from character_associations;
delete from stalker_suggestions;

update characters
set monitored=false,
    confidence='LOW',
    tags=array_remove(array_remove(tags,'PK_SEED'),'AUTO_DISCOVERED')
where lower(name) not in (
'elmuerte','royal creeds','villas creeds','lord lusius','guedes proxy','jean pusheen','king of tretas',
'rocha vimprorush','arcon dusing','malokeirah','ninfaj','madara gestao inteligente','repair softboots',
'paldoni karke','viciousback','ro od formidavel','awesome ideals','salbaria syfaladrel','pak explicit',
'umobuga feiditau','xxoxii','caneva is back','blaze lostshell','levity naverande','no pelu','adwino rhys',
'lkbomb','tehde leteo','harumasz','tiger shadow','prensado xuxuzao','xxoxi','muita agua xixica',
'brazillian jiu jitsu','tomasuakuu','lina semneura','valheu','oisoueudenovo','atiradora de dardos',
'rhashid','lebesquedoh'
);

update characters
set monitored=true,
    archived=false,
    confidence='LOW',
    tags=array_append(
      array_remove(array_remove(tags,'AUTO_DISCOVERED'),'AUTO_NOISE'),
      'PK_SEED'
    )
where lower(name) in (
'elmuerte','royal creeds','villas creeds','lord lusius','guedes proxy','jean pusheen','king of tretas',
'rocha vimprorush','arcon dusing','malokeirah','ninfaj','madara gestao inteligente','repair softboots',
'paldoni karke','viciousback','ro od formidavel','awesome ideals','salbaria syfaladrel','pak explicit',
'umobuga feiditau','xxoxii','caneva is back','blaze lostshell','levity naverande','no pelu','adwino rhys',
'lkbomb','tehde leteo','harumasz','tiger shadow','prensado xuxuzao','xxoxi','muita agua xixica',
'brazillian jiu jitsu','tomasuakuu','lina semneura','valheu','oisoueudenovo','atiradora de dardos',
'rhashid','lebesquedoh'
);

update source_syncs
set config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
  'identity_mapping_version',4,
  'identity_mapping_reset_at',now(),
  'mapping_anchor','PK_SEEDS'
)
where source='MANUAL';
