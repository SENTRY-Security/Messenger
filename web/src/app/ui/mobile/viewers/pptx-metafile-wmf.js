import { UnsupportedMetafileError } from './pptx-metafile-dib.js';

// MS-WMF 2.3.2.3/.4, 2.3.3.14, 2.3.4, 3.1.4.1 and 3.3.4.
// Capability gate: unsupported drawing records fail rather than disappear.
const fail = message => { throw new UnsupportedMetafileError(message); };
const rgb = value => `rgb(${value & 255},${value >>> 8 & 255},${value >>> 16 & 255})`;
export function decodeWmfVector(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 40) fail('Truncated placeable WMF');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = n => view.getUint16(n, true), s16 = n => view.getInt16(n, true), u32 = n => view.getUint32(n, true);
  if (u32(0) !== 0x9ac6cdd7) fail('Non-placeable WMF requires explicit playback bounds');
  let checksum = 0;
  for (let i = 0; i < 20; i += 2) checksum ^= u16(i);
  if (checksum !== u16(20) || u32(16) !== 0 || u16(4) !== 0 || !u16(14)) fail('Invalid WMF placeable header/checksum');
  const bounds = [s16(6), s16(8), s16(10), s16(12)];
  const logicalWidth = bounds[2] - bounds[0], logicalHeight = bounds[3] - bounds[1];
  if (logicalWidth <= 0 || logicalHeight <= 0 || ![1,2].includes(u16(22)) || u16(24) !== 9 || ![0x100,0x300].includes(u16(26)) || u32(28) * 2 !== data.length - 22 || u16(38) !== 0) fail('Invalid WMF header/bounds');
  const capacity = u16(32), maxRecordWords = u32(34);
  if (!capacity || capacity > 32768 || maxRecordWords < 3) fail('Invalid WMF object/record limits');
  const objects = new Array(capacity).fill(null), operations = [], records = [], ignoredTails = [];
  const blackPen = { kind:'pen', style:0, width:0, color:0 };
  const whiteBrush = { kind:'brush', style:0, color:0xffffff };
  let state = { origin:[bounds[0],bounds[1]], extent:[logicalWidth,logicalHeight], viewportOrigin:[0,0], viewportExtent:[logicalWidth,logicalHeight], mode:8, rop:13, fillMode:1, pen:blackPen, brush:whiteBrush, position:[0,0] };
  const saved = [];
  const insert = object => { const index = objects.indexOf(null); if (index < 0) fail('WMF object table exhausted'); objects[index] = object; };
  const map = (x,y) => [0,1].map((axis) => (axis ? y : x) - (state.mode === 1 ? 0 : state.origin[axis])).map((v,axis) => state.mode === 1 ? v : v * state.viewportExtent[axis] / state.extent[axis] + state.viewportOrigin[axis]);
  const emit = (kind, points, closed) => {
    const sx = state.mode === 1 ? 1 : state.viewportExtent[0] / state.extent[0];
    operations.push({ kind, points:points.map(p=>map(...p)), closed, fillMode:state.fillMode, rop:state.rop, pen:{...state.pen, deviceWidth:state.pen.width === 0 ? 0 : Math.abs(state.pen.width * sx)}, brush:{...state.brush} });
  };
  let offset = 40, ended = false;
  while (offset < data.length) {
    if (offset + 6 > data.length) fail('Truncated WMF record');
    const words = u32(offset), type = u16(offset+4), size = words * 2, p = offset + 6;
    if (words < 3 || words > maxRecordWords || offset + size > data.length) fail('Invalid WMF record size');
    const need = n => { if (size < n+6) fail('Truncated WMF parameters'); };
    const exact = n => { need(n); if(size !== n+6) fail('Invalid WMF parameter count'); };
    const pair = () => { exact(4); return [s16(p+2),s16(p)]; };
    records.push({offset,type,size});
    if (type === 0) { exact(0); if(offset+size !== data.length) fail('WMF EOF must be final'); ended = true; }
    else if (type === 0x20b) state.origin = pair();
    else if (type === 0x20c) { state.extent = pair(); if(state.extent.some(v=>v===0)) fail('Zero WMF window extent'); }
    else if (type === 0x20d) state.viewportOrigin = pair();
    else if (type === 0x20e) { state.viewportExtent = pair(); if(state.viewportExtent.some(v=>v===0)) fail('Zero WMF viewport extent'); }
    else if (type === 0x103) { exact(2); const mode=u16(p); if(![1,8].includes(mode)) fail('Unsupported WMF mapping mode '+mode); state.mode=mode; }
    else if (type === 0x104) { exact(2); state.rop=u16(p); if(state.rop<1||state.rop>16) fail('Invalid WMF ROP2'); }
    else if (type === 0x106) { exact(2); state.fillMode=u16(p); if(![1,2].includes(state.fillMode)) fail('Invalid WMF polygon fill mode'); }
    else if (type === 0x2fc) { exact(8); const style=u16(p); if(![0,1].includes(style)) fail('Unsupported WMF patterned brush'); insert({kind:'brush',style,color:u32(p+2)}); }
    else if (type === 0x2fa) {
      need(10); if(size !== 16 && size !== 18) fail('Unsupported WMF pen record extension');
      const style=u16(p); if(![0,5].includes(style)) fail('Unsupported WMF dashed/geometric pen');
      insert({kind:'pen',style,width:Math.abs(s16(p+2)),color:u32(p+6)});
      if(size>16) ignoredTails.push({offset,bytes:Array.from(data.slice(offset+16,offset+size)),status:'Unspecified producer tail; defined 10-byte Pen Object consumed'});
    }
    else if (type === 0x12d) { exact(2); const index=u16(p), object=objects[index]; if(!object) fail('WMF selects missing object '+index); state[object.kind]=object; }
    else if (type === 0x1f0) { exact(2); const index=u16(p); if(!objects[index]) fail('WMF deletes missing object '+index); if(state.pen===objects[index]||state.brush===objects[index]) fail('WMF deletes selected object'); objects[index]=null; }
    else if (type === 0x324 || type === 0x325) {
      need(2); const count=u16(p); exact(2+count*4); if(count<2) fail('Invalid WMF polygon/polyline point count');
      const points=Array.from({length:count},(_,i)=>[s16(p+2+i*4),s16(p+4+i*4)]); emit('path',points,type===0x324);
    }
    else if (type === 0x214) state.position=pair();
    else if (type === 0x213) { const end=pair(); emit('path',[state.position,end],false); state.position=end; }
    else if (type === 0x41b || type === 0x418) { exact(8); const b=s16(p),r=s16(p+2),t=s16(p+4),l=s16(p+6); emit(type===0x41b?'rectangle':'ellipse',[[l,t],[r,b]],true); }
    else if (type === 0x1e) { exact(0); saved.push({...state,origin:[...state.origin],extent:[...state.extent],viewportOrigin:[...state.viewportOrigin],viewportExtent:[...state.viewportExtent],position:[...state.position]}); }
    else if (type === 0x127) { exact(2); const index=s16(p), target=index<0?saved.length+index:index-1; if(target<0||target>=saved.length) fail('Invalid WMF RestoreDC'); state=saved[target]; saved.length=target; }
    else fail('Unsupported WMF record 0x'+type.toString(16)+' at '+offset);
    offset += size;
  }
  if(!ended || !operations.length) fail('Incomplete WMF or no drawing operations');
  return {logicalWidth,logicalHeight,bounds,inch:u16(14),intrinsicCssWidth:logicalWidth*96/u16(14),intrinsicCssHeight:logicalHeight*96/u16(14),rasterResolution:'Default one pixel per logical unit; intrinsic CSS dimensions are separate',operations,records,ignoredTails,scope:'Placeable GDI polygon/line/solid brush/pen subset; not complete WMF or Microsoft pixel acceptance'};
}
function rop2(mode,p,d) {
  const values=[0,~(p|d),~p&d,~p, p&~d,~d,p^d,~(p&d),p&d,~(p^d),d,~p|d,p,p|~d,p|d,255];
  return values[mode-1]&255;
}
export function renderWmfVector(bytes, options={}) {
  const model=decodeWmfVector(bytes),width=options.width??model.logicalWidth,height=options.height??model.logicalHeight;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>16384||height>16384||width*height>32000000) fail('Invalid/excessive WMF output dimensions');
  const output=document.createElement('canvas'); output.width=width;output.height=height;
  const ctx=output.getContext('2d'),sx=width/model.logicalWidth,sy=height/model.logicalHeight;
  if(options.background){ctx.fillStyle=options.background;ctx.fillRect(0,0,width,height);}
  const makePath=(c,op)=>{c.beginPath();const points=op.points.map(p=>[p[0]*sx,p[1]*sy]);
    if(op.kind==='ellipse'){const a=points[0],b=points[1];c.ellipse((a[0]+b[0])/2,(a[1]+b[1])/2,Math.abs(b[0]-a[0])/2,Math.abs(b[1]-a[1])/2,0,0,Math.PI*2);}
    else if(op.kind==='rectangle'){const a=points[0],b=points[1];c.rect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}
    else{c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);if(op.closed)c.closePath();}
    c.lineWidth=op.pen.deviceWidth===0?1:op.pen.deviceWidth*sx;c.lineCap='round';c.lineJoin='round';};
  const paint=(op,fill)=>{
    if(op.rop===11)return;
    const color=fill?op.brush.color:op.pen.color;
    if(op.rop===13){makePath(ctx,op);if(fill){ctx.fillStyle=rgb(color);ctx.fill(op.fillMode===1?'evenodd':'nonzero');}else{ctx.strokeStyle=rgb(color);ctx.stroke();}return;}
    const mask=document.createElement('canvas');mask.width=width;mask.height=height;const mc=mask.getContext('2d');makePath(mc,op);if(fill){mc.fillStyle='#fff';mc.fill(op.fillMode===1?'evenodd':'nonzero');}else{mc.strokeStyle='#fff';mc.stroke();}
    const coverage=mc.getImageData(0,0,width,height).data,target=ctx.getImageData(0,0,width,height);
    for(let i=0;i<coverage.length;i+=4){const alpha=coverage[i+3]/255;if(!alpha)continue;if(![1,4,13,16].includes(op.rop)&&target.data[i+3]!==255)fail('Destination-dependent WMF ROP2 requires an opaque background');
      for(let c=0;c<3;c++){const p=color >>> (c*8)&255,d=target.data[i+c],v=rop2(op.rop,p,d);target.data[i+c]=Math.round(v*alpha+d*(1-alpha));}target.data[i+3]=Math.round(255*alpha+target.data[i+3]*(1-alpha));}
    ctx.putImageData(target,0,0);
  };
  for(const op of model.operations){if(op.closed&&op.brush.style!==1)paint(op,true);if(op.pen.style!==5)paint(op,false);}
  output.metafileIntrinsic={width:model.intrinsicCssWidth,height:model.intrinsicCssHeight,unitsPerInch:model.inch};
  output.metafileUnverified=['GDI/Canvas edge pixels',...model.ignoredTails.map(t=>'Unspecified WMF producer tail at '+t.offset)];
  return output;
}
