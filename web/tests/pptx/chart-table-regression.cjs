const __pptxRuntime = require('./runtime.cjs');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=__pptxRuntime.playwright();
const viewer=process.env.VIEWER_SOURCE||(__pptxRuntime.repoRoot + '/web/src/app/ui/mobile/viewers/pptx-viewer.js');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{const bundle=await createViewerBundle(viewer,'window.audit={drawChart,parseXml,parseTable,drawTable};');const browser=await chromium.launch(__pptxRuntime.launchOptions());try{
 const page=await browser.newPage();await initAuditHost(page);await page.setContent('<html><body></body></html>');
 await page.addScriptTag({path:(__pptxRuntime.repoRoot + '/web/src/assets/libs/jszip.min.js')});
 await page.addScriptTag({content:bundle.content});
 const result=await page.evaluate(async()=>{
  const C='http://schemas.openxmlformats.org/drawingml/2006/chart', A='http://schemas.openxmlformats.org/drawingml/2006/main';
  const cases=[],fixtures={};const ctx=document.createElement('canvas').getContext('2d');ctx.canvas.width=360;ctx.canvas.height=240;
  let rects=[],texts=[];const nativeRect=ctx.fillRect.bind(ctx),nativeText=ctx.fillText.bind(ctx);
  ctx.fillRect=function(x,y,w,h){rects.push({x,y,w,h,color:this.fillStyle});return nativeRect(x,y,w,h)};
  ctx.fillText=function(text,x,y){texts.push({text,x,y});return nativeText(text,x,y)};
  const pts=entries=>entries.map(([i,v])=>`<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('');
  const nums=entries=>`<c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/>${pts(entries)}</c:numCache></c:numRef>`;
  const strs=()=>`<c:strRef><c:f>Sheet1!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/>${pts([[0,'10'],[1,'20'],[2,'45']])}</c:strCache></c:strRef>`;
  const chart=(cat,values)=>`<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="3B82F6"/></a:solidFill></c:spPr><c:cat>${cat}</c:cat><c:val>${nums(values)}</c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
  async function draw(name,xml){fixtures[name+'.xml']=xml;const zip=new JSZip();zip.file('ppt/charts/chart1.xml',xml);rects=[];texts=[];await audit.drawChart(ctx,{chartTarget:'../charts/chart1.xml'},0,0,360,240,1,zip);return {bars:rects.filter(r=>r.color==='#3b82f6'),texts:[...texts]};}
  function check(id,expected,actual,reference,method){cases.push({id,matchesSpec:JSON.stringify(expected)===JSON.stringify(actual),expected,actual,reference,method});}
  const v=[[0,3],[1,6],[2,9]];
  const sc=await draw('chart-string-category',chart(strs(),v));
  const nc=await draw('chart-numeric-category',chart(nums([[0,10],[1,20],[2,45]]),v));
  check('chart-values-not-numeric-categories',true,sc.bars.length===3&&nc.bars.length===3&&JSON.stringify(sc.bars)===JSON.stringify(nc.bars),'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.values','Replace category strRef with numerically identical numRef; value bars must retain identical coordinates.');
  const reordered=await draw('chart-reordered-points',chart(strs(),[[2,9],[0,3],[1,6]]));
  check('chart-point-index-over-xml-order',true,sc.bars.length===3&&reordered.bars.length===3&&JSON.stringify(sc.bars)===JSON.stringify(reordered.bars),'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.numericpoint','Permute numCache points preserving pt.idx; bars must retain identical coordinates.');
  const neg=await draw('chart-negative-zero-positive',chart(strs(),[[0,-10],[1,0],[2,10]]));
  // A zero datum has zero bar extent regardless of axis bounds; negative/positive bars must share the zero baseline.
  const b=neg.bars;const nonzero=b.filter(r=>Math.abs(r.h)>1e-8);const zero=b.filter(r=>Math.abs(r.h)<=1e-8);const baselineValid=nonzero.length===2&&zero.length<=1&&Math.abs(nonzero[0].y-(nonzero[1].y+nonzero[1].h))<1e-8&&nonzero[0].h>0&&nonzero[1].h>0;
  check('chart-negative-bars-share-zero-baseline',true,baselineValid,'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.barchart',{observedBars:b,assertion:'Zero has zero height; negative top equals positive bottom; negative extends below zero.'});
  const cell=(attrs,text)=>`<a:tc ${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  const table=`<a:tbl xmlns:a="${A}"><a:tblGrid>${'<a:gridCol w="1143000"/>'.repeat(3)}</a:tblGrid><a:tr h="1143000">${cell('gridSpan="2"','MERGED')}${cell('hMerge="1"','')}${cell('','THIRD')}</a:tr></a:tbl>`;
  fixtures['table-horizontal-merge.xml']=table;const model=audit.parseTable(audit.parseXml(table).documentElement);rects=[];texts=[];audit.drawTable(ctx,model,0,0,360,120,1);
  const third=texts.find(x=>x.text==='THIRD');check('table-merged-continuation-keeps-grid-column',true,!!third&&Number.isFinite(third.x)&&third.x>=240&&third.x<360,'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.tablecell',{thirdCell:third,assertion:'After a span-2 origin and its hMerge continuation, next cell begins at physical column 3.'});
  return {cases,fixtures,browser:navigator.userAgent};
 });for(const [name,xml]of Object.entries(result.fixtures))fs.writeFileSync(__pptxRuntime.outputDir+'/fixtures/'+name,xml);delete result.fixtures;
 result.sourcePath=viewer;result.sourceSha256=bundle.sourceSha256;result.dependencyHashes=bundle.dependencyHashes;result.bundleSha256=bundle.bundleSha256;result.changedDependencies=bundle.changedDependencies();result.timestamp=new Date().toISOString();
 fs.writeFileSync(__pptxRuntime.outputDir+'/chart-table-results.json',JSON.stringify(result,null,2));for(const c of result.cases)console.log(`${c.matchesSpec?'MATCH':'MISMATCH'} ${c.id}: ${JSON.stringify(c.actual)}`);
 console.log('Analytical defect probes only; no PowerPoint pixel baseline, no full conformance claim.');
 if(result.cases.some(c=>!c.matchesSpec)||result.changedDependencies.length)process.exitCode=1;
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=2});
