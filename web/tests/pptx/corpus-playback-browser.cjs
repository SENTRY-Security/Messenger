const __pptxRuntime=require('./runtime.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {chromium}=__pptxRuntime.playwright();
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
const root=__pptxRuntime.repoRoot,out=process.env.PPTX_PLAYBACK_RESULTS_DIR||path.join(__pptxRuntime.outputDir,'corpus-playback-results');
const sha=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const verified=await loadCorpus();const {manifestBytes}=verified;const manifest={files:verified.files};
 const requested=process.argv.slice(2);
 const selected=manifest.files.filter(f=>f.features.timing||f.features.transition||f.features.media_relationships||f.features.audio_relationships||f.features.video_relationships).filter(f=>!requested.length||requested.includes(f.id)||requested.includes(f.file));
 if(!selected.length||requested.some(id=>!selected.some(f=>f.id===id||f.file===id)))throw new Error('No authored playback documents, unknown ID or nonplayback document selected');
 const bundle=await createViewerBundle(path.join(root,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),`window.__slideModels=[];const buildNative=buildSlideCanvas;buildSlideCanvas=async(...args)=>{const data=await buildNative(...args);window.__slideModels.push({sourcePath:args[5],playback:data.playback,shapeIds:data.shapes.filter(s=>!s.inherited).map(s=>s.sourceId??null)});return data;};window.audit={renderPptxViewer,cleanupPptxViewer};`);
 const browser=await chromium.launch(__pptxRuntime.launchOptions());
 const report={issue:'SEN-2600',timestamp:new Date().toISOString(),sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,bundleSha256:bundle.bundleSha256,manifestSha256:sha(manifestBytes),documents:[],acceptanceStatus:'unverified',scope:'Real downloaded corpus entry playback and visible failure logging; no Microsoft frame/timing baseline. Lack of runtime exceptions is never a conformance pass.'};
 try{for(const input of selected){
  const bytes=fs.readFileSync(input.path),dir=path.join(out,input.id);fs.mkdirSync(dir,{recursive:true});
  const doc={file:input.file,id:input.id,inputSha256:sha(bytes),inputVerification:input.integrity,expectedManifestSha256:input.sha256,sourceUrl:input.raw_url||input.source_url,slides:[],exceptions:[],console:[],conformanceStatus:'unverified'};
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>doc.exceptions.push(String(e.stack||e)));page.on('console',m=>doc.console.push({type:m.type(),text:m.text()}));
  try{
   if(doc.inputSha256!==doc.expectedManifestSha256)throw new Error('Corpus bytes differ from pinned provenance');
   await initAuditHost(page);await page.setContent('<div id="modal"><div id="modalTitle"></div><div id="modalBody" style="width:1200px"></div></div>');
   await page.addScriptTag({path:path.join(root,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:'window.__auditLogs=[];'+bundle.content});
   await page.evaluate(async base64=>{window.__created=[];window.__revoked=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);window.__created.push(u);return u;};URL.revokeObjectURL=u=>{window.__revoked.push(u);revoke(u);};const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));return window.audit.renderPptxViewer({blob:new Blob([data]),name:'online-corpus.pptx',modalApi:{}});},bytes.toString('base64'));
   doc.models=await page.evaluate(()=>window.__slideModels);doc.fontDiagnostics=await page.evaluate(()=>document.getElementById('modalBody').pptxFontDiagnostics||[]);
   const loadError=await page.evaluate(()=>document.getElementById('modalBody').pptxError||null);
   if(loadError)throw new Error('Viewer failed loading actual corpus: '+JSON.stringify(loadError));
   if(doc.models.length!==input.features.slides)throw new Error(`Missing slide models: ${doc.models.length}/${input.features.slides}`);
   const firstStartLog=await page.evaluate(()=>window.__auditLogs.length);
   // A public Play click starts asynchronous layer/media preparation. The initial
   // static label is a count, not a page number; never use Next to await page 1.
   const waitPublicReady=async expected=>page.waitForFunction(expected=>{
    const label=document.querySelector('#pptxPageLabel')?.textContent||'';
    const match=label.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if(!match||expected!==null&&Number(match[1])!==expected)return false;
    const slides=[...document.querySelectorAll('.pptx-slide')];
    const visible=slides.filter(s=>getComputedStyle(s).display!=='none');
    const current=slides[Number(match[1])-1];
    return visible.length===1&&visible[0]===current&&getComputedStyle(current).visibility==='visible'&&current.getAnimations().length===0;
   },expected,{timeout:20000});
   const initialActivationStarted=Date.now();
   await page.click('#pptxPlay');
   await waitPublicReady(1);
   doc.initialPublicActivationWaitMs=Date.now()-initialActivationStarted;
   for(let index=0;index<doc.models.length;index++){
    let logStart=index===0?firstStartLog:await page.evaluate(()=>window.__auditLogs.length);
    const pageNumber=()=>page.evaluate(()=>Number((document.querySelector('#pptxPageLabel')?.textContent||'').split('/')[0]));
    const navigation=[];
    for(let attempt=0;await pageNumber()!==index+1;attempt++){
     const before=await pageNumber();
     if(before>index+1||attempt>=200)throw new Error(`Authored navigation did not reach slide ${index+1}; current ${before}; clicks ${attempt}`);
     const navigationLogStart=await page.evaluate(()=>window.__auditLogs.length);
     const navigationStarted=Date.now();
     await page.click('#pptxNext');await waitPublicReady(null);await page.waitForTimeout(120);
     const after=await pageNumber();
     const runtimeFailures=await page.evaluate(start=>window.__auditLogs.slice(start).filter(e=>e.pptxPlaybackFailure).map(e=>e.pptxPlaybackFailure),navigationLogStart);
     navigation.push({before,after,click:attempt+1,publicActivationWaitMs:Date.now()-navigationStarted,runtimeFailures,attribution:before===after?'current authored slide':'navigation interval spans previous and destination slide; not assigned exclusively'});
     logStart=await page.evaluate(()=>window.__auditLogs.length);
    }
    const authoredDuration=index===0?0:doc.models[index].playback?.transition?.duration||0;
    const waitMs=Math.min(10000,Math.max(250,Number(authoredDuration)+150));await page.waitForTimeout(waitMs);
    // The page label changes before real layer preparation and transition begin.
    // Preserve the nominal observation; wait for actual completion without hiding either slide.
    const nominalVisibleSlideIndices=await page.evaluate(()=>[...document.querySelectorAll('.pptx-slide')].flatMap((s,i)=>getComputedStyle(s).display==='none'?[]:[i+1]));
    const settleStarted=Date.now();
    await page.waitForFunction(index=>{const visible=[...document.querySelectorAll('.pptx-slide')].flatMap((s,i)=>getComputedStyle(s).display==='none'?[]:[i+1]);return visible.length===1&&visible[0]===index+1;},index,{timeout:10000});
    const extraSettlementWaitMs=Date.now()-settleStarted;
    const observed=await page.evaluate(({index,logStart})=>{const slide=document.querySelectorAll('.pptx-slide')[index];return{display:slide?getComputedStyle(slide).display:null,visibleSlideIndices:[...document.querySelectorAll('.pptx-slide')].flatMap((s,i)=>getComputedStyle(s).display==='none'?[]:[i+1]),conformance:slide?.dataset.pptxConformance,visibleWarnings:slide?[...slide.querySelectorAll('.pptx-playback-failure')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent):[],runtimeFailures:window.__auditLogs.slice(logStart).filter(e=>e.pptxPlaybackFailure).map(e=>e.pptxPlaybackFailure),media:slide?[...slide.querySelectorAll('audio,video')].map(e=>({kind:e.tagName,src:e.currentSrc,readyState:e.readyState,currentTime:e.currentTime,duration:Number.isFinite(e.duration)?e.duration:null,paused:e.paused,error:e.error?.code??null})):[]};},{index,logStart});
    const parseFailures=doc.models[index].playback?.failures||[];
    const slide={number:index+1,observedPageNumber:await pageNumber(),navigation,sourcePath:doc.models[index].sourcePath,authoredDuration,observationWaitMs:waitMs,nominalVisibleSlideIndices,extraSettlementWaitMs,settlementTimingStatus:'unverified-no-Microsoft-preparation-and-transition-baseline',parseFailures,...observed,conformanceStatus:parseFailures.length||observed.runtimeFailures.length||observed.conformance==='failed'||observed.visibleWarnings.length||observed.media.some(e=>e.error)?'fail':'unverified',frameBaseline:'missing'};
    if(slide.observedPageNumber!==index+1||slide.display==='none'||slide.visibleSlideIndices.length!==1||slide.visibleSlideIndices[0]!==index+1)throw new Error(`Observed slide differs from authored page ${index+1}; visible ${slide.visibleSlideIndices}`);
    await page.screenshot({path:path.join(dir,`slide-${String(index+1).padStart(3,'0')}.png`)});doc.slides.push(slide);
   }
   await page.evaluate(()=>window.audit.cleanupPptxViewer());doc.cleanup=await page.evaluate(()=>({unrevokedUrls:window.__created.filter(u=>!window.__revoked.includes(u)),remainingMedia:document.querySelectorAll('audio,video').length}));
   if(doc.exceptions.length||doc.fontDiagnostics.some(d=>d.code==='fallback-font-load-failed'||d.code==='embedded-font-load-failed')||doc.slides.some(s=>s.conformanceStatus==='fail'||s.navigation.some(n=>n.runtimeFailures.length))||doc.cleanup.unrevokedUrls.length||doc.cleanup.remainingMedia)doc.conformanceStatus='fail';
  }catch(e){doc.exceptions.push(String(e.stack||e));doc.conformanceStatus='fail';try{doc.finalLogs=await page.evaluate(()=>window.__auditLogs);fs.writeFileSync(path.join(dir,'exception-dom.html'),await page.content());await page.screenshot({path:path.join(dir,'exception.png')});}catch{}}
  finally{await context.close();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(doc,null,2)+'\n');report.documents.push(doc);}
  console.log(`${doc.conformanceStatus.toUpperCase()} ${doc.file}: ${doc.slides.filter(s=>s.conformanceStatus==='fail').length}/${doc.slides.length} slides observed failure; ${doc.exceptions.length} exceptions`);
 }}finally{await browser.close();}
 report.changedDependencies=bundle.changedDependencies();report.sourceVerificationStatus=report.changedDependencies.length?'invalid-source-changed':'immutable-snapshot';report.acceptanceStatus=report.changedDependencies.length?'fail':report.documents.some(d=>d.conformanceStatus==='fail')?'fail':'unverified';
 report.failureGroups={};for(const doc of report.documents)for(const slide of doc.slides)for(const f of slide.parseFailures){const group=report.failureGroups[f.code]??={count:0,examples:[]};group.count++;if(group.examples.length<8)group.examples.push({file:doc.file,slide:slide.number,detail:f.detail});}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 const lines=[`SEN-2600 網路 PPTX 播放觀察：${report.acceptanceStatus}`,`來源 ${report.sourceSha256}`,`文件 ${report.documents.length}；投影片 ${report.documents.reduce((n,d)=>n+d.slides.length,0)}`,`Microsoft 視覺／時序 baseline 缺失；任何未觀察到故障的頁面仍為未驗收。`,''];
 for(const [code,g]of Object.entries(report.failureGroups))lines.push(`${code}: ${g.count}`, ...g.examples.map(e=>`  ${e.file} 第 ${e.slide} 頁 ${JSON.stringify(e.detail)}`));
 for(const d of report.documents)if(d.exceptions.length)lines.push(`${d.file}: ${d.exceptions.join('\n')}`);
 fs.writeFileSync(path.join(out,'failures.txt'),lines.join('\n')+'\n');
 process.exitCode=report.changedDependencies.length?2:report.acceptanceStatus==='fail'?1:3;
})().catch(e=>{console.error(e);process.exitCode=2;});
