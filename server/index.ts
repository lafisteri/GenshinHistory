import express from 'express';
import { createServer as createViteServer } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalize, equipmentKey, translate } from './model';

const root=process.cwd(), data=path.resolve(process.env.DATA_DIR || path.join(root,'data'));
const app=express(); app.use(express.json());
const uidValid=(s:string)=>/^\d{9,10}$/.test(s);
const slugValid=(s:string)=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
const fileValid=(s:string)=>/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d(?:-\d{3})?Z\.json$/.test(s);
const dir=(uid:string)=>path.join(data,uid);
const list=async (p:string): Promise<string[]> => fs.readdir(p).catch((e)=>{if(e.code==='ENOENT')return [];throw e;});
const valid=(req:express.Request,res:express.Response,next:express.NextFunction)=>{if(!uidValid(req.params.uid) || (req.params.slug && !slugValid(req.params.slug)) || (req.params.file && !fileValid(req.params.file))) {res.status(400).json({error:'Некорректный адрес'});return;} next();};
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const lock=new Set<string>();
const statusFile=(uid:string)=>path.join(dir(uid),'.refresh.json');
async function cacheIcon(icon:unknown) {
 if(typeof icon!=='string' || !/^(?:UI|Skill)_[A-Za-z0-9_]+$/.test(icon)) return;
 const folder=path.join(data,'images'), target=path.join(folder,`${icon}.png`);
 try {await fs.access(target);return;} catch {}
 try {const response=await fetch(`https://enka.network/ui/${icon}.png`,{headers:{'User-Agent':'GenshinHistory/1.0 (local personal app)'},signal:AbortSignal.timeout(10000)}); if(!response.ok)return; const bytes=Buffer.from(await response.arrayBuffer()); if(bytes.length>5_000_000)return; await fs.mkdir(folder,{recursive:true}); await fs.writeFile(target,bytes,{flag:'wx'}).catch((e)=>{if(e.code!=='EEXIST')throw e;});} catch { /* Images are optional. */ }
}
async function findSlug(uid:string, snapshot:any) {
 const directories=await list(dir(uid));
 for(const s of directories.filter(slugValid)) {
  const files=(await list(path.join(dir(uid),s))).filter(fileValid).sort().reverse();
  for(const f of files) { try {if((await read(path.join(dir(uid),s,f))).character.id===snapshot.character.id) return s; break;} catch {} }
 }
 const base=snapshot.character.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `character-${snapshot.character.id}`;
 return directories.includes(base)?`${base}-${snapshot.character.id}`:base;
}
app.get('/api/u/:uid',valid,async(req,res)=>{try {const names=(await list(dir(req.params.uid))).filter(slugValid);const characters=[]; const errors=[];for(const slug of names){const files=(await list(path.join(dir(req.params.uid),slug))).filter(fileValid).sort().reverse(); let first; let count=0;for(const f of files){try{const s=await read(path.join(dir(req.params.uid),slug,f));if(!s.character || !s.equipment)throw Error();first ??= s;count++;}catch{errors.push(`${slug}/${f}`);}} if(first) characters.push({slug,character:translate(first).character,count});}let nextRefresh=0,profile=null;try{const status=await read(statusFile(req.params.uid));nextRefresh=status.nextRefresh || 0;profile=status.profile || null;}catch{}res.json({characters,errors,nextRefresh,profile});}catch{res.status(500).json({error:'Не удалось прочитать историю'});}});
app.get('/api/u/:uid/:slug',valid,async(req,res)=>{try{const folder=path.join(dir(req.params.uid),req.params.slug), files=(await list(folder)).filter(fileValid).sort().reverse(), snapshots=[],errors=[];for(const file of files){try{const s=await read(path.join(folder,file));if(!s.character || !s.equipment)throw Error();snapshots.push({file,...translate(s)});}catch{errors.push(file);}}res.json({snapshots,errors});}catch{res.status(500).json({error:'Не удалось прочитать снимки'});}});
app.delete('/api/u/:uid/:slug/:file',valid,async(req,res)=>{try{await fs.unlink(path.join(dir(req.params.uid),req.params.slug,req.params.file));await fs.rmdir(path.join(dir(req.params.uid),req.params.slug)).catch(()=>{});res.json({ok:true});}catch(e:any){res.status(e.code==='ENOENT'?404:500).json({error:'Не удалось удалить снимок'});}});
app.post('/api/u/:uid/refresh',valid,async(req,res)=>{const uid=req.params.uid;if(lock.has(uid)){res.status(409).json({error:'Обновление уже выполняется'});return;}lock.add(uid);try{
 let nextRefresh=0;try{nextRefresh=(await read(statusFile(uid))).nextRefresh || 0;}catch{} if(nextRefresh>Date.now()){res.status(429).json({error:'Данные Enka ещё находятся в кеше',nextRefresh});return;}
 const response=await fetch(`https://enka.network/api/uid/${uid}/`,{headers:{'User-Agent':'GenshinHistory/1.0 (local personal app)'},signal:AbortSignal.timeout(20000)});
 if(!response.ok){res.status(502).json({error:`Enka вернула ошибку ${response.status}. Проверьте UID и попробуйте позже.`});return;}
 const result:any=await response.json(); nextRefresh=Date.now()+Math.max(0, Number(result.ttl)||60)*1000;await fs.mkdir(dir(uid),{recursive:true});await fs.writeFile(statusFile(uid),JSON.stringify({nextRefresh,profile:result.playerInfo || null}));
 if(!Array.isArray(result.avatarInfoList) || result.avatarInfoList.length===0){res.status(422).json({error:'Витрина пуста или показ характеристик персонажей отключён в игре.',nextRefresh});return;}
 const results=[];for(const avatar of result.avatarInfoList){try{const time=new Date().toISOString();const snap=normalize(avatar,uid,time);const slug=await findSlug(uid,snap);const folder=path.join(dir(uid),slug);const files=(await list(folder)).filter(fileValid).sort().reverse();let previous;if(files.length){try{previous=await read(path.join(folder,files[0]));if(!previous.equipment)throw Error();}catch{throw Error('Последний снимок повреждён; сравнение невозможно');}}const changed=!previous || equipmentKey(previous)!==equipmentKey(snap);if(changed){await fs.mkdir(folder,{recursive:true});const file=time.replace(/:/g,'-').replace('.', '-')+'.json';const temporary=path.join(folder,`.${file}.${process.pid}.tmp`); try {await fs.writeFile(temporary,JSON.stringify(snap,null,2),{flag:'wx'}); await fs.link(temporary,path.join(folder,file));} finally {await fs.unlink(temporary).catch(()=>{});}} const details=translate(snap).character.details;const icons=[snap.character.icon,snap.character.art,...details.constellations.map((c:any)=>c.icon),...details.talents.map((t:any)=>t.icon),snap.equipment.weapon?.icon,...Object.values(snap.equipment.artifacts).map((a:any)=>a?.icon)];await Promise.all(icons.map(cacheIcon));results.push({name:translate(snap).character.displayName,changed});}catch(e:any){results.push({name:`#${avatar.avatarId ?? '?'}`,error:e.message || 'Ошибка обработки'});}}
 res.json({results,nextRefresh});
 }catch(e:any){res.status(502).json({error:`Не удалось обновить данные: ${e.message}`});}finally{lock.delete(uid);}});
app.get('/images/:name',async(req,res,next)=>{const match=/^((?:UI|Skill)_[A-Za-z0-9_]+)\.png$/.exec(req.params.name);if(!match){res.sendStatus(404);return;}await cacheIcon(match[1]);next();});
app.use('/images',express.static(path.join(data,'images'),{fallthrough:false}));
if(process.env.NODE_ENV==='production'){app.use(express.static(path.join(root,'dist')));app.get('*',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));} else {const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const port=Number(process.env.PORT || 3000);
app.listen(port,'127.0.0.1',()=>console.log(`История сборок: http://localhost:${port}`));
