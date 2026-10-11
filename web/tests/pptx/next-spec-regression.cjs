const __pptxRuntime = require('./runtime.cjs');
const fs=require('node:fs');
const {chromium}=__pptxRuntime.playwright();
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
const viewer=(__pptxRuntime.repoRoot + '/web/src/app/ui/mobile/viewers/pptx-viewer.js');
(async()=>{const bundle=await createViewerBundle(viewer,'window.audit={drawChart,parseTheme,parseXml,parseShape,buildSlideCanvas};');const browser=await chromium.launch(__pptxRuntime.launchOptions());try{
 const page=await browser.newPage();await initAuditHost(page);await page.setContent('<body></body>');await page.addScriptTag({path:(__pptxRuntime.repoRoot + '/web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:bundle.content});
 const result=await page.evaluate(async()=>{
  const C='http://schemas.openxmlformats.org/drawingml/2006/chart', A='http://schemas.openxmlformats.org/drawingml/2006/main',P='http://schemas.openxmlformats.org/presentationml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const cases=[],fixtures={};const ctx=document.createElement('canvas').getContext('2d');let rects=[],strokes=0;const ns=ctx.stroke.bind(ctx);ctx.stroke=function(){strokes++;return ns()};const nr=ctx.fillRect.bind(ctx);ctx.fillRect=function(x,y,w,h){rects.push({x,y,w,h,color:this.fillStyle});return nr(x,y,w,h)};
  const chart=(max,tag='barChart')=>`<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:plotArea><c:${tag}><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="3B82F6"/></a:solidFill></c:spPr><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="1"><c:v>10</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:${tag}><c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:min val="0"/><c:max val="${max}"/></c:scaling><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
  async function draw(name,s){fixtures[name+'.xml']=s;const z=new JSZip();z.file('ppt/charts/chart1.xml',s);rects=[];strokes=0;await audit.drawChart(ctx,{chartTarget:'../charts/chart1.xml'},0,0,360,240,1,z);return rects.filter(r=>r.color==='#3b82f6');}
  const b10=await draw('axis-max10',chart(10)),b20=await draw('axis-max20',chart(20));
  function check(id,expected,actual,ref,method){cases.push({id,matchesSpec:JSON.stringify(expected)===JSON.stringify(actual),expected,actual,reference:ref,method});}
  check('chart-axis-explicit-max-affects-data-scale',true,b10.length===2&&b20.length===2&&Math.abs(b10[1].h-2*b20[1].h)<1e-8,'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.scaling',{max10:b10,max20:b20,assertion:'Same values on min0/max10 and min0/max20; peak bar extent halves.'});
  const line=chart(20,'lineChart').replace('xmlns:c=','xmlns=').replaceAll('<c:','<').replaceAll('</c:','</');
  const lineBars=await draw('default-namespace-linechart',line);
  check('chart-type-independent-of-namespace-prefix',true,lineBars.length===0&&strokes>0,'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.linechart',{bars:lineBars,assertion:'A lineChart in default chart namespace cannot render bar rectangles.'});
  const shape=`<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>`;
  const slide=`<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${shape}</p:spTree></p:cSld></p:sld>`;
  const z=new JSZip();const rel=(id,type,target)=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;const rels=s=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${s}</Relationships>`;
  z.file('ppt/slides/slide1.xml',slide);z.file('ppt/slides/_rels/slide1.xml.rels',rels(rel('layout','slideLayout','../slideLayouts/slideLayout1.xml')));
  const layout=`<p:sldLayout xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><a:overrideClrMapping accent1="accent2"/></p:clrMapOvr></p:sldLayout>`;
  z.file('ppt/slideLayouts/slideLayout1.xml',layout);z.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels',rels(rel('master','slideMaster','../slideMasters/slideMaster1.xml')));
  z.file('ppt/slideMasters/slideMaster1.xml',`<p:sldMaster xmlns:p="${P}"><p:cSld><p:spTree/></p:cSld><p:clrMap accent1="accent1"/></p:sldMaster>`);z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels',rels(rel('theme','theme','../theme/theme1.xml')));
  z.file('ppt/theme/theme1.xml',`<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="colors"><a:accent1><a:srgbClr val="FF0000"/></a:accent1><a:accent2><a:srgbClr val="0000FF"/></a:accent2></a:clrScheme></a:themeElements></a:theme>`);
  await audit.parseTheme(z,'ppt/slides/slide1.xml');const inherited=audit.parseShape(audit.parseXml(`<p:sp xmlns:p="${P}" xmlns:a="${A}">${audit.parseXml(slide).getElementsByTagNameNS(P,'sp')[0].innerHTML}</p:sp>`).documentElement,{},{});
  fixtures['layout-color-map.xml']=layout;
  check('layout-color-map-override-inherits-to-slide','#0000FF',inherited.bgColor?.toUpperCase(),'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.colormapoverride','Master accent1 red; layout overrides accent1 to accent2 blue; slide with no clrMapOvr inherits blue.');
  const mc='http://schemas.openxmlformats.org/markup-compatibility/2006';const altSlide=slide.replace('xmlns:p=',`xmlns:mc="${mc}" xmlns:x="urn:unsupported" xmlns:p=`).replace(shape,`<mc:AlternateContent><mc:Choice Requires="x"><x:unsupported/></mc:Choice><mc:Fallback>${shape}</mc:Fallback></mc:AlternateContent>`);
  const parsed=await audit.buildSlideCanvas(altSlide,null,new JSZip(),{w:960,h:540},[]);fixtures['mce-fallback-slide.xml']=altSlide;
  check('mce-unsupported-choice-renders-fallback',1,parsed.shapes.length,'https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.alternatecontent','Unknown Choice Requires namespace must select fallback shape exactly once.');
  return {cases,fixtures,browser:navigator.userAgent};
 });for(const [name,xml]of Object.entries(result.fixtures))fs.writeFileSync(__pptxRuntime.outputDir+'/fixtures/'+name,xml);delete result.fixtures;
 result.sourceSha256=bundle.sourceSha256;result.bundleSha256=bundle.bundleSha256;result.dependencyHashes=bundle.dependencyHashes;result.changedDependencies=bundle.changedDependencies();result.timestamp=new Date().toISOString();
 fs.writeFileSync(__pptxRuntime.outputDir+'/next-spec-results.json',JSON.stringify(result,null,2));for(const c of result.cases)console.log(`${c.matchesSpec?'MATCH':'MISMATCH'} ${c.id} ${JSON.stringify(c.actual)}`);if(result.cases.some(c=>!c.matchesSpec)||result.changedDependencies.length)process.exitCode=1;
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=2});
