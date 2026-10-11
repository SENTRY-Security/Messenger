'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const runtime=require('./runtime.cjs');
const {pathToFileURL}=require('node:url');
(async()=>{
  const verification=await import(pathToFileURL(path.join(__dirname,'corpus/fetch-corpus.mjs')).href);
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'corpus/supplementary-modern-chart-research.json'),'utf8'));
  const specimen=manifest.files.find(item=>item.id==='LibreOffice__core__regionMap');
  const cache=process.env.PPTX_MODERN_CHART_CACHE||path.join(os.tmpdir(),'sentry-modern-chart-research');
  const file=path.join(cache,specimen.file),bytes=fs.readFileSync(file),checked=verification.verifySpecimen(bytes,specimen);
  const files=require('./chart-fixtures.cjs').filesFromVerifiedZip(bytes),xml=files['xl/charts/chartEx1.xml'];
  const sourcesBefore=runtime.sourceState();
  const {chromium}=runtime.playwright(),browser=await chromium.launch(runtime.launchOptions());
  try{
    const page=await browser.newPage();
    await page.addScriptTag({content:fs.readFileSync(path.join(runtime.viewerDir,'pptx-chart-map.js'),'utf8').replace(/^export /gm,'')+'\nwindow.mapCodec={decodeCompressedGeoPoints,encodeCompressedGeoPoints,decodeChartGeoCache,resolveGeoCategoryEntities};'});
    const result=await page.evaluate(async xml=>{
      const api=window.mapCodec,cases=[],check=(id,pass,actual)=>cases.push({id,pass:!!pass,actual});
      const official=[[35.89431,-110.72522],[35.89393,-110.72578],[35.89374,-110.72606],[35.89337,-110.72662]];
      check('Microsoft primary PCA four-point published vector decodes quantized values',JSON.stringify(api.decodeCompressedGeoPoints('vx1vilihnM6hR7mEl2Q'))===JSON.stringify(official),api.decodeCompressedGeoPoints('vx1vilihnM6hR7mEl2Q'));
      check('Independent PCA inverse roundtrips primary vector',api.encodeCompressedGeoPoints(official)==='vx1vilihnM6hR7mEl2Q',api.encodeCompressedGeoPoints(official));
      const crossing=[[20,179],[20,-179],[21,178]],encoded=api.encodeCompressedGeoPoints(crossing);
      check('PCA authored antimeridian deltas wrap180degree boundary',JSON.stringify(api.decodeCompressedGeoPoints(encoded))===JSON.stringify(crossing),{encoded,points:api.decodeCompressedGeoPoints(encoded)});
      check('PCA zero pair is encoded as one zero digit',api.encodeCompressedGeoPoints([[0,0]])==='A'&&JSON.stringify(api.decodeCompressedGeoPoints('A'))==='[[0,0]]',api.decodeCompressedGeoPoints('A'));
      let rejected=0;for(const malformed of ['!','g','_________________A']){try{api.decodeCompressedGeoPoints(malformed);}catch(e){if(e.name==='UnsupportedChartMapError')rejected++;}}
      check('PCA invalid alphabet truncated varint and unsafe precision explicitly fail',rejected===3,{rejected});
      const doc=new DOMParser().parseFromString(xml,'application/xml'),cache=doc.getElementsByTagNameNS('*','geoCache')[0];
      const data=await api.decodeChartGeoCache(cache),polygons=data.entities.flatMap(entity=>entity.polygons);
      check('Authentic regionMap binary cache inflates complete XML and698validatedpolygons',data.entities.length===59&&polygons.length===698&&polygons.every(p=>p.count===p.rings.flat().length),{entities:data.entities.length,polygons:polygons.length,points:polygons.reduce((sum,p)=>sum+p.count,0)});
      const within=data.entities.every(entity=>entity.polygons.every(polygon=>polygon.rings.every(ring=>ring.every(([lat,lon])=>lon>=entity.bounds.west-.00003&&lon<=entity.bounds.east+.00003&&lat>=entity.bounds.south-.00003&&lat<=entity.bounds.north+.00003))));
      check('All698realPCApolygons remain inside authored Bing entity bounds',within,{within});
      const categories=['Mali','Cameroun','Niger','Uganda','Eritrea','Kenya','Ivory Coast','Benin','Morocco','Rwanda'];
      const mapped=api.resolveGeoCategoryEntities(data,categories);
      check('Authentic regionMap ten category queries resolve coordinate-to-entity IDs including authored language aliases',mapped.length===10&&mapped.every(item=>item.entity?.polygons.length>0)&&mapped[1].entity.name==='Cameroon'&&mapped[6].entity.name==="Côte d'Ivoire",mapped.map(item=>({category:item.category,id:item.entity.id,name:item.entity.name})));
      let missing=false;try{api.resolveGeoCategoryEntities(data,['UncachedCountry']);}catch(error){missing=error.name==='UnsupportedChartMapError';}
      check('Missing cached category identity fails rather than substituting name or generic shape',missing,{missing});
      return {passed:cases.every(c=>c.pass),cases,fullMicrosoftRenderingAcceptance:'unverified',pending:['RegionMap geographic projection and exact Microsoft visual rendering','Data values/theme coloring/labels/legend rendering']};
    },xml);
    result.provenance={kind:'authentic supplementary XLSX research input, not native PPTX or Microsoft golden',sourceUrl:specimen.source_url,sourceCommit:specimen.source_commit,sourceSha256:checked.sha256,crcVerified:checked.crcVerified,part:'xl/charts/chartEx1.xml',partSha256:runtime.digest(Buffer.from(xml))};
    result.changedSources=runtime.changedSources(sourcesBefore,runtime.sourceState());result.sourceChanged=result.changedSources.length>0;if(result.sourceChanged)result.passed=false;
    fs.writeFileSync(path.join(runtime.outputDir,'chart-map-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
