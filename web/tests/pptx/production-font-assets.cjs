const __pptxRuntime = require('./runtime.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {checkProductionFontAssets}=require('./viewer-bundle.cjs');
const result={issue:'SEN-2600',timestamp:new Date().toISOString(),...checkProductionFontAssets()};
fs.writeFileSync(path.join(__pptxRuntime.outputDir,'production-font-assets-results.json'),JSON.stringify(result,null,2)+'\n');
for(const file of result.files)console.log(`${file.matches?'MATCH':'MISMATCH'} source/dist ${file.name}`);
process.exitCode=result.status==='pass'?0:1;
