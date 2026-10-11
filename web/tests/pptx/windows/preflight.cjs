#!/usr/bin/env node
'use strict';
// Uses the repository's authoritative pins and full-member ZIP CRC verifier.
// No rendering engine, browser or Office substitute participates in preflight.
const fs=require('node:fs'),path=require('node:path');
const {loadCorpus}=require('../corpus-inputs.cjs');
async function collectPreflight(output,cache,selection){
 if(!output||!cache)throw Error('Usage: node preflight.cjs output.json cache-dir [comma-separated-ids]');
 const ids=selection===undefined?undefined:selection.split(',');
 const corpus=await loadCorpus({ids,cache,resolved:undefined});
 if(corpus.files.some(f=>f.format!=='pptx'))throw Error('Desktop collector accepts only pinned PPTX inputs');
 const record={schema:'pptx-desktop-preflight/v1',manifestPath:corpus.manifestPath,manifestSha256:corpus.manifestSha256,
  files:corpus.files.map(f=>({id:f.id,file:f.file,path:f.path,sha256:f.sha256,sizeBytes:f.size_bytes,
   sourceCommit:f.source_commit,sourceURL:f.raw_url,expectedSlides:f.features.slides,integrity:f.integrity}))};
 fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n');
 return record;
}
module.exports={collectPreflight};
if(require.main===module)collectPreflight(...process.argv.slice(2)).then(record=>{
 console.log(JSON.stringify({verifiedInputs:record.files.length,manifestSha256:record.manifestSha256}));
}).catch(error=>{console.error(error.message);process.exitCode=2;});
