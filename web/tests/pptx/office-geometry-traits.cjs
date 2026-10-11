const __pptxRuntime = require('./runtime.cjs');
const fs=require('node:fs'),crypto=require('node:crypto');
const {chromium}=__pptxRuntime.playwright();
const dir=(__pptxRuntime.repoRoot + '/web/src/app/ui/mobile/viewers/');
const dependencies=['pptx-preset-geometries.js','pptx-geometry.js'];const sources=Object.fromEntries(dependencies.map(f=>[dir+f,fs.readFileSync(dir+f,'utf8')]));
(async()=>{const browser=await chromium.launch(__pptxRuntime.launchOptions());try{const page=await browser.newPage();
 await page.addScriptTag({content:sources[dir+'pptx-preset-geometries.js'].replace(/^export /gm,'')});
 await page.addScriptTag({content:sources[dir+'pptx-geometry.js'].replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nwindow.officeGeometry={evaluateGuide,geometryFillStyle};'});
 const cases=await page.evaluate(()=>{const a=window.officeGeometry,ctx=document.createElement('canvas').getContext('2d'),cases=[];
 function check(id,expected,fn,official){let actual;try{actual=fn()}catch(e){actual={error:e.name,message:e.message}}cases.push({id,expected,actual,matchesMicrosoft:JSON.stringify(expected)===JSON.stringify(actual),official});}
 check('office-sqrt-uses-absolute-operand',9,()=>a.evaluateGuide('sqrt -81',{}),{spec:'MS-OI29500 v20260818 §2.1.1311(b)',path:'references/ms-oi29500.txt',line:35580,quote:'In Office, sqrt x = sqrt(abs(x)).'});
 check('office-lightenLess-uses-50-over-255','rgba(50,50,50,1)',()=>a.geometryFillStyle(ctx,'#000000','lightenLess'),{spec:'MS-OI29500 v20260818 §2.1.1327',path:'references/ms-oi29500.txt',line:35938,quote:'lightenLess does not use a scale factor of exactly 0.2. It uses 50/255'});
 check('office-darkenLess-uses-50-over-255','rgba(205,205,205,1)',()=>a.geometryFillStyle(ctx,'#ffffff','darkenLess'),{spec:'MS-OI29500 v20260818 §2.1.1327',path:'references/ms-oi29500.txt',line:35928,quote:'darkenLess does not use a scale factor of exactly 0.2. It uses 50/255'});
 return cases;});const hashes=Object.fromEntries(Object.entries(sources).map(([p,s])=>[p,crypto.createHash('sha256').update(s).digest('hex')]));const changedDependencies=Object.entries(hashes).filter(([p,h])=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h).map(([p])=>p);
 const result={timestamp:new Date().toISOString(),dependencyHashes:hashes,changedDependencies,cases,scope:'Exact Microsoft implementation trait analytical probes, not PowerPoint pixel conformance.'};fs.writeFileSync(__pptxRuntime.outputDir+'/office-geometry-traits-results.json',JSON.stringify(result,null,2));for(const c of cases)console.log(`${c.matchesMicrosoft?'MATCH':'MISMATCH'} ${c.id} actual=${JSON.stringify(c.actual)}`);if(cases.some(c=>!c.matchesMicrosoft)||changedDependencies.length)process.exitCode=1;
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=2});
