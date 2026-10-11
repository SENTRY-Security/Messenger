// DrawingML precedence/choice oracles; these do not establish full Office pixels.
const runtime=require('./runtime.cjs'),fs=require('node:fs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const bundle=await createViewerBundle(runtime.repoRoot+'/web/src/app/ui/mobile/viewers/pptx-viewer.js','window.cascadeAudit={parseXml,parseShape,extractLstStyleDefaults,mergeTextDefaults,drawTextShape};');
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions());
 try{
  const page=await browser.newPage();await initAuditHost(page);await page.setContent('<body></body>');await page.addScriptTag({content:bundle.content});
  const cases=await page.evaluate(()=>{
   const a='http://schemas.openxmlformats.org/drawingml/2006/main',p='http://schemas.openxmlformats.org/presentationml/2006/main',api=cascadeAudit,cases=[];
   const list=(properties)=>`<a:lstStyle xmlns:a="${a}"><a:lvl1pPr>${properties}</a:lvl1pPr></a:lstStyle>`;
   const defaults=properties=>api.extractLstStyleDefaults(api.parseXml(list(properties)).documentElement);
   function shape(own,inherited,ppr=''){
    const xml=`<p:sp xmlns:p="${p}" xmlns:a="${a}"><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="1905000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/>${list(own)}<a:p><a:pPr>${ppr}</a:pPr><a:r><a:t>X</a:t></a:r></a:p><a:p><a:r><a:t>Y</a:t></a:r></a:p></p:txBody></p:sp>`;
    return api.parseShape(api.parseXml(xml).documentElement,{}, {other:defaults(inherited)});
   }
   const check=(id,expected,actual,ref)=>cases.push({id,expected,actual,matchesSpecification:JSON.stringify(expected)===JSON.stringify(actual),reference:ref});
   const paragraph=shape('<a:defRPr sz="2400"/>','<a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="200"/></a:spcAft><a:buAutoNum type="romanUcPeriod" startAt="7"/><a:defRPr sz="1800"/>').paragraphs[0];
   check('local-font-retains-inherited-paragraph-properties',[24,6,2,'auto',7,'romanUcPeriod'],[paragraph.defaultFontSize,paragraph.spaceBefore,paragraph.spaceAfter,paragraph.bullet,paragraph.bulletStart,paragraph.bulletType],'ISO 29500-1 21.1.2.2.9 lvl1pPr; character defaults do not erase unspecified paragraph properties.');
   check('list-buNone-clears-inherited-auto-number',null,shape('<a:buNone/>','<a:buAutoNum type="romanUcPeriod" startAt="7"/>').paragraphs[0].bullet,'ISO 29500-1 21.1.2.4.4 buNone; exclusive bullet choice.');
   check('direct-buNone-clears-list-bullet',null,shape('<a:buChar char="•"/>','','<a:buNone/>').paragraphs[0].bullet,'ISO 29500-1 21.1.2.4.4 buNone; explicit paragraph formatting takes precedence.');
   const percent=shape('<a:lnSpc><a:spcPct val="100000"/></a:lnSpc>','<a:lnSpc><a:spcPts val="1800"/></a:lnSpc>').paragraphs[0];
   check('local-line-percent-replaces-inherited-point-choice',[1,null],[percent.lineHeight,percent.lineSpacingPoints??null],'ISO 29500-1 21.1.2.2.5 lnSpc; CT_TextSpacing has exclusive spcPct/spcPts choice.');
   const points=shape('<a:lnSpc><a:spcPts val="1100"/></a:lnSpc>','<a:lnSpc><a:spcPct val="90000"/></a:lnSpc>').paragraphs[0];
   check('local-line-points-replace-inherited-percent-choice',[11,null],[points.lineSpacingPoints,points.lineHeight??null],'ISO 29500-1 21.1.2.2.5 lnSpc; exclusive spacing choice.');
   const zero=shape('<a:spcAft><a:spcPct val="0"/></a:spcAft>','<a:spcAft><a:spcPts val="600"/></a:spcAft>').paragraphs[0];
   check('explicit-zero-percent-after-blocks-point-inheritance',[0,0],[zero.spaceAfterPct,zero.spaceAfter],'ISO 29500-1 21.1.2.2.11 spcAft; explicit zero is a value.');
   const merged=api.mergeTextDefaults(defaults('<a:spcBef><a:spcPct val="50000"/></a:spcBef>'),defaults('<a:spcBef><a:spcPts val="200"/></a:spcBef>'))[0];
   check('spacing-merge-keeps-only-higher-unit',[2,null],[merged.spaceBefore,merged.spaceBeforePct??null],'ISO 29500-1 CT_TextSpacing choice; higher priority point spacing replaces percentage.');
   const draws=shape('<a:spcAft><a:spcPts val="0"/></a:spcAft>','<a:spcAft><a:spcPts val="600"/></a:spcAft>'),drawsSix=shape('','<a:spcAft><a:spcPts val="600"/></a:spcAft>');
   function positions(s){const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const ctx=canvas.getContext('2d'),ys=[];ctx.fillText=(text,x,y)=>ys.push(y);api.drawTextShape(ctx,s,0,0,400,200,1,{},'#fff');return ys;}
   const noGap=positions(draws),sixGap=positions(drawsSix);
   check('explicit-zero-after-reaches-paint',true,Math.abs((sixGap[1]-sixGap[0])-(noGap[1]-noGap[0])-8)<1e-8,'6pt * 96/72 = 8px independent of font metrics; compare inherited 6pt versus local zero.');
   const colored=shape('','<a:buAutoNum type="arabicPeriod"/><a:buClr><a:srgbClr val="FF0000"/></a:buClr>','<a:buClr><a:srgbClr val="0000FF"/></a:buClr>').paragraphs[0];
   check('direct-bullet-color-overrides-inherited-bullet-style','#0000ff',colored.bulletColor,'ISO 29500-1 21.1.2.4.2 buClr; direct paragraph color takes precedence while bullet choice inherits.');
   const sized=shape('<a:buSzPct val="50000"/>','<a:buChar char="•"/><a:buSzPts val="1400"/>').paragraphs[0];
   check('local-bullet-percent-replaces-inherited-point-size',[.5,null],[sized.bulletSizePercent,sized.bulletSizePoints??null],'ISO 29500-1 21.1.2.4.10/.11 buSzPct/buSzPts exclusive bullet-size choice.');
   return cases;
  });
  const result={cases,sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,changedDependencies:bundle.changedDependencies(),timestamp:new Date().toISOString(),conformanceStatus:'unverified'};
  fs.writeFileSync(runtime.outputDir+'/text-cascade-results.json',JSON.stringify(result,null,2));
  for(const c of cases)console.log(`${c.matchesSpecification?'MATCH':'MISMATCH'} ${c.id} ${JSON.stringify(c.actual)}`);
  if(!cases.length||cases.some(c=>!c.matchesSpecification)||result.changedDependencies.length)process.exitCode=1;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=2;});
