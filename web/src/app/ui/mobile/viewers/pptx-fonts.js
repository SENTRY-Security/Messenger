import { decompressMtx } from './vendor/mtx-decompressor/index.js';
// Carlito is distributed under SIL OFL 1.1; see src/assets/fonts/carlito/OFL.txt.
let fallbackLoading;
let documentSerial = 0;
const fallbackMetrics = {};
const variants = [['regular','400','normal'],['bold','700','normal'],['italic','400','italic'],['boldItalic','700','italic']];

async function loadCarlito(diagnostics) {
  if (!globalThis.FontFace || !document.fonts) return;
  fallbackLoading ||= Promise.all(variants.map(async ([variant, weight, style]) => {
    const name = {regular:'Regular',bold:'Bold',italic:'Italic',boldItalic:'BoldItalic'}[variant];
    const response=await fetch(`/assets/fonts/carlito/Carlito-${name}.ttf`);
    if(!response.ok)throw new Error(`Carlito font HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    const face = new FontFace('Pptx Carlito', bytes, {weight,style});
    fallbackMetrics[variant]=readSfntLineMetrics(bytes);
    await face.load(); document.fonts.add(face);
  }));
  try { await fallbackLoading; }
  catch (error) { diagnostics.push({code:'fallback-font-load-failed',detail:error.message}); fallbackLoading = null; }
}

export function readSfntLineMetrics(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tables={};
  for(let i=0;i<view.getUint16(4);i++){const entry=12+i*16;tables[view.getUint32(entry)]=view.getUint32(entry+8);}
  const head=tables[0x68656164],hhea=tables[0x68686561],os2=tables[0x4f532f32];
  if(head==null||hhea==null)return null;
  const em=view.getUint16(head+18);let ascent=view.getInt16(hhea+4),descent=-view.getInt16(hhea+6),gap=view.getInt16(hhea+8);
  if(os2!=null&&(view.getUint16(os2+62)&0x80)){ascent=view.getInt16(os2+68);descent=-view.getInt16(os2+70);gap=view.getInt16(os2+72);}
  return em>0?{ascent:ascent/em,descent:descent/em,gap:gap/em,line:(ascent+descent+gap)/em}:null;
}

function validateSfnt(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12) throw new Error('Truncated embedded font');
  const signature = view.getUint32(0);
  if (![0x00010000,0x4f54544f,0x74727565].includes(signature)) throw new Error('Embedded font encoding requires decoding (not a standalone SFNT font)');
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.length) throw new Error('Truncated embedded font table directory');
  for (let i=0;i<count;i++) {
    const entry=12+i*16, offset=view.getUint32(entry+8), length=view.getUint32(entry+12);
    if (offset+length>bytes.length) throw new Error('Embedded font table exceeds part bounds');
    if(view.getUint32(entry)===0x4f532f32 && length>=10) {
      const fsType=view.getUint16(offset+8);
      if(fsType&0x0002) throw new Error('Embedded font prohibits embedding');
      if(fsType&0x0200) throw new Error('Embedded font permits bitmap embedding only');
    }
  }
}

export function extractPptxFontPayload(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length < 36 || view.getUint16(34,true) !== 0x504c) return {bytes,compressed:false,encrypted:false};
  const size=view.getUint32(0,true),dataSize=view.getUint32(4,true),version=view.getUint32(8,true),flags=view.getUint32(12,true),fsType=view.getUint16(32,true);
  if(size<82||size>bytes.length||!dataSize)throw new Error('Invalid EOT font header bounds');
  if(fsType&0x0002||fsType&0x0200)throw new Error('Embedded EOT font licensing does not permit outline embedding');
  if(![0x00010000,0x00020001,0x00020002].includes(version))throw new Error('Unsupported EOT font version');
  let offset=82;
  const advanceString=(padding=0)=>{
    if(offset+2>size)throw new Error('Truncated EOT name length');
    const length=view.getUint16(offset,true);offset+=2+length+padding;
    if(offset>size||length%2)throw new Error('Invalid EOT name bounds');
  };
  for(const padding of [2,2,2,0])advanceString(padding);
  if(version>=0x00020001){offset+=2;advanceString();}
  if(version>=0x00020002){offset+=10;advanceString();offset+=4;if(offset+4>size)throw new Error('Truncated EOT EUDC data');offset+=4+view.getUint32(offset,true);}
  if(offset+dataSize>size)throw new Error('EOT font payload exceeds part bounds');
  return {bytes:bytes.subarray(offset,offset+dataSize),compressed:!!(flags&4),encrypted:!!(flags&0x10000000)};
}

// Some PowerPoint-generated EOT subsets retain a nonzero reserved format-12
// language field. The input CTF checksum includes that field, so this is not
// an MTX decoder error. Normalize only the reserved field; preserve mappings.
export function normalizeEmbeddedCmapLanguage(input) {
  const bytes=input.slice(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),repairs=[];
  const records=[];let cmap,head;
  for(let i=0;i<view.getUint16(4);i++) {
    const entry=12+i*16,tag=view.getUint32(entry),offset=view.getUint32(entry+8),length=view.getUint32(entry+12);
    const record={entry,offset,length};records.push(record);
    if(tag===0x636d6170)cmap=record;if(tag===0x68656164)head=record;
  }
  if(!cmap)return {bytes:input,repairs};
  const count=view.getUint16(cmap.offset+2),visited=new Set();
  if(4+count*8>cmap.length)throw new Error('Invalid embedded cmap directory');
  for(let i=0;i<count;i++) {
    const record=cmap.offset+4+i*8,platform=view.getUint16(record),subOffset=view.getUint32(record+4);
    if(subOffset+2>cmap.length)throw new Error('Embedded cmap subtable is out of bounds');
    const start=cmap.offset+subOffset,format=view.getUint16(start);
    if(platform===1||format!==12||visited.has(start))continue;
    visited.add(start);
    if(subOffset+16>cmap.length||subOffset+view.getUint32(start+4)>cmap.length)throw new Error('Invalid embedded format-12 cmap');
    const language=view.getUint32(start+8);
    if(language){view.setUint32(start+8,0);repairs.push({code:'embedded-font-reserved-field-normalized',table:'cmap',format,previousLanguage:language});}
  }
  if(!repairs.length)return {bytes:input,repairs};
  const checksum=(offset,length)=>{
    let sum=0;
    for(let i=0;i<length;i+=4){let word=0;for(let j=0;j<4;j++)word=(word<<8)|(i+j<length?bytes[offset+i+j]:0);sum=(sum+(word>>>0))>>>0;}
    return sum;
  };
  view.setUint32(cmap.entry+4,checksum(cmap.offset,cmap.length));
  if(head&&head.length>=12){view.setUint32(head.offset+8,0);view.setUint32(head.entry+4,checksum(head.offset,head.length));view.setUint32(head.offset+8,(0xb1b0afba-checksum(0,bytes.length))>>>0);}
  return {bytes,repairs};
}

export async function loadPptxFonts(zip,{parseXml,resolvePartPath,relationshipNamespace,presentationNamespace}) {
  const diagnostics=[], aliases={}, faces=[],metrics={};
  await loadCarlito(diagnostics);
  if(fallbackMetrics.regular) for(const family of ['Pptx Carlito','Calibri']) {
    metrics[family]=fallbackMetrics.regular;
    for(const [variant,weight,style]of variants) if(fallbackMetrics[variant])metrics[`${family}|${weight}|${style}`]=fallbackMetrics[variant];
  }
  const xml=await zip.file('ppt/presentation.xml')?.async('string');
  const relXml=await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!xml || !relXml || !globalThis.FontFace || !document.fonts) return {aliases,metrics,diagnostics,dispose(){}};
  const doc=parseXml(xml), rels=new Map([...parseXml(relXml).getElementsByTagNameNS('*','Relationship')].filter(el=>el.getAttribute('TargetMode')!=='External').map(el=>[el.getAttribute('Id'),el.getAttribute('Target')]));
  const serial=++documentSerial;
  for (const embedded of doc.getElementsByTagNameNS(presentationNamespace,'embeddedFont')) {
    const children=[...embedded.children], original=children.find(el=>el.localName==='font')?.getAttribute('typeface');
    if(!original) continue;
    const alias=`Pptx Embedded ${serial} ${Object.keys(aliases).length}`;
    for(const [variant,weight,style]of variants) {
      const reference=children.find(el=>el.localName===variant),id=reference?.getAttributeNS(relationshipNamespace,'id'),target=rels.get(id);
      if(!target) continue;
      try {
        const path=resolvePartPath('ppt/',target),file=zip.file(path);
        if(!file) throw new Error('Embedded font part is missing');
        const payload=extractPptxFontPayload(await file.async('uint8array'));
        const decoded=decompressMtx(payload.bytes,{compressed:payload.compressed,encrypted:payload.encrypted});validateSfnt(decoded);
        const {bytes,repairs}=normalizeEmbeddedCmapLanguage(decoded);
        diagnostics.push(...repairs.map(repair=>({...repair,font:original,variant})));
        const lineMetrics=readSfntLineMetrics(bytes);
        metrics[alias] ||= lineMetrics; metrics[`${alias}|${weight}|${style}`]=lineMetrics;
        const face=new FontFace(alias,bytes,{weight,style});await face.load();document.fonts.add(face);faces.push(face);aliases[original]=alias;
      } catch(error) { diagnostics.push({code:'embedded-font-load-failed',font:original,variant,detail:error.message}); }
    }
  }
  diagnostics.push({code:'font-substitution-available',font:'Calibri',fallback:'Carlito',detail:'Metrics-compatible substitute; Microsoft pixel equivalence remains unverified.'});
  return {aliases,metrics,diagnostics,dispose(){for(const face of faces)document.fonts.delete(face);faces.length=0;}};
}
