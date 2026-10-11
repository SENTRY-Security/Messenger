// Embedded image physical resolution; no pixel decoding or synthesized DPI.
export function readImageDpi(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const valid=(x,y,source)=>Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0?{x,y,source}:null;
  if(bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){
    for(let offset=8;offset+12<=bytes.length;){const length=view.getUint32(offset);if(length>bytes.length-offset-12)return null;const name=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(name==='pHYs'&&length===9&&bytes[offset+16]===1)return valid(view.getUint32(offset+8)*.0254,view.getUint32(offset+12)*.0254,'PNG pHYs metres');if(name==='IEND')break;offset+=12+length;}
    return null;
  }
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216)return null;
  let jfif=null,exif=null;
  for(let offset=2;offset+4<=bytes.length;){
    if(bytes[offset++]!==255)break;while(offset<bytes.length&&bytes[offset]===255)offset++;
    const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;
    if(offset+2>bytes.length)break;const size=view.getUint16(offset),start=offset+2,end=offset+size;if(size<2||end>bytes.length)break;
    if(marker===224&&size>=16&&String.fromCharCode(...bytes.slice(start,start+5))==='JFIF\0'){
      const units=bytes[start+7],factor=units===1?1:units===2?2.54:0;if(factor)jfif=valid(view.getUint16(start+8)*factor,view.getUint16(start+10)*factor,'JPEG JFIF '+(units===1?'inches':'centimetres'));
    }
    if(marker===225&&size>=16&&String.fromCharCode(...bytes.slice(start,start+6))==='Exif\0\0'){
      const base=start+6,little=bytes[base]===73&&bytes[base+1]===73,big=bytes[base]===77&&bytes[base+1]===77;
      const inBounds=(position,length)=>position>=base&&position+length<=end;
      if((little||big)&&inBounds(base,8)&&view.getUint16(base+2,little)===42){
        const ifd=base+view.getUint32(base+4,little);if(inBounds(ifd,2)){const count=view.getUint16(ifd,little);let x=null,y=null,unit=2;
          for(let i=0;i<count;i++){const position=ifd+2+i*12;if(!inBounds(position,12))break;const tag=view.getUint16(position,little),type=view.getUint16(position+2,little),number=view.getUint32(position+4,little);
            if(tag===296&&type===3&&number===1)unit=view.getUint16(position+8,little);
            if((tag===282||tag===283)&&type===5&&number===1){const rational=base+view.getUint32(position+8,little);if(inBounds(rational,8)){const denominator=view.getUint32(rational+4,little),value=denominator?view.getUint32(rational,little)/denominator:null;if(tag===282)x=value;else y=value;}}
          }
          const factor=unit===2?1:unit===3?2.54:0;if(factor)exif=valid(x*factor,y*factor,'JPEG EXIF '+(unit===2?'inches':'centimetres'));
        }
      }
    }
    offset=end;
  }
  return exif||jfif;
}
