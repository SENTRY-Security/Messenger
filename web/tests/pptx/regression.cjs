const __pptxRuntime = require('./runtime.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = __pptxRuntime.playwright();

// Run against the clone without editing its production source.
const root = __pptxRuntime.repoRoot;
const viewer = path.join(root, 'web/src/app/ui/mobile/viewers/pptx-viewer.js');
const { createViewerBundle, initAuditHost } = require('./viewer-bundle.cjs');
const out = __pptxRuntime.outputDir;
fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true });

(async () => {
  const bundle = await createViewerBundle(viewer, 'window.audit = {parseXml,parseShape,parseTransform,parseGroupShapes,buildSlideCanvas,parseGradientStops,parseFill,parseTheme,drawShapeOnCanvas,renderPptxThumbnail,renderPptxViewer,cleanupPptxViewer};');
  const browser = await chromium.launch(__pptxRuntime.launchOptions());
  try {
    const page = await browser.newPage();
    await initAuditHost(page);await page.setContent('<div id="modal"><div id="modalTitle"></div><div id="modalBody" style="width:960px"></div></div>');
    await page.addScriptTag({ path: path.join(root, 'web/src/assets/libs/jszip.min.js') });
    await page.addScriptTag({ content: bundle.content });
    const results = await page.evaluate(async () => {
      const a = window.audit;
      const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
      const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
      const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const fixtures = {}, cases = [];
      function xml(name, text) { fixtures[name + '.xml'] = text; return a.parseXml(text).documentElement; }
      function check(id, expected, actual, evidence) { cases.push({ id, matchesSpec: JSON.stringify(expected) === JSON.stringify(actual), expected, actual, evidence }); }
      const tf = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="914400"/></a:xfrm>';
      const shape = (spPr, pPr, rPr, text = 'TEST') => `<p:sp xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:spPr>${tf}${spPr}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${pPr}<a:r>${rPr}<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
      const slide = content => `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`;
      const ctx = document.createElement('canvas').getContext('2d');
      const drawn = [];
      const nativeFill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y) { drawn.push({text:String(text),font:this.font,x,y}); return nativeFill.call(this,text,x,y); };

      const bold = a.parseShape(xml('explicit-not-bold', shape('', '<a:pPr><a:defRPr b="1"/></a:pPr>', '<a:rPr b="0"/>')), {}, {});
      const boldZip = new JSZip(); boldZip.file('ppt/slides/slide1.xml', slide(shape('', '<a:pPr><a:defRPr b="1"/></a:pPr>', '<a:rPr b="0"/>')));
      await a.renderPptxThumbnail(await boldZip.generateAsync({type:'arraybuffer'}), ctx.canvas);
      check('explicit-bold-off', false, drawn.find(d=>d.text==='TEST')?.font.includes('bold') || drawn.find(d=>d.text==='TEST')?.font.includes('700'), '275-304, 1172-1189');

      const left = a.parseShape(xml('explicit-left', shape('', '<a:pPr algn="l"/>', '<a:rPr/>').replace('<a:lstStyle/>','<a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle>')), {}, {});
      check('explicit-left-overrides-list-style', 'left', left.paragraphs[0].align, '579-593');

      const noFill = a.parseShape(xml('no-fill-border', shape('<a:noFill/><a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>', '', '<a:rPr/>')), {}, {});
      check('no-fill-does-not-use-border-color', null, noFill.bgColor, '222-245, 504-528');

      const group = `<p:grpSp xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:grpSpPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="9144000" cy="9144000"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="9144000"/></a:xfrm></p:grpSpPr>${shape('<a:solidFill><a:srgbClr val="123456"/></a:solidFill>', '', '<a:rPr/>')}</p:grpSp>`;
      const rotatedShape = a.parseGroupShapes(xml('group-rotation',group),{},{} )[0];
      const rotatedCanvas = document.createElement('canvas');
      rotatedCanvas.width = rotatedCanvas.height = 960;
      const rotatedCtx = rotatedCanvas.getContext('2d');
      rotatedCtx.fillStyle = '#ffffff'; rotatedCtx.fillRect(0,0,960,960);
      await a.drawShapeOnCanvas(rotatedCtx,rotatedShape,new JSZip(),960,960,{w:960,h:960},1,[],'#ffffff');
      check('group-rotation-pixels', [[18,52,86],[255,255,255]], [
        [...rotatedCtx.getImageData(900,100,1,1).data].slice(0,3),
        [...rotatedCtx.getImageData(100,50,1,1).data].slice(0,3)
      ], '618-662, drawShapeOnCanvas');
      const table = `<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="${A}/table"><a:tbl><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="914400"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
      const tableGroup = group.replace(shape('<a:solidFill><a:srgbClr val="123456"/></a:solidFill>', '', '<a:rPr/>'),table);
      check('grouped-table-present', 1, a.parseGroupShapes(xml('grouped-table',tableGroup),{},{}).length, '650-657');

      const strict = shape('', '', '<a:rPr/>').replaceAll(A,'http://purl.oclc.org/ooxml/drawingml/main').replaceAll(P,'http://purl.oclc.org/ooxml/presentationml/main').replaceAll(R,'http://purl.oclc.org/ooxml/officeDocument/relationships');
      check('strict-ooxml-shape-present', true, a.parseShape(xml('strict-shape',strict),{},{} ) !== null, '46-48, 55-80');

      const fillXml = `<a:spPr xmlns:a="${A}"><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"><a:alpha val="50000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill></a:spPr>`;
      check('alpha-gradient-reaches-canvas', true, a.parseGradientStops(a.parseFill(xml('alpha-gradient',fillXml))) !== null, '974-985');

      const themeZip = new JSZip();
      themeZip.file('ppt/theme/theme1.xml', `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="test"><a:accent1><a:srgbClr val="123456"/></a:accent1></a:clrScheme><a:fontScheme name="test"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
      const accentShape = shape('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>', '', '<a:rPr/>');
      themeZip.file('ppt/slides/slide1.xml', slide(accentShape));
      const themeBuf = await themeZip.generateAsync({type:'arraybuffer'});
      const thumbnailCanvas = document.createElement('canvas');
      await a.renderPptxThumbnail(themeBuf,thumbnailCanvas);
      const pixel = [...thumbnailCanvas.getContext('2d').getImageData(100,5,1,1).data].slice(0,3);
      check('fresh-thumbnail-theme-color', [18,52,86], pixel, '2152-2175');
      const otherThemeZip = await JSZip.loadAsync(themeBuf);
      otherThemeZip.file('ppt/theme/theme1.xml', await themeZip.file('ppt/theme/theme1.xml').async('string').then(s=>s.replace('123456','ABCDEF')));
      const themeCanvases = [document.createElement('canvas'),document.createElement('canvas')];
      await Promise.all([
        a.renderPptxThumbnail(themeBuf, themeCanvases[0]),
        a.renderPptxThumbnail(await otherThemeZip.generateAsync({type:'arraybuffer'}), themeCanvases[1])
      ]);
      check('concurrent-document-theme-isolation', [[18,52,86],[171,205,239]], themeCanvases.map(c=>[...c.getContext('2d').getImageData(100,5,1,1).data].slice(0,3)), 'document render isolation');
      await a.parseTheme(themeZip);
      check('theme-parser-positive-control', '#123456', a.parseShape(xml('theme-accent',accentShape),{},{}).bgColor, '89-112');

      const ordered = new JSZip();
      ordered.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
      ordered.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
      ordered.file('ppt/presentation.xml',`<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
      ordered.file('ppt/_rels/presentation.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="${R}/slide" Target="slides/slide2.xml"/></Relationships>`);
      ordered.file('ppt/slides/slide1.xml',slide(shape('', '', '<a:rPr/>','FIRST')));
      ordered.file('ppt/slides/slide2.xml',slide(shape('', '', '<a:rPr/>','SECOND')));
      fixtures['reordered.pptx'] = Array.from(await ordered.generateAsync({type:'uint8array'}));
      drawn.length = 0;
      await a.renderPptxThumbnail(await ordered.generateAsync({type:'arraybuffer'}),document.createElement('canvas'));
      check('thumbnail-uses-first-presentation-slide','SECOND',drawn.find(d=>['FIRST','SECOND'].includes(d.text))?.text,'2157');
      drawn.length = 0;
      await a.renderPptxViewer({blob:new Blob([await ordered.generateAsync({type:'arraybuffer'})]),name:'ordered.pptx',modalApi:{}});
      await new Promise(resolve=>setTimeout(resolve,300));
      check('viewer-presentation-order',['SECOND','FIRST'],[...new Set(drawn.filter(d=>['FIRST','SECOND'].includes(d.text)).map(d=>d.text))],'2257-2260');
      a.cleanupPptxViewer();
      const longText = 'Long text must wrap across multiple lines in a narrow text box '.repeat(8);
      const textZip = new JSZip();
      textZip.file('ppt/slides/slide1.xml',slide(shape('', '', '<a:rPr/>',longText).replace('9144000','1905000')));
      drawn.length = 0;
      await a.renderPptxThumbnail(await textZip.generateAsync({type:'arraybuffer'}),document.createElement('canvas'));
      check('long-first-run-wraps',true,drawn.length>1,'drawTextShape first-segment wrapping');
      textZip.file('ppt/slides/slide1.xml',slide(shape('', '<a:pPr algn="ctr"/>', '<a:rPr/>','NO_WRAP').replace('<a:bodyPr/>','<a:bodyPr wrap="none"/>')));
      drawn.length = 0;
      await a.renderPptxThumbnail(await textZip.generateAsync({type:'arraybuffer'}),document.createElement('canvas'));
      check('nowrap-center-finite-coordinates',true,drawn.length===1 && Number.isFinite(drawn[0].x) && Number.isFinite(drawn[0].y),'drawTextShape nowrap/alignment');
      const zeroAfterShape = shape('', '<a:pPr><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>', '<a:rPr/>','LINE_A').replace('</a:p>','</a:p><a:p><a:r><a:t>LINE_B</a:t></a:r></a:p>');
      textZip.file('ppt/slides/slide1.xml',slide(zeroAfterShape));
      drawn.length = 0;
      await a.renderPptxThumbnail(await textZip.generateAsync({type:'arraybuffer'}),document.createElement('canvas'));
      const lineA=drawn.find(d=>d.text==='LINE_A'),lineB=drawn.find(d=>d.text==='LINE_B');
      const zeroGapAdvance = lineB.y-lineA.y;
      textZip.file('ppt/slides/slide1.xml',slide(zeroAfterShape.replace('val="0"','val="200"')));
      drawn.length = 0;
      await a.renderPptxThumbnail(await textZip.generateAsync({type:'arraybuffer'}),document.createElement('canvas'));
      const twoPointAdvance = drawn.find(d=>d.text==='LINE_B').y-drawn.find(d=>d.text==='LINE_A').y;
      // Changing explicit after-spacing from 0 to 2pt must add 2*96/72*240/960 px.
      // Comparing advances cancels font line metrics; no assumed default line factor.
      check('explicit-zero-paragraph-after',0.6667,Number((twoPointAdvance-zeroGapAdvance).toFixed(4)),'a:spcPts unit conversion and explicit zero');
      CanvasRenderingContext2D.prototype.fillText = nativeFill;
      return { cases, fixtures, browser: navigator.userAgent };
    });
    for (const [name,data] of Object.entries(results.fixtures)) fs.writeFileSync(path.join(out,'fixtures',name),Array.isArray(data)?Buffer.from(data):data);
    delete results.fixtures;
    results.sourceCommit = execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    results.sourcePath = viewer;
    results.sourceSha256 = bundle.sourceSha256;
    results.dependencyHashes = bundle.dependencyHashes;
    results.bundleSha256 = bundle.bundleSha256;
    results.changedDependencies = bundle.changedDependencies();
    results.timestamp = new Date().toISOString();
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
    for (const c of results.cases) console.log(`${c.matchesSpec?'MATCH':'MISMATCH'} ${c.id}: expected=${JSON.stringify(c.expected)} actual=${JSON.stringify(c.actual)}`);
    const mismatches = results.cases.filter(c=>!c.matchesSpec).length;
    console.log(`${results.cases.length} cases executed; ${mismatches} spec mismatches. These are defect probes, not a full conformance suite.`);
    process.exitCode = mismatches ? 1 : 0;
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=2; });
