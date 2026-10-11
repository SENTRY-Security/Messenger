#!/usr/bin/env node
'use strict';
// Real pinned-file and corruption checks only; no Office rendering assertion.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {collectPreflight}=require('./preflight.cjs');
(async()=>{
 const {loadCorpus}=require('../corpus-inputs.cjs');
 const cache=process.env.PPTX_CORPUS_CACHE||path.join(os.tmpdir(),'sentry-pptx-corpus');
 const id='ChristopherVR__ooxml__media-bookmark-trigger';
 const corpus=await loadCorpus({ids:[id],cache,resolved:undefined});
 const {verifyZip}=await import(pathToFileURL(path.join(__dirname,'../corpus/fetch-corpus.mjs')).href);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pptx-desktop-preflight-'));
 const cases=[];
 const check=async(name,fn)=>{await fn();cases.push({name,status:'MATCH'});};
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 try{
  const invoke=async(selection,cacheDir=cache)=>{const output=path.join(dir,Math.random().toString(16).slice(2)+'.json');try{return{record:await collectPreflight(output,cacheDir,selection),output};}catch(error){return{error,output};}};
  await check('genuine pinned bookmark source SHA/all-member CRC before collection',async()=>{const r=await invoke(id);assert(!r.error,r.error?.message);const a=JSON.parse(fs.readFileSync(r.output));assert(a.files.length===1&&a.files[0].integrity.crcVerified&&a.files[0].sha256===corpus.files[0].sha256,'Missing verified nonempty source');});
  for(const [name,selection]of [['empty selection',''],['unknown selection','unknown-pptx'],['duplicate selection',id+','+id]])await check(name+' rejects without a preflight record',async()=>{const r=await invoke(selection);assert(r.error&&!fs.existsSync(r.output),'Invalid selection was accepted');});
  await check('tampered real input rejected before any baseline collection',async()=>{const fake=path.join(dir,'cache');fs.mkdirSync(fake);const bytes=fs.readFileSync(corpus.files[0].path);bytes[0]^=1;fs.writeFileSync(path.join(fake,corpus.files[0].file),bytes);const r=await invoke(id,fake);assert(r.error&&!fs.existsSync(r.output)&&r.error.message.includes('SHA256'),'Tampered bytes were accepted');});
  await check('real package central-directory CRC corruption independently rejects',()=>{const bytes=fs.readFileSync(corpus.files[0].path),marker=Buffer.from([0x50,0x4b,0x01,0x02]),offset=bytes.indexOf(marker);assert(offset>=0,'No central-directory oracle');bytes[offset+16]^=1;let rejected=false;try{verifyZip(bytes,corpus.files[0]);}catch(error){rejected=/CRC/.test(error.message);}assert(rejected,'Wrong CRC was accepted');});
  console.log(JSON.stringify({cases,scope:'Pinned input/CRC validation only; Windows COM and full Microsoft acceptance unexecuted'}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=2;});
