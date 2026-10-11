'use strict';
// Original internet PPTX and real HTMLVideoElement clock; no synthesized bookmark events.
const fs=require('node:fs'),path=require('node:path');
const runtime=require('./runtime.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const {files}=await loadCorpus({ids:['ChristopherVR__ooxml__media-bookmark-trigger']});
 const input=files[0],bytes=fs.readFileSync(input.path),out=path.join(runtime.outputDir,'bookmark-observations');fs.mkdirSync(out,{recursive:true});
 const bundle=await createViewerBundle(path.join(runtime.repoRoot,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),'window.__slideModels=[];const originalBuild=buildSlideCanvas;buildSlideCanvas=async(...args)=>{const model=await originalBuild(...args);window.__slideModels.push({sourcePath:args[5],playback:model.playback,shapeIds:model.shapes.filter(s=>!s.inherited).map(s=>s.sourceId)});return model;};window.audit={renderPptxViewer,cleanupPptxViewer};');
 const report={timestamp:new Date().toISOString(),inputSha256:runtime.digest(bytes),inputVerification:input.integrity,sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,cases:[],exceptions:[],acceptanceStatus:'unverified',reason:'Exact authored source and actual media/shape observations; Microsoft bookmark playback, waveform and frame comparison remain unverified.'};
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions());
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>report.exceptions.push(String(e)));
  await initAuditHost(page);await page.setContent('<div id="modal"><div id="modalTitle"></div><div id="modalBody" style="width:1200px"></div></div>');
  await page.addStyleTag({path:path.join(runtime.repoRoot,'web/src/assets/app-modals.css')});
  await page.addScriptTag({path:path.join(runtime.repoRoot,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:'window.__auditLogs=[];'+bundle.content});
  report.rawSource=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),zip=await JSZip.loadAsync(bytes),raw=await zip.file('ppt/slides/slide1.xml').async('text'),doc=new DOMParser().parseFromString(raw,'application/xml');return{choiceRequirements:[...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/markup-compatibility/2006','Choice')].map(n=>n.getAttribute('Requires')),bookmarkEvents:[...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','cond')].filter(n=>n.getAttribute('evt')==='onMediaBookmark').map(n=>({event:n.getAttribute('evt'),targets:[...n.getElementsByTagNameNS('http://schemas.microsoft.com/office/powerpoint/2010/main','bmkTgt')].map(t=>({namespace:t.namespaceURI,shapeId:t.getAttribute('spid'),bookmark:t.getAttribute('bmkName')}))}))};},bytes.toString('base64'));
  await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));await window.audit.renderPptxViewer({blob:new Blob([bytes]),name:'media-bookmark-trigger.pptx',modalApi:{}});},bytes.toString('base64'));
  const loadError=await page.evaluate(()=>document.getElementById('modalBody').pptxError||null);if(loadError)throw new Error(JSON.stringify(loadError));
  report.models=await page.evaluate(()=>window.__slideModels);
  const conditions=[];const visit=n=>{conditions.push(...(n.start||[]),...(n.end||[]),...(n.next||[]),...(n.previous||[]));for(const c of [...(n.children||[]),...(n.subChildren||[])])visit(c);};for(const n of report.models[0]?.playback?.timeline||[])visit(n);
  const bookmarks=report.models[0]?.playback?.media?.find(m=>m.shapeId==='2')?.bookmarks||[];
  report.cases.push({id:'original-p14-choice-contains-native-bookmark-conditions',matchesTrait:report.rawSource.choiceRequirements.includes('p14')&&report.rawSource.bookmarkEvents.length===2&&report.rawSource.bookmarkEvents.every(c=>c.targets.some(t=>t.shapeId==='2'&&t.bookmark==='BM1'))});
  report.cases.push({id:'full-viewer-retains-bookmark-choice-start-and-next',matchesTrait:conditions.filter(c=>c.event==='onMediaBookmark'&&c.shapeId==='2'&&c.bookmark==='BM1').length===2});
  report.cases.push({id:'full-viewer-retains-original-media-bookmarks',matchesTrait:bookmarks.length===2&&bookmarks.some(b=>b.name==='BM1'&&b.time===0.5)&&bookmarks.some(b=>b.name==='BM2'&&b.time===1.5)});
  await page.evaluate(()=>{window.__bookmarkFrames=[];window.__bookmarkEvents=[];window.__observeRunning=true;const slide=document.querySelector('.pptx-slide');for(const name of ['BM1','BM2'])slide.addEventListener('pptxbookmark:2:'+name,()=>window.__bookmarkEvents.push({name,time:slide.querySelector('video')?.currentTime,at:performance.now()}));const observe=()=>{if(!window.__observeRunning)return;const video=slide.querySelector('video'),shape=slide.querySelector('[data-pptx-shape-id="3"]');let visible=!!shape,opacity=1;for(let n=shape;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);opacity*=Number(s.opacity);if(s.display==='none'||s.visibility==='hidden')visible=false;}window.__bookmarkFrames.push({at:performance.now(),currentTime:video?.currentTime,paused:video?.paused,ended:video?.ended,readyState:video?.readyState,videoWidth:video?.videoWidth,videoHeight:video?.videoHeight,error:video?.error?.code??null,targetExists:!!shape,visible,opacity});requestAnimationFrame(observe);};observe();});
  await page.click('#pptxPlay');await page.waitForTimeout(100);await page.click('#pptxNext');
  await page.waitForTimeout(3700);
  report.observed=await page.evaluate(()=>{window.__observeRunning=false;return{frames:window.__bookmarkFrames,events:window.__bookmarkEvents,failures:window.__auditLogs.filter(e=>e.pptxPlaybackFailure).map(e=>e.pptxPlaybackFailure),logs:window.__auditLogs};});
  await page.locator('.pptx-slide').first().screenshot({path:path.join(out,'after-native-bookmarks.png')});
  const frames=report.observed.frames,before=frames.filter(f=>!f.paused&&f.currentTime>0.05&&f.currentTime<0.45),during=frames.filter(f=>f.currentTime>0.55&&f.currentTime<0.95),after=frames.filter(f=>f.currentTime>1.2&&f.currentTime<2.5);
  report.cases.push({id:'embedded-native-video-decodes-and-progresses',matchesTrait:frames.some(f=>f.currentTime>1.6&&f.readyState>=2&&f.videoWidth===320&&f.videoHeight===240)&&frames.every(f=>f.error===null)});
  report.cases.push({id:'original-bookmark-target-hidden-before-500ms',matchesTrait:before.length>0&&before.every(f=>f.targetExists&&(!f.visible||f.opacity===0))});
  report.cases.push({id:'original-500ms-bookmark-triggers-real-fade',matchesTrait:report.observed.events.some(e=>e.name==='BM1'&&e.time>=0.5)&&during.some(f=>f.visible&&f.opacity>0&&f.opacity<1)});
  report.cases.push({id:'authored-fade-target-visible-after-one-second',matchesTrait:after.length>0&&after.every(f=>f.visible&&f.opacity===1)});
  await page.evaluate(()=>window.audit.cleanupPptxViewer());
  if(report.cases.some(c=>!c.matchesTrait)||report.observed.failures.length||report.exceptions.length)report.acceptanceStatus='fail';
 }catch(e){report.exceptions.push(String(e.stack||e));report.acceptanceStatus='fail';}
 finally{await browser.close();}
 report.changedDependencies=bundle.changedDependencies();if(report.changedDependencies.length)report.acceptanceStatus='invalid-source-changed';
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.acceptanceStatus,cases:report.cases,exceptions:report.exceptions,changedDependencies:report.changedDependencies}));
 process.exitCode=report.acceptanceStatus==='unverified'?3:1;
})().catch(e=>{console.error(e);process.exitCode=2;});
