#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),runtime=require('./runtime.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const out=path.join(runtime.outputDir,'blip-destination-effects-results');fs.mkdirSync(out,{recursive:true});
 const dir=path.join(runtime.repoRoot,'web/src/app/ui/mobile/viewers'),viewer=await createViewerBundle(path.join(dir,'pptx-viewer.js'),'window.destinationColor={parseColor};'),fills=await createViewerBundle(path.join(dir,'pptx-fills.js'),'window.destinationFill={parseDrawingFill,renderDrawingFill};');
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions()),page=await browser.newPage({viewport:{width:1000,height:800},deviceScaleFactor:1}),exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
 try{
  await initAuditHost(page);await page.setContent('<body></body>');await page.addScriptTag({content:viewer.content});await page.addScriptTag({content:fills.content});
  const cases=await page.evaluate(async()=>{
   const api=window.destinationFill,parseColor=window.destinationColor.parseColor,cases=[],ns='http://schemas.openxmlformats.org/drawingml/2006/main';
   const make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},source=make(8,4),sc=source.getContext('2d');sc.fillStyle='black';sc.fillRect(0,0,8,4);sc.fillStyle='white';sc.fillRect(4,0,4,4);
   const parse=(body,profile='office')=>api.parseDrawingFill(new DOMParser().parseFromString(`<a:blipFill xmlns:a="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><a:blip r:embed="image">${body}</a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill>`,'application/xml').documentElement,{parseColor,renderingProfile:profile,resolveRelationship:id=>id});
   const bytes=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   // Independent oracle: publicly specified Office destination-pixel radius
   // plus native Canvas drawImage/filter. No production mapping/effect helper
   // is used; each fixture has an explicitly known axis-aligned target rect.
   const reference=(w,h,order)=>{let c=make(w,h);c.getContext('2d').drawImage(source,0,0,w,h);for(const op of order){if(op==='blur'){const next=make(w,h),ctx=next.getContext('2d');ctx.filter='blur(2px)';ctx.drawImage(c,0,0);c=next;}else if(op==='half-alpha'){const ctx=c.getContext('2d'),data=ctx.getImageData(0,0,w,h);for(let i=3;i<data.data.length;i+=4)data.data[i]=128;ctx.putImageData(data,0,0);}}return c;};
   const compare=(actual,expected)=>{const a=bytes(actual),b=bytes(expected);let changed=0,maxDelta=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}if(changed)throw Error(`Exact destination oracle changed ${changed} channels (max ${maxDelta})`);return {changedChannels:changed,maxDelta,width:actual.width,height:actual.height};};
   const blur='<a:blur rad="19050" grow="1"/>',alpha='<a:alphaRepl a="50000"/>';
   const test=async(name,fn)=>{try{cases.push({name,status:'MATCH',evidence:await fn()});}catch(e){cases.push({name,status:'FAIL',error:e.message});}};
   await test('Office default grown blur is clipped in a stretched destination fill',async()=>{const c=make(64,32);await api.renderDrawingFill(c.getContext('2d'),parse(blur),{x:0,y:0,width:64,height:32},{resolveImage:async()=>source,parseColor,dpi:96});return compare(c,reference(64,32,['blur']));});
   await test('Office blur radius remains two destination pixels under nonuniform group affine',async()=>{const c=make(128,16),ctx=c.getContext('2d');ctx.scale(2,.5);await api.renderDrawingFill(ctx,parse(blur),{x:0,y:0,width:64,height:32},{resolveImage:async()=>source,parseColor,dpi:96});return compare(c,reference(128,16,['blur']));});
   await test('Office alpha replacement then blur retains declared effect ordering',async()=>{const c=make(64,32);await api.renderDrawingFill(c.getContext('2d'),parse(alpha+blur),{x:0,y:0,width:64,height:32},{resolveImage:async()=>source,parseColor,dpi:96});return compare(c,reference(64,32,['half-alpha','blur']));});
   await test('Office blur then alpha replacement retains the reverse declared order',async()=>{const c=make(64,32);await api.renderDrawingFill(c.getContext('2d'),parse(blur+alpha),{x:0,y:0,width:64,height:32},{resolveImage:async()=>source,parseColor,dpi:96});return compare(c,reference(64,32,['blur','half-alpha']));});
   await test('Office blur is applied after repeated image tiles join in destination space',async()=>{const c=make(64,32),model=parse(blur);model.mode='tile';model.tile={sx:1,sy:1,tx:0,ty:0,alignment:'tl',flip:'none'};await api.renderDrawingFill(c.getContext('2d'),model,{x:0,y:0,width:64,height:32},{resolveImage:async()=>source,parseColor,dpi:96,imageDpi:96});const mapped=make(64,32),mc=mapped.getContext('2d');mc.fillStyle=mc.createPattern(source,'repeat');mc.fillRect(0,0,64,32);const expected=make(64,32),ec=expected.getContext('2d');ec.filter='blur(2px)';ec.drawImage(mapped,0,0);return compare(c,expected);});
   await test('ISO grown blur remains unsupported rather than falsely clipping the expanded effect',async()=>{let code;try{await api.renderDrawingFill(make(64,32).getContext('2d'),parse(blur,'iso'),{x:0,y:0,width:64,height:32},{resolveImage:async()=>source,parseColor,dpi:96});}catch(e){code=e.code;}if(code!=='unsupported-blip-blur-grow')throw Error('ISO expansion was silently truncated');return {code,scope:'Negative diagnostic; ISO expanded surface still pending'};});
   return cases;
  });
  const changedDependencies=[...viewer.changedDependencies(),...fills.changedDependencies()],report={cases,exceptions,sourceSha256:viewer.sourceSha256,fillSourceSha256:fills.sourceSha256,dependencyHashes:fills.dependencyHashes,changedDependencies,reference:'MS-OI29500 v20260818 §2.1.1289(a,b) + native Canvas filter destination-raster oracle',microsoftVisualBaseline:'missing',acceptanceStatus:'unverified',operationalStatus:cases.every(c=>c.status==='MATCH')&&!exceptions.length&&!changedDependencies.length?'pass':'fail'};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:cases.length,failures:cases.filter(c=>c.status==='FAIL'),exceptions,status:report.operationalStatus}));process.exitCode=report.operationalStatus==='pass'?3:1;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=2;});
