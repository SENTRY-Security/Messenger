#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),runtime=require('./runtime.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const out=path.join(runtime.outputDir,'viewer-frame-results');fs.mkdirSync(out,{recursive:true});
 const cssPath=path.join(runtime.repoRoot,'web/src/assets/app-modals.css'),css=fs.readFileSync(cssPath,'utf8'),cssSha256=crypto.createHash('sha256').update(css).digest('hex');
 const bundle=await createViewerBundle(path.join(runtime.repoRoot,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),'window.frameAudit={renderPptxViewer,cleanupPptxViewer};'),browser=await runtime.playwright().chromium.launch(runtime.launchOptions()),cases=[],exceptions=[];
 try{for(const width of [1200,390]){
  const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});page.on('pageerror',e=>exceptions.push({width,error:e.message}));
  try{
   await initAuditHost(page);await page.setContent('<body><div id="modal" class="modal" style="display:flex"><div class="modal-backdrop"></div><div class="modal-panel"><div class="modal-head"><span id="modalTitle"></span></div><div id="modalBody" class="modal-body"></div></div></div></body>');
   await page.addStyleTag({content:css});await page.addScriptTag({path:path.join(runtime.repoRoot,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:bundle.content});
   await page.evaluate(async()=>{
    const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',attrs=`xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`,zip=new JSZip();
    zip.file('ppt/presentation.xml',`<p:presentation ${attrs}><p:sldIdLst><p:sldId id="256" r:id="s1"/><p:sldId id="257" r:id="s2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s1" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="s2" Type="${R}/slide" Target="slides/slide2.xml"/></Relationships>`);
    for(let i=1;i<=2;i++)zip.file(`ppt/slides/slide${i}.xml`,`<p:sld ${attrs}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Frame target"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${i===1?'FF0000':'0000FF'}"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`);
    const rendered=await window.frameAudit.renderPptxViewer({blob:new Blob([await zip.generateAsync({type:'uint8array'})]),name:'native-ratio-16-9.pptx',modalApi:{closeModal(){}}});if(!rendered)throw Error('Viewer entry failed');
   });
   const inspect=()=>page.evaluate(()=>{
    const box=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};},slide=[...document.querySelectorAll('.pptx-slide')].find(e=>getComputedStyle(e).display!=='none');
    return {frames:document.querySelectorAll('.pptx-presentation-frame').length,wrappers:document.querySelectorAll('.pptx-slide').length,stage:box(document.querySelector('.pptx-stage')),frame:box(document.querySelector('.pptx-presentation-frame')),wrapper:box(slide),canvas:box(slide?.querySelector('.pptx-slide-canvas')),host:box(slide?.querySelector('.pptx-shape-layers')),hosts:[...document.querySelectorAll('.pptx-slide')].map(e=>e.querySelectorAll('.pptx-shape-layers').length),parents:[...document.querySelectorAll('.pptx-slide')].map(e=>e.parentElement.className)};
   });
   const record=(name,state,playing)=>{
    // CSS layout uses a 1/64 CSS-pixel grid. This is a geometry rounding bound,
    // not an RGBA tolerance or a Microsoft screenshot acceptance threshold.
    const epsilon=1/64,fields=playing?['frame','wrapper','canvas','host']:['wrapper','canvas'],errors=[];
    if(state.frames!==(playing?1:0))errors.push('Duplicate or missing presentation frame');
    for(const key of fields){const b=state[key];if(!b||!(b.width>0&&b.height>0)||Math.abs(b.height-b.width*9/16)>epsilon)errors.push(key+' violates authored 16:9');}
    if(playing){for(const key of ['wrapper','canvas','host'])for(const axis of ['x','y','width','height'])if(Math.abs(state[key]?.[axis]-state.frame?.[axis])>epsilon)errors.push(key+' mismatches frame '+axis);if(state.hosts.some(n=>n>1)||!state.host)errors.push('Duplicate/missing active layer host');}
    else if(state.parents.some(c=>c!=='pptx-stage'))errors.push('Stop did not restore slide wrappers to stage');
    cases.push({name,width,status:errors.length?'FAIL':'MATCH',errors,evidence:state});
   };
   await page.click('#pptxPlay');await page.waitForFunction(()=>{const h=document.querySelector('.pptx-shape-layers');return h&&getComputedStyle(h).display!=='none';});record('play uses authored canvas/frame/host ratio',await inspect(),true);await page.screenshot({path:path.join(out,`${width}-play.png`)});
   await page.click('#pptxStop');await page.waitForFunction(()=>!document.querySelector('.pptx-presentation-frame'));record('stop removes frame and restores slide order',await inspect(),false);
   await page.click('#pptxPlay');await page.waitForFunction(()=>{const h=document.querySelector('.pptx-shape-layers');return h&&getComputedStyle(h).display!=='none';});record('replay retains one frame and one host per slide',await inspect(),true);
   await page.evaluate(()=>window.frameAudit.cleanupPptxViewer());
  }catch(error){cases.push({name:'true app CSS viewer entry',width,status:'FAIL',error:error.message});}finally{await page.close();}
 }}finally{await browser.close();}
 const changedDependencies=bundle.changedDependencies(),currentCssHash=crypto.createHash('sha256').update(fs.readFileSync(cssPath)).digest('hex'),report={cases,exceptions,sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,cssSha256,changedDependencies,acceptanceStatus:'unverified',scope:'Actual app-modals.css and viewer entry at desktop1200/mobile390; authored16:9 geometry and stop/replay cleanup',operationalStatus:cases.every(c=>c.status==='MATCH')&&!exceptions.length&&!changedDependencies.length&&cssSha256===currentCssHash?'pass':'fail'};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:cases.length,failures:cases.filter(c=>c.status==='FAIL'),exceptions,status:report.operationalStatus}));process.exitCode=report.operationalStatus==='pass'?3:1;
})().catch(error=>{console.error(error);process.exitCode=2;});
