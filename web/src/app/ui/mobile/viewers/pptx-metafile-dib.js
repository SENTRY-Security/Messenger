// Strict raster-DIB EMF subset. Vector/EMF+ records are explicitly unsupported.
// MS-EMF 2.3.1.7, 2.3.11.19/.28-.31; MS-WMF BitmapInfoHeader.
export class UnsupportedMetafileError extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedMetafileError'; }
}
function fail(message) { throw new UnsupportedMetafileError(message); }
// Picture-frame mapping is shared by raster and vector playback. Header Bounds is
// the painted bounding box, not the destination picture rectangle (PlayEnhMetaFile).
export function emfPictureFrame(view) {
  if(view.byteLength<88)fail('Truncated EMF physical header');
  const u=n=>view.getUint32(n,true),i=n=>view.getInt32(n,true);
  if(u(4)<88||u(4)%4||u(4)>view.byteLength)fail('Invalid EMF header record size');
  const frame=[24,28,32,36].map(i),device=[i(72),i(76)];
  const micrometers=u(4)>=108&&i(100)>0&&i(104)>0?[i(100),i(104)]:[i(80)*1000,i(84)*1000];
  if(device.some(n=>n<=0)||micrometers.some(n=>n<=0)||frame[2]<=frame[0]||frame[3]<=frame[1])fail('Invalid EMF physical frame/reference device');
  const factors=device.map((n,j)=>n*10/micrometers[j]),frameOrigin=[frame[0]*factors[0],frame[1]*factors[1]];
  const width=Math.max(1,Math.round((frame[2]-frame[0])*factors[0])),height=Math.max(1,Math.round((frame[3]-frame[1])*factors[1]));
  if(width>16384||height>16384||width*height>32000000)fail('Excessive EMF physical frame');
  return {frame,device,micrometers,frameOrigin,width,height,intrinsicCssWidth:(frame[2]-frame[0])*96/2540,intrinsicCssHeight:(frame[3]-frame[1])*96/2540};
}
export function decodeEmfDib(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const i32 = (offset) => view.getInt32(offset, true);
  if (data.length < 88 || u32(0) !== 1 || u32(40) !== 0x464d4520) fail('Not a supported EMF header; WMF/vector requires a metafile renderer');
  if (u32(48) !== data.length || u32(52) < 2 || u32(52) > 100000) fail('Invalid EMF byte/record count');
  const bounds = [8,12,16,20].map(i32);
  const picture=emfPictureFrame(view),{width,height,frameOrigin}=picture;
  if (width <= 0 || height <= 0 || width * height > 32000000) fail('Invalid or excessive EMF bounds');
  let windowOrigin = [0,0], windowExtent = [1,1], viewportOrigin = [0,0], viewportExtent = [1,1], mode = 1;
  let offset = 0, recordCount = 0, ended = false;
  const operations = [];
  while (offset < data.length) {
    if (offset + 8 > data.length) fail('Truncated EMF record');
    const type = u32(offset), size = u32(offset+4);
    if (size < 8 || size % 4 || offset + size > data.length) fail('Invalid EMF record bounds');
    const value = n => i32(offset+n), unsigned = n => u32(offset+n);
    const pair = () => { if (size !== 16) fail('Invalid mapping record'); return [value(8),value(12)]; };
    if (type === 1) { if (offset !== 0 || size < 88) fail('Invalid repeated EMF header'); }
    else if (type === 17) { if (size !== 12 || ![1,8].includes(value(8))) fail('Unsupported EMF mapping mode'); mode = value(8); }
    else if (type === 9) { windowExtent = pair(); if (windowExtent.some(v=>v===0)) fail('Zero EMF window extent'); }
    else if (type === 10) windowOrigin = pair();
    else if (type === 11) { viewportExtent = pair(); if (viewportExtent.some(v=>v===0)) fail('Zero EMF viewport extent'); }
    else if (type === 12) viewportOrigin = pair();
    else if (type === 81) {
      if (size < 80) fail('Truncated EMR_STRETCHDIBITS');
      if (unsigned(64) !== 0 || unsigned(68) !== 0x00cc0020) fail('Unsupported DIB palette usage or raster operation (only DIB_RGB_COLORS/SRCCOPY)');
      const bmiOffset=unsigned(48),bmiLength=unsigned(52),bitsOffset=unsigned(56),bitsLength=unsigned(60);
      if (bmiOffset<80 || bmiLength<40 || bmiOffset+bmiLength>size || bitsOffset<80 || bitsOffset+bitsLength>size || (bitsOffset<bmiOffset+bmiLength && bmiOffset<bitsOffset+bitsLength)) fail('Invalid overlapping/truncated DIB buffers');
      const base=offset+bmiOffset, headerSize=u32(base), dibWidth=i32(base+4), signedHeight=i32(base+8), dibHeight=Math.abs(signedHeight);
      const planes=view.getUint16(base+12,true),bpp=view.getUint16(base+14,true),compression=u32(base+16);
      if (headerSize!==40 || planes!==1 || ![24,32].includes(bpp) || compression!==0 || dibWidth<=0 || !dibHeight || dibWidth*dibHeight>32000000 || u32(base+32)!==0) fail('Unsupported DIB header, palette, bit depth, compression or dimensions');
      const stride=Math.ceil(dibWidth*bpp/32)*4;
      if (stride*dibHeight>bitsLength) fail('Truncated DIB scanlines');
      const rgba=new Uint8ClampedArray(dibWidth*dibHeight*4);
      for(let y=0;y<dibHeight;y++)for(let x=0;x<dibWidth;x++) {
        const source=offset+bitsOffset+(signedHeight>0?dibHeight-1-y:y)*stride+x*(bpp/8),dest=(y*dibWidth+x)*4;
        rgba[dest]=data[source+2];rgba[dest+1]=data[source+1];rgba[dest+2]=data[source];rgba[dest+3]=255; // BI_RGB fourth byte is unused, not alpha.
      }
      const source=[value(32),value(36),value(40),value(44)],destination=[value(24),value(28),value(72),value(76)];
      if(!source[2]||!source[3]||!destination[2]||!destination[3]) fail('Zero DIB source/destination extent');
      const sourceRect={x:Math.min(source[0],source[0]+source[2]),y:Math.min(source[1],source[1]+source[3]),width:Math.abs(source[2]),height:Math.abs(source[3])};
      if(sourceRect.x<0||sourceRect.y<0||sourceRect.x+sourceRect.width>dibWidth||sourceRect.y+sourceRect.height>dibHeight) fail('DIB source crop outside bitmap');
      const scale=mode===8?[viewportExtent[0]/windowExtent[0],viewportExtent[1]/windowExtent[1]]:[1,1];
      const map=(v,index)=>mode===8?(v-windowOrigin[index])*scale[index]+viewportOrigin[index]:v;
      const p0=[map(destination[0],0)-frameOrigin[0],map(destination[1],1)-frameOrigin[1]],p1=[map(destination[0]+destination[2],0)-frameOrigin[0],map(destination[1]+destination[3],1)-frameOrigin[1]];
      operations.push({width:dibWidth,height:dibHeight,rgba,sourceRect,destination:{x:Math.min(p0[0],p1[0]),y:Math.min(p0[1],p1[1]),width:Math.abs(p1[0]-p0[0]),height:Math.abs(p1[1]-p0[1])},flipX:Math.sign(source[2])!==Math.sign(p1[0]-p0[0]),flipY:Math.sign(source[3])!==Math.sign(p1[1]-p0[1]),recordOffset:offset});
    } else if(type===14) { if(offset+size!==data.length)fail('EMF EOF not final'); ended=true; }
    else fail('Unsupported EMF record '+type+' at '+offset+'; vector/EMF+ requires a renderer');
    offset+=size;recordCount++;
  }
  if(!ended || recordCount!==u32(52) || !operations.length)fail('Incomplete EMF or no supported image operations');
  return {...picture,bounds,operations,recordCount,scope:'Raster DIB subset; no vector/EMF+ conformance'};
}
export function renderEmfDib(bytes) {
  const model=decodeEmfDib(bytes),output=document.createElement('canvas');output.width=model.width;output.height=model.height;
  const context=output.getContext('2d');
  for(const op of model.operations){
    const bitmap=document.createElement('canvas');bitmap.width=op.width;bitmap.height=op.height;bitmap.getContext('2d').putImageData(new ImageData(op.rgba,op.width,op.height),0,0);
    const dest=op.destination,src=op.sourceRect;context.save();context.translate(dest.x+(op.flipX?dest.width:0),dest.y+(op.flipY?dest.height:0));context.scale(op.flipX?-1:1,op.flipY?-1:1);context.imageSmoothingEnabled=false;
    context.drawImage(bitmap,src.x,src.y,src.width,src.height,0,0,dest.width,dest.height);context.restore();
  }
  output.metafileIntrinsic={width:model.intrinsicCssWidth,height:model.intrinsicCssHeight,frameUnitsPerInch:2540};
  return output;
}
