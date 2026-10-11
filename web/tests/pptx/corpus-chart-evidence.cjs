'use strict';
// Original PPTX inputs: prove real ChartEx paint, never fallback preview coverage.
const fs=require('node:fs'),path=require('node:path'),runtime=require('./runtime.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
const expected={
 'dotnet__Open-XML-SDK__Of16-01':{family:'waterfallChart',marks:8},
 'dotnet__Open-XML-SDK__Of16-02':{family:'boxWhiskerChart',marks:9},
 'dotnet__Open-XML-SDK__Of16-03':{family:'sunburstChart',marks:25},
 'LibreOffice__core__funnel-pp1':{family:'funnelChart',marks:4}
};
(async()=>{
 const {files}=await loadCorpus({ids:Object.keys(expected)}),out=path.join(runtime.outputDir,'native-chart-evidence');fs.mkdirSync(out,{recursive:true});
 const bundle=await createViewerBundle(path.join(runtime.repoRoot,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),'window.__nativeModels=[];const originalBuild=buildSlideCanvas;buildSlideCanvas=async(...args)=>{const data=await originalBuild(...args);window.__nativeModels.push(data);return data;};window.audit={renderPptxViewer,cleanupPptxViewer};');
 const report={timestamp:new Date().toISOString(),sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,cases:[],acceptanceStatus:'unverified',reason:'Actual original ChartEx pipeline and authored mark inventory; Microsoft exact frame comparisons remain separate failed/unverified gates.'};
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions());
 try{for(const input of files){const item={id:input.id,inputSha256:runtime.digest(fs.readFileSync(input.path)),inputVerification:input.integrity,expected:expected[input.id],exceptions:[]};const page=await browser.newPage({viewport:{width:900,height:900}});page.on('pageerror',e=>item.exceptions.push(String(e)));
  try{await initAuditHost(page);await page.setContent('<div id="modal"><div id="modalTitle"></div><div id="modalBody" style="width:720px"></div></div>');await page.addScriptTag({path:path.join(runtime.repoRoot,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:'window.__auditLogs=[];'+bundle.content});
   const returned=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));return window.audit.renderPptxViewer({blob:new Blob([bytes]),name:'original native ChartEx.pptx',modalApi:{}});},fs.readFileSync(input.path).toString('base64'));
   Object.assign(item,await page.evaluate(()=>({error:document.getElementById('modalBody').pptxError||null,logs:window.__auditLogs,canvases:[...document.querySelectorAll('.pptx-slide-canvas')].map(c=>({width:c.width,height:c.height})),models:window.__nativeModels.map(m=>({shapes:m.shapes.map(s=>({type:s.type,sourceId:s.sourceId,inherited:s.inherited,evidence:s.chartRenderEvidence}))}))})));
   item.viewerReturned=returned;const charts=item.models.flatMap(m=>m.shapes).filter(s=>!s.inherited&&s.type==='chart');item.matchesTrait=returned===true&&!item.error&&!item.exceptions.length&&!item.logs.length&&item.canvases.length===1&&item.canvases.every(c=>c.width>0&&c.height>0)&&charts.length===1&&charts[0].evidence?.families.includes(item.expected.family)&&charts[0].evidence.markCount===item.expected.marks;
   await page.locator('.pptx-slide-canvas').screenshot({path:path.join(out,input.id+'.png')});await page.evaluate(()=>window.audit.cleanupPptxViewer());
  }catch(e){item.exceptions.push(String(e.stack||e));item.matchesTrait=false;}finally{await page.close();report.cases.push(item);}
 }}finally{await browser.close();}
 report.changedDependencies=bundle.changedDependencies();if(report.cases.length!==4||report.cases.some(c=>!c.matchesTrait)||report.changedDependencies.length)report.acceptanceStatus='fail';
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.acceptanceStatus,cases:report.cases.map(c=>({id:c.id,matchesTrait:c.matchesTrait,models:c.models,exceptions:c.exceptions,logs:c.logs})),changedDependencies:report.changedDependencies}));process.exitCode=report.acceptanceStatus==='unverified'?3:1;
})().catch(e=>{console.error(e);process.exitCode=2;});
