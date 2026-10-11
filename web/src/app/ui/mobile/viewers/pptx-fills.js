// DrawingML fill models and Canvas rendering. ISO/IEC 29500-1, 20.1.8.
// Colors, including all scheme/color transforms, are resolved by the caller's parseColor.
import { DRAWINGML_PATTERN_ROWS } from './pptx-fill-patterns.js';
import { readImageDpi } from './pptx-image-metadata.js';
export { readImageDpi };
const matrix=value=>value==null?new DOMMatrix():typeof value==='string'||Array.isArray(value)||ArrayBuffer.isView(value)?new DOMMatrix(value):DOMMatrix.fromMatrix(value);

const DRAWING_NAMESPACES = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main']);
const FILL_NAMES = new Set(['noFill','solidFill','gradFill','pattFill','blipFill','grpFill']);
const child = (n,name) => [...(n?.children || [])].find(e => DRAWING_NAMESPACES.has(e.namespaceURI) && e.localName === name);
const children = (n,name) => [...(n?.children || [])].filter(e => DRAWING_NAMESPACES.has(e.namespaceURI) && (!name || e.localName === name));
const attribute = (n,name,fallback) => n?.getAttribute(name) ?? fallback;
const clamp = (v,min=0,max=1) => Math.max(min,Math.min(max,v));
const boolean = (n,name,fallback=true) => !['0','false'].includes(attribute(n,name,String(fallback)));
function percentage(n,name,fallback=0) { const value=attribute(n,name,null);if(value==null)return fallback;const parsed=String(value).endsWith('%')?parseFloat(value)/100:Number(value)/100000;if(!Number.isFinite(parsed))throw new Error('Invalid DrawingML percentage: '+name);return parsed; }
const relativeRect = n => Object.fromEntries(['l','t','r','b'].map(name=>[name,percentage(n,name)]));
const rectangle = (bounds,inset) => ({x:bounds.x+inset.l*bounds.width,y:bounds.y+inset.t*bounds.height,width:bounds.width*(1-inset.l-inset.r),height:bounds.height*(1-inset.t-inset.b)});
function failure(code,detail) { const error=new Error(`${code}: ${detail}`);error.code=code;throw error; }
function requireColor(n,parseColor) { const color=parseColor?.(n);if(!color)failure('unresolved-fill-color',n?.localName||'missing color');return color; }

export function parseDrawingFill(container,helpers={}) {
  if(!container)return null;
  const node=FILL_NAMES.has(container.localName)?container:children(container).find(e=>FILL_NAMES.has(e.localName));
  if(!node)return null;
  const base={kind:node.localName,rotateWithShape:boolean(node,'rotWithShape'),renderingProfile:helpers.renderingProfile||'iso',diagnostics:[],conformanceStatus:'unverified'};
  if(base.kind==='noFill'||base.kind==='grpFill')return base;
  if(base.kind==='solidFill')return {...base,color:requireColor(node,helpers.parseColor)};
  if(base.kind==='pattFill') {
    const preset=attribute(node,'prst','');if(!DRAWINGML_PATTERN_ROWS[preset])failure('unknown-pattern-fill',preset);
    return {...base,preset,foreground:child(node,'fgClr')?requireColor(child(node,'fgClr'),helpers.parseColor):'#000000',background:child(node,'bgClr')?requireColor(child(node,'bgClr'),helpers.parseColor):'#ffffff'};
  }
  if(base.kind==='gradFill') {
    const linear=child(node,'lin'),path=child(node,'path');
    const stops=children(child(node,'gsLst'),'gs').map((gs,index)=>({position:percentage(gs,'pos'),color:requireColor(gs,helpers.parseColor),index})).sort((a,b)=>a.position-b.position||a.index-b.index);
    if(!stops.length&&base.renderingProfile==='office')stops.push({position:0,color:'#000000',index:0});
    if(!stops.length||stops.some(s=>s.position<0||s.position>1))failure('invalid-gradient-stops','Positions must be within 0..100%');
    const pathKind=path?attribute(path,'path',base.renderingProfile==='office'?'rect':'shape'):null;
    if(pathKind&&!['circle','rect','shape'].includes(pathKind))failure('unknown-path-gradient',pathKind);
    if(linear&&path)failure('invalid-gradient-shading','Both linear and path shading specified');
    return {...base,stops,angle:Number(attribute(linear,'ang',0))/60000,scaled:boolean(linear,'scaled',false),path:pathKind,
      focusRect:child(path,'fillToRect')?relativeRect(child(path,'fillToRect')):{l:0,t:0,r:1,b:1},
      tileRect:relativeRect(child(node,'tileRect')),flip:attribute(node,'flip','none')};
  }
  const blip=child(node,'blip'),tile=child(node,'tile'),stretch=child(node,'stretch');
  if(tile&&stretch)failure('invalid-blip-fill-mode','Both tile and stretch specified');
  const id=blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed')||blip?.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships','embed')||blip?.getAttribute('r:embed');
  const link=blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','link')||blip?.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships','link')||blip?.getAttribute('r:link');
  const effects=children(blip).map(e=>({kind:e.localName,attributes:Object.fromEntries([...e.attributes].map(a=>[a.localName,a.value])),node:e}));
  const dpiPolicy=[...(child(blip,'extLst')?.getElementsByTagNameNS('http://schemas.microsoft.com/office/drawing/2010/main','useLocalDpi')||[])][0];
  return {...base,relationshipId:id||link,external:!id&&!!link,target:helpers.resolveRelationship?.(id||link)??null,dpi:Number(attribute(node,'dpi',0)),useLocalDpi:dpiPolicy?boolean(dpiPolicy,'val',true):null,srcRect:relativeRect(child(node,'srcRect')),mode:stretch?'stretch':'tile',fillRect:relativeRect(child(stretch,'fillRect')),
    tile:{sx:percentage(tile,'sx',1),sy:percentage(tile,'sy',1),tx:Number(attribute(tile,'tx',0)),ty:Number(attribute(tile,'ty',0)),alignment:attribute(tile,'algn','tl'),flip:attribute(tile,'flip','none')},effects,colorParser:helpers.parseColor};
}

function canvas(width,height) { const element=document.createElement('canvas');element.width=Math.max(1,Math.ceil(width));element.height=Math.max(1,Math.ceil(height));return element; }
let colorContext;
function rgba(css) { const ctx=colorContext||(colorContext=canvas(1,1).getContext('2d',{willReadFrequently:true}));ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]; }
function mixStops(stops,t,office=false) {
  if(t<stops[0].position)return stops[0].rgba;
  // Microsoft Open Specifications, Mike Bowen, 2025-04-17:
  // https://learn.microsoft.com/en-us/answers/questions/2248059/non-preset-a-tilerect-behaves-strange-in-case-of-g
  // This exponent and the narrow eligibility rules are published behavior,
  // not a fitted brightness adjustment. Alpha always remains linear.
  const special=office&&stops[0].position===0&&stops.at(-1).position===1&&(stops.length===2||stops.length===3&&stops[0].rgba.every((value,index)=>value===stops[2].rgba[index]));
  let left=stops[0];for(const right of stops.slice(1)){
    if(t<right.position){const amount=(t-left.position)/(right.position-left.position);return left.rgba.map((value,index)=>{
      const weight=special&&index<3?(right.rgba[index]>value?1-Math.pow(1-amount,1.875):Math.pow(amount,1.875)):amount;
      return value+(right.rgba[index]-value)*weight;
    });}
    left=right;
  }
  return left.rgba;
}
function officeRadialPosition(model,x,y,tile,bounds,options) {
  // Bowen's 2025-04-30 correction uses actual filled path bounds. Backgrounds
  // have rectangular geometry; shape callers supply geometryBounds/fillBounds.
  const anchor=options.geometryBounds||options.geometryPaths?.fillBounds||bounds;
  const radius=Math.hypot(anchor.width,anchor.height)/2;
  if(!(radius>0))failure('invalid-radial-gradient-geometry','Actual path bounds have no radius');
  const center={x:anchor.x+anchor.width/2,y:anchor.y+anchor.height/2},outer={x:center.x-radius,y:center.y-radius,width:2*radius,height:2*radius},inner=rectangle(outer,model.focusRect);
  if(inner.width<0||inner.height<0)failure('invalid-gradient-focus-rectangle','Opposing focus edges cross');
  const scaleX=inner.width/outer.width,scaleY=inner.height/outer.height,origin={x:inner.x,y:inner.y};
  if(inner.width>0&&Math.abs(outer.width-inner.width)>2*Number.EPSILON)origin.x+=inner.width*(inner.x-outer.x)/(outer.width-inner.width);
  if(inner.height>0&&Math.abs(outer.height-inner.height)>2*Number.EPSILON)origin.y+=inner.height*(inner.y-outer.y)/(outer.height-inner.height);
  const dx=tile.x+x-origin.x,dy=tile.y+y-origin.y,vx=origin.x-center.x,vy=origin.y-center.y;
  const field=t=>{
    const kx=scaleX+(1-scaleX)*t,ky=scaleY+(1-scaleY)*t;
    const px=kx===0?(dx===0?vx:Infinity):vx+dx/kx,py=ky===0?(dy===0?vy:Infinity):vy+dy/ky;
    return px*px+py*py-radius*radius;
  };
  if(field(0)<=0)return 0;
  if(field(1)>=0)return 1;
  if(scaleX===scaleY){
    const a=vx*vx+vy*vy-radius*radius,b=2*(vx*dx+vy*dy),c=dx*dx+dy*dy,discriminant=Math.max(0,b*b-4*a*c),denominator=-b+Math.sqrt(discriminant);
    if(denominator===0)return 0;
    const k=2*c/denominator;
    return clamp((k-scaleX)/(1-scaleX));
  }
  let low=0,high=1;
  for(let i=0;i<32;i++){const middle=(low+high)/2;if(field(middle)>0)low=middle;else high=middle;}
  return (low+high)/2;
}
function gradientPosition(model,x,y,tile,bounds,options,hitContext) {
  if(!model.path) {
    const angle=model.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    let dx=c,dy=s;
    if(model.scaled){dx*=tile.width;dy*=tile.height;const norm=Math.hypot(dx,dy);dx/=norm;dy/=norm;}
    const length=Math.abs(dx)*tile.width+Math.abs(dy)*tile.height;
    return clamp(.5+((x-tile.width/2)*dx+(y-tile.height/2)*dy)/length);
  }
  // MS-OI29500 2.1.1296(b): Office measures focus edges against the
  // shape bounding box, whereas ISO measures them against the fill tile.
  const office=(options.renderingProfile||model.renderingProfile)==='office';
  if(office&&(model.path==='circle'||model.path==='shape'&&options.geometryKind==='custom'))return officeRadialPosition(model,x,y,tile,bounds,options);
  const focus=rectangle(office?{x:bounds.x-tile.x,y:bounds.y-tile.y,width:bounds.width,height:bounds.height}:{x:0,y:0,width:tile.width,height:tile.height},model.focusRect);
  if(focus.width<0||focus.height<0)failure('invalid-gradient-focus-rectangle','Opposing focus edges cross');
  const fx=clamp(x,focus.x,focus.x+focus.width),fy=clamp(y,focus.y,focus.y+focus.height),dx=x-fx,dy=y-fy;
  if(dx===0&&dy===0)return 0;
  if(model.path==='shape') {
    const paths=options.geometryPaths?.paths||options.geometryPaths;
    if(!paths?.length)failure('shape-gradient-requires-geometry','Pass actual filled Path2D geometry paths');
    const inside=(px,py)=>paths.some(entry=>(entry.fill??'norm')!=='none'&&hitContext.isPointInPath(entry.path||entry,tile.x+px,tile.y+py,entry.fillRule||'nonzero'));
    if(!inside(fx,fy))failure('shape-gradient-focus-outside-geometry','Focus must be inside the actual shape');
    let low=0,high=1;
    while(inside(fx+dx*high,fy+dy*high)&&high<1048576)high*=2;
    if(high>=1048576)failure('shape-gradient-boundary-not-found','Unbounded geometry');
    for(let i=0;i<24;i++){const middle=(low+high)/2;if(inside(fx+dx*middle,fy+dy*middle))low=middle;else high=middle;}
    return clamp(1/high);
  }
  const horizontal=dx<0?focus.x:tile.width-focus.x-focus.width,vertical=dy<0?focus.y:tile.height-focus.y-focus.height;
  const nx=dx===0?0:horizontal===0?1:Math.abs(dx)/horizontal,ny=dy===0?0:vertical===0?1:Math.abs(dy)/vertical;
  return clamp(model.path==='circle'?Math.hypot(nx,ny):Math.max(nx,ny));
}
function gradientTexture(model,tile,bounds,options) {
  if(!(tile.width>0&&tile.height>0))failure('invalid-gradient-tile-rectangle','Tile must have positive dimensions');
  const texture=canvas(tile.width,tile.height),ctx=texture.getContext('2d',{willReadFrequently:true}),data=ctx.createImageData(texture.width,texture.height),hitContext=canvas(1,1).getContext('2d');
  const stops=model.stops.map(s=>({...s,rgba:rgba(s.color)}));
  for(let y=0;y<texture.height;y++)for(let x=0;x<texture.width;x++){
    const position=gradientPosition(model,(x+.5)/texture.width*tile.width,(y+.5)/texture.height*tile.height,tile,bounds,options,hitContext),pixel=mixStops(stops,position,(options.renderingProfile||model.renderingProfile)==='office'),offset=(y*texture.width+x)*4;
    for(let c=0;c<4;c++)data.data[offset+c]=Math.round(pixel[c]);
  }
  ctx.putImageData(data,0,0);return texture;
}
function mirroredTexture(texture,flip) {
  if(!['none','x','y','xy'].includes(flip))failure('unknown-fill-tile-flip',flip);
  if(flip==='none')return texture;
  const horizontal=flip.includes('x'),vertical=flip.includes('y'),combined=canvas(texture.width*(horizontal?2:1),texture.height*(vertical?2:1)),ctx=combined.getContext('2d');
  for(let y=0;y<(vertical?2:1);y++)for(let x=0;x<(horizontal?2:1);x++){ctx.save();ctx.translate(x?2*texture.width:0,y?2*texture.height:0);ctx.scale(x?-1:1,y?-1:1);ctx.drawImage(texture,0,0);ctx.restore();}return combined;
}
function fillPattern(ctx,texture,tile,model,bounds,options) {
  const originalWidth=texture.width,originalHeight=texture.height;
  const image=mirroredTexture(texture,model.flip||'none'),pattern=ctx.createPattern(image,'repeat');
  if(!pattern)failure('canvas-pattern-creation-failed',model.kind);
  let transform=new DOMMatrix().translate(tile.x,tile.y).scale(tile.width/originalWidth,tile.height/originalHeight);
  if(model.rotateWithShape===false){
    const current=options.shapeTransform||ctx.getTransform(),angle=options.shapeRotation!=null?options.shapeRotation*Math.PI/180:Math.atan2(current.b,current.a),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
    transform=new DOMMatrix().translate(cx,cy).rotate(-angle*180/Math.PI).translate(-cx,-cy).multiply(transform);
  }
  if(options.fillTransform)transform=matrix(options.fillTransform).multiply(transform);
  pattern.setTransform(transform);return pattern;
}
function patternTexture(model) {
  const rows=DRAWINGML_PATTERN_ROWS[model.preset];if(!rows)failure('unknown-pattern-fill',model.preset);
  const element=canvas(8,8),ctx=element.getContext('2d');ctx.fillStyle=model.background;ctx.fillRect(0,0,8,8);ctx.fillStyle=model.foreground;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(rows[y]&(1<<x))ctx.fillRect(x,y,1,1);return element;
}
function transformColor(pixel,transforms,parseColor) {
  if(!parseColor)failure('image-effect-requires-color-pipeline',transforms.map(t=>t[0]).join(','));
  const doc=document.implementation.createDocument('http://schemas.openxmlformats.org/drawingml/2006/main','a:srgbClr',null),node=doc.documentElement;
  node.setAttribute('val',pixel.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''));
  for(const [kind,value]of transforms){const t=doc.createElementNS(node.namespaceURI,'a:'+kind);if(value!=null)t.setAttribute('val',String(value));node.append(t);}
  return rgba(parseColor(node)).slice(0,3).concat(pixel[3]);
}
export async function applyBlipEffects(image,effects,helpers={}) {
  if(!effects?.length)return image;
  let output=canvas(image.naturalWidth||image.width,image.naturalHeight||image.height),ctx=output.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  for(const effect of effects){
    const kind=effect.kind,n=effect.node,number=(key,def=0)=>percentage(n,key,def);
    if(kind==='extLst'){
      // Office stores image-DPI policy here; it is metadata, not a pixel effect.
      for(const extension of n.children){
        if(!DRAWING_NAMESPACES.has(extension.namespaceURI)||extension.localName!=='ext')failure('unsupported-blip-extension',extension.outerHTML);
        for(const payload of extension.children){
        if(payload.namespaceURI==='http://schemas.microsoft.com/office/drawing/2010/main'&&payload.localName==='useLocalDpi')continue;
        failure('unsupported-blip-extension',payload.outerHTML);
        }
      }
      continue;
    }
    if(kind==='blur'){
      const radius=Number(attribute(n,'rad',0))/914400*(helpers.dpi||96);
      if(radius<0||!Number.isFinite(radius))failure('invalid-blip-blur-radius',radius);
      // MS-OI29500 2.1.1289(a): Office blip-fill constraints clip even grow=true.
      // The ISO profile still requires an expanded surface contract.
      // Office callers rasterize in destination space before this effect list.
      if(radius>0&&boolean(n,'grow',true)&&helpers.renderingProfile!=='office')failure('unsupported-blip-blur-grow','Expanded picture bounds require a geometry-aware effect surface');
      const next=canvas(output.width,output.height),nextCtx=next.getContext('2d');nextCtx.filter=`blur(${radius}px)`;nextCtx.drawImage(output,0,0);output=next;ctx=output.getContext('2d',{willReadFrequently:true});continue;
    }
    if(kind==='fillOverlay'){
      const modes={over:'source-over',mult:'multiply',screen:'screen',darken:'darken',lighten:'lighten'},mode=modes[attribute(n,'blend','over')];if(!mode)failure('unsupported-blip-overlay-blend',attribute(n,'blend'));
      const fill=parseDrawingFill(n,{parseColor:helpers.parseColor});const overlay=canvas(output.width,output.height);await renderDrawingFill(overlay.getContext('2d'),fill,{x:0,y:0,width:output.width,height:output.height},helpers);
      ctx.save();ctx.globalCompositeOperation=mode;ctx.drawImage(overlay,0,0);ctx.restore();continue;
    }
    if(kind==='alphaMod'){
      const container=child(n,'cont');if(!container)failure('invalid-alpha-mod-container','Missing effect container');
      const modulated=await applyBlipEffects(output,children(container).map(e=>({kind:e.localName,node:e})),helpers),mask=modulated.getContext('2d').getImageData(0,0,output.width,output.height).data,base=ctx.getImageData(0,0,output.width,output.height);for(let i=3;i<base.data.length;i+=4)base.data[i]=Math.round(base.data[i]*mask[i]/255);ctx.putImageData(base,0,0);continue;
    }
    const data=ctx.getImageData(0,0,output.width,output.height),color=kind==='clrRepl'?rgba(requireColor(n,helpers.parseColor)):null,
      from=kind==='clrChange'?rgba(requireColor(child(n,'clrFrom'),helpers.parseColor)):null,to=kind==='clrChange'?rgba(requireColor(child(n,'clrTo'),helpers.parseColor)):null,
      duo=kind==='duotone'?children(n).map(c=>rgba(requireColor(c,helpers.parseColor))):null;
    const supported=new Set(['alphaBiLevel','alphaCeiling','alphaFloor','alphaInv','alphaModFix','alphaRepl','biLevel','grayscl','clrChange','clrRepl','duotone','hsl','lum','tint']);
    if(!supported.has(kind))failure('unsupported-blip-effect',kind);
    if(duo&&duo.length!==2)failure('invalid-duotone-colors','Exactly two colors required');
    const cache=new Map();
    for(let i=0;i<data.data.length;i+=4){
      let p=[...data.data.slice(i,i+4)];
      if(kind==='alphaBiLevel')p[3]=p[3]/255<number('thresh')?0:255;
      else if(kind==='alphaCeiling')p[3]=p[3]===0?0:255;
      else if(kind==='alphaFloor')p[3]=p[3]===255?255:0;
      else if(kind==='alphaInv')p[3]=255-p[3];
      else if(kind==='alphaModFix')p[3]=clamp(p[3]*number('amt',1),0,255);
      else if(kind==='alphaRepl')p[3]=clamp(number('a'))*255;
      else if(kind==='clrRepl')p=[...color.slice(0,3),p[3]];
      else if(kind==='clrChange'){const useAlpha=boolean(n,'useA',true);if(p.slice(0,useAlpha?4:3).every((v,c)=>v===from[c]))p=[...to.slice(0,3),useAlpha?to[3]:p[3]];}
      else {
        const key=p.slice(0,3).join(',');let rgb=cache.get(key);
        if(!rgb){
          if(kind==='lum'){const bright=number('bright'),contrast=number('contrast'),slope=contrast>=0?1/(1-contrast||Number.EPSILON):1+contrast;rgb=p.slice(0,3).map(v=>clamp(((v/255-.5+bright/2)*slope+.5+bright/2))*255);}
          else if(kind==='hsl')rgb=transformColor(p,[['hueOff',attribute(n,'hue',0)],['satOff',attribute(n,'sat',0)],['lumOff',attribute(n,'lum',0)]],helpers.parseColor).slice(0,3);
          else if(kind==='tint'){
            const amount=number('amt');if(amount===0)rgb=p.slice(0,3);else {const target=transformColor(p,[['hue',attribute(n,'hue',0)],['sat',100000]],helpers.parseColor);rgb=p.slice(0,3).map((v,c)=>clamp(v+(target[c]-v)*amount,0,255));}
          }else {
            const gray=transformColor(p,[['gray',null]],helpers.parseColor)[0];
            if(kind==='grayscl')rgb=[gray,gray,gray];else if(kind==='biLevel'){const b=gray/255<number('thresh')?0:255;rgb=[b,b,b];}else rgb=duo[0].slice(0,3).map((v,c)=>v+(duo[1][c]-v)*gray/255);
          }
          if(cache.size>=4096)cache.clear();cache.set(key,rgb);
        }
        p=[...rgb,p[3]];
      }
      for(let c=0;c<4;c++)data.data[i+c]=Math.round(p[c]);
    }
    ctx.putImageData(data,0,0);
  }
  return output;
}
async function blipImage(model,options,image) {
  const resolved=image||await options.resolveImage?.(model.target||model.relationshipId,model);
  const source=resolved?.image||resolved;if(!source)failure('missing-blip-image',model.target||model.relationshipId);
  const effected=options.deferBlipEffects?source:await applyBlipEffects(source,model.effects,{...options,parseColor:options.parseColor||model.colorParser});
  // Metadata belongs to this resolution result, not to a shared Image object:
  // a cached image may be reused with a different document's DPI policy.
  return {image:effected,dpi:resolved?.dpi||null};
}
function croppedImage(image,rect) {
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height,src=rectangle({x:0,y:0,width,height},rect);
  if(!(src.width>0&&src.height>0))failure('invalid-blip-source-rectangle','Source rectangle has no area');
  const texture=canvas(src.width,src.height);texture.getContext('2d').drawImage(image,src.x,src.y,src.width,src.height,0,0,texture.width,texture.height);return {texture,sourceWidth:src.width,sourceHeight:src.height};
}
// Office blur radii are destination pixels (MS-OI29500 2.1.1289(b)),
// including nonuniform group transforms. Map the complete image fill first;
// then run the original effect sequence on that device-pixel surface. Applying
// a source-space blur and compensating its radius loses tile seams, affine
// anisotropy and the ordering of subsequent pixel effects.
async function destinationBlipEffects(ctx,style,model,bounds,options,drawMapped) {
  const transform=ctx.getTransform(),corners=[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x,bounds.y+bounds.height],[bounds.x+bounds.width,bounds.y+bounds.height]].map(([x,y])=>transform.transformPoint({x,y}));
  const left=Math.floor(Math.min(...corners.map(p=>p.x))),top=Math.floor(Math.min(...corners.map(p=>p.y))),right=Math.ceil(Math.max(...corners.map(p=>p.x))),bottom=Math.ceil(Math.max(...corners.map(p=>p.y)));
  if(!(right>left&&bottom>top))failure('invalid-blip-destination-surface','Empty transformed picture fill');
  const inverse=transform.inverse();if(![inverse.a,inverse.b,inverse.c,inverse.d,inverse.e,inverse.f].every(Number.isFinite))failure('invalid-blip-destination-transform','Singular fill transform');
  const surface=canvas(right-left,bottom-top),paint=surface.getContext('2d');
  paint.setTransform(new DOMMatrix().translate(-left,-top).multiply(transform));
  if(drawMapped)drawMapped(paint);else{paint.fillStyle=style;paint.fillRect(bounds.x,bounds.y,bounds.width,bounds.height);}
  const effected=await applyBlipEffects(surface,model.effects,{...options,renderingProfile:'office',parseColor:options.parseColor||model.colorParser}),pattern=ctx.createPattern(effected,'repeat');
  if(!pattern)failure('canvas-pattern-creation-failed','destination-blip-effects');
  pattern.setTransform(inverse.multiply(new DOMMatrix().translate(left,top)));return pattern;
}
export async function createDrawingFillStyle(ctx,model,bounds,options={}) {
  if(!model||model.kind==='noFill')return null;
  // A legal zero-sized shape has no fill area (e.g. a degenerate triangle).
  // Its stroke remains the caller's responsibility. This does not normalize
  // an invalid tileRect belonging to a shape with a nonzero fill area.
  if(bounds.width===0||bounds.height===0)return null;
  if(model.kind==='grpFill'){
    if(!options.groupFill)failure('unresolved-group-fill','Pass the actual parent group fill');
    const parent=options.groupFill.model||options.groupFill,parentBounds=options.groupFill.bounds||options.groupFillBounds||bounds;
    const nextParent=options.groupFill.parent||options.parentGroupFill;
    if(parent===model||parent.kind==='grpFill'&&!nextParent)failure('unresolved-group-fill','Resolve the parent group fill cascade');
    let fillTransform=options.fillTransform;
    if(options.groupFill.transform)fillTransform=matrix(fillTransform).multiply(matrix(options.groupFill.transform));
    return createDrawingFillStyle(ctx,parent,parentBounds,{...options,fillTransform,groupFill:nextParent,
      // Group shading belongs to the parent geometry. Child bounds/kind must
      // not change the parent's radial circle or custom-path fallback policy.
      geometryPaths:options.groupFill.geometryPaths,
      geometryBounds:options.groupFill.geometryBounds||parentBounds,
      geometryKind:options.groupFill.geometryKind||'preset',
      presetName:options.groupFill.presetName||'rect',
      shapeTransform:options.groupFill.shapeTransform||options.shapeTransform});
  }
  if(model.kind==='solidFill')return model.color;
  if(model.kind==='gradFill'){
    if(model.stops.length===1)return model.stops[0].color;
    const tile=rectangle(bounds,model.tileRect),office=(options.renderingProfile||model.renderingProfile)==='office';
    // MS-OI29500 2.1.1297(a): Office ignores authored gradient flip
    // and uses xy. Picture tile flips remain the authored value.
    return fillPattern(ctx,gradientTexture(model,tile,bounds,options),tile,office?{...model,flip:'xy'}:model,bounds,options);
  }
  if(model.kind==='pattFill'){const size=8*(options.dpi||96)/96;return fillPattern(ctx,patternTexture(model),{x:bounds.x,y:bounds.y,width:size,height:size},{...model,flip:'none'},bounds,options);}
  if(model.kind!=='blipFill')failure('unknown-drawingml-fill-kind',model.kind);
  const office=(options.renderingProfile||model.renderingProfile)==='office',deferBlipEffects=office&&model.effects?.some(effect=>effect.kind==='blur');
  const resolved=await blipImage(model,{...options,deferBlipEffects}),image=resolved.image,cropped=croppedImage(image,model.srcRect);
  const complete=style=>deferBlipEffects?destinationBlipEffects(ctx,style,model,bounds,options):style;
  if(model.mode==='stretch'){
    const target=rectangle(bounds,model.fillRect),texture=canvas(bounds.width,bounds.height),context=texture.getContext('2d');
    if(!(target.width>0&&target.height>0))failure('invalid-blip-fill-rectangle','Fill rectangle has no area');
    if(deferBlipEffects){
      // Stretch directly into device space: an intermediate bounds-sized image
      // would be resampled again by a group scale, changing the blur input.
      let placement=new DOMMatrix();
      if(model.rotateWithShape===false){
        const current=options.shapeTransform||ctx.getTransform(),angle=options.shapeRotation!=null?options.shapeRotation*Math.PI/180:Math.atan2(current.b,current.a),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
        placement=new DOMMatrix().translate(cx,cy).rotate(-angle*180/Math.PI).translate(-cx,-cy);
      }
      if(options.fillTransform)placement=matrix(options.fillTransform).multiply(placement);
      return destinationBlipEffects(ctx,null,model,bounds,options,paint=>{
        paint.save();paint.transform(placement.a,placement.b,placement.c,placement.d,placement.e,placement.f);
        paint.beginPath();paint.rect(bounds.x,bounds.y,bounds.width,bounds.height);paint.clip();
        paint.drawImage(cropped.texture,target.x,target.y,target.width,target.height);paint.restore();
      });
    }
    context.drawImage(cropped.texture,(target.x-bounds.x)/bounds.width*texture.width,(target.y-bounds.y)/bounds.height*texture.height,target.width/bounds.width*texture.width,target.height/bounds.height*texture.height);
    return complete(fillPattern(ctx,texture,bounds,{...model,flip:'none'},bounds,options));
  }
  const dpi=options.dpi||96,embeddedDpi=options.imageDpi||resolved.dpi||96,imageDpi=model.dpi||(model.useLocalDpi===false?96:embeddedDpi),dpiX=typeof imageDpi==='number'?imageDpi:imageDpi.x,dpiY=typeof imageDpi==='number'?imageDpi:imageDpi.y,width=cropped.sourceWidth*dpi/dpiX*model.tile.sx,height=cropped.sourceHeight*dpi/dpiY*model.tile.sy;
  if(!(width>0&&height>0))failure('invalid-blip-tile-size','Scale and image dimensions must be positive');
  const alignment={tl:[0,0],t:[.5,0],tr:[1,0],l:[0,.5],ctr:[.5,.5],r:[1,.5],bl:[0,1],b:[.5,1],br:[1,1]}[model.tile.alignment];if(!alignment)failure('unknown-blip-tile-alignment',model.tile.alignment);
  const tile={x:bounds.x+(bounds.width-width)*alignment[0]+model.tile.tx/914400*dpi,y:bounds.y+(bounds.height-height)*alignment[1]+model.tile.ty/914400*dpi,width,height};
  return complete(fillPattern(ctx,cropped.texture,tile,{...model,flip:model.tile.flip},bounds,options));
}
export async function renderDrawingFill(ctx,model,bounds,options={}) {
  const style=await createDrawingFillStyle(ctx,model,bounds,options);if(style==null)return false;
  ctx.save();try{if(options.clip)options.clip(ctx);ctx.fillStyle=style;ctx.fillRect(bounds.x,bounds.y,bounds.width,bounds.height);}finally{ctx.restore();}return true;
}
export async function drawBlipFill(ctx,model,image,bounds,options={}) {
  return renderDrawingFill(ctx,model,bounds,{...options,resolveImage:async()=>image});
}
