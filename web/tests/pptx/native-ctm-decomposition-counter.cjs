#!/usr/bin/env node
'use strict';
// A diagnostic native Canvas counter, not a replacement for the caller-CTM oracle.
const fs=require('node:fs'),path=require('node:path'),runtime=require('./runtime.cjs');
(async()=>{
 const input=process.env.PPTX_CTM_COUNTER_INPUT;
 if(!input)throw Error('PPTX_CTM_COUNTER_INPUT must identify the preserved chart-effects report');
 const bytes=fs.readFileSync(input),report=JSON.parse(bytes),profiles=report.cases.filter(c=>c.name.includes('nonuniform')||c.name.includes('caller crop'));
 if(profiles.length!==2)throw Error('Expected exactly two recorded nonuniform-affine profiles');
 const records=profiles.map(profile=>{
  if(!profile.calls?.length)throw Error('Recorded chart effects are empty');
  const paint=profile.calls[0].paints?.[0];
  if(!paint||paint.expectedLinear?.length!==4||paint.linear?.length!==4)throw Error('Recorded caller/supplied CTM is missing');
  return {name:profile.name,before:paint.expectedLinear,supplied:paint.linear};
 });
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions());
 try{
  const page=await browser.newPage(),exceptions=[];page.on('pageerror',error=>exceptions.push(error.message));
  const cases=await page.evaluate(records=>{
   const linear=matrix=>[matrix.a,matrix.b,matrix.c,matrix.d];
   const equal=(a,b)=>a.length===4&&b.length===4&&a.every((value,index)=>value===b[index]);
   // Authored profile: rotation 31 degrees in group [0.8,0.1,0.2,0.65].
   // Explicit scalar multiplication, no shapeAffine or effect implementation.
   const radians=31*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
   const frame=new DOMMatrix([.8*c+.2*s,.1*c+.65*s,-.8*s+.2*c,-.1*s+.65*c,0,0]);
   return records.map(record=>{
    const original=new DOMMatrix([...record.before,0,0]);
    const transfer=document.createElement('canvas').getContext('2d');transfer.setTransform(original);
    const normalized=document.createElement('canvas').getContext('2d');normalized.setTransform(original.multiply(frame.inverse()));
    const capture=document.createElement('canvas').getContext('2d');capture.setTransform(normalized.getTransform());capture.transform(frame.a,frame.b,frame.c,frame.d,0,0);
    const direct=linear(transfer.getTransform()),decomposed=linear(capture.getTransform());
    return {...record,authoredFrame:linear(frame),nativeNormalizedBase:linear(normalized.getTransform()),nativeDirectTransfer:direct,nativeDecomposedTransfer:decomposed,recordedEqualsDirect:equal(record.supplied,direct),recordedEqualsDecomposed:equal(record.supplied,decomposed),originalEqualsDecomposed:equal(record.before,decomposed),scope:'diagnostic of authored affine removal/reapplication through native Canvas; not an original caller-CTM preservation pass or Microsoft pixel acceptance'};
   });
  },records);
  const result={sourceArtifact:path.resolve(input),sourceArtifactSHA256:runtime.digest(bytes),cases,exceptions,productionHelpersUsed:false,rgbaToleranceChanged:false,fullMicrosoftRenderingAcceptance:'unverified'};
  fs.writeFileSync(path.join(runtime.outputDir,'native-ctm-decomposition-counter.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));process.exitCode=exceptions.length?2:3;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=2;});
