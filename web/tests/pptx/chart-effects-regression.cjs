#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),runtime=require('./runtime.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
(async()=>{
 const corpus=await loadCorpus({ids:['scanny__python-pptx__cht-chart-type']});
 const input=corpus.files[0],bytes=fs.readFileSync(input.path);
 // Instrument the actual viewer adapter, without replacing its raster renderer.
 const bundle=await createViewerBundle(path.join(runtime.viewerDir,'pptx-viewer.js'),`
 window.chartEffectCalls=[];
 const renderDrawingEffects=async function(context,models,bounds,paint,options){
  return actualDrawingEffects(context,models,bounds,async(supplied,capture)=>{
   const previous=window.chartEffectDeviceOrigin;window.chartEffectDeviceOrigin=capture?.deviceOrigin;
   try{return await paint(supplied,capture);}finally{window.chartEffectDeviceOrigin=previous;}
  },options);
 };
 const actualChartEffects=renderChartEffects;
 renderChartEffects=async function(context,node,rect,paint,...rest){
  const before=context.getTransform(),call={xml:new XMLSerializer().serializeToString(node),rect,part:rest[3]?.chartPartPath,paints:[]};window.chartEffectCalls.push(call);
  await actualChartEffects(context,node,rect,async supplied=>{
   const matrix=supplied.getTransform(),origin=window.chartEffectDeviceOrigin;
   if(!origin)throw Error('Actual raster capture did not report device origin');
   // Independent native transfer uses original incoming CTM and capture origin,
   // without reproducing the viewer's frame decomposition/recomposition.
   const counterCanvas=document.createElement('canvas');counterCanvas.width=supplied.canvas.width;counterCanvas.height=supplied.canvas.height;const counter=counterCanvas.getContext('2d');counter.setTransform(before.a,before.b,before.c,before.d,before.e-origin.x,before.f-origin.y);
   const expected=counter.getTransform();await paint(supplied);await paint(counter);
   const actualPixels=supplied.getImageData(0,0,counterCanvas.width,counterCanvas.height).data,expectedPixels=counter.getImageData(0,0,counterCanvas.width,counterCanvas.height).data;let differentSourceChannels=0;
   for(let i=0;i<actualPixels.length;i++)if(actualPixels[i]!==expectedPixels[i])differentSourceChannels++;
   call.paints.push({differentContext:supplied!==context,deviceOrigin:origin,matrix:['a','b','c','d','e','f'].map(key=>matrix[key]),expectedMatrix:['a','b','c','d','e','f'].map(key=>expected[key]),exactNativeCTM:['a','b','c','d','e','f'].every(key=>matrix[key]===expected[key]),differentSourceChannels,sourceRasterRGBAExact:differentSourceChannels===0});
  },...rest);
  const after=context.getTransform();call.restored=['a','b','c','d','e','f'].every(key=>before[key]===after[key]);
 };
 window.chartEffectAudit={buildSlideCanvas,restoreTheme,drawShapeOnCanvas};`,{transformEntry:entry=>{
  const imported="renderDrawingEffects } from './pptx-effects.js';";
  if(!entry.includes(imported))throw Error('Actual viewer raster import changed; observer must be reviewed');
  return entry.replace(imported,"renderDrawingEffects as actualDrawingEffects } from './pptx-effects.js';");
 }});
 if(process.env.PPTX_CHART_EFFECTS_BUILD_ONLY==='1'){console.log(JSON.stringify({sourceSha256:bundle.sourceSha256,entryTransformApplied:bundle.entryTransformApplied,instrumentedEntrySha256:bundle.instrumentedEntrySha256,changedDependencies:bundle.changedDependencies()}));return;}
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions()),page=await browser.newPage({viewport:{width:1000,height:800}}),exceptions=[];
 page.on('pageerror',error=>exceptions.push(error.message));
 try{
  await initAuditHost(page);await page.setContent('<body></body>');await page.addScriptTag({path:path.join(runtime.repoRoot,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:bundle.content});
  const cases=await page.evaluate(async base64=>{
   const zip=await JSZip.loadAsync(Uint8Array.from(atob(base64),c=>c.charCodeAt(0))),api=window.chartEffectAudit,slidePath='ppt/slides/slide2.xml',size={w:960,h:720};
   const data=await api.buildSlideCanvas(await zip.file(slidePath).async('string'),await zip.file('ppt/slides/_rels/slide2.xml.rels').async('string'),zip,size,[],slidePath);
   const native=data.shapes.find(shape=>shape.type==='chart'&&shape.chartTarget?.endsWith('/chart7.xml'));if(!native)throw Error('Original chart7 relationship did not resolve to native chart shape');
   const cases=[],profiles=[{name:'native frame',rotation:0,group:null,crop:0},{name:'controlled native frame rotation',rotation:31,group:null,crop:0},{name:'controlled native nonuniform affine group',rotation:31,group:[.8,.1,.2,.65,70,40],crop:0},{name:'controlled native group with caller crop',rotation:31,group:[.8,.1,.2,.65,70,40],crop:29}];
   for(const profile of profiles){try{
    const shape={...native,rot:profile.rotation,groupTransform:profile.group||native.groupTransform},paint=async effects=>{
     const canvas=document.createElement('canvas');canvas.width=960;canvas.height=720;const context=canvas.getContext('2d');context.translate(-profile.crop,-profile.crop);
     api.restoreTheme(effects?data.theme:{...data.theme,format:{...data.theme.format,effects:data.theme.format.effects.map(()=>'<a:effectStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:effectLst/></a:effectStyle>')}});
     window.chartEffectCalls.length=0;await api.drawShapeOnCanvas(context,shape,zip,canvas.width,canvas.height,size,1,[],data.slideBgColor);
     return {pixels:context.getImageData(0,0,960,720).data,calls:window.chartEffectCalls.slice(),evidence:shape.chartRenderEvidence};
    };
    const actual=await paint(true),plain=await paint(false);let differentPixels=0;for(let i=0;i<actual.pixels.length;i+=4)if([0,1,2,3].some(channel=>actual.pixels[i+channel]!==plain.pixels[i+channel]))differentPixels++;
    const valid=actual.evidence?.markCount>0&&actual.calls.length===actual.evidence.markCount&&actual.calls.every(call=>call.xml.includes('dist="23000"')&&call.xml.includes('rotWithShape="0"')&&call.restored&&call.paints.length===1&&call.paints.every(p=>p.differentContext&&p.exactNativeCTM&&p.sourceRasterRGBAExact))&&plain.calls.length===0&&differentPixels>0;
    cases.push({name:profile.name,status:valid?'MATCH':'FAIL',differentPixels,evidence:actual.evidence,calls:actual.calls,plainEffectCalls:plain.calls.length,scope:profile.name==='native frame'?'authentic native chart/theme/shape through actual viewer adapter':'controlled derivative retaining native chart/theme; full affine adapter trait'});
   }catch(error){cases.push({name:profile.name,status:'FAIL',error:error.message,stack:error.stack});}}
   return cases;
  },bytes.toString('base64'));
  const changedDependencies=bundle.changedDependencies(),report={cases,exceptions,changedDependencies,sourceSha256:bundle.sourceSha256,entryTransformApplied:bundle.entryTransformApplied,instrumentedEntrySha256:bundle.instrumentedEntrySha256,dependencyHashes:bundle.dependencyHashes,corpusManifestSHA256:corpus.manifestSha256,inputSHA256:runtime.digest(bytes),chartPart:'ppt/charts/chart7.xml',slide:2,fullMicrosoftRenderingAcceptance:'unverified',microsoftEffectPixels:'unverified',passed:cases.length===4&&cases.every(c=>c.status==='MATCH')&&!exceptions.length&&!changedDependencies.length};
  fs.writeFileSync(path.join(runtime.outputDir,'chart-effects-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=2;});
