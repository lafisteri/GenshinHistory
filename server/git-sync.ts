import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export interface SyncConfig { remote:string; branch:string; repoDir:string; dataDir:string; authorName:string; authorEmail:string }
export interface SyncResult { enabled:boolean; committed?:boolean; error?:string }
let pending:Promise<unknown>=Promise.resolve();
const git = async (args:string[], cwd?:string) => {
  try { return await exec('git',args,{cwd,timeout:60_000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}); }
  catch (error:any) { throw new Error((error.stderr || error.message || 'Ошибка Git').trim().replace(/https?:\/\/[^\s]*@/g,'https://***@')); }
};
async function copySnapshots(source:string, target:string) {
  let entries;try {entries=await fs.readdir(source,{withFileTypes:true})}catch(e:any){if(e.code==='ENOENT')return;throw e;}
  for (const entry of entries) {
    const src=path.join(source,entry.name), dest=path.join(target,entry.name);
    if(entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) await copySnapshots(src,dest);
    else if(entry.isFile() && /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d(?:-\d{3})?Z\.json$/.test(entry.name)) {await fs.mkdir(target,{recursive:true});await fs.copyFile(src,dest);}
  }
}
async function run(config:SyncConfig,uid:string,deleted?:{slug:string,file:string}):Promise<SyncResult> {
  const pendingFile=path.join(config.dataDir,'.git-sync-deletions.json');
  try {
    if(!/^\d{9,10}$/.test(uid)) throw new Error('Некорректный UID');
    if(deleted && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(deleted.slug)|| !/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d(?:-\d{3})?Z\.json$/.test(deleted.file))) throw new Error('Некорректный путь снимка');
    let deletions:{uid:string;slug:string;file:string}[]=[];
    try {deletions=JSON.parse(await fs.readFile(pendingFile,'utf8'));if(!Array.isArray(deletions))throw new Error('Неверный формат очереди удалений');} catch(e:any) {if(e.code!=='ENOENT')throw e;}
    if(deleted && !deletions.some(d=>d.uid===uid && d.slug===deleted.slug && d.file===deleted.file)) {
      deletions.push({uid,...deleted});await fs.mkdir(config.dataDir,{recursive:true});await fs.writeFile(pendingFile,JSON.stringify(deletions));
    }
    try {await fs.access(path.join(config.repoDir,'.git'));} catch {
      await fs.mkdir(path.dirname(config.repoDir),{recursive:true});
      await git(['clone','--single-branch','--branch',config.branch,'--',config.remote,config.repoDir]);
    }
    const repo=config.repoDir;
    const remote=(await git(['remote','get-url','origin'],repo)).stdout.trim();
    if(remote!==config.remote) throw new Error('Адрес репозитория синхронизации не совпадает с настройкой');
    const branch=(await git(['branch','--show-current'],repo)).stdout.trim();
    if(branch!==config.branch) throw new Error('В служебном репозитории выбрана другая ветка');
    await git(['config','user.name',config.authorName],repo);await git(['config','user.email',config.authorEmail],repo);
    await git(['fetch','origin',config.branch],repo);
    await git(['merge','--ff-only',`origin/${config.branch}`],repo);
    await fs.mkdir(path.join(repo,'data'),{recursive:true});
    await copySnapshots(path.join(config.dataDir,uid),path.join(repo,'data',uid));
    for(const d of deletions) {
      if(!/^\d{9,10}$/.test(d.uid)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)||!/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d(?:-\d{3})?Z\.json$/.test(d.file)) throw new Error('Некорректная очередь удалений');
      await fs.rm(path.join(repo,'data',d.uid,d.slug,d.file),{force:true});
    }
    await git(['add','-f','-A','--','data'],repo);
    const changed=Boolean((await git(['diff','--cached','--name-only'],repo)).stdout.trim());
    if(changed) await git(['commit','-m',`Save artifact history for ${uid}`],repo);
    await git(['push','origin',`HEAD:${config.branch}`],repo);
    if(deletions.length)await fs.rm(pendingFile,{force:true});
    return {enabled:true,committed:changed};
  } catch(error:any) { return {enabled:true,error:error.message || 'Ошибка синхронизации Git'}; }
}
export function syncHistory(uid:string,deleted?:{slug:string,file:string}):Promise<SyncResult> {
  if(process.env.GIT_SYNC_ENABLED!=='true')return Promise.resolve({enabled:false});
  const config:SyncConfig={remote:process.env.GIT_SYNC_REMOTE || '',branch:process.env.GIT_SYNC_BRANCH || 'main',repoDir:process.env.GIT_SYNC_REPO || '/git-sync/repository',dataDir:path.resolve(process.env.DATA_DIR || path.join(process.cwd(),'data')),authorName:process.env.GIT_AUTHOR_NAME || 'Genshin History',authorEmail:process.env.GIT_AUTHOR_EMAIL || 'genshin-history@localhost'};
  if(!config.remote)return Promise.resolve({enabled:true,error:'Не задан адрес GIT_SYNC_REMOTE'});
  const task=pending.then(()=>run(config,uid,deleted));pending=task.catch(()=>{});return task;
}
export async function syncWithConfig(config:SyncConfig,uid:string,deleted?:{slug:string,file:string}) {return run(config,uid,deleted)}
