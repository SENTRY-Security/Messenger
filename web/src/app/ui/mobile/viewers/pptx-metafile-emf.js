import { UnsupportedMetafileError, emfPictureFrame } from './pptx-metafile-dib.js';
const fail = message => { throw new UnsupportedMetafileError(message); };
const rgb = value => `rgb(${value&255},${value>>>8&255},${value>>>16&255})`;
// MS-EMF GDI fallback subset. EMF+ Only is rejected; Dual is processed once as GDI.
export function decodeEmfVector(bytes) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const u=n=>v.getUint32(n,true),i=n=>v.getInt32(n,true),s=n=>v.getInt16(n,true);
  if(data.length<88||u(0)!==1||u(40)!==0x464d4520||u(48)!==data.length)fail('Invalid EMF header/signature/byte count');
  if(u(4)<88||u(4)%4||u(4)>data.length)fail('Invalid EMF header record size');
  const bounds=[8,12,16,20].map(i),picture=emfPictureFrame(v),{width,height,frameOrigin,frame,device,micrometers}=picture,capacity=v.getUint16(56,true);
  if(width<=0||height<=0||width>16384||height>16384||width*height>32000000||!capacity||capacity>32768||u(52)>100000)fail('Invalid EMF dimensions/record/object limits');
  const pen=(style=0,color=0,width=0)=>({kind:'pen',style,color,width}),brush=(color=0xffffff,style=0)=>({kind:'brush',style,color}),font={kind:'font',height:-12,weight:400,italic:0,face:'sans-serif'};
  const stocks={0:brush(),1:brush(0xc0c0c0),2:brush(0x808080),3:brush(0x404040),4:brush(0),5:brush(0,1),6:pen(0,0xffffff),7:pen(),8:pen(5),10:font,11:font,12:font,13:font,14:font,16:font,17:font};
  const objects=new Array(capacity).fill(null),ops=[],records=[],comments=[],unverified=new Set();let dual=null,plusEnded=false,plusStarted=false;
  let state={mode:1,origin:[0,0],extent:[1,1],viewportOrigin:[0,0],viewportExtent:[1,1],pen:pen(),brush:brush(),font,textColor:0,bkColor:0xffffff,bkMode:2,textAlign:0,fillMode:1,position:[0,0],clips:[]};const saved=[];
  const map=(x,y)=>[x,y].map((a,j)=>(state.mode===1?a:(a-state.origin[j])*state.viewportExtent[j]/state.extent[j]+state.viewportOrigin[j])-frameOrigin[j]);
  const rect=values=>[map(values[0],values[1]),map(values[2],values[3])];
  const emit=op=>{ops.push({...op,pen:{...state.pen},brush:{...state.brush},font:{...state.font},textColor:state.textColor,bkColor:state.bkColor,bkMode:state.bkMode,textAlign:state.textAlign,fillMode:state.fillMode,clips:state.clips.map(c=>({...c,rect:c.rect.map(p=>[...p])}))});};
  let offset=0,ended=false;
  while(offset<data.length){if(offset+8>data.length)fail('Truncated EMF record');const type=u(offset),size=u(offset+4),base=offset; if(size<8||size%4||offset+size>data.length)fail('Invalid EMF record bounds');
    const need=n=>{if(size<n)fail('Truncated EMF record '+type);},exact=n=>{need(n);if(size!==n)fail('Invalid EMF record size '+type);},pair=()=>{exact(16);return[i(base+8),i(base+12)];};records.push({type,offset,size});
    if(type===1){if(offset||size<88)fail('Invalid EMF header record');}
    else if(type===14){need(20);if(offset+size!==data.length)fail('EMF EOF not final');ended=true;}
    else if(type===9){state.extent=pair();if(state.extent.some(n=>!n))fail('Zero EMF window extent');}
    else if(type===10)state.origin=pair();
    else if(type===11){state.viewportExtent=pair();if(state.viewportExtent.some(n=>!n))fail('Zero EMF viewport extent');}
    else if(type===12)state.viewportOrigin=pair();
    else if(type===17){exact(12);state.mode=u(base+8);if(![1,8].includes(state.mode))fail('Unsupported EMF map mode');}
    else if(type===18){exact(12);state.bkMode=u(base+8);if(![1,2].includes(state.bkMode))fail('Invalid EMF background mode');}
    else if(type===19){exact(12);state.fillMode=u(base+8);if(![1,2].includes(state.fillMode))fail('Invalid EMF fill mode');}
    else if(type===20){exact(12);if(u(base+8)!==13)fail('Unsupported EMF non-COPYPEN ROP2');}
    else if(type===22){exact(12);state.textAlign=u(base+8);if(![0,2,6,8,10,14,24,26,30].includes(state.textAlign))fail('Unsupported EMF text alignment flags');}
    else if(type===24||type===25){exact(12);state[type===24?'textColor':'bkColor']=u(base+8);}
    else if(type===33){exact(8);saved.push({...state,clips:[...state.clips],position:[...state.position]});}
    else if(type===34){exact(12);const n=i(base+8),target=n<0?saved.length+n:n-1;if(target<0||target>=saved.length)fail('Invalid EMF RestoreDC');state=saved[target];saved.length=target;}
    else if(type===37){exact(12);const handle=u(base+8),object=handle&0x80000000?stocks[handle&0x7fffffff]:objects[handle];if(!object)fail('EMF selects missing/unsupported object');state[object.kind]=object;}
    else if(type===38||type===39||type===82){need(type===38?28:type===39?24:104);const handle=u(base+8);if(!handle||handle>=capacity||objects[handle])fail('Invalid/reused EMF object handle');let object;
      if(type===38){exact(28);const style=u(base+12);if(![0,5].includes(style)||i(base+20)!==0)fail('Unsupported EMF pen');object=pen(style,u(base+24),Math.abs(i(base+16)));}
      else if(type===39){exact(24);const style=u(base+12);if(![0,1].includes(style))fail('Unsupported EMF patterned brush');object=brush(u(base+16),style);}
      else{const height=i(base+12),fontWidth=i(base+16),escapement=i(base+20),orientation=i(base+24),weight=i(base+28),italic=data[base+32],underline=data[base+33],strikeout=data[base+34];if(!height||fontWidth||escapement||orientation||underline||strikeout)fail('Unsupported EMF transformed/decorated font');const chars=[];for(let p=base+40;p<base+104;p+=2){const code=v.getUint16(p,true);if(!code)break;chars.push(code);}object={kind:'font',height,weight,italic,face:String.fromCharCode(...chars)};unverified.add('GDI font mapper/metrics and installed face identity require native/Office reference');}
      objects[handle]=object;
    }
    else if(type===40){exact(12);const handle=u(base+8);if(!objects[handle])fail('EMF deletes missing object');if(Object.values(state).includes(objects[handle]))fail('EMF deletes selected object');objects[handle]=null;}
    else if(type===29||type===30){exact(24);state.clips=[...state.clips,{exclude:type===29,rect:rect([8,12,16,20].map(n=>i(base+n)))}];}
    else if(type===27)state.position=pair();
    else if(type===54){const p=pair();emit({kind:'path',points:[map(...state.position),map(...p)],closed:false});state.position=p;}
    else if(type===43||type===42){exact(24);emit({kind:type===43?'rectangle':'ellipse',rect:rect([8,12,16,20].map(n=>i(base+n)))});unverified.add('GDI inclusive/exclusive outline edge rasterization vs Canvas requires pixel reference');}
    else if([3,4,86,87].includes(type)){need(28);const count=u(base+24),short=type>=86,step=short?4:8;if(count<2||28+count*step!==size)fail('Invalid EMF polygon point count');const points=Array.from({length:count},(_,n)=>map(short?s(base+28+n*step):i(base+28+n*step),short?s(base+30+n*step):i(base+32+n*step)));emit({kind:'path',points,closed:type===3||type===86});}
    else if(type===84){need(76);const mode=u(base+24),count=u(base+44),start=u(base+48),flags=u(base+52),dx=u(base+72);if(![1,2].includes(mode)||flags&~6||start<76||start+count*2>size||count>100000||(dx&&(dx<76||dx+count*4>size)))fail('Unsupported/invalid EMF UTF16 text/options/spacing');const codes=Array.from({length:count},(_,n)=>v.getUint16(base+start+n*2,true));if(codes.some(c=>c>=0xd800&&c<=0xdfff))fail('EMF surrogate/glyph positioning requires shaping support');const advances=dx?Array.from({length:count},(_,n)=>i(base+dx+n*4)):null;if(advances&&start<dx+count*4&&dx<start+count*2)fail('Overlapping EMF string/spacing buffers');emit({kind:'text',text:String.fromCharCode(...codes),point:map(i(base+36),i(base+40)),advances:advances?.map(n=>state.mode===1?n:n*state.viewportExtent[0]/state.extent[0]),flags,rect:rect([56,60,64,68].map(n=>i(base+n))),fontScale:state.mode===1?1:Math.abs(state.viewportExtent[1]/state.extent[1]),graphicsMode:mode,physicalScale:[v.getFloat32(base+28,true),v.getFloat32(base+32,true)]});if(state.bkMode===2)unverified.add('Opaque text background depends on exact native font cell metrics');}
    else if(type===70){need(12);const length=u(base+8);if(length>size-12||size-12-length>3)fail('Invalid EMF comment length/padding');if(length>=4&&u(base+12)===0x2b464d45){let p=base+16,end=base+12+length;const entries=[];while(p<end){if(p+12>end)fail('Truncated EMF+ record');const type=v.getUint16(p,true),flags=v.getUint16(p+2,true),n=u(p+4),d=u(p+8);if(n<12||n%4||p+n>end||d!==n-12)fail('Malformed EMF+ comment subrecord');if(type===0x4001){if(plusStarted||n!==28)fail('Invalid EMF+ Header');plusStarted=true;dual=!!(flags&1);if(!dual)fail('EMF+ Only requires EMF+ renderer; GDI fallback incomplete');}else if(!plusStarted||plusEnded)fail('EMF+ record outside Header/EOF');if(type===0x4002)plusEnded=true;entries.push({type,flags,size:n});p+=n;}comments.push({offset,kind:'EMF+ Dual, GDI fallback',entries});}
      else if(length>=4&&[0,0x43494447].includes(u(base+12)))fail('Unsupported EMF public/spool comment');else comments.push({offset,kind:'Private comment, MAY ignore per MS-EMF 2.3.3.1',identifier:length>=4?u(base+12):null});}
    else fail('Unsupported EMF GDI record '+type+' at '+offset);
    offset+=size;
  }
  if(!ended||records.length!==u(52)||!ops.length||(plusStarted&&!plusEnded))fail('Incomplete EMF GDI drawing');
  unverified.add('Canvas/GDI pen antialiasing and edge pixels require native/Office reference');
  return {width,height,bounds,frame,device,micrometers,frameOrigin,intrinsicCssWidth:(frame[2]-frame[0])*96/2540,intrinsicCssHeight:(frame[3]-frame[1])*96/2540,operations:ops,records,comments,dual,unverified:[...unverified],scope:'GDI fallback subset; EMF+ Only/unknown draw operations rejected; not Microsoft pixel acceptance'};
}
export function renderEmfVector(bytes,options={}) {
 const m=decodeEmfVector(bytes),width=options.width??m.width,height=options.height??m.height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>16384||height>16384||width*height>32000000)fail('Invalid EMF output dimensions');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.scale(width/m.width,height/m.height);
 if(options.background){ctx.fillStyle=options.background;ctx.fillRect(0,0,m.width,m.height);}
 const rectangle=(r)=>ctx.rect(r[0][0],r[0][1],r[1][0]-r[0][0],r[1][1]-r[0][1]);
 for(const op of m.operations){ctx.save();for(const clip of op.clips){ctx.beginPath();if(clip.exclude){ctx.rect(0,0,m.width,m.height);rectangle(clip.rect);ctx.clip('evenodd');}else{rectangle(clip.rect);ctx.clip();}}
  if(op.kind==='text'){
   const size=Math.abs(op.font.height)*op.fontScale,face=options.fontResolver?options.fontResolver(op.font.face):op.font.face;ctx.font=`${op.font.italic?'italic ':''}${op.font.weight} ${size}px ${(options.fontResolverCSS?face:JSON.stringify(face))}`;ctx.fillStyle=rgb(op.textColor);const vertical=op.textAlign&24;ctx.textBaseline=vertical===24?'alphabetic':vertical===8?'bottom':'top';ctx.textAlign='left';let x=op.point[0],y=op.point[1],total=op.advances?op.advances.reduce((a,b)=>a+b,0):ctx.measureText(op.text).width;const horizontal=op.textAlign&6;if(horizontal===2)x-=total;else if(horizontal===6)x-=total/2;
   if(op.flags&4){ctx.beginPath();rectangle(op.rect);ctx.clip();}if(op.flags&2){ctx.fillStyle=rgb(op.bkColor);ctx.beginPath();rectangle(op.rect);ctx.fill();ctx.fillStyle=rgb(op.textColor);}
   if(op.bkMode===2){const metrics=ctx.measureText(op.text),top=vertical===24?y-(metrics.fontBoundingBoxAscent??size):vertical===8?y-size:y;ctx.fillStyle=rgb(op.bkColor);ctx.fillRect(x,top,total,(metrics.fontBoundingBoxAscent??size)+(metrics.fontBoundingBoxDescent??0));ctx.fillStyle=rgb(op.textColor);}
   if(op.advances){for(let n=0;n<op.text.length;n++){ctx.fillText(op.text[n],x,y);x+=op.advances[n];}}else ctx.fillText(op.text,x,y);
  }else{ctx.beginPath();if(op.kind==='path'){ctx.moveTo(...op.points[0]);for(const p of op.points.slice(1))ctx.lineTo(...p);if(op.closed)ctx.closePath();}else if(op.kind==='rectangle')rectangle(op.rect);else{const [a,b]=op.rect;ctx.ellipse((a[0]+b[0])/2,(a[1]+b[1])/2,Math.abs(a[0]-b[0])/2,Math.abs(a[1]-b[1])/2,0,0,Math.PI*2);}
   if((op.closed||op.kind!=='path')&&op.brush.style!==1){ctx.fillStyle=rgb(op.brush.color);ctx.fill(op.fillMode===1?'evenodd':'nonzero');}if(op.pen.style!==5){ctx.strokeStyle=rgb(op.pen.color);ctx.lineWidth=op.pen.width||1;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();}
  }ctx.restore();}
 canvas.metafileIntrinsic={width:m.intrinsicCssWidth,height:m.intrinsicCssHeight,frameUnitsPerInch:2540};canvas.metafileUnverified=m.unverified;return canvas;
}
