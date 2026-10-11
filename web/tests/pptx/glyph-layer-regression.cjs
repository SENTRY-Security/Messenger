#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const runtime=require('./runtime.cjs');
const {chromium}=runtime.playwright();
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const root=runtime.repoRoot,out=path.join(runtime.outputDir,'glyph-layer-results');fs.mkdirSync(out,{recursive:true});
 const bundle=await createViewerBundle(path.join(root,'web/src/app/ui/mobile/viewers/pptx-viewer.js'),'window.glyphAudit={buildSlideCanvas,buildShapeLayers,loadPptxFonts,parseXml,resolvePathFrom};');
 const browser=await chromium.launch(runtime.launchOptions()),page=await browser.newPage({viewport:{width:1500,height:900},deviceScaleFactor:1}),exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
 try{await initAuditHost(page);await page.setContent('<body></body>');await page.evaluate(()=>{window.__auditLogs=[];});await page.addScriptTag({path:path.join(root,'web/src/assets/libs/jszip.min.js')});await page.addScriptTag({content:bundle.content});
 const cases=await page.evaluate(async()=>{
  const a=window.glyphAudit,zip=new JSZip(),result=[],P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main';
  await a.loadPptxFonts(zip,{parseXml:a.parseXml,resolvePartPath:a.resolvePathFrom,relationshipNamespace:'http://schemas.openxmlformats.org/officeDocument/2006/relationships',presentationNamespace:P});
  const text=(value,attrs='')=>`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Glyph test"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm ${attrs}><a:off x="952500" y="952500"/><a:ext cx="4762500" cy="1905000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:r><a:rPr sz="3200"><a:solidFill><a:srgbClr val="346699"><a:alpha val="65000"/></a:srgbClr></a:solidFill><a:latin typeface="Carlito"/></a:rPr><a:t>${value}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const group=(inner,attrs,extent)=>`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm ${attrs}><a:off x="0" y="0"/><a:ext cx="${extent}" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="6858000"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
  const variants=[{name:'unrotated semi-transparent paragraph',xml:text('ABC xyz')},{name:'rotated text 30 degrees',xml:text('ABC xyz','rot="1800000"')},{name:'horizontal flip',xml:text('ABC xyz','flipH="1"')},{name:'vertical flip',xml:text('ABC xyz','flipV="1"')},{name:'nested rotated nonuniform group affine',xml:group(group(text('ABC xyz'),'rot="1200000"','7315200'),'rot="900000"','10972800')},{name:'joining Arabic remains unsupported glyph target',xml:text('مرحبا'),unsupported:true},{name:'ligature fi remains unsupported glyph target',xml:text('fi'),unsupported:true}];
  for(const variant of variants){try{
   const xml=`<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${variant.xml}</p:spTree></p:cSld></p:sld>`,slideSize={w:960,h:720},data=await a.buildSlideCanvas(xml,'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',zip,slideSize,[],null),make=async(iteration)=>{data.playback.requiresGlyphTargets=iteration;const wrapper=document.createElement('div'),canvas=document.createElement('canvas');canvas.width=720;canvas.height=540;wrapper.style.cssText='position:relative;width:720px;height:540px';wrapper.append(canvas);document.body.append(wrapper);return a.buildShapeLayers(wrapper,canvas,data,slideSize,zip,[]);};
   const base=await make(false),split=await make(true),original=base.host.querySelector('.pptx-paragraph-layer canvas'),paragraph=split.host.querySelector('.pptx-paragraph-layer'),glyphs=[...paragraph.querySelectorAll('.pptx-glyph-layer')],chars=[...split.targets.keys()].filter(k=>/^2:p:0:c:/.test(k)),words=[...split.targets.keys()].filter(k=>/^2:p:0:w:/.test(k));
   if(variant.unsupported){if(chars.length||glyphs.length||!paragraph.querySelector('canvas'))throw Error('Unsupported shaping emitted fabricated glyph targets');result.push({name:variant.name,status:'MATCH',scope:'Negative diagnostic; glyph playback remains unsupported',glyphTargets:chars.length});continue;}
   if(chars.length!==7||words.length!==2||!glyphs.length)throw Error('Incorrect actual character/word target counts: '+chars.length+'/'+words.length);
   const width=original.width,height=original.height,expected=original.getContext('2d').getImageData(0,0,width,height).data,actual=new Uint8ClampedArray(expected.length),owners=new Uint8Array(width*height);let overlapping=0,changed=0;
   for(const glyph of glyphs){const canvas=glyph.querySelector('canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,left=Math.round(parseFloat(glyph.style.left)*width/100),top=Math.round(parseFloat(glyph.style.top)*height/100);for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const from=(y*canvas.width+x)*4;if(!pixels[from+3])continue;const position=(y+top)*width+x+left;if(position<0||position>=owners.length)throw Error('Glyph painted outside original crop');if(owners[position]++)overlapping++;actual.set(pixels.subarray(from,from+4),position*4);}}
   for(let i=0;i<expected.length;i++)if(actual[i]!==expected[i])changed++;
   if(changed||overlapping)throw Error(`Glyph recomposition changed ${changed} RGBA channels or overlapped ${overlapping} pixels`);
   result.push({name:variant.name,status:'MATCH',width,height,glyphTargets:chars.length,wordTargets:words.length,changedChannels:changed,overlappingPixels:overlapping});
  }catch(error){result.push({name:variant.name,status:'FAIL',error:error.message});}}
  return result;
 });
 const report={cases,exceptions,sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,changedDependencies:bundle.changedDependencies(),scope:'True buildSlideCanvas→buildShapeLayers; exact transformed paragraph RGBA vs recomposed glyphs',acceptanceStatus:'unverified',operationalStatus:cases.every(c=>c.status==='MATCH')&&!exceptions.length&&!bundle.changedDependencies().length?'pass':'fail'};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:cases.length,failures:cases.filter(c=>c.status==='FAIL'),exceptions,status:report.operationalStatus}));process.exitCode=report.operationalStatus==='pass'?3:1;
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=2;});
