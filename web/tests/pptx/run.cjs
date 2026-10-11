'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtime = require('./runtime.cjs');
const suites = [
  ['regression','results.json'], ['geometry-regression','geometry-results.json'],
  ['office-geometry-traits','office-geometry-traits-results.json'],
  ['office-text-table-traits','office-text-table-traits-results.json'],
  ['office-color-traits','office-color-traits-results.json'],
  ['office-picture-effects-traits','office-picture-effects-traits-results.json'],
  ['office-table-text-traits','office-table-text-traits-results.json'],
  ['office-line-spacing-traits','office-line-spacing-traits-results.json'],
  ['chart-table-regression','chart-table-results.json'], ['next-spec-regression','next-spec-results.json'],
  ['font-host-regression','font-host-results.json'], ['production-font-assets','production-font-assets-results.json'],
  ['chart-types-regression','chart-types-results.json'],
  ['chart-effects-regression','chart-effects-results.json'],
  ['chart-map-regression','chart-map-results.json'],
  ['corpus-chart-evidence','native-chart-evidence/report.json'],
  ['playback-regression','playback-results.json'],
  ['viewer-playback-regression','viewer-playback-results/report.json'],
  ['drawing-fill-regression','drawing-fill-results/report.json'],
  ['drawing-effects-regression','drawing-effects-results/report.json'],
  ['native-drawing-effects-regression','native-drawing-effects-results/report.json'],
  ['transition-cancel-regression','transition-cancel-results/report.json'],
  ['image-dpi-regression','image-dpi-results.json'],
  ['glyph-layer-regression','glyph-layer-results/report.json'],
  ['text-cascade-regression','text-cascade-results.json'],
  ['table-fill-regression','table-fill-results.json'],
  ['corpus-subtitle-observation','subtitle-observations/report.json'],
  ['corpus-bookmark-observation','bookmark-observations/report.json'],
  ['metafile-dib-regression','metafile-dib-results.json'],
  ['placeholder-transform-regression','placeholder-transform-results.json'],
  ['metafile-wmf-regression','metafile-wmf-results.json'],
  ['metafile-emf-regression','metafile-emf-results.json'],
  ['shape-paint-regression','shape-paint-results/report.json'],
  ['text-paint-regression','text-paint-results/report.json'],
  ['viewer-frame-regression','viewer-frame-results/report.json'],
  ['blip-destination-effects-regression','blip-destination-effects-results/report.json'],
  ['metafile-frame-regression','metafile-frame-results.json'],
  ['shape-paint-cancel-regression','shape-paint-cancel-results/results.json']
];
const requested = process.argv.slice(2);
if (requested.includes('--list')) { console.log(suites.map(([name])=>name).join('\n')); process.exit(0); }
const chosen = requested.length ? suites.filter(([name])=>requested.includes(name)) : suites;
if (!chosen.length || requested.some(name=>!suites.some(([known])=>known===name))) {
  console.error('Unknown or empty PPTX suite selection. Use --list.'); process.exit(2);
}
const report = {timestamp:new Date().toISOString(),scope:'Limited independent traits; Microsoft visual/timing/device acceptance remains unverified.',suites:[],sourceHashes:runtime.sourceState()};
for (const [name,resultName] of chosen) {
  const outputDir = path.join(runtime.outputDir,name);
  fs.rmSync(outputDir,{recursive:true,force:true}); fs.mkdirSync(outputDir,{recursive:true});
  const before = runtime.sourceState();
  const run = spawnSync(process.execPath,[path.join(__dirname,name+'.cjs')],{
    env:{...process.env,PPTX_RESULTS_DIR:outputDir},encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024
  });
  fs.writeFileSync(path.join(outputDir,'stdout.txt'),run.stdout||'');fs.writeFileSync(path.join(outputDir,'stderr.txt'),run.stderr||'');
  let artifact,validationError;
  try {
    artifact=JSON.parse(fs.readFileSync(path.join(outputDir,resultName),'utf8'));
    const cases=artifact.cases??artifact.files;
    if(!Array.isArray(cases)||!cases.length)throw new Error('Empty result oracle');
    if(cases.some(c=>![c.matchesSpec,c.matchesSpecification,c.matchesMicrosoft,c.matchesTrait,c.pass,c.matches,c.passed].some(v=>typeof v==='boolean')&&!['MATCH','PASS','FAIL'].includes(c.status)))throw new Error('Case lacks an explicit oracle');
    if(cases.some(c=>c.status==='FAIL'))throw new Error('Trait mismatch');
    if(cases.some(c=>[c.matchesSpec,c.matchesSpecification,c.matchesMicrosoft,c.matchesTrait,c.pass,c.matches,c.passed].some(v=>v===false)))throw new Error('Trait mismatch');
    if(artifact.sourceChanged||artifact.changedDependencies?.length)throw new Error('Result source changed during probe');
  }catch(error){validationError=String(error.message);}
  const changedSources=runtime.changedSources(before);
  const status=run.error||run.status===null||![0,3].includes(run.status)?'failed':validationError||changedSources.length?'invalid':run.status===3?'unverified':'traits-passed';
  report.suites.push({name,status,exitCode:run.status,error:run.error?.message,validationError,changedSources,resultPath:path.relative(__dirname,path.join(outputDir,resultName)),caseCount:(artifact?.cases??artifact?.files)?.length??0});
  console.log(`${status.toUpperCase()} ${name}: ${report.suites.at(-1).caseCount} cases`);
}
report.changedSources=runtime.changedSources(report.sourceHashes);
report.status=report.changedSources.length||report.suites.some(s=>['failed','invalid'].includes(s.status))?'failed':report.suites.some(s=>s.status==='unverified')?'unverified':'traits-passed';
report.fullAcceptance='unverified';
fs.writeFileSync(path.join(runtime.outputDir,'summary.json'),JSON.stringify(report,null,2)+'\n');
process.exitCode=report.status==='failed'?1:report.status==='unverified'?3:0;
