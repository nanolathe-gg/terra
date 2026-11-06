'use strict';
// The map exporter in the browser: export/ (Go) built for WebAssembly, run exactly as the command line runs `map-export --stream`
// (export/README.md): the page's chunks arrive one PNG at a time and every reply is one JSON line. Go's js/wasm port reaches files
// through a Node-style globalThis.fs; this one keeps them in the Origin Private File System through synchronous access handles, so
// past its memory budget the tile store spills to disk as the native exporter's does, and the finished .ufo and indexed PNG are
// disk-backed Files the page offers as downloads without copying them into memory.
//
//   {op:'start', job, metadata, catalog, features} -> {type:'ready', width, height, maxChunkSide}   (features: the map's feature pack, or null)
//   {op:'chunk', x, y, width, height, png}         -> {type:'progress', receivedTiles, totalTiles, uniqueTiles, tileLimit}
//   {op:'finish'}                                  -> {type:'result', result, archive: File, indexed: File}
// A failure answers {type:'error', message}. The page cancels by terminating the worker; it removes the job's folder afterwards.

const NO_STORAGE='This browser cannot export maps: it does not let this page keep files on disk (the Origin Private File System). Use a current Chrome, Edge, Firefox or Safari outside a private window.';
const O={RDONLY:0,WRONLY:1,RDWR:2,CREAT:64,EXCL:128,TRUNC:512,APPEND:1024,DIRECTORY:65536};
const fail=(code,message=code) => Object.assign(new Error(message),{code});
const encoder=new TextEncoder();

// The file system: names and folders live here, each file's bytes in its own OPFS file (or, for the inputs this worker writes, in memory).
let jobDir=null,nextIno=1,nextFd=3;
const fds=new Map();
const newNode=(kind,extra={}) => ({ino:nextIno++,kind,nlink:0,opened:0,mtime:Date.now(),...extra});
const root=newNode('dir',{entries:new Map(),nlink:1});
let pending=Promise.resolve();
const serial=task => (pending=pending.then(task,task));   // OPFS calls that await run one at a time

function resolve(path) {
  const parts=[];
  for (const part of String(path).split('/')) if (part==='..') parts.pop(); else if (part && part!=='.') parts.push(part);
  let dir=root;
  for (const part of parts.slice(0,-1)) { dir=dir.entries.get(part); if (!dir) throw fail('ENOENT'); if (dir.kind!=='dir') throw fail('ENOTDIR'); }
  return parts.length?{parent:dir,name:parts.at(-1),node:dir.entries.get(parts.at(-1))}:{parent:null,name:'',node:root};
}
const size=n => n.kind==='dir'?0:n.handle?n.handle.getSize():n.size;
function readAt(n,view,at) {
  if (n.handle) return n.handle.read(view,{at});
  const count=Math.max(0,Math.min(view.length,n.size-at)); view.set(n.data.subarray(at,at+count)); return count;
}
function writeAt(n,view,at) {
  n.mtime=Date.now();
  if (n.handle) return n.handle.write(view,{at});
  if (at+view.length>n.data.length) { const grown=new Uint8Array(Math.max(at+view.length,n.data.length*2)); grown.set(n.data.subarray(0,n.size)); n.data=grown; }
  n.data.set(view,at); n.size=Math.max(n.size,at+view.length); return view.length;
}
function truncate(n,length) {
  if (n.handle) return n.handle.truncate(length);
  if (length>n.data.length) { const grown=new Uint8Array(length); grown.set(n.data.subarray(0,n.size)); n.data=grown; }
  n.data.fill(0,Math.min(n.size,length),length); n.size=length;
}
function release(n) {   // the last name and descriptor are gone: drop the bytes
  if (n.nlink>0 || n.opened>0 || n.kind!=='file') return;
  if (n.handle) { n.handle.close(); n.handle=null; serial(() => jobDir.removeEntry(n.opfs)).catch(() => {}); }
  n.data=null;
}
function stat(n) {
  const bytes=size(n);
  return {dev:1,ino:n.ino,mode:n.kind==='dir'?0o40755:n.kind==='tty'?0o20666:0o100644,nlink:n.nlink,uid:0,gid:0,rdev:0,size:bytes,blksize:4096,blocks:Math.ceil(bytes/512),
    atimeMs:n.mtime,mtimeMs:n.mtime,ctimeMs:n.mtime,isDirectory:() => n.kind==='dir'};
}
function errorOf(err) {
  if (err?.code) return err;
  if (err?.name==='QuotaExceededError') return fail('ENOSPC','no space left on device');
  if (err?.name==='NotFoundError') return fail('ENOENT');
  return fail('EIO',String(err?.message||err));
}
const done=(callback,task) => { try { callback(null,task()); } catch (err) { callback(errorOf(err)); } };
const later=(callback,task) => { serial(task).then(value => go.exited || callback(null,value),err => go.exited || callback(errorOf(err))); };   // nothing answers a program that has ended
function mkdirs(path) { let dir=root; for (const part of path.split('/').filter(Boolean)) { if (!dir.entries.has(part)) { const d=newNode('dir',{entries:new Map(),nlink:1}); dir.entries.set(part,d); } dir=dir.entries.get(part); } return dir; }
function putFile(path,bytes) { const {parent,name}=resolve(path); const n=newNode('file',{data:bytes,size:bytes.length,nlink:1}); parent.entries.set(name,n); }
function removeFile(path) { const {parent,name,node}=resolve(path); if (node) { parent.entries.delete(name); node.nlink--; release(node); } }

// The three standard streams: commands in, one JSON reply per line out, errors kept for the message.
const tty=newNode('tty',{size:0});
let input=new Uint8Array(0),reader=null,lineText='',errorText='',waiting=null;
const outDecoder=new TextDecoder(),errDecoder=new TextDecoder();
function send(command) {
  const bytes=encoder.encode(JSON.stringify(command)+'\n'),next=new Uint8Array(input.length+bytes.length);
  next.set(input); next.set(bytes,input.length); input=next; const r=reader; reader=null; r?.();
}
const nextReply=() => new Promise((resolve,reject) => { waiting={resolve,reject}; });
function standard(fd,bytes) {
  if (fd===2) { errorText+=errDecoder.decode(bytes,{stream:true}); return bytes.length; }
  lineText+=outDecoder.decode(bytes,{stream:true});
  for (let at;(at=lineText.indexOf('\n'))>=0;) { const line=lineText.slice(0,at).trim(); lineText=lineText.slice(at+1); if (line) { const w=waiting; waiting=null; w?.resolve(JSON.parse(line)); } }
  return bytes.length;
}

const fs={
  constants:{O_RDONLY:O.RDONLY,O_WRONLY:O.WRONLY,O_RDWR:O.RDWR,O_CREAT:O.CREAT,O_EXCL:O.EXCL,O_TRUNC:O.TRUNC,O_APPEND:O.APPEND,O_DIRECTORY:O.DIRECTORY},
  writeSync(fd,buf) { if (fd===1 || fd===2) return standard(fd,buf); const f=fds.get(fd); if (!f) throw fail('EBADF'); const n=writeAt(f.node,buf,f.pos); f.pos+=n; return n; },
  open(path,flags,mode,callback) {
    later(callback,async () => {
      const {parent,name,node}=resolve(path); let n=node;
      if (n && flags&O.CREAT && flags&O.EXCL) throw fail('EEXIST');
      if (!n) {
        if (!(flags&O.CREAT)) throw fail('ENOENT');
        if (!parent || parent.kind!=='dir') throw fail('ENOENT');
        n=newNode('file',{opfs:`f${nextIno}`});
        n.fh=await jobDir.getFileHandle(n.opfs,{create:true}); n.handle=await n.fh.createSyncAccessHandle();
        parent.entries.set(name,n); n.nlink++;
      }
      if (n.kind==='dir' && (flags&3)!==O.RDONLY) throw fail('EISDIR');
      if (flags&O.DIRECTORY && n.kind!=='dir') throw fail('ENOTDIR');
      if (n.kind==='file' && flags&O.TRUNC) truncate(n,0);
      const fd=nextFd++; fds.set(fd,{node:n,pos:0,flags}); n.opened++; return fd;
    });
  },
  close(fd,callback) { done(callback,() => { const f=fds.get(fd); if (!f) { if (fd<3) return; throw fail('EBADF'); } fds.delete(fd); f.node.opened--; release(f.node); }); },
  read(fd,buffer,offset,length,position,callback) {
    if (fd===0) {
      const serve=() => { if (go.exited) return; const count=Math.min(length,input.length); buffer.set(input.subarray(0,count),offset); input=input.subarray(count); callback(null,count); };
      if (input.length) serve(); else reader=serve;
      return;
    }
    done(callback,() => {
      const f=fds.get(fd); if (!f) throw fail('EBADF'); if (f.node.kind==='dir') throw fail('EISDIR');
      const count=readAt(f.node,buffer.subarray(offset,offset+length),position??f.pos); if (position==null) f.pos+=count; return count;
    });
  },
  write(fd,buffer,offset,length,position,callback) {
    done(callback,() => {
      const view=buffer.subarray(offset,offset+length);
      if (fd===1 || fd===2) return standard(fd,view);
      const f=fds.get(fd); if (!f) throw fail('EBADF');
      const at=position??(f.flags&O.APPEND?size(f.node):f.pos),count=writeAt(f.node,view,at); if (position==null) f.pos=at+count; return count;
    });
  },
  fstat(fd,callback) { done(callback,() => { if (fd<3) return stat(tty); const f=fds.get(fd); if (!f) throw fail('EBADF'); return stat(f.node); }); },
  stat(path,callback) { done(callback,() => { const {node}=resolve(path); if (!node) throw fail('ENOENT'); return stat(node); }); },
  lstat(path,callback) { fs.stat(path,callback); },   // no symbolic links here
  readdir(path,callback) { done(callback,() => { const {node}=resolve(path); if (!node) throw fail('ENOENT'); if (node.kind!=='dir') throw fail('ENOTDIR'); return [...node.entries.keys()]; }); },
  mkdir(path,perm,callback) { done(callback,() => { const {parent,name,node}=resolve(path); if (node) throw fail('EEXIST'); if (!parent) throw fail('ENOENT'); parent.entries.set(name,newNode('dir',{entries:new Map(),nlink:1})); }); },
  rmdir(path,callback) { done(callback,() => { const {parent,name,node}=resolve(path); if (!node) throw fail('ENOENT'); if (node.kind!=='dir') throw fail('ENOTDIR'); if (node.entries.size) throw fail('ENOTEMPTY'); parent.entries.delete(name); }); },
  unlink(path,callback) { done(callback,() => { const {parent,name,node}=resolve(path); if (!node) throw fail('ENOENT'); if (node.kind==='dir') throw fail('EISDIR'); parent.entries.delete(name); node.nlink--; release(node); }); },
  link(from,to,callback) {
    done(callback,() => {
      const source=resolve(from).node,target=resolve(to);
      if (!source) throw fail('ENOENT'); if (source.kind==='dir') throw fail('EPERM'); if (target.node) throw fail('EEXIST'); if (!target.parent) throw fail('ENOENT');
      target.parent.entries.set(target.name,source); source.nlink++;
    });
  },
  rename(from,to,callback) {
    done(callback,() => {
      const source=resolve(from),target=resolve(to); if (!source.node) throw fail('ENOENT'); if (!target.parent) throw fail('ENOENT');
      if (target.node===source.node) return;
      if (target.node) { if (target.node.kind==='dir') throw fail('EISDIR'); target.node.nlink--; release(target.node); }
      source.parent.entries.delete(source.name); target.parent.entries.set(target.name,source.node);
    });
  },
  fsync(fd,callback) { done(callback,() => { fds.get(fd)?.node.handle?.flush(); }); },
  ftruncate(fd,length,callback) { done(callback,() => { const f=fds.get(fd); if (!f) throw fail('EBADF'); truncate(f.node,length); }); },
  truncate(path,length,callback) { done(callback,() => { const {node}=resolve(path); if (!node) throw fail('ENOENT'); truncate(node,length); }); },
  readlink(path,callback) { callback(fail('EINVAL')); },
  symlink(path,link,callback) { callback(fail('ENOSYS')); },
  chmod(path,mode,callback) { callback(null); }, fchmod(fd,mode,callback) { callback(null); },
  chown(path,uid,gid,callback) { callback(null); }, fchown(fd,uid,gid,callback) { callback(null); }, lchown(path,uid,gid,callback) { callback(null); },
  utimes(path,atime,mtime,callback) { callback(null); },
};
globalThis.fs=fs;
globalThis.process={pid:1,ppid:0,getuid:() => 0,getgid:() => 0,geteuid:() => 0,getegid:() => 0,getgroups:() => [],umask:() => 0o22,cwd:() => '/',chdir:() => { throw fail('ENOSYS'); }};
globalThis.path={resolve:(...parts) => '/'+parts.join('/').split('/').filter(Boolean).join('/')};

// The exporter program.
let go=null,exited=null,peakMemory=0;
const memory=() => { peakMemory=Math.max(peakMemory,go?._inst?.exports.mem.buffer.byteLength||0); return peakMemory; };
function message(err) {
  const text=String(err?.message||err).replace(/^map-export: /,'').trim();
  return /no space left on device/.test(text)?'The browser ran out of storage for this export. Free some disk space, or close other tabs of this site, and export again.':text;
}

async function start({job,metadata,catalog,features,budgetMB}) {
  if (!self.FileSystemSyncAccessHandle || !navigator.storage?.getDirectory) throw new Error(NO_STORAGE);
  let storage;
  try { storage=await navigator.storage.getDirectory(); } catch { throw new Error(NO_STORAGE); }
  jobDir=await (await storage.getDirectoryHandle('terraform-export',{create:true})).getDirectoryHandle(job,{create:true});
  const response=await fetch('map-export.wasm');
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error||`The map exporter could not be loaded (HTTP ${response.status}).`);
  const bytes=await response.arrayBuffer();
  importScripts('wasm_exec.js');
  go=new Go();
  const {instance}=await WebAssembly.instantiate(bytes,go.importObject);
  mkdirs('/job/features'); mkdirs(`/work/export-${job}`); mkdirs('/out');
  putFile('/job/catalog.json',encoder.encode(JSON.stringify(catalog))); putFile('/job/metadata.json',encoder.encode(JSON.stringify(metadata)));
  if (features) putFile('/job/features/pack.json',encoder.encode(JSON.stringify(features)));   // the map's generated features (export/featurepack.go)
  go.argv=['map-export','--stream','--catalog-file','/job/catalog.json','--input','/job/metadata.json','--out','/out','--work',`/work/export-${job}`,'--features-root','/job/features',
    ...(budgetMB==null?[]:['--tile-budget-mb',String(budgetMB)])];
  go.env={HOME:'/'};
  // wasm_exec.js leaves the runtime's pending timers behind when the program exits; one firing later would throw "Go program has already exited".
  let code=0; go.exit=c => { code=c; for (const timer of go._scheduledTimeouts.values()) clearTimeout(timer); go._scheduledTimeouts.clear(); };
  const ready=nextReply();
  exited=go.run(instance).then(() => code,err => { errorText+=String(err?.message||err); return 1; }).then(c => {
    const w=waiting; waiting=null; w?.reject(new Error(errorText.trim()||(c?`The exporter stopped (exit ${c}).`:'The exporter stopped before replying.')));
    return c;
  });
  const reply=await ready; memory(); return reply;
}

async function chunk({x,y,width,height,png}) {
  putFile('/job/chunk.png',new Uint8Array(png));
  const reply=nextReply(); send({op:'chunk',x,y,width,height,path:'/job/chunk.png'});
  try { return await reply; } finally { removeFile('/job/chunk.png'); memory(); }
}

async function finish() {
  const reply=nextReply(); send({op:'finish'});
  const result=await reply; memory();
  if (await exited) throw new Error(errorText.trim()||'The exporter failed after its result.');
  const file=async name => { const n=resolve('/out/'+name).node; if (n.handle) { n.handle.flush(); n.handle.close(); n.handle=null; } return n.fh.getFile(); };
  result.metrics={...result.metrics,peakRSSBytes:peakMemory};   // the module's linear memory: it never shrinks, so this is its peak (export/rss_js.go)
  return {result,archive:await file(result.archive),indexed:await file(result.indexed)};
}

self.onmessage=async ({data}) => {
  try {
    if (data.op==='start') self.postMessage({type:'ready',...await start(data)});
    else if (data.op==='chunk') self.postMessage({type:'progress',...await chunk(data)});
    else if (data.op==='finish') self.postMessage({type:'result',...await finish()});
  } catch (err) { self.postMessage({type:'error',message:message(err)}); }
};
