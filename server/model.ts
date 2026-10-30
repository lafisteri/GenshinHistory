import characters from '../reference/characters.json';
import loc from '../reference/loc.json';
import db from 'genshin-db';

type Obj = Record<string, any>;
const chars: Record<string, any> = characters;
const translations: Record<string, Record<string,string>> = loc;
const allCharacters = db.characters('names', {matchCategories:true, verboseCategories:true}) as unknown as any[];
const russianCharacters = db.characters('names', {matchCategories:true, verboseCategories:true, resultLanguage:db.Language.Russian}) as unknown as any[];
const characterDb = new Map(allCharacters.map(c => [c.id,c]));
const characterRu = new Map(russianCharacters.map(c => [c.id,c.name]));
const allWeapons = db.weapons('names', {matchCategories:true, verboseCategories:true}) as unknown as any[];
const russianWeapons = db.weapons('names', {matchCategories:true, verboseCategories:true, resultLanguage:db.Language.Russian}) as unknown as any[];
const allSets = db.artifacts('names', {matchCategories:true, verboseCategories:true}) as unknown as any[];
const russianSets = db.artifacts('names', {matchCategories:true, verboseCategories:true, resultLanguage:db.Language.Russian}) as unknown as any[];
const sets = new Map(allSets.map(a => [a.id,a]));
const setsRu = new Map(russianSets.map(a => [a.id,a]));
const partKey:Record<string,string> = {EQUIP_BRACER:'flower',EQUIP_NECKLACE:'plume',EQUIP_SHOES:'sands',EQUIP_RING:'goblet',EQUIP_DRESS:'circlet'};
const weapons = new Map(allWeapons.map(w => [w.id, w.name]));
const weaponsRu = new Map(russianWeapons.map(w => [w.id, w.name]));
export const slots = ['EQUIP_BRACER','EQUIP_NECKLACE','EQUIP_SHOES','EQUIP_RING','EQUIP_DRESS'] as const;
const word = (hash: unknown, lang = 'en') => translations[lang]?.[String(hash)];
const elements:Record<string,string> = {Fire:'pyro',Water:'hydro',Electric:'electro',Wind:'anemo',Ice:'cryo',Rock:'geo',Grass:'dendro',ELEMENT_PYRO:'pyro',ELEMENT_HYDRO:'hydro',ELEMENT_ELECTRO:'electro',ELEMENT_ANEMO:'anemo',ELEMENT_CRYO:'cryo',ELEMENT_GEO:'geo',ELEMENT_DENDRO:'dendro'};
function characterElement(id:number, depot?:number):string {
  const info=chars[`${id}-${depot}`] || chars[id];
  return elements[info?.Element] || elements[characterDb.get(id)?.elementType] || 'unknown';
}
const hasStat = (s: any) => s && typeof (s.appendPropId ?? s.mainPropId) === 'string' && typeof s.statValue === 'number';
export function normalize(avatar: Obj, uid: string, time: string) {
  if (!Number.isInteger(avatar.avatarId) || !Array.isArray(avatar.equipList) || !avatar.propMap || !avatar.fightPropMap) throw Error('Неполные данные персонажа');
  const info = chars[avatar.avatarId];
  const name = word(info?.NameTextMapHash) || characterDb.get(avatar.avatarId)?.name || `Character ${avatar.avatarId}`;
  const artifacts: Record<string, any> = Object.fromEntries(slots.map(s => [s, null]));
  let weapon: any = null;
  for (const item of avatar.equipList) {
    const flat = item.flat;
    if (!flat || !Number.isInteger(item.itemId)) throw Error('Неизвестная структура предмета');
    if (flat.itemType === 'ITEM_RELIQUARY') {
      if (!slots.includes(flat.equipType) || artifacts[flat.equipType] || !item.reliquary || typeof item.reliquary.level !== 'number' || !hasStat(flat.reliquaryMainstat) || !Array.isArray(flat.reliquarySubstats) || !flat.reliquarySubstats.every(hasStat)) throw Error('Неизвестная структура артефакта');
      artifacts[flat.equipType] = {id:item.itemId, name:sets.get(flat.setId)?.[partKey[flat.equipType]]?.name || word(flat.nameTextMapHash) || `Item #${item.itemId}`, nameHash:flat.nameTextMapHash, slot:flat.equipType, setId:flat.setId, setName:sets.get(flat.setId)?.name || word(flat.setNameTextMapHash) || `Set #${flat.setId}`, setNameHash:flat.setNameTextMapHash, icon:flat.icon, rarity:flat.rankLevel, level:item.reliquary.level - 1, main:flat.reliquaryMainstat, substats:flat.reliquarySubstats, rolls:item.reliquary.appendPropIdList ?? []};
    } else if (flat.itemType === 'ITEM_WEAPON') {
      if (weapon || !item.weapon || typeof item.weapon.level !== 'number' || !Array.isArray(flat.weaponStats) || !flat.weaponStats.every(hasStat)) throw Error('Неизвестная структура оружия');
      weapon = {id:item.itemId, name:weapons.get(item.itemId) || word(flat.nameTextMapHash) || `Item #${item.itemId}`, nameHash:flat.nameTextMapHash, icon:flat.icon, rarity:flat.rankLevel, level:item.weapon.level, ascension:item.weapon.promoteLevel ?? 0, refinement:1 + Number(Object.values(item.weapon.affixMap ?? {})[0] ?? 0), stats:flat.weaponStats};
    } else throw Error('Неизвестный тип предмета');
  }
  return {version:1, uid, capturedAt:time, character:{id:avatar.avatarId,element:characterElement(avatar.avatarId,avatar.skillDepotId),name,nameHash:info?.NameTextMapHash,icon:info?.SideIconName?.replace('_Side_', '_') || characterDb.get(avatar.avatarId)?.images?.filename_icon, art:characterDb.get(avatar.avatarId)?.images?.filename_gachaSplash, level:Number(avatar.propMap['4001']?.val ?? avatar.propMap['4001']?.ival ?? 0), constellations:avatar.talentIdList?.length ?? 0, skills:avatar.skillLevelMap ?? {}, stats:avatar.fightPropMap}, equipment:{weapon,artifacts}, raw:avatar};
}
export function equipmentKey(snapshot: ReturnType<typeof normalize>) {
  const w=snapshot.equipment.weapon;
  const a=snapshot.equipment.artifacts;
  return JSON.stringify({weapon:w && {id:w.id,level:w.level,ascension:w.ascension,refinement:w.refinement,stats:w.stats},artifacts:slots.map(s=>{const v=a[s];return v && {id:v.id,level:v.level,main:v.main,substats:v.substats,rolls:v.rolls};})});
}
function characterDetails(snapshot: any) {
  const c = snapshot.character;
  const raw = snapshot.raw || {};
  const info = chars[`${c.id}-${raw.skillDepotId}`] || chars[c.id];
  const character = characterDb.get(c.id);
  // The lookup is keyed by the canonical English name from the local character catalogue.
  const constellationData: any = character?.name ? db.constellations(character.name, {resultLanguage:db.Language.Russian}) : undefined;
  const talentData: any = character?.name ? db.talents(character.name, {resultLanguage:db.Language.Russian}) : undefined;
  const constellations = Array.from({length:6}, (_,index) => {
    const key = `c${index+1}`, detail = constellationData?.[key];
    return {index:index+1, unlocked:index < (c.constellations || 0), icon:constellationData?.images?.[`filename_${key}`] || info?.Consts?.[index], name:detail?.name || `Созвездие ${index+1}`, description:detail?.description || 'Описание недоступно в локальном справочнике.'};
  });
  const ordered = (info?.SkillOrder || Object.keys(c.skills || {})).filter((id: number|string) => c.skills?.[id] !== undefined);
  const talents = ordered.slice(0,3).map((id: number|string,index: number) => {
    const key = `combat${index+1}`, detail = talentData?.[key];
    const bonusId = info?.ProudMap?.[id];
    const bonus = Number(raw.proudSkillExtraLevelMap?.[bonusId] || 0);
    return {id, level:Number(c.skills[id]) + bonus, icon:info?.Skills?.[id] || talentData?.images?.[`filename_${key}`], name:detail?.name || `Талант ${index+1}`, description:detail?.description || 'Описание недоступно в локальном справочнике.'};
  });
  return {constellations,talents};
}
export function translate(snapshot: any) {
  const c=snapshot.character;
  const eq=snapshot.equipment;
  const translateItem=(item:any) => item && {...item, displayName:(item.slot ? setsRu.get(item.setId)?.[partKey[item.slot]]?.name : weaponsRu.get(item.id)) || word(item.nameHash,'ru') || item.name, displaySet:setsRu.get(item.setId)?.name || word(item.setNameHash,'ru') || item.setName};
  return {...snapshot, character:{...c,element:characterElement(c.id,snapshot.raw?.skillDepotId),details:characterDetails(snapshot),art:c.art || characterDb.get(c.id)?.images?.filename_gachaSplash,displayName:word(c.nameHash,'ru') || characterRu.get(c.id) || c.name}, equipment:{weapon:translateItem(eq.weapon),artifacts:Object.fromEntries(Object.entries(eq.artifacts).map(([k,v])=>[k,translateItem(v)]))}};
}
