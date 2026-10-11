// DrawingML shape effects. ISO/IEC 29500-1 §§20.1.8.29,32,40,45,50.
// Office differences: MS-OI29500 §§2.1.1300,1303,1304. Canvas raster
// semantics are implemented here; Microsoft kernel/quantization remains a
// separate visual acceptance requirement, never implied by model support.
import { parseDrawingFill, renderDrawingFill } from './pptx-fills.js';
const A=new Set(['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main']);
const modes={over:'source-over',mult:'multiply',screen:'screen',darken:'darken',lighten:'lighten'};
const children=n=>[...(n?.children||[])].filter(c=>A.has(c.namespaceURI));
const value=(n,k,d)=>n.getAttribute(k)??d;
function fail(code,detail){const error=Error(`${code}: ${detail}`);error.code=code;throw error;}
function number(n,k,d=0){const v=Number(value(n,k,d));if(!Number.isFinite(v))fail('invalid-drawing-effect-number',k);return v;}
function percent(n,k,d=0){const v=value(n,k,null);if(v==null)return d;const x=String(v).endsWith('%')?parseFloat(v)/100:Number(v)/100000;if(!Number.isFinite(x))fail('invalid-drawing-effect-percentage',k);return x;}
const angle=(n,k,d=0)=>number(n,k,d)/60000*Math.PI/180;
const positive=(n,k,d=0)=>{const v=number(n,k,d);if(v<0)fail('invalid-drawing-effect-radius',k);return v;};
const surface=(w,h)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;};
const alignment={tl:[0,0],t:[.5,0],tr:[1,0],l:[0,.5],ctr:[.5,.5],r:[1,.5],bl:[0,1],b:[.5,1],br:[1,1]};
export function parseDrawingEffects(input,options={}){
 if(!input)return [];
 const node=typeof input==='string'?new DOMParser().parseFromString(input,'application/xml').documentElement:input;
 if(node.localName==='parsererror'||node.querySelector?.('parsererror'))fail('invalid-drawing-effect-xml','Malformed effect XML');
 const list=node.localName==='effectLst'?node:children(node).find(n=>n.localName==='effectLst');
 if(!list){if(node.localName==='effectDag'||children(node).some(n=>n.localName==='effectDag'))fail('unsupported-drawing-effect-dag','Resolve named graph effects explicitly');return [];}
 return children(list).map(n=>{
  const kind=n.localName,model={kind,renderingProfile:options.renderingProfile||'iso',conformanceStatus:'unverified'};
  if(kind==='fillOverlay'){const blend=value(n,'blend',null);if(!modes[blend])fail('unsupported-drawing-effect-blend',blend);return {...model,blend,fill:parseDrawingFill(n,options)};}
  if(!['innerShdw','outerShdw','glow','reflection','blur'].includes(kind))fail('unsupported-drawing-effect',kind);
  if(kind==='blur')return {...model,radius:positive(n,'rad'),grow:!['0','false'].includes(value(n,'grow','true'))};
  if(kind==='glow'||kind==='innerShdw'||kind==='outerShdw'){
   const colorNode=children(n).find(c=>['srgbClr','schemeClr','prstClr','sysClr','scrgbClr','hslClr'].includes(c.localName)),color=options.parseColor?.(colorNode);
   if(!color)fail('unresolved-drawing-effect-color',kind);
   Object.assign(model,{color,radius:positive(n,kind==='glow'?'rad':'blurRad')});
   if(kind==='glow')return model;
  }else Object.assign(model,{radius:positive(n,'blurRad'),startAlpha:percent(n,'stA',1),startPosition:percent(n,'stPos'),endAlpha:percent(n,'endA'),endPosition:percent(n,'endPos',1),fadeDirection:angle(n,'fadeDir',5400000)});
  Object.assign(model,{distance:positive(n,'dist'),direction:angle(n,'dir'),sx:percent(n,'sx',1),sy:percent(n,'sy',1),kx:angle(n,'kx'),ky:angle(n,'ky'),alignment:value(n,'algn','b'),rotateWithShape:!['0','false'].includes(value(n,'rotWithShape','true'))});
  if(!alignment[model.alignment])fail('invalid-drawing-effect-alignment',model.alignment);
  if(kind==='reflection'&&(!(model.startPosition>=0&&model.endPosition<=1&&model.endPosition>model.startPosition)||model.startAlpha<0||model.startAlpha>1||model.endAlpha<0||model.endAlpha>1))fail('invalid-reflection-alpha-ramp','Invalid positions or opacity');
  return model;
 });
}
function reflectionMatrix(effect,bounds,dpi,options={}){
 if(effect.rotateWithShape&&options.localBounds&&options.shapeTransform){
  const transform=Array.isArray(options.shapeTransform)?new DOMMatrix(options.shapeTransform):DOMMatrix.fromMatrix(options.shapeTransform);
  return transform.multiply(reflectionMatrix(effect,options.localBounds,dpi)).multiply(transform.inverse());
 }
 const [ax,ay]=alignment[effect.alignment],x=bounds.x+bounds.width*ax,y=bounds.y+bounds.height*ay,office=effect.renderingProfile==='office',direction=office?effect.direction:effect.fadeDirection,distance=effect.distance/914400*dpi;
 return new DOMMatrix().translate(distance*Math.cos(direction),distance*Math.sin(direction)).translate(x,y).multiply(new DOMMatrix([effect.sx,effect.sx*Math.tan(effect.ky),effect.sy*Math.tan(effect.kx),effect.sy,0,0])).translate(-x,-y);
}
function mappedBounds(bounds,matrix){const points=[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x,bounds.y+bounds.height],[bounds.x+bounds.width,bounds.y+bounds.height]].map(([x,y])=>matrix.transformPoint({x,y})),left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));return {x:left,y:top,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-top};}
function union(a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};}
const expanded=(bounds,padding)=>({x:bounds.x-padding,y:bounds.y-padding,width:bounds.width+padding*2,height:bounds.height+padding*2});
export function drawingEffectsExtent(effects,bounds,options={}){
 const dpi=options.dpi||96;let extent={...bounds};
 for(const e of effects){const radius=e.radius/914400*dpi,padding=radius>0?Math.ceil(radius*3)+2:0;
  if(e.kind==='glow'||e.kind==='blur'&&e.grow)extent=union(extent,expanded(bounds,padding));
  if(e.kind==='reflection')extent=union(extent,expanded(mappedBounds(bounds,reflectionMatrix(e,bounds,dpi,options)),padding));
  if(e.kind==='outerShdw'){if(e.renderingProfile==='office'&&options.container!=='grpSpPr'&&(e.sx!==1||e.sy!==1))continue;extent=union(extent,expanded(mappedBounds(bounds,reflectionMatrix(e,bounds,dpi,options)),padding));}
 }
 return extent;
}
function copy(image){const c=surface(image.width,image.height);c.getContext('2d').drawImage(image,0,0);return c;}
function coloredMask(image,color){const c=copy(image),ctx=c.getContext('2d');ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,c.width,c.height);return c;}
function blurred(image,radius){if(!radius)return copy(image);const c=surface(image.width,image.height),ctx=c.getContext('2d');ctx.filter=`blur(${radius}px)`;ctx.drawImage(image,0,0);return c;}
// bounds are final affine canvas coordinates. paint receives a real Canvas
// context retaining the caller's coordinate system; it draws fill/stroke/text
// once, including its own existing group and shape transforms. No DOM cloning.
export async function renderDrawingEffects(ctx,input,bounds,paint,options={}){
 const effects=Array.isArray(input)?input:parseDrawingEffects(input,options);
 if(!effects.length){await paint(ctx,{deviceOrigin:{x:0,y:0},callerTransform:ctx.getTransform()});return {supported:true,effects:[],conformanceStatus:'unverified'};}
 const callerTransform=ctx.getTransform(),inverseCaller=callerTransform.inverse(),deviceBounds=mappedBounds(bounds,callerTransform),extent=mappedBounds(drawingEffectsExtent(effects,bounds,options),callerTransform),left=Math.floor(extent.x),top=Math.floor(extent.y),width=Math.ceil(extent.x+extent.width)-left,height=Math.ceil(extent.y+extent.height)-top,dpi=options.dpi||96,base=surface(width,height),baseCtx=base.getContext('2d');
 baseCtx.setTransform(new DOMMatrix().translate(-left,-top).multiply(callerTransform));await paint(baseCtx,{deviceOrigin:{x:left,y:top},callerTransform});
 // The callback paints in caller coordinates; subsequent raster compositing
 // operates in surface coordinates. Retaining this capture transform would
 // translate each inner-shadow/overlay draw a second time.
 baseCtx.setTransform(1,0,0,1,0,0);baseCtx.globalAlpha=1;baseCtx.globalCompositeOperation='source-over';baseCtx.filter='none';
 let foreground=base;const behind=surface(width,height),back=behind.getContext('2d');
 for(const effect of effects){const radius=effect.radius/914400*dpi;
  if(effect.kind==='blur'){foreground=blurred(foreground,radius);if(!effect.grow){const fc=foreground.getContext('2d');fc.globalCompositeOperation='destination-in';fc.drawImage(base,0,0);fc.globalCompositeOperation='source-over';}continue;}
  if(effect.kind==='fillOverlay'){
   const overlay=surface(width,height),oc=overlay.getContext('2d'),local=options.localBounds&&options.shapeTransform,ownTransform=local?(Array.isArray(options.shapeTransform)?new DOMMatrix(options.shapeTransform):DOMMatrix.fromMatrix(options.shapeTransform)):new DOMMatrix();
   oc.setTransform(new DOMMatrix().translate(-left,-top).multiply(callerTransform).multiply(ownTransform));
   await renderDrawingFill(oc,effect.fill,local?options.localBounds:bounds,{...options,shapeTransform:oc.getTransform()});oc.setTransform(1,0,0,1,0,0);oc.globalCompositeOperation='destination-in';oc.drawImage(foreground,0,0);
   const fc=foreground.getContext('2d');fc.save();fc.globalCompositeOperation=modes[effect.blend];fc.drawImage(overlay,0,0);fc.restore();continue;
  }
  if(effect.kind==='glow'){const glow=blurred(coloredMask(foreground,effect.color),radius);glow.getContext('2d').globalCompositeOperation='destination-out';glow.getContext('2d').drawImage(foreground,0,0);back.drawImage(glow,0,0);continue;}
  if(effect.kind==='innerShdw'){
   // Office dir is clockwise from the left, unlike the generic right-axis
   // convention. A shadow of the complement is clipped source-atop, keeping
   // the object's original alpha even along antialiased edges.
   const distance=effect.distance/914400*dpi,office=effect.renderingProfile==='office',dx=distance*Math.cos(effect.direction)*(office?-1:1),dy=distance*Math.sin(effect.direction)*(office?-1:1),shifted=surface(width,height),sc=shifted.getContext('2d');sc.drawImage(foreground,dx,dy);
   const softened=blurred(shifted,radius),mask=surface(width,height),mc=mask.getContext('2d');mc.fillStyle=effect.color;mc.fillRect(0,0,width,height);mc.globalCompositeOperation='destination-out';mc.drawImage(softened,0,0);
   const fc=foreground.getContext('2d');fc.save();fc.globalCompositeOperation='source-atop';fc.drawImage(mask,0,0);fc.restore();continue;
  }
  if(effect.kind==='outerShdw'&&effect.renderingProfile==='office'&&options.container!=='grpSpPr'&&(effect.sx!==1||effect.sy!==1))continue;
  if(effect.kind==='outerShdw'||effect.kind==='reflection'){
   const matrix=callerTransform.multiply(reflectionMatrix(effect,bounds,dpi,options)).multiply(inverseCaller),image=effect.kind==='outerShdw'?coloredMask(foreground,effect.color):foreground,mapped=surface(width,height),mc=mapped.getContext('2d');
   mc.setTransform(new DOMMatrix().translate(-left,-top).multiply(matrix).translate(left,top));mc.drawImage(image,0,0);
   let effectImage=blurred(mapped,radius);
   if(effect.kind==='reflection'){
    const local=effect.rotateWithShape&&options.localBounds&&options.shapeTransform,shapeTransform=local?(Array.isArray(options.shapeTransform)?new DOMMatrix(options.shapeTransform):DOMMatrix.fromMatrix(options.shapeTransform)):new DOMMatrix(),rampInverse=callerTransform.multiply(shapeTransform).inverse(),rampBounds=local?options.localBounds:bounds;
    const rect=mappedBounds(rampBounds,reflectionMatrix(effect,rampBounds,dpi)),direction=effect.renderingProfile==='office'?effect.fadeDirection:effect.direction,ux=Math.cos(direction),uy=Math.sin(direction),projections=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>x*ux+y*uy),minimum=Math.min(...projections),span=Math.max(...projections)-minimum;
    if(!(span>0))fail('invalid-reflection-transform','Reflection has no ramp extent');const ec=effectImage.getContext('2d'),data=ec.getImageData(0,0,width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const point=rampInverse.transformPoint({x:x+left+.5,y:y+top+.5}),position=(point.x*ux+point.y*uy-minimum)/span,t=Math.max(0,Math.min(1,(position-effect.startPosition)/(effect.endPosition-effect.startPosition))),alpha=effect.startAlpha+(effect.endAlpha-effect.startAlpha)*t;data.data[(y*width+x)*4+3]=Math.round(data.data[(y*width+x)*4+3]*alpha);}ec.putImageData(data,0,0);
   }
   back.drawImage(effectImage,0,0);continue;
  }
  fail('unsupported-drawing-effect',effect.kind);
 }
 back.drawImage(foreground,0,0);ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(behind,left,top);}finally{ctx.restore();}
 return {supported:true,effects:effects.map(e=>e.kind),extent,conformanceStatus:'unverified'};
}
