import { test } from 'node:test';
import assert from 'node:assert/strict';
import {normalize,equipmentKey,translate} from './model';
const make=()=>({avatarId:10000089,propMap:{'4001':{val:'90'}},fightPropMap:{},equipList:[{itemId:11513,weapon:{level:90,affixMap:{'111513':0}},flat:{itemType:'ITEM_WEAPON',weaponStats:[{appendPropId:'FIGHT_PROP_BASE_ATTACK',statValue:542}]}},{itemId:32543,reliquary:{level:21,appendPropIdList:[1]},flat:{itemType:'ITEM_RELIQUARY',equipType:'EQUIP_BRACER',setId:15032,reliquaryMainstat:{mainPropId:'FIGHT_PROP_HP',statValue:4780},reliquarySubstats:[]}}]});
test('snapshot preserves empty slots and localizes known items',()=>{const s=normalize(make(),'741066691','2026-10-29T18:30:00.000Z');assert.equal(s.equipment.artifacts.EQUIP_RING,null);assert.equal(s.equipment.weapon.name,'Splendor of Tranquil Waters');assert.notEqual(translate(s).equipment.weapon.displayName,s.equipment.weapon.name);assert.ok(s.equipment.artifacts.EQUIP_BRACER.name);});
test('equipment comparison ignores character changes and detects item upgrades',()=>{const a=make(), b=make();b.propMap['4001'].val='80';assert.equal(equipmentKey(normalize(a,'123456789','a')),equipmentKey(normalize(b,'123456789','b')));b.equipList[0].weapon!.level=80;assert.notEqual(equipmentKey(normalize(a,'123456789','a')),equipmentKey(normalize(b,'123456789','b')));});
test('unknown or malformed equipment is rejected',()=>{const a=make();a.equipList[1].flat.reliquaryMainstat=undefined as any;assert.throws(()=>normalize(a,'123456789','a'));});
test('saved snapshots expose constellation and talent details with their level bonuses',()=>{
  const avatar:any=make();
  avatar.talentIdList=[891,892];
  avatar.skillLevelMap={'10891':10,'10892':10,'10895':10};
  avatar.proudSkillExtraLevelMap={'8932':3,'8939':3};
  const character=translate(normalize(avatar,'741066691','2026-10-29T18:30:00.000Z')).character;
  assert.equal(character.details.constellations.length,6);
  assert.equal(character.details.constellations[1].unlocked,true);
  assert.equal(character.details.constellations[2].unlocked,false);
  assert.match(character.details.constellations[0].description,/Фурин/);
  assert.deepEqual(character.details.talents.map((talent:any)=>talent.level),[10,13,13]);
  assert.ok(character.details.talents.every((talent:any)=>talent.icon && talent.description));
});
test('element colors support existing snapshots, newer characters and traveler variants',()=>{
  const furina=normalize(make(),'741066691','2026-10-29T18:30:00.000Z');
  assert.equal(translate(furina).character.element,'hydro');
  const old={...furina,character:{...furina.character,id:10000005,element:undefined},raw:{skillDepotId:507}};
  assert.equal(translate(old).character.element,'electro');
  const newer={...furina,character:{...furina.character,id:10000140,element:undefined},raw:{}};
  assert.equal(translate(newer).character.element,'hydro');
});
