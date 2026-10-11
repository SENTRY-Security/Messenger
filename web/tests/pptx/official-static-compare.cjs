const __pptxRuntime=require('./runtime.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {chromium}=__pptxRuntime.playwright();
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
const {comparePng}=require('./corpus-render.cjs');
const root=__pptxRuntime.repoRoot,baselineRoot=path.resolve(process.env.PPTX_OFFICE_BASELINES_DIR||path.join(__pptxRuntime.outputDir,'office-static-baselines')),out=path.join(__pptxRuntime.outputDir,'office-static-comparisons');
const sha=b=>createHash('sha256').update(b).digest('hex');
const argumentsList=process.argv.slice(2),ids=argumentsList.filter(s=>!s.startsWith('--'));
if(argumentsList.some(s=>s.startsWith('--')&&s!=='--desktop-only'))throw new Error('Unknown Microsoft comparison option');
const profiles=argumentsList.includes('--desktop-only')?['desktop']:['desktop','mobile'];
function validateProvenance(meta,input,dir){
 const errors=[];
 const fail=(test,message)=>{if(!test)errors.push(message);};
 fail(meta.engine==='Microsoft Office Online public PowerPoint viewer','Unexpected renderer engine');
 fail(meta.result==='all-static-pages-captured','Capture incomplete or failed');
 fail(meta.sourceSHA256===input.sha256&&sha(fs.readFileSync(input.path))===input.sha256,'Source SHA256 differs');
 fail(meta.sourceURL===input.raw_url&&meta.sourceCommit===input.source_commit,'Pinned source URL/commit differs');
 let hostname;try{hostname=new URL(meta.frameOrigin).hostname;}catch{}
 fail(!!hostname&&/(^|\.)officeapps\.live\.com$/.test(hostname)&&/powerpoint/i.test(hostname),'Origin is not Microsoft PowerPoint viewer');
 fail(meta.deviceScaleFactor===1,'This renderer comparison requires actual capture DPR 1');
 fail(meta.expectedSlides===input.features.slides&&meta.slides?.length===input.features.slides,'Expected page count differs');
 const seen=new Set();
 for(const [index,slide] of (meta.slides||[]).entries()){
  fail(slide.slideNumber===index+1&&slide.microsoftCounter===index+1&&slide.microsoftTotal===meta.expectedSlides,'Slide counter/order differs');
  fail(!seen.has(slide.file),'Duplicate PNG path');seen.add(slide.file);
  fail(slide.exactCanvasCrop===true&&slide.postCaptureResampling===false,'Canvas crop/resampling provenance invalid');
  const file=path.resolve(dir,slide.file||'');
  fail(file.startsWith(path.resolve(dir)+path.sep)&&fs.existsSync(file),'PNG missing or outside baseline directory');
  if(fs.existsSync(file)&&file.startsWith(path.resolve(dir)+path.sep)){
   const bytes=fs.readFileSync(file);fail(sha(bytes)===slide.sha256,'PNG SHA256 differs');
   fail(bytes.readUInt32BE(16)===slide.pixelWidth&&bytes.readUInt32BE(20)===slide.pixelHeight,'PNG pixel dimensions differ from provenance');
  }
 }
 return errors;
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const verified=await loadCorpus(ids.length?{ids}:{});const {manifestBytes,files}=verified;
 if(!files.length||ids.some(id=>!files.some(f=>f.id===id)))throw new Error('No matching corpus input or unknown requested specimen ID');
 const bundle=await createViewerBundle(path.join(root,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),`
 window.__auditParsedSlides=[];
 const originalAuditBuild=buildSlideCanvas;
 buildSlideCanvas=async(...args)=>{const slide=await originalAuditBuild(...args);window.__auditParsedSlides.push(slide);return slide;};
 window.audit={renderPptxViewer,cleanupPptxViewer};`);
 const report={issue:'SEN-2600',timestamp:new Date().toISOString(),sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,bundleSha256:bundle.bundleSha256,manifestSha256:sha(manifestBytes),comparisonPolicy:'Exact RGBA/dimensions; renderer target width is actual captured PNG width; no baseline or renderer image is resized',playbackStatus:'unverified',documents:[]};
 const browser=await chromium.launch(__pptxRuntime.launchOptions());
 try{for(const input of files)for(const profile of profiles){
  const baselineDir=path.join(baselineRoot,input.id,profile),provenancePath=path.join(baselineDir,'provenance.json');
  const dir=path.join(out,input.id,profile);fs.mkdirSync(dir,{recursive:true});
  if(!fs.existsSync(provenancePath)){
   const doc={id:input.id,file:input.file,profile,inputSha256:sha(fs.readFileSync(input.path)),inputVerification:input.integrity,expectedCount:input.features.slides,baselineProvenancePath:provenancePath,baselineStatus:'unavailable',baselineReason:'No official Microsoft reference has been captured for this document/profile',contentIdentityStatus:'unverified',pixelStatus:'unverified',acceptanceStatus:'unverified',exceptions:[],slides:[]};
   report.documents.push(doc);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(doc,null,2)+'\n');continue;
  }
  const metaBytes=fs.readFileSync(provenancePath),meta=JSON.parse(metaBytes);
  const doc={id:input.id,file:input.file,profile,inputSha256:sha(fs.readFileSync(input.path)),inputVerification:input.integrity,baselineProvenancePath:provenancePath,baselineProvenanceSha256:sha(metaBytes),baselineStatus:meta.result==='all-static-pages-captured'?'captured':'unavailable',baselineReason:meta.result==='all-static-pages-captured'?null:meta.failure||meta.result,provenanceErrors:validateProvenance(meta,input,baselineDir),contentIdentityStatus:meta.contentIdentityVerified===true&&!!meta.contentIdentityEvidence?'verified':'unverified',contentIdentityEvidence:meta.contentIdentityEvidence||null,pixelStatus:'unverified',acceptanceStatus:'unverified',exceptions:[],logs:[],slides:[]};
  if(doc.provenanceErrors.length){report.documents.push(doc);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(doc,null,2));continue;}
  const width=meta.slides[0].pixelWidth;
  const context=await browser.newContext({viewport:{width:Math.max(width,390),height:900},deviceScaleFactor:1}),page=await context.newPage();
  page.on('pageerror',e=>doc.exceptions.push(String(e.stack||e)));
  try{
   await initAuditHost(page);await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><div id="modal"><div id="modalTitle"></div><div id="modalBody" style="width:${width}px"></div></div>`);
   await page.addScriptTag({path:path.join(root,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:'window.__auditLogs=[];'+bundle.content});
   const rendering=await page.evaluate(async base64=>{const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const viewerReturned=await window.audit.renderPptxViewer({blob:new Blob([data]),name:'Microsoft exact comparison',modalApi:{}});await document.fonts.ready;return{viewerReturned,fontDiagnostics:document.getElementById('modalBody').pptxFontDiagnostics||[],logs:window.__auditLogs,parsedSlideObservations:window.__auditParsedSlides.map((s,i)=>({number:i+1,shapes:s.shapes.map(shape=>({type:shape.type,sourceId:shape.sourceId,inherited:!!shape.inherited,chartTarget:shape.chartTarget||null,chartRenderEvidence:shape.chartRenderEvidence||null}))})),slides:[...document.querySelectorAll('.pptx-slide-canvas')].map(c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight,png:c.toDataURL('image/png')}))};},fs.readFileSync(input.path).toString('base64'));
   doc.viewerReturned=rendering.viewerReturned;doc.parsedSlideObservations=rendering.parsedSlideObservations;doc.logs=rendering.logs;doc.fontDiagnostics=rendering.fontDiagnostics;doc.actualCount=rendering.slides.length;doc.expectedCount=meta.expectedSlides;doc.targetWidth=width;
   for(const [index,slide]of rendering.slides.entries()){
    const expected=meta.slides[index],file=`slide-${String(index+1).padStart(3,'0')}.png`,actual=path.join(dir,file),bytes=Buffer.from(slide.png.split(',')[1],'base64');delete slide.png;fs.writeFileSync(actual,bytes);
    const comparison=expected?comparePng(actual,path.join(baselineDir,expected.file),path.join(dir,`slide-${String(index+1).padStart(3,'0')}-diff.png`)):{status:'unverified',reason:'No corresponding Microsoft baseline page'};
    doc.slides.push({number:index+1,...slide,actualPng:actual,actualPngSha256:sha(bytes),baselinePng:expected?path.join(baselineDir,expected.file):null,baselinePngSha256:expected?.sha256,baselineCanvasBacking:expected?.canvasBacking,baselineCssBox:expected?.cssBox,comparison});
   }
   doc.pixelStatus=doc.viewerReturned!==true||doc.actualCount===0||doc.exceptions.length||doc.logs.length||doc.fontDiagnostics.some(d=>d.code==='fallback-font-load-failed'||d.code==='embedded-font-load-failed')||doc.actualCount!==doc.expectedCount||doc.slides.some(s=>s.comparison.status==='fail')?'fail':doc.slides.every(s=>s.comparison.status==='pass')?'pass':'unverified';
   // A candidate frame cannot certify equivalence even when pixels happen to agree.
   doc.acceptanceStatus=doc.contentIdentityStatus==='verified'?doc.pixelStatus:'unverified';
   await page.evaluate(()=>window.audit.cleanupPptxViewer());
  }catch(e){doc.exceptions.push(String(e.stack||e));doc.pixelStatus='fail';doc.acceptanceStatus='fail';}
  finally{await context.close();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(doc,null,2)+'\n');report.documents.push(doc);}
  console.log(`${doc.pixelStatus.toUpperCase()} exact pixels / ${doc.contentIdentityStatus.toUpperCase()} baseline identity: ${input.id} ${profile}`);
 }}finally{await browser.close();}
 report.changedDependencies=bundle.changedDependencies();
 report.status=report.documents.some(d=>d.acceptanceStatus==='fail')?'fail':'unverified';
 report.pixelStatus=report.documents.some(d=>d.pixelStatus==='fail')?'fail':report.documents.length&&report.documents.every(d=>d.pixelStatus==='pass')?'pass':'unverified';
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 process.exitCode=report.changedDependencies.length?2:report.status==='fail'||report.pixelStatus==='fail'?1:3;
})().catch(e=>{console.error(e);process.exitCode=2;});
