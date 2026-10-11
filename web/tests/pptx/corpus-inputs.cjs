'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {digest}=require('./runtime.cjs');
const manifestPath=path.join(__dirname,'corpus/manifest.json');
function envIds(){const raw=process.env.PPTX_CORPUS_IDS;if(raw===undefined)return undefined;const ids=raw.split(',').map(x=>x.trim());if(ids.some(x=>!x))throw new Error('Empty requested corpus ID');return ids;}
async function loadCorpus({ids=envIds(),cache=process.env.PPTX_CORPUS_CACHE,resolved=process.env.PPTX_CORPUS_RESOLVED}={}){
 const manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
 if(manifest.schema_version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('Expected nonempty authoritative pinned manifest');
 const known=new Map(manifest.files.map(f=>[f.id,f]));if(known.size!==manifest.files.length)throw new Error('Duplicate authoritative IDs');
 if(ids!==undefined&&(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!known.has(id))))throw new Error('Unknown, duplicate or empty corpus selection');
 const selected=ids===undefined?manifest.files:ids.map(id=>known.get(id));
 const paths=new Map();if(resolved){const record=JSON.parse(fs.readFileSync(path.resolve(resolved),'utf8'));for(const row of record.files||[]){if(!known.has(row.id)||paths.has(row.id)||typeof row.path!=='string')throw new Error('Invalid resolved corpus path record');paths.set(row.id,path.resolve(row.path));}}
 const cacheRoot=path.resolve(cache||path.join(os.tmpdir(),'sentry-pptx-corpus'));
 const {verifySpecimen}=await import(pathToFileURL(path.join(__dirname,'corpus/fetch-corpus.mjs')).href);
 const files=selected.map(item=>{if(path.basename(item.file)!==item.file)throw new Error('Unsafe authoritative specimen filename');const file=paths.get(item.id)||path.join(cacheRoot,item.file);const bytes=fs.readFileSync(file);const integrity=verifySpecimen(bytes,{...item,format:item.format||'pptx'});return{...item,path:file,integrity};});
 if(!files.length)throw new Error('Empty verified corpus');
 return{manifestBytes,manifest,manifestPath,manifestSha256:digest(manifestBytes),files,cacheRoot};
}
module.exports={loadCorpus,envIds};
