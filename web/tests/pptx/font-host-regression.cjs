const __pptxRuntime = require('./runtime.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=__pptxRuntime.playwright();
const {createViewerBundle,initAuditHost,checkProductionFontAssets}=require('./viewer-bundle.cjs');
const root=__pptxRuntime.repoRoot;
(async()=>{
 const bundle=await createViewerBundle(path.join(root,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),'window.fontHostAudit={loadPptxFonts,parseXml,resolvePathFrom};');
 const browser=await chromium.launch(__pptxRuntime.launchOptions());
 const report={issue:'SEN-2600',timestamp:new Date().toISOString(),sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,cases:[],runs:[],acceptanceStatus:'unverified'};
 try{for(const available of [true,false]){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   const host=await initAuditHost(page,available?root:'/tmp/pptx-intentionally-missing-font-host');
   await page.addScriptTag({path:path.join(root,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:bundle.content});
   const result=await page.evaluate(async()=>{const a=window.fontHostAudit;const loaded=await a.loadPptxFonts(new JSZip(),{parseXml:a.parseXml,resolvePartPath:a.resolvePathFrom,relationshipNamespace:'http://schemas.openxmlformats.org/officeDocument/2006/relationships',presentationNamespace:'http://schemas.openxmlformats.org/presentationml/2006/main'});return{origin:location.origin,diagnostics:loaded.diagnostics,faces:[...document.fonts].map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status}))};});
   report.runs.push({available,...result,fontResponses:host.fontResponses});
   // FontFace.family serializes a CSS string, and Chromium may retain its outer quotes.
   const actualVariants=result.faces.filter(f=>f.family.replace(/^(['"])(.*)\1$/s,'$2')==='Pptx Carlito'&&f.status==='loaded').map(f=>`${f.weight}:${f.style}`).sort();
   const expectedVariants=['400:normal','700:normal','400:italic','700:italic'].sort();
   const matches=available?JSON.stringify(actualVariants)===JSON.stringify(expectedVariants)&&host.fontResponses.length===4&&host.fontResponses.every(f=>f.status===200)&&!result.diagnostics.some(d=>d.code==='fallback-font-load-failed'):result.diagnostics.some(d=>d.code==='fallback-font-load-failed')&&host.fontResponses.some(f=>f.status===404);
   report.cases.push({id:available?'actual-product-four-font-variants-load':'missing-assets-diagnostic-retained',matchesSpec:matches});
  }finally{await context.close();}
 }}finally{await browser.close();}
 report.productionAssets=checkProductionFontAssets(root);
 report.cases.push({id:'production-dist-fonts-and-license-match-source',matchesSpec:report.productionAssets.status==='pass'});
 report.changedDependencies=bundle.changedDependencies();fs.writeFileSync(path.join(__pptxRuntime.outputDir,'font-host-results.json'),JSON.stringify(report,null,2)+'\n');
 for(const c of report.cases)console.log(`${c.matchesSpec?'MATCH':'MISMATCH'} ${c.id}`);
 process.exitCode=report.cases.every(c=>c.matchesSpec)?report.changedDependencies.length?3:0:1;
})().catch(e=>{console.error(e);process.exitCode=2;});
