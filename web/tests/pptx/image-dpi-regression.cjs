#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),os=require('node:os'),{inflateRawSync}=require('node:zlib');
const runtime=require('./runtime.cjs');
(async()=>{
 const source=path.join(runtime.viewerDir,'pptx-image-metadata.js'),sourceBytes=fs.readFileSync(source),{readImageDpi}=await import('data:text/javascript;base64,'+sourceBytes.toString('base64')),cases=[];
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const test=(name,fn)=>{try{cases.push({name,status:'MATCH',evidence:fn()});}catch(error){cases.push({name,status:'FAIL',error:error.message});}};
 const check=(dpi,x,y)=>{if(!dpi||Math.abs(dpi.x-x)>1e-9||Math.abs(dpi.y-y)>1e-9)throw Error(JSON.stringify({actual:dpi,expected:{x,y}}));return dpi;};
 const jfif=(units,x,y)=>{const bytes=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,2,units,0,0,0,0,0,0,255,217]);bytes.writeUInt16BE(x,14);bytes.writeUInt16BE(y,16);return bytes;};
 test('JPEG JFIF inch resolution',()=>check(readImageDpi(jfif(1,75,75)),75,75));
 test('JPEG JFIF centimetre resolution with unequal axes',()=>check(readImageDpi(jfif(2,100,200)),254,508));
 test('JPEG unitless ratio is not DPI',()=>{if(readImageDpi(jfif(0,75,75))!==null)throw Error('Unitless ratio became DPI');return null;});
 test('truncated JPEG metadata is rejected',()=>{if(readImageDpi(jfif(1,75,75).subarray(0,15))!==null)throw Error('Truncated bytes accepted');return null;});
 const exif=(little,unit)=>{const tiff=Buffer.alloc(66);tiff.write(little?'II':'MM');const u16=(value,p)=>little?tiff.writeUInt16LE(value,p):tiff.writeUInt16BE(value,p),u32=(value,p)=>little?tiff.writeUInt32LE(value,p):tiff.writeUInt32BE(value,p);u16(42,2);u32(8,4);u16(3,8);for(const [index,tag,location]of [[0,282,50],[1,283,58]]){const p=10+index*12;u16(tag,p);u16(5,p+2);u32(1,p+4);u32(location,p+8);}u16(296,34);u16(3,36);u32(1,38);u16(unit,42);u32(755,50);u32(10,54);u32(1510,58);u32(10,62);const payload=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),prefix=Buffer.from([255,216,255,225,0,0]);prefix.writeUInt16BE(payload.length+2,4);return Buffer.concat([prefix,payload,Buffer.from([255,217])]);};
 test('JPEG EXIF little endian rational resolution',()=>check(readImageDpi(exif(true,2)),75.5,151));
 test('JPEG EXIF big endian centimetre resolution',()=>check(readImageDpi(exif(false,3)),75.5*2.54,151*2.54));
 const png=Buffer.alloc(8+12+9);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(9,8);png.write('pHYs',12);png.writeUInt32BE(11811,16);png.writeUInt32BE(5906,20);png[24]=1;
 test('PNG pHYs metre resolution preserves unequal axes',()=>check(readImageDpi(png),11811*.0254,5906*.0254));
 test('PNG unitless pHYs is not DPI',()=>{const unitless=Buffer.from(png);unitless[24]=0;if(readImageDpi(unitless)!==null)throw Error('Unitless pHYs accepted');return null;});
 const file=path.join(process.env.PPTX_CORPUS_CACHE||path.join(os.tmpdir(),'sentry-pptx-corpus'),'apache__poi__backgrounds.pptx'),fixtureBytes=fs.readFileSync(file);
 let end=fixtureBytes.length-22;while(end>=Math.max(0,fixtureBytes.length-65557)&&fixtureBytes.readUInt32LE(end)!==0x06054b50)end--;if(end<0)throw Error('ZIP end-of-central-directory missing');
 let offset=fixtureBytes.readUInt32LE(end+16);const entries=fixtureBytes.readUInt16LE(end+10);let images=0;
 for(let i=0;i<entries;i++){if(fixtureBytes.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid ZIP central directory');const nameLength=fixtureBytes.readUInt16LE(offset+28),extraLength=fixtureBytes.readUInt16LE(offset+30),commentLength=fixtureBytes.readUInt16LE(offset+32),part=fixtureBytes.subarray(offset+46,offset+46+nameLength).toString();
  if(part.startsWith('ppt/media/')&&part.endsWith('.jpeg')){const local=fixtureBytes.readUInt32LE(offset+42),body=local+30+fixtureBytes.readUInt16LE(local+26)+fixtureBytes.readUInt16LE(local+28),compressed=fixtureBytes.subarray(body,body+fixtureBytes.readUInt32LE(offset+20)),method=fixtureBytes.readUInt16LE(offset+10);if(method!==0&&method!==8)throw Error('Unsupported ZIP compression');const bytes=method===8?inflateRawSync(compressed):compressed;images++;test('Real online backgrounds '+part,()=>{const dpi=check(readImageDpi(bytes),75,75);return {part,sha256:hash(bytes),dpi,expectedPeriodAt72Ppi:128/75*72};});}
  offset+=46+nameLength+extraLength+commentLength;
 }
 if(images!==5)throw Error('Expected five real JPEG textures');
 const report={cases,sourceSha256:hash(sourceBytes),fixture:{file,sha256:hash(fixtureBytes)},operationalStatus:cases.every(c=>c.status==='MATCH')?'pass':'fail',acceptanceStatus:'unverified',scope:'Metadata and provenance assertions; real Microsoft pixel comparison required separately'};
 fs.writeFileSync(path.join(runtime.outputDir,'image-dpi-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:cases.length,failures:cases.filter(c=>c.status==='FAIL'),status:report.operationalStatus}));process.exitCode=report.operationalStatus==='pass'?0:1;
})().catch(error=>{console.error(error);process.exitCode=2;});
