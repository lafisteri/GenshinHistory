import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {syncWithConfig} from './git-sync';

test('sync commits snapshots, retries pushes and records deletion without images or code changes',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'genshin-git-test-'));
 const remote=path.join(tmp,'remote.git'),source=path.join(tmp,'source'),data=path.join(tmp,'data'),repoDir=path.join(tmp,'sync');
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git(tmp,'init','--bare',remote);await fs.mkdir(source);git(source,'init','-b','main');git(source,'config','user.name','Test');git(source,'config','user.email','test@example.com');await fs.writeFile(path.join(source,'.gitignore'),'data/\n');await fs.writeFile(path.join(source,'code.txt'),'original');git(source,'add','.');git(source,'commit','-m','initial');git(source,'remote','add','origin',remote);git(source,'push','-u','origin','main');
  const uid='741066691',slug='furina',file='2026-10-29T18-30-00-000Z.json';const folder=path.join(data,uid,slug);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,file),'{"build":1}');await fs.mkdir(path.join(data,'images'));await fs.writeFile(path.join(data,'images','image.png'),'image');await fs.writeFile(path.join(data,uid,'.refresh.json'),'{}');await fs.writeFile(path.join(source,'code.txt'),'local edit');
  const config={remote,branch:'main',repoDir,dataDir:data,authorName:'Test',authorEmail:'test@example.com'};
  assert.deepEqual(await syncWithConfig(config,uid),{enabled:true,committed:true});
  assert.match(git(source,'--git-dir',remote,'show',`main:data/${uid}/${slug}/${file}`),/build/);
  const paths=git(source,'--git-dir',remote,'ls-tree','-r','--name-only','main');assert.doesNotMatch(paths,/images|refresh/);assert.equal(await fs.readFile(path.join(source,'code.txt'),'utf8'),'local edit');
  assert.deepEqual(await syncWithConfig(config,uid),{enabled:true,committed:false});
  await fs.unlink(path.join(folder,file));
  const offlineRemote=remote+'-offline';await fs.rename(remote,offlineRemote);
  assert.ok((await syncWithConfig(config,uid,{slug,file})).error);
  await fs.rename(offlineRemote,remote);
  assert.deepEqual(await syncWithConfig(config,uid),{enabled:true,committed:true});
  assert.doesNotMatch(git(source,'--git-dir',remote,'ls-tree','-r','--name-only','main'),/furina/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
