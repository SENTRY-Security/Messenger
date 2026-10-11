'use strict';
// Timed observations of actual internet-authored glyph animation, not a Microsoft oracle.
const fs=require('node:fs'),path=require('node:path');
const runtime=require('./runtime.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const {files}=await loadCorpus({ids:['LibreOffice__core__subtitle-animation-save']});
 const input=files[0],bytes=fs.readFileSync(input.path),out=path.join(runtime.outputDir,'subtitle-observations');fs.mkdirSync(out,{recursive:true});
 const bundle=await createViewerBundle(path.join(runtime.repoRoot,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),'window.audit={renderPptxViewer,cleanupPptxViewer};');
 const report={timestamp:new Date().toISOString(),inputSha256:runtime.digest(bytes),inputVerification:input.integrity,sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,frames:[],exceptions:[],acceptanceStatus:'unverified',reason:'Real viewer glyph/time/frame observations; Microsoft timing and frame baseline missing.'};
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions());
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>report.exceptions.push(String(e)));
  await initAuditHost(page);await page.setContent('<div id="modal"><div id="modalTitle"></div><div id="modalBody" style="width:1200px"></div></div>');
  await page.addStyleTag({path:path.join(runtime.repoRoot,'web/src/assets/app-modals.css')});
  await page.addScriptTag({path:path.join(runtime.repoRoot,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:'window.__auditLogs=[];'+bundle.content});
  await page.evaluate(async base64=>{const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));await window.audit.renderPptxViewer({blob:new Blob([data]),name:'subtitle-animation-save.pptx',modalApi:{}});},bytes.toString('base64'));
  const loadingError=await page.evaluate(()=>document.getElementById('modalBody').pptxError||null);if(loadingError)throw new Error(JSON.stringify(loadingError));
  await page.evaluate(()=>{document.querySelector('#pptxPlay').click();window.__playStarted=performance.now();});
  for(const atMs of [100,900,1100,1500,2100,2500,3500]){
   await page.evaluate(async target=>{const remaining=target-(performance.now()-window.__playStarted);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));},atMs);
   const frame=await page.evaluate(()=>({elapsedMs:performance.now()-window.__playStarted,page:document.querySelector('#pptxPageLabel')?.textContent,shapes:[...document.querySelectorAll('.pptx-shape-layers [data-pptx-shape-id]')].filter(s=>['2','3'].includes(s.dataset.pptxShapeId)).map(shape=>({id:shape.dataset.pptxShapeId,glyphs:[...shape.querySelectorAll('[data-pptx-glyph-index]')].map(e=>{let opacity=1,visible=true;for(let node=e;node&&node!==document.body;node=node.parentElement){const style=getComputedStyle(node);opacity*=Number(style.opacity);if(style.display==='none'||style.visibility==='hidden')visible=false;}return{index:Number(e.dataset.pptxGlyphIndex),opacity,visible,animations:e.getAnimations().map(a=>({currentTime:a.currentTime,playState:a.playState}))};})})),failures:window.__auditLogs.filter(e=>e.pptxPlaybackFailure).map(e=>e.pptxPlaybackFailure)}));
   frame.targetMs=atMs;frame.screenshot=path.join(out,`frame-${atMs}.png`);await page.locator('.pptx-slide').first().screenshot({path:frame.screenshot});report.frames.push(frame);
  }
  await page.evaluate(()=>window.audit.cleanupPptxViewer());
  const first=report.frames[0],last=report.frames.at(-1);
  report.observations={glyphCounts:first.shapes.map(s=>({id:s.id,count:s.glyphs.length})),initialHidden:first.shapes.every(s=>s.glyphs.every(g=>!g.visible||g.opacity===0)),finalVisible:last.shapes.every(s=>s.glyphs.every(g=>g.visible&&g.opacity===1)),individualIntermediateOpacity:report.frames.some(f=>f.shapes.some(s=>s.glyphs.some(g=>g.opacity>0&&g.opacity<1))),runtimeFailures:report.frames.flatMap(f=>f.failures)};
  report.cases=[
   {id:'authored-delayed-glyphs-hidden-before-one-second',matchesTrait:report.observations.initialHidden},
   {id:'authored-per-letter-fade-produces-intermediate-opacity',matchesTrait:report.observations.individualIntermediateOpacity},
   {id:'authored-title-subtitle-visible-after-delays-and-iteration',matchesTrait:report.observations.finalVisible}
  ];
  if(report.cases.some(c=>!c.matchesTrait)||report.observations.runtimeFailures.length||report.exceptions.length)report.acceptanceStatus='fail';
  if(!first.shapes.length||first.shapes.some(s=>!s.glyphs.length))throw new Error('Actual glyph targets missing');
 }catch(e){report.exceptions.push(String(e.stack||e));report.acceptanceStatus='fail';}
 finally{await browser.close();}
 report.changedDependencies=bundle.changedDependencies();if(report.changedDependencies.length)report.acceptanceStatus='invalid-source-changed';
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.acceptanceStatus,observations:report.observations,exceptions:report.exceptions,changedDependencies:report.changedDependencies}));
 process.exitCode=report.acceptanceStatus==='unverified'?3:1;
})().catch(e=>{console.error(e);process.exitCode=2;});
