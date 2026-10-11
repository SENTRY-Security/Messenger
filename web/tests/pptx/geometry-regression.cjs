const __pptxRuntime = require('./runtime.cjs');
const fs = require('node:fs');
const { chromium } = __pptxRuntime.playwright();
const dir = (__pptxRuntime.repoRoot + '/web/src/app/ui/mobile/viewers/');
(async () => {
  const browser = await chromium.launch(__pptxRuntime.launchOptions());
  try {
    const page = await browser.newPage();
    await page.addScriptTag({content:fs.readFileSync(dir+'pptx-preset-geometries.js','utf8').replace(/^export /gm,'')});
    await page.addScriptTag({content:fs.readFileSync(dir+'pptx-geometry.js','utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nwindow.geometryAPI={parseGeometry,buildGeometryPaths,drawGeometry,clipGeometry,evaluateGuide,geometryFillStyle,PRESET_GEOMETRIES};'});
    const result = await page.evaluate(() => {
      const a=window.geometryAPI, cases=[];
      const check=(id,ok,actual)=>cases.push({id,pass:!!ok,actual});
      const eps=(a,b)=>Math.abs(a-b)<1e-7;
      const formulas=[['val 9',9],['*/ 12 5 3',20],['+- 12 5 3',14],['+/ 12 6 3',6],['?: -1 5 3',3],['abs -3',3],['at2 0 1',5400000],['cat2 10 3 4',6],['sat2 10 3 4',8],['cos 10 5400000',0],['sin 10 5400000',10],['tan 10 2700000',10],['max 3 8',8],['min 3 8',3],['mod 3 4 12',13],['pin 2 9 6',6],['sqrt 81',9]];
      for(const [formula,expected] of formulas){ const actual=a.evaluateGuide(formula,{});check('formula '+formula,eps(actual,expected),actual); }
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=300;const ctx=canvas.getContext('2d');
      const failures=[];
      for(const name of Object.keys(a.PRESET_GEOMETRIES)) for(const [width,height] of [[160,90],[90,160],[100,100]]) {
        try { const geometry=a.parseGeometry(`<a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="${name}"><a:avLst/></a:prstGeom>`);const out=a.buildGeometryPaths(geometry,{x:20,y:20,width,height});ctx.clearRect(0,0,400,300);ctx.fillStyle='#2468ac';ctx.strokeStyle='#123456';a.drawGeometry(ctx,geometry,{x:20,y:20,width,height});if(out.paths.length<1)throw Error('empty paths'); } catch(e){failures.push({name,width,height,error:String(e)});}
      }
      check('187 presets x 3 aspect ratios',Object.keys(a.PRESET_GEOMETRIES).length===187&&failures.length===0,failures);
      const wrap = body=>`<a:custGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</a:custGeom>`;
      const custom=a.parseGeometry(wrap('<a:avLst><a:gd name="adj" fmla="val 25"/></a:avLst><a:gdLst><a:gd name="edge" fmla="*/ w adj 100"/></a:gdLst><a:rect l="edge" t="0" r="w" b="h"/><a:pathLst><a:path><a:moveTo><a:pt x="edge" y="0"/></a:moveTo><a:lnTo><a:pt x="w" y="0"/></a:lnTo><a:lnTo><a:pt x="w" y="h"/></a:lnTo><a:lnTo><a:pt x="edge" y="h"/></a:lnTo><a:close/></a:path></a:pathLst>'));
      ctx.clearRect(0,0,400,300);ctx.fillStyle='#ff0000';const out=a.drawGeometry(ctx,custom,{x:10,y:10,width:200,height:100},{stroke:false});const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
      check('custom guides text rectangle',out.textRect.l===60,out.textRect);
      check('custom geometry pixels',pixel(30,50)[3]===0&&pixel(80,50)[0]===255,[pixel(30,50),pixel(80,50)]);
      const emu=a.parseGeometry(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:xfrm><a:ext cx="1905000" cy="952500"/></a:xfrm>${wrap('<a:gdLst><a:gd name="left" fmla="+- wd2 95250 0"/></a:gdLst><a:rect l="left" t="0" r="w" b="h"/><a:pathLst><a:path><a:moveTo><a:pt x="left" y="0"/></a:moveTo><a:lnTo><a:pt x="w" y="0"/></a:lnTo><a:lnTo><a:pt x="w" y="h"/></a:lnTo><a:lnTo><a:pt x="left" y="h"/></a:lnTo><a:close/></a:path></a:pathLst>')}</a:spPr>`);ctx.clearRect(0,0,400,300);const emuResult=a.drawGeometry(ctx,emu,{x:10,y:10,width:200,height:100},{stroke:false});check('custom implicit EMU path and mixed guide literal',emuResult.textRect.l===120&&pixel(110,50)[3]===0&&pixel(130,50)[3]===255,{textRect:emuResult.textRect,pixels:[pixel(110,50),pixel(130,50)]});
      const ellipse=a.parseGeometry('<a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="ellipse"/>');ctx.clearRect(0,0,400,300);ctx.save();a.clipGeometry(ctx,ellipse,{x:10,y:10,width:200,height:100});ctx.fillRect(0,0,400,300);ctx.restore();check('ellipse image clipping pixels',pixel(12,12)[3]===0&&pixel(110,60)[3]===255,[pixel(12,12),pixel(110,60)]);
      const arc=a.parseGeometry(wrap('<a:pathLst><a:path fill="none"><a:moveTo><a:pt x="200" y="50"/></a:moveTo><a:arcTo wR="100" hR="50" stAng="0" swAng="5400000"/></a:path></a:pathLst>'));ctx.clearRect(0,0,400,300);ctx.strokeStyle='#ff0000';ctx.lineWidth=3;a.drawGeometry(ctx,arc,{x:0,y:0,width:200,height:100},{fill:false});check('arc endpoints pixels',pixel(100,99)[3]>0&&pixel(199,50)[3]>0,[pixel(100,99),pixel(199,50)]);
      // The radial 45-degree endpoint is (100+100/sqrt(5),50+100/sqrt(5)).
      // (170,85) lies BEFORE that endpoint along the same ellipse, so it is painted.
      // (130,98) is near the ellipse at radial 58 degrees, beyond this sweep.
      const diagonal=a.parseGeometry(wrap('<a:pathLst><a:path fill="none"><a:moveTo><a:pt x="200" y="50"/></a:moveTo><a:arcTo wR="100" hR="50" stAng="0" swAng="2700000"/></a:path></a:pathLst>'));ctx.clearRect(0,0,400,300);a.drawGeometry(ctx,diagonal,{x:0,y:0,width:200,height:100},{fill:false});check('noncircular arc radial angle 45 degrees',pixel(145,95)[3]>0&&pixel(170,85)[3]>0&&pixel(130,98)[3]===0,[pixel(145,95),pixel(170,85),pixel(130,98)]);
      const bezier=a.parseGeometry(wrap('<a:pathLst><a:path fill="none" w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:quadBezTo><a:pt x="50" y="100"/><a:pt x="100" y="0"/></a:quadBezTo><a:cubicBezTo><a:pt x="100" y="50"/><a:pt x="50" y="100"/><a:pt x="0" y="100"/></a:cubicBezTo></a:path></a:pathLst>'));ctx.clearRect(0,0,400,300);a.drawGeometry(ctx,bezier,{x:0,y:0,width:200,height:100},{fill:false});check('quadratic and cubic path canvas pixels',pixel(100,50)[3]>0&&pixel(0,99)[3]>0,[pixel(100,50),pixel(0,99)]);
      check('fill shading rgb',a.geometryFillStyle(ctx,'#646464','lighten')==='rgba(162,162,162,1)'&&a.geometryFillStyle(ctx,'#646464','darken')==='rgba(60,60,60,1)',[a.geometryFillStyle(ctx,'#646464','lighten'),a.geometryFillStyle(ctx,'#646464','darken')]);
      const adjusted=a.parseGeometry('<a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 0"/></a:avLst></a:prstGeom>');ctx.clearRect(0,0,400,300);a.drawGeometry(ctx,adjusted,{x:10,y:10,width:200,height:100},{stroke:false});check('preset avLst overrides default adjustment',pixel(11,11)[3]===255,pixel(11,11));
      let unknown=false;try{a.parseGeometry('<a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="invented"/>');}catch(e){unknown=e.name==='UnsupportedGeometryError';}check('unsupported preset fails explicitly',unknown);
      let formulaFail=false;try{a.evaluateGuide('invented 1',{});}catch(e){formulaFail=e.name==='UnsupportedGeometryError';}check('unsupported formula fails explicitly',formulaFail);
      let malformed=false;try{a.evaluateGuide('+- 1 2 3 0',{});}catch(e){malformed=e.name==='UnsupportedGeometryError';}check('malformed four operand formula rejected',malformed);
      const quadBounds=a.buildGeometryPaths(a.parseGeometry(wrap('<a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:quadBezTo><a:pt x="50" y="100"/><a:pt x="100" y="0"/></a:quadBezTo></a:path></a:pathLst>')),{x:10,y:20,width:200,height:200});check('analytic quadratic actual fill extrema scale to output coordinates',eps(quadBounds.fillBounds.l,10)&&eps(quadBounds.fillBounds.r,210)&&eps(quadBounds.fillBounds.t,20)&&eps(quadBounds.fillBounds.b,120),quadBounds.fillBounds);
      const cubicBounds=a.buildGeometryPaths(a.parseGeometry(wrap('<a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:cubicBezTo><a:pt x="0" y="100"/><a:pt x="100" y="100"/><a:pt x="100" y="0"/></a:cubicBezTo></a:path></a:pathLst>')),{x:0,y:0,width:100,height:100});check('analytic cubic derivative bounds exclude off-curve controls',eps(cubicBounds.pathBounds.b,75)&&eps(cubicBounds.pathBounds.width,100),cubicBounds.pathBounds);
      const arcBounds=a.buildGeometryPaths(diagonal,{x:0,y:0,width:200,height:100});check('analytic radial ellipse partial sweep includes only swept extrema',eps(arcBounds.pathBounds.l,100+100/Math.sqrt(5))&&eps(arcBounds.pathBounds.b,50+100/Math.sqrt(5))&&arcBounds.fillBounds===null,arcBounds.pathBounds);
      const separateBounds=a.buildGeometryPaths(a.parseGeometry(wrap('<a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="20" y="20"/></a:lnTo></a:path><a:path fill="none" w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo></a:path><a:path w="100" h="100"><a:moveTo><a:pt x="999" y="999"/></a:moveTo><a:close/></a:path></a:pathLst>')),{x:0,y:0,width:100,height:100});check('fill bounds union excludes stroke-only path and isolated move-close',separateBounds.fillBounds.width===20&&separateBounds.pathBounds.width===100&&separateBounds.paths[2].bounds===null,{pathBounds:separateBounds.pathBounds,fillBounds:separateBounds.fillBounds});
      return {passed:cases.every(c=>c.pass),cases};
    });
    fs.writeFileSync((__pptxRuntime.outputDir + '/geometry-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
  } finally {await browser.close();}
})();
