/** PresentationML playback. Unsupported constructs are conformance failures, never silent fallbacks. */
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC='http://schemas.openxmlformats.org/markup-compatibility/2006';
const supportedNamespaces=new Set([P,A,R,'http://schemas.microsoft.com/office/powerpoint/2010/main','http://schemas.microsoft.com/office/powerpoint/2012/main']);
const children = n => Array.from(n?.children || []).flatMap(v=>{
  if(v.localName!=='AlternateContent'||v.namespaceURI!==MC)return [v];
  const alternatives=Array.from(v.children||[]);
  const selected=alternatives.find(branch=>branch.localName==='Choice'&&String(branch.getAttribute('Requires')||'').trim().split(/\s+/).every(prefix=>supportedNamespaces.has(branch.lookupNamespaceURI(prefix))))||alternatives.find(branch=>branch.localName==='Fallback');
  return children(selected);
});
const child = (n, name) => children(n).find(v => v.localName === name);
const descendants = (n, name) => children(n).flatMap(v=>[...(v.localName===name?[v]:[]),...descendants(v,name)]);
const attr = (n, name, fallback = null) => n?.getAttribute(name) ?? fallback;
const number = (n, name, fallback = 0) => Number(attr(n, name, fallback));
const percentage = (n,name,fallback=0) => {const value=attr(n,name);if(value==null)return fallback;return String(value).endsWith('%')?Number(String(value).slice(0,-1))/100:Number(value)/100000;};
const relationshipId = (n, name) => n?.getAttributeNS(R, name) || n?.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', name) || attr(n, 'r:' + name);
function failure(list, code, node, detail) {
  list.push({ code, element: node?.localName || null, detail });
}
function time(value, failures, node) {
  if (value == null) return 0;
  if (value === 'indefinite') return Infinity;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  failure(failures, 'invalid-time', node, value);
  return 0;
}
function universalTime(value,failures,node) {
  if(value==null)return 0;
  const match=/^(\d+(?:\.\d+)?)(h|min|s|ms|µs|ns)?$/i.exec(value);
  if(!match){failure(failures,'invalid-universal-time-offset',node,value);return 0;}
  const scales={h:3600000,min:60000,s:1000,ms:1,'µs':0.001,ns:0.000001};
  const result=Number(match[1])*(scales[(match[2]||'ms').toLowerCase()]);
  if(!Number.isFinite(result)){failure(failures,'invalid-universal-time-offset',node,value);return 0;}
  return result;
}
function conditions(node, failures) {
  return children(node).map(cond => {
    const evt = attr(cond, 'evt');
    if (evt && !['onClick', 'onNext', 'onPrev','onBegin','onEnd','begin','end','onStopAudio','onMediaBookmark'].includes(evt)) failure(failures, 'unsupported-event', cond, evt);
    if(child(cond,'rtn'))failure(failures,'unsupported-runtime-node-trigger',cond,child(cond,'rtn').outerHTML);
    const target = child(cond, 'tgtEl');
    const sp = child(target, 'spTgt');
    const slideTarget=child(target,'sldTgt');
    const bookmarkTarget=child(target,'bmkTgt');
    if(bookmarkTarget&&(!attr(bookmarkTarget,'spid')||!attr(bookmarkTarget,'bmkName')))failure(failures,'invalid-media-bookmark-target',bookmarkTarget,bookmarkTarget.outerHTML);
    if(bookmarkTarget && evt!=='onMediaBookmark')failure(failures,'unsupported-bookmark-trigger-event',cond,evt);
    if(evt==='onMediaBookmark'&&!bookmarkTarget)failure(failures,'missing-media-bookmark-target',cond,cond.outerHTML);
    if(target && ((!sp&&!slideTarget&&!bookmarkTarget)||children(target).some(v=>v!==sp&&v!==slideTarget&&v!==bookmarkTarget)))failure(failures,'unsupported-condition-target',target,target.outerHTML);
    return { event: evt, delay: time(attr(cond, 'delay'), failures, cond), shapeId: attr(sp||bookmarkTarget, 'spid'), bookmark:attr(bookmarkTarget,'bmkName'), timeNode: attr(child(cond, 'tn'), 'val') };
  });
}
function animationExpression(value,variables,validateOnly=false) {
  const source=String(value??'');
  const tokens=source.match(/#?ppt_[xywh]|\$|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[a-z]+|[(),+*/%^-]/g)||[];
  if(tokens.join('')!==source.replace(/\s/g,''))throw Error('Unsupported animation expression: '+source);
  if(tokens.length>2048)throw Error('Animation expression is too long');
  const functions={abs:Math.abs,acos:Math.acos,asin:Math.asin,atan:Math.atan,ceil:Math.ceil,cos:Math.cos,cosh:Math.cosh,deg:x=>x*180/Math.PI,exp:Math.exp,floor:Math.floor,ln:Math.log,max:Math.max,min:Math.min,rad:x=>x*Math.PI/180,sin:Math.sin,sinh:Math.sinh,sqrt:Math.sqrt,tan:Math.tan,tanh:Math.tanh};
  let index=0,depth=0;
  const factor=()=>{
    if(++depth>128)throw Error('Animation expression nesting is too deep');
    const token=tokens[index++];let value;
    if(token==='('){value=add();if(tokens[index++]!==')')throw Error('Unbalanced animation expression');}
    else if(token==='$'||/^#?ppt_[xywh]$/.test(token||'')){value=variables[token.replace(/^#/,'')];if(!Number.isFinite(value))throw Error('Missing animation variable: '+token);}
    else if(token==='pi'||token==='e')value=token==='pi'?Math.PI:Math.E;
    else if(functions[token]){if(tokens[index++]!=='(')throw Error('Missing function parentheses');const args=[add()];if(tokens[index]===','){index++;args.push(add());}if(tokens[index++]!==')'||args.length!==(['max','min'].includes(token)?2:1))throw Error('Invalid function arguments: '+token);value=functions[token](...args);}
    else {if(token==null||!Number.isFinite(Number(token)))throw Error('Invalid animation expression token: '+token);value=Number(token);}
    depth--;return value;
  };
  const unary=()=>{const token=tokens[index];if(token==='+'||token==='-'){index++;return(token==='-'?-1:1)*factor();}return factor();};
  const power=()=>{let value=unary();if(tokens[index]==='^'){index++;value=value**unary();}return value;};
  const multiply=()=>{let value=power();while(['*','/','%'].includes(tokens[index])){const op=tokens[index++],next=power();value=op==='*'?value*next:op==='/'?value/next:value%next;}return value;};
  const add=()=>{let value=multiply();while(tokens[index]==='+'||tokens[index]==='-'){const op=tokens[index++],next=multiply();value=op==='+'?value+next:value-next;}return value;};
  const result=add();if(index!==tokens.length||(!validateOnly&&!Number.isFinite(result)))throw Error('Invalid animation expression');return result;
}

function motionPath(path,width=1,height=1) {
  if(typeof path!=='string')return null;
  const tokens=path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[MLCZEmlcze]/g)||[];
  if(tokens.join('').toLowerCase()!==path.replace(/[\s,]/g,'').toLowerCase())return null;
  let index=0,output='',first=true;
  while(index<tokens.length){
    const command=tokens[index++],upper=command.toUpperCase();
    if(!/^[MLCZEmlcze]$/.test(command)||(first&&upper!=='M'))return null;
    first=false;
    if(upper==='E'){if(index!==tokens.length)return null;break;}
    if(upper==='Z'){output+=command+' ';continue;}
    const values=[];
    while(index<tokens.length&&!/^[MLCZEmlcze]$/.test(tokens[index])){const token=tokens[index++];values.push(Number(/^\+?\.\d/.test(token)?token.replace('.',''):token));}
    const size=upper==='C'?6:2;
    if(!values.length||values.length%size||values.some(v=>!Number.isFinite(v)))return null;
    output+=command+' '+values.map((v,i)=>v*(i%2?height:width)).join(' ')+' ';
  }
  return first?null:output.trim();
}
function parseTimeNode(n, failures,depth=0,inSub=false,path=[]) {
  const c = child(n, 'cTn') || child(child(n, 'cBhvr'), 'cTn') || child(child(n, 'cMediaNode'), 'cTn');
  const model = { kind: n.localName, id: attr(c, 'id'), nodeType: attr(c, 'nodeType'), presetClass: attr(c, 'presetClass'), presetId: attr(c, 'presetID'), restart:attr(c,'restart','always'), eventFilter:attr(c,'evtFilter'), display:!['0','false'].includes(attr(c,'display','1')), duration: time(attr(c, 'dur'), failures, c), delay: 0, fill: attr(c, 'fill', 'remove'), start: conditions(child(c, 'stCondLst'), failures), end: conditions(child(c, 'endCondLst'), failures), children: [], subChildren:[], masterRelation:inSub?attr(c,'masterRel'):null };
  if (c) {
    const animatedLeaf=['anim','animClr','animEffect','animMotion','animRot','animScale'].includes(n.localName);
    const rawChildren=children(child(c,'childTnLst'));
    const parentClock=['1','true'].includes(attr(c,'autoRev'))||(attr(c,'repeatCount')!=null&&attr(c,'repeatCount')!=='1000')||attr(c,'repeatDur')!=null||percentage(c,'spd',1)!==1||percentage(c,'accel')!==0||percentage(c,'decel')!==0||attr(c,'tmFilter')!=null;
    model.simpleTimingChild=parentClock&&n.localName==='par'&&model.duration===0&&rawChildren.length===1&&['anim','animClr','animEffect','animMotion','animRot','animScale'].includes(rawChildren[0].localName)&&!child(c,'iterate');
    const timingTarget=animatedLeaf||model.simpleTimingChild;
    model.autoReverse=['1','true'].includes(attr(c,'autoRev'));model.repeatCount=attr(c,'repeatCount')==null?1:time(attr(c,'repeatCount'),failures,c)/1000;model.repeatDuration=attr(c,'repeatDur')==null?Infinity:time(attr(c,'repeatDur'),failures,c);model.speed=percentage(c,'spd',1);
    model.timeFilter=attr(c,'tmFilter')==null?null:String(attr(c,'tmFilter')).split(';').map(pair=>pair.trim().split(',').map(value=>Number(value.trim())));
    if(model.timeFilter){if(model.timeFilter.length<2||model.timeFilter.some(pair=>pair.length!==2||pair.some(value=>!Number.isFinite(value)||value<0||value>1))||model.timeFilter.some((pair,index)=>index&&pair[0]<=model.timeFilter[index-1][0]))failure(failures,'invalid-animation-time-filter',c,attr(c,'tmFilter'));else if(model.timeFilter[0][0]!==0||model.timeFilter[model.timeFilter.length-1][0]!==1)failure(failures,'unverified-partial-time-filter-domain',c,attr(c,'tmFilter'));}
    model.acceleration=percentage(c,'accel');model.deceleration=percentage(c,'decel');
    if(model.timeFilter&&(model.acceleration||model.deceleration))failure(failures,'unverified-combined-filter-acceleration',c,'Time filter and acceleration/deceleration ordering requires a PowerPoint timeline reference.');
    if(!Number.isFinite(model.acceleration)||!Number.isFinite(model.deceleration)||model.acceleration<0||model.deceleration<0||model.acceleration+model.deceleration>1)failure(failures,'invalid-animation-acceleration',c,{accel:model.acceleration,decel:model.deceleration});
    if(!['0','1','false','true'].includes(attr(c,'autoRev','0')))failure(failures,'invalid-auto-reverse',c,attr(c,'autoRev'));
    if(timingTarget&&attr(c,'repeatCount')!=null&&model.repeatCount>1&&attr(c,'repeatDur')==null)failure(failures,'unverified-repeat-duration-default',c,'ISO absent repeatDur wording and repeatCount precedence require a measured PowerPoint timeline.');
    if(timingTarget&&model.autoReverse&&(attr(c,'repeatCount')!=null||attr(c,'repeatDur')!=null))failure(failures,'unverified-auto-reverse-repeat-combination',c,'Combined repeat/autoReverse cycle timing requires a PowerPoint timeline reference.');
    if(!Number.isFinite(model.speed)||model.speed===0)failure(failures,'unsupported-timing-speed',c,attr(c,'spd'));
    for (const key of ['autoRev', 'repeatCount', 'repeatDur', 'spd', 'accel', 'decel', 'syncBehavior', 'masterRel','afterEffect','tmFilter','nodePh','bldLvl']) {
      const value = attr(c, key);
      if (value != null && !(timingTarget&&['autoRev','repeatCount','repeatDur','spd','accel','decel','tmFilter'].includes(key)) && !(key==='masterRel'&&(!inSub||model.masterRelation==='sameClick')) && !((key === 'autoRev' && ['0','false'].includes(value)) || (key === 'repeatCount'&&model.repeatCount===1) || (key === 'spd' && model.speed === 1) || (['accel','decel'].includes(key) && percentage(c,key) === 0))) failure(failures, 'unsupported-timing-attribute', c, `${key}=${value}`);
    }
    if(!['always','whenNotActive','never'].includes(model.restart))failure(failures,'unsupported-timing-restart',c,model.restart);
    if(model.eventFilter && model.eventFilter!=='cancelBubble')failure(failures,'unsupported-event-filter',c,model.eventFilter);
    if(!['remove','hold','freeze'].includes(model.fill))failure(failures,'unsupported-timing-fill',c,model.fill);
    model.endSync=child(c,'endSync')?{event:attr(child(c,'endSync'),'evt'),runtime:attr(child(child(c,'endSync'),'rtn'),'val')}:null;
    if(model.endSync&&!(model.endSync.event==='end'&&model.endSync.runtime==='all'))failure(failures,'unsupported-end-synchronization',c,child(c,'endSync').outerHTML);
    const iterate=child(c,'iterate');
    if(iterate){const absolute=child(iterate,'tmAbs'),percentInterval=child(iterate,'tmPct');model.iteration={type:attr(iterate,'type','el'),backwards:['1','true'].includes(attr(iterate,'backwards')),interval:absolute?time(attr(absolute,'val'),failures,absolute):null,percentage:percentInterval?percentage(percentInterval,'val'):null};if(!['el','lt','wd'].includes(model.iteration.type)||(+!!absolute + +!!percentInterval)!==1||(absolute&&attr(absolute,'val')==null)||(percentInterval&&(attr(percentInterval,'val')==null||!Number.isFinite(model.iteration.percentage)||model.iteration.percentage<0)))failure(failures,'invalid-time-iteration',iterate,iterate.outerHTML);if(model.iteration.type==='wd')failure(failures,'unverified-word-iteration-segmentation',iterate,'Word boundaries require comparison with PowerPoint, including punctuation.');}
    const subTimeList=child(c,'subTnLst');
    if(subTimeList){if(depth!==4||path[0]!=='par'||path[1]!=='seq')failure(failures,'unsupported-powerpoint-sub-time-placement',subTimeList,{depth:depth+1,path});model.subChildren=children(subTimeList).map(v=>parseTimeNode(v,failures,depth+1,true,[...path,n.localName]));}
    model.children=children(child(c,'childTnLst')).map(v=>parseTimeNode(v,failures,depth+1,false,[...path,n.localName]));
    if(inSub&&model.masterRelation!=='sameClick')failure(failures,'unsupported-sub-time-master-relation',c,model.masterRelation==null?'No default relation is specified by the standard.':model.masterRelation);

    if(model.simpleTimingChild){const only=model.children[0];if(only.start.some(condition=>condition.event||condition.timeNode||condition.delay!==0))failure(failures,'unsupported-inherited-timing-child-start',c,only.start);if(model.timeFilter&&(only.timeFilter||only.acceleration||only.deceleration))failure(failures,'unsupported-nested-time-filter-clock',c,only.id);if(only.timeFilter&&(model.acceleration||model.deceleration))failure(failures,'unsupported-nested-time-filter-clock',c,only.id);if(model.autoReverse&&only.autoReverse)failure(failures,'unsupported-nested-auto-reverse',c,only.id);if((model.acceleration||model.deceleration)&&(only.acceleration||only.deceleration))failure(failures,'unsupported-nested-acceleration-clock',c,only.id);}
  }
  if(['par','seq'].includes(n.localName) && Number.isFinite(model.duration) && model.duration>0)failure(failures,'unsupported-container-duration-limit',c,model.duration);
  for(const end of model.end)if(!(['audio','video'].includes(n.localName)&&['onStopAudio','onNext','onPrev'].includes(end.event)&&!end.shapeId&&!end.timeNode&&!end.bookmark&&Number.isFinite(end.delay)))failure(failures,'unsupported-end-condition',c,end);
  const b = child(n, 'cBhvr');
  const target = child(b || child(n, 'cMediaNode'), 'tgtEl');
  const sp = child(target, 'spTgt');
  model.shapeId = attr(sp, 'spid');
  const textTarget=child(sp,'txEl'),paragraphRange=child(textTarget,'pRg');
  if(paragraphRange) {
    const first=Number(attr(paragraphRange,'st')),last=Number(attr(paragraphRange,'end'));
    if(attr(paragraphRange,'st')==null||attr(paragraphRange,'end')==null||!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||last<first||last-first>100000)failure(failures,'invalid-paragraph-target-range',paragraphRange,paragraphRange.outerHTML);
    else model.targetIds=Array.from({length:last-first+1},(_,i)=>`${model.shapeId}:p:${first+i}`);
  }
  if(sp && children(sp).some(v=>v!==textTarget) || textTarget && (children(textTarget).some(v=>v!==paragraphRange)||!paragraphRange))failure(failures,'unsupported-subshape-target',sp,'Only inclusive paragraph index ranges currently have separate DOM targets.');
  const snd=child(target,'sndTgt');
  if(snd)model.mediaRelationshipId=relationshipId(snd,'embed');
  if (target && !sp && !snd) failure(failures, 'unsupported-animation-target', target, target.outerHTML);
  model.attributes = children(child(b, 'attrNameLst')).map(v => v.textContent.trim());
  model.override=attr(b,'override','normal');
  for (const key of ['additive','accumulate','override','transformType','rctx']) if (attr(b,key) != null && !(key==='override'&&n.localName==='animClr'&&model.attributes[0]==='style.color'&&['normal','childStyle'].includes(model.override))) failure(failures, 'unsupported-behavior-attribute', b, `${key}=${attr(b,key)}`);
  if (n.localName === 'animEffect') {
    model.transition = attr(n, 'transition', 'in'); model.filter = attr(n, 'filter', '');
    if (!['fade','wipe(left)','wipe(right)','wipe(up)','wipe(down)','box(in)','box(out)','diamond(in)','diamond(out)','circle(in)','circle(out)','blinds(horizontal)','blinds(vertical)','slide(fromLeft)','slide(fromRight)','slide(fromTop)','slide(fromBottom)'].includes(model.filter)) failure(failures, 'unsupported-animation-filter', n, model.filter);
    if (!['in','out'].includes(model.transition)) failure(failures, 'unsupported-effect-transition', n, model.transition);
    if (attr(n,'prLst') || child(n,'progress')) failure(failures, 'unsupported-effect-progress', n, 'prLst/progress');
  } else if (n.localName === 'set') {
    model.declaredAttributes=[...model.attributes];model.attributes=model.attributes.slice(0,1);
    if(!model.attributes.length)failure(failures,'missing-set-attribute-name',n,'PowerPoint requires at least one attrName.');
    const val = children(child(n, 'to'))[0]; model.value = attr(val, 'val', val?.textContent);
    if (model.attributes.some(v => !['style.visibility','style.opacity','stroke.on','fill.on','fill.type'].includes(v))) failure(failures, 'unsupported-set-property', n, model.attributes);
  } else if(n.localName==='animClr') {
    model.declaredAttributes=[...model.attributes];model.attributes=model.attributes.slice(0,1);
    model.colorSpace=attr(n,'clrSpc','rgb');model.colorDirection=attr(n,'dir','cw');
    const readColor=node=>{const color=children(node)[0];return color?{kind:color.localName,value:attr(color,'val'),attributes:Object.fromEntries(Array.from(color.attributes||[]).map(a=>[a.name,a.value])),transforms:children(color).map(t=>({kind:t.localName,value:attr(t,'val')}))}:null;};
    model.colorFrom=readColor(child(n,'from'))||{kind:'srgbClr',value:'000000',transforms:[]};model.colorTo=readColor(child(n,'to'));model.colorBy=child(n,'by')?.outerHTML||null;
    if(!model.attributes.length||!['fillcolor','stroke.color','style.color'].includes(model.attributes[0]))failure(failures,'unsupported-animate-color-property',n,model.attributes);
    if(model.colorSpace!=='rgb')failure(failures,'unsupported-animate-color-space',n,model.colorSpace);
    if(!model.colorTo)failure(failures,model.colorBy?'unsupported-relative-animate-color':'missing-animate-color-destination',n,model.colorBy);
  } else if (n.localName === 'anim') {
    model.values = children(child(n,'tavLst')).map(v => {
      const val = children(child(v,'val'))[0];
      const formula=attr(v,'fmla');if(formula)try{animationExpression(formula,{ppt_x:1,ppt_y:1,ppt_w:1,ppt_h:1,'$':.5},true);}catch(error){failure(failures,'unsupported-animation-formula',v,error.message);}
      return {offset:percentage(v,'tm'),value:attr(val,'val',val?.textContent),formula};
    });
    if(model.values.some(v=>!Number.isFinite(v.offset)||v.offset<0||v.offset>1)||model.values.some((v,i)=>i&&v.offset<model.values[i-1].offset))failure(failures,'invalid-animation-keypoint-time',n,model.values);
    if(model.values.some(v=>v.formula))failure(failures,'unverified-animation-formula-sampling',n,'Continuous mathematical formulas use sampled native keyframes; error bounds require a PowerPoint timeline reference.');
    model.from = attr(n,'from'); model.to = attr(n,'to'); model.by=attr(n,'by');
    if(model.by!=null)failure(failures,'unsupported-relative-animate-value',n,model.by);
    if(attr(n,'valueType') && attr(n,'valueType')!=='num')failure(failures,'unsupported-animation-value-type',n,attr(n,'valueType'));
    model.calcMode = attr(n,'calcmode','lin');
    if (!['lin','discrete'].includes(model.calcMode)) failure(failures,'unsupported-interpolation',n,model.calcMode);
    if (model.attributes.some(v => !['style.opacity','ppt_x','ppt_y','ppt_w','ppt_h'].includes(v))) failure(failures,'unsupported-animate-property',n,model.attributes);
    for(const value of [...model.values.map(v=>v.value),model.from,model.to].filter(v=>v!=null))try{animationExpression(value,{ppt_x:1,ppt_y:1,ppt_w:1,ppt_h:1},true);}catch(e){failure(failures,'unsupported-animation-value',n,e.message);}
  } else if (n.localName === 'animMotion') {
    model.path = attr(n,'path',''); model.origin = attr(n,'origin','layout'); model.pathEditMode = attr(n,'pathEditMode','relative');
    if (model.path.trim()&&!motionPath(model.path)) failure(failures,'unsupported-motion-path',n,model.path);
    if (model.origin !== 'layout' || model.pathEditMode !== 'relative') failure(failures,'unsupported-motion-coordinate-system',n,`${model.origin}/${model.pathEditMode}`);
    if (number(n,'rAng')!==0 || child(n,'by') || child(n,'from') || child(n,'to')) failure(failures,'unsupported-motion-parameters',n,n.outerHTML);
  } else if (n.localName === 'animRot') {
    model.from = number(n,'from'); model.to = attr(n,'to') == null ? model.from + number(n,'by') : number(n,'to');
  } else if (n.localName === 'animScale') {
    const from=child(n,'from'), to=child(n,'to'), by=child(n,'by');
    model.scaleMode=from&&to?'from_to':from&&by?'from_by':!from&&to?'to_only':!from&&by?'by_only':null;
    if(!model.scaleMode)failure(failures,'invalid-scale-animation-parameters',n,'PowerPoint supports from/to, from/by, to-only, and by-only.');
    if(['from_by','by_only'].includes(model.scaleMode))failure(failures,'unverified-relative-scale-semantics',n,'Relative scaling requires a measured PowerPoint timeline reference.');
    const initial=model.scaleMode==='to_only'?0:100000;
    model.from={ x:percentage(from,'x',initial/100000),y:percentage(from,'y',initial/100000) };
    model.to={ x:percentage(to,'x',model.from.x*percentage(by,'x',1)),y:percentage(to,'y',model.from.y*percentage(by,'y',1)) };
    if([model.from.x,model.from.y,model.to.x,model.to.y].some(v=>!Number.isFinite(v)))failure(failures,'invalid-scale-percentage',n,n.outerHTML);
    if (['0','false'].includes(attr(n,'zoomContents'))) failure(failures,'unsupported-scale-contents',n,'zoomContents=0');
  } else if(n.localName==='cmd') {
    model.command=attr(n,'cmd');model.commandType=attr(n,'type','call');
    if(model.commandType!=='call'||!(/^(?:playFrom\((?:\d+(?:\.\d*)?|\.\d+)\)|play|pause|resume|stop|togglePause)$/.test(model.command||'')))failure(failures,'unsupported-animation-command',n,`${model.commandType}:${model.command}`);
  } else if (['audio','video'].includes(n.localName)) {
    const cm=child(n,'cMediaNode'); model.media = true; model.volume=percentage(cm,'vol',1);
    if(!Number.isFinite(model.volume)||model.volume<0||model.volume>1)failure(failures,'invalid-media-volume',cm,model.volume); model.mute=['1','true'].includes(attr(cm,'mute'));
    model.fullScreen=['1','true'].includes(attr(n,'fullScrn'));
    if(model.fullScreen)failure(failures,'unsupported-fullscreen-media',n,'fullScrn=1');
    model.slideCount=number(cm,'numSld',1);
    if(!Number.isSafeInteger(model.slideCount)||model.slideCount<1)failure(failures,'unsupported-media-slide-count',cm,attr(cm,'numSld'));
    if(model.slideCount>1)failure(failures,'unverified-cross-slide-media-navigation',cm,'Sequential cross-slide playback is implemented; PowerPoint skip/back/re-entry semantics need a reference.');
    if(['0','false'].includes(attr(cm,'showWhenStopped')))failure(failures,'unsupported-stopped-media-visibility',cm,'showWhenStopped=0 requires the visual target lifecycle.');
  } else if (!['par','seq','excl'].includes(n.localName)) {
    failure(failures, 'unsupported-time-node', n, n.localName);
  }
  for(const attribute of Array.from(n.attributes||[]))if(attribute.namespaceURI==='http://schemas.microsoft.com/office/powerpoint/2010/main')failure(failures,'unsupported-animation-extension-attribute',n,`${attribute.name}=${attribute.value}`);
  if (n.localName === 'excl') failure(failures,'unsupported-exclusive-timeline',n,'excl');
  for(const condition of model.start) {
    if(condition.timeNode && !['onBegin','onEnd','begin','end'].includes(condition.event))failure(failures,'unsupported-time-node-reference-event',c,condition);
    if(['onBegin','onEnd','begin','end'].includes(condition.event) && !condition.timeNode&&!condition.bookmark)failure(failures,'unsupported-shape-lifecycle-trigger',c,condition);
  }
  if(n.localName==='seq') {
    model.concurrent=['1','true'].includes(attr(n,'concurrent'));
    model.nextAction=attr(n,'nextAc','none');model.previousAction=attr(n,'prevAc','none');
    model.next=conditions(child(n,'nextCondLst'),failures);model.previous=conditions(child(n,'prevCondLst'),failures);
    if(!['none','seek'].includes(model.nextAction)||!['none','skipTimed'].includes(model.previousAction))failure(failures,'unsupported-sequence-action',n,`${model.nextAction}/${model.previousAction}`);
    for(const condition of model.next.concat(model.previous))if(condition.timeNode||!['onNext','onPrev','onClick','onMediaBookmark'].includes(condition.event))failure(failures,'unsupported-sequence-navigation-condition',n,condition);
  }
  return model;
}
function normalizeRelationship(rels,id) {
  const raw = rels instanceof Map ? rels.get(id) : rels?.[id];
  if(!raw)return raw;
  const source=typeof raw==='string'?{target:raw,external:/^(?:https?:|file:|[a-z]:[\\/]|\\\\)/i.test(raw)}:{...raw};
  if(source.external&&/^(?:file:|[a-z]:[\\/]|\\\\|\/(?!\/))/i.test(String(source.target||'').trim()))source.unavailableReason='external-local-media-unavailable';
  return source;
}
/** rels: rId -> { target, external, type } or string. All failures must block conformance acceptance. */
export function parseSlidePlayback(slideDoc, rels = {}) {
  const root = slideDoc.documentElement || slideDoc;
  const failures=[];
  if(root.localName!=='sld' || descendants(root,'parsererror').length)failure(failures,'invalid-slide-xml',root,'Expected a valid PresentationML slide.');
  const timing=child(root,'timing');
  const timeline=children(child(timing,'tnLst')).map(n=>parseTimeNode(n,failures));
  const paragraphTargets=new Set();
  const collectParagraphTargets=node=>{if(node.targetIds?.length)paragraphTargets.add(node.shapeId);node.children.concat(node.subChildren||[]).forEach(collectParagraphTargets);};timeline.forEach(collectParagraphTargets);
  for(const build of children(child(timing,'bldLst'))) {
    const wholeShape=build.localName==='bldP' && ['allAtOnce',null].includes(attr(build,'build')) && !child(build,'tmplLst');
    // A serialized per-paragraph time tree already specifies its ordering and paragraph ranges.
    // A template-only build would require expansion; never invent sequencing from the build flag.
    const authoredParagraphs=build.localName==='bldP' && attr(build,'build')==='p' && paragraphTargets.has(attr(build,'spid')) && !child(build,'tmplLst') && !['1','true'].includes(attr(build,'animBg'));
    if(!wholeShape&&!authoredParagraphs)failure(failures,'unsupported-build-list',build,'Paragraph/diagram/chart builds require explicitly authored independently addressable targets.');
  }
  const ids=new Set();
  const collect=n=>{if(n.id){if(ids.has(n.id))failure(failures,'duplicate-time-node-id',null,n.id);ids.add(n.id);}for(const c of n.children.concat(n.subChildren||[]))collect(c);};timeline.forEach(collect);
  const validate=n=>{for(const c of n.start)if(c.timeNode&&!ids.has(c.timeNode))failure(failures,'missing-trigger-time-node',null,c.timeNode);for(const v of n.children.concat(n.subChildren||[]))validate(v);};timeline.forEach(validate);
  const tx=child(root,'transition');
  let transition=null;
  if (tx) {
    const effects=children(tx).filter(n=>!['sndAc','extLst'].includes(n.localName));
    const effect=effects[0];
    const durationValue=tx.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main','dur');
    const duration=durationValue?universalTime(durationValue,failures,tx):({slow:1000,med:750,fast:500}[attr(tx,'spd','fast')]);
    transition={ kind:effect?.localName || 'cut', direction:attr(effect,'dir',['blinds','randomBar','comb'].includes(effect?.localName)?'horz':effect?.localName==='strips'?'ld':'l'), spokes:[1,2,3,4,8].reduce((a,b)=>Math.abs(b-number(effect,'spokes',4))<Math.abs(a-number(effect,'spokes',4))?b:a,1), orientation:attr(effect,'orient','horz'), duration, advanceClick:!['0','false'].includes(attr(tx,'advClick','1')), advanceAfter:attr(tx,'advTm')==null?null:time(attr(tx,'advTm'),failures,tx) };
    if(transition.kind!=='cut' && !tx.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main','dur'))failure(failures,'unverified-transition-speed-duration',tx,'ISO specifies spd enum without a universal millisecond duration mapping.');
    if (!['cut','fade','push','wipe','diamond','plus','blinds','randomBar','wheel','comb','newsflash','dissolve','strips'].includes(transition.kind)) failure(failures,'unsupported-slide-transition',effect,transition.kind);
    if (effects.length>1) failure(failures,'multiple-transition-effects',tx,effects.map(n=>n.localName));
    if (['1','true'].includes(attr(effect,'thruBlk'))) failure(failures,'unsupported-through-black-transition',effect,'thruBlk');
    const soundAction=child(tx,'sndAc');
    if(soundAction){
      const startSound=child(soundAction,'stSnd'),endSound=child(soundAction,'endSnd');
      if(startSound){const sound=child(startSound,'snd'),id=relationshipId(sound,'embed');transition.sound={action:'start',relationshipId:id,source:normalizeRelationship(rels,id),loop:['1','true'].includes(attr(startSound,'loop'))};if(!transition.sound.source)failure(failures,'missing-transition-sound-relationship',sound,id);}
      else if(endSound)transition.sound={action:'stop'};
      if((!!startSound+!!endSound)!==1||children(soundAction).some(n=>n!==startSound&&n!==endSound))failure(failures,'invalid-transition-sound-action',soundAction,soundAction.outerHTML);
    }
    if (child(tx,'extLst')) failure(failures,'unsupported-transition-extension',child(tx,'extLst'),child(tx,'extLst').outerHTML);
  }
  const media=[];
  for (const pic of descendants(root,'pic').concat(descendants(root,'sp'),descendants(root,'cxnSp'),descendants(root,'graphicFrame'))) {
    const shapeId=attr(descendants(pic,'cNvPr')[0],'id');
    const declarations=descendants(pic,'videoFile').concat(descendants(pic,'audioFile'), descendants(pic,'wavAudioFile'),descendants(pic,'media'));
    for(const declaration of descendants(pic,'quickTimeFile').concat(descendants(pic,'audioCd')))failure(failures,'unsupported-media-source-type',declaration,declaration.outerHTML);
    if (!declarations.length) continue;
    // CT_Media supersedes the legacy declaration; on that same element r:link wins over r:embed (MS-PPTX).
    const preferred=declarations.find(n=>n.localName==='media') || declarations.find(n=>relationshipId(n,'embed')) || declarations[0];
    const id=preferred.localName==='media'?(relationshipId(preferred,'link')||relationshipId(preferred,'embed')):(relationshipId(preferred,'embed')||relationshipId(preferred,'link'));
    const relationship=normalizeRelationship(rels,id);
    const kind=declarations.some(n=>n.localName==='videoFile') ? 'video' : 'audio';
    if (!relationship) failure(failures,'missing-media-relationship',preferred,id);
    const trim=descendants(pic,'trim')[0];
    const model={ shapeId,kind,relationshipId:id,source:relationship,trimStart:universalTime(attr(trim,'st'),failures,trim)/1000,trimEnd:universalTime(attr(trim,'end'),failures,trim)/1000 };
    const fade=descendants(pic,'fade')[0];model.fadeIn=universalTime(attr(fade,'in'),failures,fade)/1000;model.fadeOut=universalTime(attr(fade,'out'),failures,fade)/1000;
    if(model.fadeIn||model.fadeOut)failure(failures,'unverified-media-fade-envelope',fade,'Linear native-volume envelope is implemented; PowerPoint curve and trim interaction need waveform comparison.');
    model.bookmarks=descendants(pic,'bmk').map(n=>({name:attr(n,'name'),time:universalTime(attr(n,'time'),failures,n)/1000}));
    const bookmarkNames=new Set(),bookmarkTimes=new Set();
    for(const bookmark of model.bookmarks){if(!bookmark.name||bookmarkNames.has(bookmark.name)||bookmarkTimes.has(bookmark.time))failure(failures,'invalid-media-bookmark',pic,bookmark);bookmarkNames.add(bookmark.name);bookmarkTimes.add(bookmark.time);}
    if(descendants(pic,'bookmark').length)failure(failures,'unsupported-media-bookmark-extension',pic,'Expected p14:bmk inside p14:bmkLst.');
    media.push(model);
  }
  for (const target of descendants(timing,'sndTgt')) {
    const id=relationshipId(target,'embed');
    if(!media.some(m=>m.relationshipId===id)) {
      const source=normalizeRelationship(rels,id);
      if(!source)failure(failures,'missing-media-relationship',target,id);
      media.push({shapeId:null,kind:'audio',relationshipId:id,source,trimStart:0,trimEnd:null});
    }
  }
  for(const item of [...media,...(transition?.sound?.action==='start'?[transition.sound]:[])])if(item.source?.unavailableReason){failure(failures,item.source.unavailableReason,root,{category:'source-limitation',relationshipId:item.relationshipId,target:item.source.target});failures[failures.length-1].category='source-limitation';}
  const validateBookmarks=node=>{for(const condition of node.start.concat(node.end,node.next||[],node.previous||[]))if(condition.bookmark&&!media.find(m=>m.shapeId===condition.shapeId)?.bookmarks?.some(b=>b.name===condition.bookmark))failure(failures,'missing-media-bookmark-trigger-target',null,condition);node.children.concat(node.subChildren||[]).forEach(validateBookmarks);};timeline.forEach(validateBookmarks);
  let requiresGlyphTargets=false;const iteratedIds=new Set();
  const collectIterations=(node,inside=false)=>{if(node.iteration&&inside)failure(failures,'unsupported-nested-iteration',null,node.id);if(inside&&node.id)iteratedIds.add(node.id);inside=inside||!!node.iteration;if(node.iteration&&['lt','wd'].includes(node.iteration.type))requiresGlyphTargets=true;if(inside&&(node.subChildren||[]).length)failure(failures,'unsupported-iteration-sub-time-combination',null,node.id);node.children.concat(node.subChildren||[]).forEach(c=>collectIterations(c,inside));};timeline.forEach(node=>collectIterations(node));
  const checkIterationReferences=node=>{for(const condition of node.start.concat(node.end))if(condition.timeNode&&iteratedIds.has(condition.timeNode))failure(failures,'unsupported-iterated-time-node-reference',null,condition);node.children.concat(node.subChildren||[]).forEach(checkIterationReferences);};timeline.forEach(checkIterationReferences);
  const textTargets={};for(const shape of descendants(root,'sp')){const id=attr(descendants(shape,'cNvPr')[0],'id'),body=child(shape,'txBody');if(id)textTargets[id]=children(body).filter(n=>n.localName==='p').map(n=>descendants(n,'t').map(t=>t.textContent).join(''));}
  return { timeline,transition,media,textTargets,requiresGlyphTargets,failures, supported:failures.length===0, conformanceStatus:'unverified' };
}

function effectFrames(effect) {
  const outgoing=effect.transition==='out';
  let frames;
  if (effect.filter==='fade') frames=[{opacity:0},{opacity:1}];
  else if(effect.filter.startsWith('slide(')){const direction={'slide(fromLeft)':'translateX(-100%)','slide(fromRight)':'translateX(100%)','slide(fromTop)':'translateY(-100%)','slide(fromBottom)':'translateY(100%)'}[effect.filter];frames=[{transform:direction},{transform:'translate(0,0)'}];}
  else if (effect.filter.startsWith('wipe(')) {
    const initial={'wipe(left)':'inset(0 0 0 100%)','wipe(right)':'inset(0 100% 0 0)','wipe(up)':'inset(100% 0 0 0)','wipe(down)':'inset(0 0 100% 0)'}[effect.filter];
    frames=[{clipPath:initial},{clipPath:'inset(0 0 0 0)'}];
  } else if (effect.filter.startsWith('circle')) frames=[{clipPath:'circle(0% at 50% 50%)'},{clipPath:'circle(72% at 50% 50%)'}];
  else if (effect.filter.startsWith('diamond')) frames=[{clipPath:'polygon(50% 50%,50% 50%,50% 50%,50% 50%)'},{clipPath:'polygon(50% -50%,150% 50%,50% 150%,-50% 50%)'}];
  else if (effect.filter.startsWith('box')) frames=[{clipPath:'inset(50% 50% 50% 50%)'},{clipPath:'inset(0 0 0 0)'}];
  else return null;
  return outgoing?frames.reverse():frames;
}
function transitionMaskFrames(transition,width,height) {
  let state=0x72ca19;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const kind=transition.kind,vertical=transition.direction==='vert',count=kind==='randomBar'?100:8;
  const cells=Array.from({length:kind==='dissolve'?600:count},(_,i)=>i);
  for(let i=cells.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
  const rect=(x,y,w,h)=>`<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" fill="white"/>`;
  const frames=[];
  for(let frame=0;frame<=60;frame++){
    const progress=frame/60;let geometry='';
    if(frame===60)geometry=rect(0,0,width,height);
    else if(kind==='dissolve')for(const i of cells.slice(0,Math.floor(progress*cells.length)))geometry+=rect((i%30)*width/30,Math.floor(i/30)*height/20,width/30+0.1,height/20+0.1);
    else if(kind==='randomBar')for(const i of cells.slice(0,Math.floor(progress*count)))geometry+=vertical?rect(i*width/count,0,width/count+0.1,height):rect(0,i*height/count,width,height/count+0.1);
    else if(kind==='blinds')for(let i=0;i<count;i++)geometry+=vertical?rect(i*width/count,0,width/count*progress,height):rect(0,i*height/count,width,height/count*progress);
    else if(kind==='comb')for(let i=0;i<count;i++)geometry+=vertical?rect(i*width/count,i%2?height*(1-progress):0,width/count,height*progress):rect(i%2?width*(1-progress):0,i*height/count,width*progress,height/count);
    else if(['boxIn','circleIn','diamondIn'].includes(kind)){const outer=`M 0 0 H ${width} V ${height} H 0 Z`;let hole;if(kind==='boxIn'){const x=progress*width/2,y=progress*height/2;hole=`M ${x} ${y} H ${width-x} V ${height-y} H ${x} Z`;}else if(kind==='diamondIn'){const x=width*(1-progress),y=height*(1-progress);hole=`M ${width/2} ${height/2-y} L ${width/2+x} ${height/2} L ${width/2} ${height/2+y} L ${width/2-x} ${height/2} Z`;}else {const r=Math.hypot(width,height)/2*(1-progress);hole=`M ${width/2-r} ${height/2} A ${r} ${r} 0 1 0 ${width/2+r} ${height/2} A ${r} ${r} 0 1 0 ${width/2-r} ${height/2} Z`;}geometry=`<path fill="white" fill-rule="evenodd" d="${outer} ${hole}"/>`;}
    else if(kind==='plus'){const arm=Math.min(1,progress*2),bar=progress;geometry=rect(width*(1-arm)/2,height*(1-bar)/2,width*arm,height*bar)+rect(width*(1-bar)/2,height*(1-arm)/2,width*bar,height*arm);}
    else if(kind==='strips')for(let i=0;i<count;i++){const fromRight=transition.direction.startsWith('l'),down=transition.direction.endsWith('d'),delay=(down?i:count-1-i)/(count-1)/3;const p=Math.min(1,Math.max(0,progress*4/3-delay));geometry+=rect(fromRight?width*(1-p):0,i*height/count,width*p,height/count+0.1);}
    else if(kind==='wheel'&&progress>0){const radius=Math.hypot(width,height)/2,spokes=transition.spokes;for(let i=0;i<spokes;i++){const start=-Math.PI/2+i*Math.PI*2/spokes,end=start+progress*Math.PI*2/spokes,x1=width/2+radius*Math.cos(start),y1=height/2+radius*Math.sin(start),x2=width/2+radius*Math.cos(end),y2=height/2+radius*Math.sin(end);geometry+=`<path fill="white" d="M ${width/2} ${height/2} L ${x1} ${y1} A ${radius} ${radius} 0 ${end-start>Math.PI?1:0} 1 ${x2} ${y2} Z"/>`;}}
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${geometry}</svg>`;
    frames.push({offset:progress,maskImage:`url("data:image/svg+xml,${encodeURIComponent(svg)}")`,maskSize:'100% 100%',maskRepeat:'no-repeat'});
  }
  return frames;
}
/** One bus per presentation: transition sounds continue across slide changes until a sound event. */
export function createPptxAudioBus() {
  let generation=0,current=null,disposed=false;
  function stop(){generation++;if(current){current.element.pause();current.element.removeAttribute('src');current.element.load();current.element.remove();current.cleanup?.();current=null;}}
  async function play(sound,resolveMedia,onFailure=()=>{}) {
    if(disposed)return;
    stop();const token=generation;
    if(sound.action==='stop')return;
    if(sound.source?.unavailableReason){onFailure({code:sound.source.unavailableReason,category:'source-limitation',detail:{relationshipId:sound.relationshipId,target:sound.source.target,category:'source-limitation'}});return;}
    if(!sound.source||!resolveMedia){onFailure({code:'missing-transition-sound-resolver',detail:sound.relationshipId});return;}
    let resolved;try{resolved=await resolveMedia(sound.source,sound);}catch(error){onFailure({code:'transition-sound-resolution-failed',detail:error.message});return;}
    if(disposed||token!==generation){resolved?.cleanup?.();return;}
    const url=typeof resolved==='string'?resolved:resolved?.url;
    if(!url){onFailure({code:'empty-transition-sound-source',detail:sound.relationshipId});return;}
    const element=document.createElement('audio');element.src=url;element.loop=sound.loop;element.preload='auto';current={element,cleanup:resolved?.cleanup};
    element.addEventListener('error',()=>{if(token===generation)onFailure({code:'transition-sound-decode-failed',detail:{relationshipId:sound.relationshipId,code:element.error?.code}});});
    try{await element.play();}catch(error){if(token===generation)onFailure({code:'transition-sound-play-failed',detail:error.message});}
  }
  return {play,stop,dispose(){stop();disposed=true;},get element(){return current?.element||null;}};
}
/** Retains native media across sequential slides. The viewer must enterSlide before canceling the old slide. */
export function createPptxMediaBus() {
  let slide=0,disposed=false;const entries=new Map();
  const stopEntry=entry=>{clearTimeout(entry.timer);entry.timer=null;entry.firstSlide=null;entry.element.pause();entry.element.dispatchEvent(new Event('pptxmediaended'));};
  function register(element,{slides=1,duration=0}={}){
    if(disposed)return()=>{};
    const entry={element,slides,duration,firstSlide:null,timer:null};entries.set(element,entry);
    const play=()=>{if(entry.firstSlide!=null)return;entry.firstSlide=slide;if(Number.isFinite(duration)&&duration>0)entry.timer=setTimeout(()=>stopEntry(entry),duration);};
    const end=()=>{clearTimeout(entry.timer);entry.timer=null;entry.firstSlide=null;};
    element.addEventListener('play',play);element.addEventListener('ended',end);element.addEventListener('pptxmediaended',end);
    entry.cleanup=()=>{element.removeEventListener('play',play);element.removeEventListener('ended',end);element.removeEventListener('pptxmediaended',end);clearTimeout(entry.timer);entries.delete(element);};
    return entry.cleanup;
  }
  const keeps=element=>{const entry=entries.get(element);return !!entry&&entry.slides>1&&entry.firstSlide!=null&&slide>=entry.firstSlide&&slide<entry.firstSlide+entry.slides&&!element.ended;};
  return {register,keeps,enterSlide(index){if(!Number.isSafeInteger(index)||index<0)throw Error('Invalid presentation slide index');slide=index;for(const entry of entries.values())if(entry.firstSlide!=null&&!keeps(entry.element))stopEntry(entry);},stopAudio(){for(const entry of entries.values())if(entry.element.localName==='audio')stopEntry(entry);},stop(){for(const entry of entries.values())stopEntry(entry);},dispose(){this.stop();for(const entry of [...entries.values()])entry.cleanup();disposed=true;}};
}
/** DOM targets must preserve source IDs. Target values may be one element or multiple group layers. */
export function createPptxPlayback({ model,root,shapes=new Map(),resolveMedia,audioBus,mediaBus,shapePaint,onFailure=()=>{},onAdvance=()=>{} }) {
  let disposed=false,epoch=0,mediaInitialization=null,preparedEpoch=null,preparedReady=null,startedEpoch=null;
  const timeNodeStates=new Map(),mediaSettings=new Map(),originalBounds=new Map(),frozenByNode=new Map(),sequenceControllers=new Set();
  const collectMedia=n=>{if(n.media)mediaSettings.set(n.mediaRelationshipId?'r:'+n.mediaRelationshipId:String(n.shapeId),n);for(const c of n.children.concat(n.subChildren||[]))collectMedia(c);};model.timeline.forEach(collectMedia);
  const mediaOwners=new Map();
  const animations=new Set(),timers=new Set(),listeners=[],mediaElements=new Map(),mediaEnvelopes=new Map(),restore=new Map(),pending=new Set();
  const originalPaint=new Map(),paintAborters=new Set(),paintOwners=new Map();let paintRestoration=Promise.resolve();
  const failures=[...model.failures,...(shapePaint?.failures||[])];
  if(shapePaint?.subscribeFailure)listeners.push(shapePaint.subscribeFailure(failure=>failures.push(failure)));
  const report=(code,detail)=> {const f={code,detail,...(detail?.category?{category:detail.category}:{})};failures.push(f);onFailure(f);};
  const elements=id=> {const value=shapes instanceof Map?shapes.get(String(id)):shapes[String(id)];return value?(Array.isArray(value)?value:[value]):[];};
  const targetElements=node=>Array.from(new Set((node.targetIds||[node.shapeId]).flatMap(id=>{const result=elements(id);if(node.targetIds&&!result.length)report('missing-paragraph-animation-target',id);return result;})));
  const save=el=> {if (!restore.has(el)) restore.set(el,el.getAttribute('style'));};
  const setMediaVolume=(element,volume)=>{const envelope=mediaEnvelopes.get(element);if(envelope)envelope.setVolume(volume);else element.volume=volume;};
  function timer(fn,delay) {const id=setTimeout(()=>{timers.delete(id);if(!disposed)fn();},Math.max(0,delay));timers.add(id);return id;}
  const wait=(ms,scope)=>new Promise(resolve=>{if(scope?.seeking){resolve();return;}let id;const done=()=>{if(id!=null){clearTimeout(id);timers.delete(id);}pending.delete(done);scope?.waiters.delete(done);resolve();};pending.add(done);scope?.waiters.add(done);id=timer(done,ms);});
  const park=scope=>new Promise(resolve=>{const done=()=>{pending.delete(done);scope?.waiters.delete(done);resolve();};pending.add(done);scope?.waiters.add(done);});
  const listen=(el,name,fn)=>{el.addEventListener(name,fn);listeners.push(()=>el.removeEventListener(name,fn));};
  function setGroupPivot(targets) {
    if(targets.length<2)return;
    const rects=targets.map(el=>originalBounds.get(el)||el.getBoundingClientRect());
    const centerX=(Math.min(...rects.map(r=>r.left))+Math.max(...rects.map(r=>r.right)))/2;
    const centerY=(Math.min(...rects.map(r=>r.top))+Math.max(...rects.map(r=>r.bottom)))/2;
    targets.forEach((el,index)=>{save(el);el.style.transformOrigin=`${centerX-rects[index].left}px ${centerY-rects[index].top}px`;});
  }
  function freeze(node,cleanup){if(!frozenByNode.has(node))frozenByNode.set(node,[]);frozenByNode.get(node).push(cleanup);}
  function thaw(node){for(const cleanup of frozenByNode.get(node)||[])cleanup();frozenByNode.delete(node);}
  function seekAnimation(animation){if(animation.effect.getTiming().iterations===Infinity)animation.effect.updateTiming({iterations:animation.pptxCycleIterations||1});try{animation.finish();}catch(error){report('animation-seek-failed',error.message);}}
  function timingEasing(node){
    if(node.timeFilter)return `linear(${node.timeFilter.map(([local,warped])=>warped+' '+(local*100)+'%').join(',')})`;
    if(node.calcMode==='discrete')return 'steps(1,end)';
    const acceleration=node.acceleration||0,deceleration=node.deceleration||0;
    if(!acceleration&&!deceleration)return 'linear';
    const rate=1/(1-(acceleration+deceleration)/2);
    const values=Array.from({length:201},(_,i)=>{const t=i/200;return t<acceleration?rate*t*t/(2*acceleration):t>1-deceleration?1-rate*(1-t)*(1-t)/(2*deceleration):rate*(t-acceleration/2);});
    return `linear(${values.join(',')})`;
  }
  async function animate(el,frames,node,token=epoch,scope=null) {
    if(disposed||token!==epoch||scope?.cancelled)return;
    save(el);
    if (!frames) {report('runtime-unsupported-effect',node.filter || node.kind);return;}
    if (!Number.isFinite(node.duration) || node.duration<0) {report('runtime-invalid-effect-duration',node.id);return;}
    const cycleIterations=node.autoReverse?2:1,speed=node.speed??1;
    const iterations=Math.min((node.repeatCount??1)*cycleIterations,node.duration>0?(node.repeatDuration??Infinity)/node.duration:Infinity);
    const direction=node.autoReverse?(speed<0?'alternate-reverse':'alternate'):(speed<0?'reverse':'normal');
    const anim=el.animate(frames,{duration:node.duration/Math.abs(speed),iterations,direction,fill:node.fill==='hold'||node.fill==='freeze'?'forwards':'none',easing:timingEasing(node),composite:frames.some(v=>v.transform)?'add':'replace'});
    anim.pptxCycleIterations=cycleIterations;animations.add(anim);scope?.animations.add(anim);if(scope?.seeking)seekAnimation(anim);
    try{await anim.finished;}catch{}finally{if(token===epoch&&!scope?.cancelled&&node.fill==='freeze')freeze(node,()=>{anim.cancel();animations.delete(anim);});if(node.fill!=='hold'&&node.fill!=='freeze'){anim.cancel();animations.delete(anim);}}
  }
  function framesFor(node,targets) {
    if(node.kind==='animEffect') {
      const kind=node.filter==='box(in)'?'boxIn':node.filter==='circle(in)'?'circleIn':node.filter==='diamond(in)'?'diamondIn':node.filter.startsWith('blinds(')?'blinds':null;
      if(kind){const rects=targets.map(el=>originalBounds.get(el)||el.getBoundingClientRect()),width=Math.max(...rects.map(r=>r.right))-Math.min(...rects.map(r=>r.left)),height=Math.max(...rects.map(r=>r.bottom))-Math.min(...rects.map(r=>r.top));const frames=transitionMaskFrames({kind,direction:node.filter==='blinds(vertical)'?'vert':'horz'},width,height);return node.transition==='out'?frames.reverse().map(frame=>({...frame,offset:1-frame.offset})):frames;}
      return effectFrames(node);
    }
    if(node.kind==='animRot')return [{transform:`rotate(${node.from/60000}deg)`},{transform:`rotate(${node.to/60000}deg)`}];
    if(node.kind==='animScale')return [{transform:`scale(${node.from.x},${node.from.y})`},{transform:`scale(${node.to.x},${node.to.y})`}];
    if(node.kind==='anim') {
      if(node.attributes.length!==1){report('runtime-multiple-animation-properties',node.attributes);return null;}
      const rootBounds=root.getBoundingClientRect(),rects=targets.map(el=>originalBounds.get(el)||el.getBoundingClientRect());
      const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));
      if(rootBounds.width<=0||rootBounds.height<=0||right<=left||bottom<=top){report('runtime-zero-animation-bounds',node.shapeId);return null;}
      const vars={ppt_x:((left+right)/2-rootBounds.left)/rootBounds.width,ppt_y:((top+bottom)/2-rootBounds.top)/rootBounds.height,ppt_w:(right-left)/rootBounds.width,ppt_h:(bottom-top)/rootBounds.height};
      const prop=node.attributes[0],baseline=prop==='style.opacity'?Number(getComputedStyle(targets[0]).opacity):vars[prop];
      const values=node.values.length?node.values:[{offset:0,value:node.from??(node.to!=null?0:baseline)},{offset:1,value:node.to??baseline}];
      try{const resolved=values.map(v=>({...v,numeric:animationExpression(v.value,vars)}));
        const samples=values.some(v=>v.formula)&&values.length>1?Array.from({length:241},(_,i)=>{const offset=i/240;let index=resolved.findIndex(v=>v.offset>offset)-1;if(index<0)index=offset>=resolved[resolved.length-1].offset?resolved.length-2:0;const left=resolved[index],right=resolved[index+1],fraction=right.offset===left.offset?1:Math.max(0,Math.min(1,(offset-left.offset)/(right.offset-left.offset))),input=node.calcMode==='discrete'?left.numeric:left.numeric+(right.numeric-left.numeric)*fraction;return{offset,numeric:left.formula?animationExpression(left.formula,{...vars,'$':input}):input};}):resolved;
        return samples.map(v=>{const numeric=v.numeric;
        if(prop==='style.opacity')return {offset:v.offset,opacity:numeric};
        if(prop==='ppt_x')return {offset:v.offset,transform:`translateX(${(numeric-vars.ppt_x)*rootBounds.width}px)`};
        if(prop==='ppt_y')return {offset:v.offset,transform:`translateY(${(numeric-vars.ppt_y)*rootBounds.height}px)`};
        return {offset:v.offset,transform:prop==='ppt_w'?`scaleX(${numeric/vars.ppt_w})`:`scaleY(${numeric/vars.ppt_h})`};
      });}catch(e){report('runtime-animation-expression-failed',e.message);return null;}
    }
    return null;
  }
  function paintIds(node){return node.targetIds||[String(node.shapeId)];}
  function claimPaint(ids,properties,node){
    const keys=ids.flatMap(id=>properties.map(property=>id+':'+property)),token=Symbol('paint-owner');
    const conflict=keys.find(key=>paintOwners.has(key));if(conflict)report('unverified-overlapping-shape-paint-priority',{property:conflict,node:node.id,activeNodes:[...paintOwners.get(conflict).values()]});
    for(const key of keys){if(!paintOwners.has(key))paintOwners.set(key,new Map());paintOwners.get(key).set(token,node.id);}return()=>{for(const key of keys){const owners=paintOwners.get(key);owners?.delete(token);if(!owners?.size)paintOwners.delete(key);}};
  }
  async function applyPaint(id,patch,signal){
    if(!shapePaint){report('missing-shape-paint-api',id);return false;}
    if(!originalPaint.has(id)){const snapshot=shapePaint.get(id);if(!snapshot){report('unsupported-shape-paint-target',id);return false;}originalPaint.set(id,snapshot);}
    const result=await shapePaint.apply(id,patch,{signal});if(signal?.aborted)return false;
    if(!result?.supported&&result?.detail!=='cancelled-shape-paint'){report('unsupported-shape-paint-operation',{id,patch,detail:result?.detail});return false;}return true;
  }
  const restorePaint=(id,snapshot,properties)=>shapePaint?.restore(id,snapshot,{properties}).then(result=>{if(!result?.supported&&result?.detail!=='cancelled-shape-paint')report('shape-paint-restore-failed',{id,detail:result?.detail});});
  function resolvedColor(descriptor){
    const value=shapePaint?.resolveColor?.(descriptor)||(descriptor?.kind==='srgbClr'?'#'+descriptor.value:null);
    if(!value)throw Error('Unable to resolve animation color');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle=value;context.fillRect(0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data);
  }
  async function animateColor(node,token,scope){
    if(!shapePaint){report('missing-shape-paint-api',node.shapeId);return;}
    if(!Number.isFinite(node.duration)||node.duration<0){report('runtime-invalid-effect-duration',node.id);return;}
    if(node.colorSpace!=='rgb'||!node.colorTo||!['fillcolor','stroke.color','style.color'].includes(node.attributes[0])){report('runtime-unsupported-animate-color',node.attributes[0]);return;}
    const ids=paintIds(node),before=new Map(ids.map(id=>[id,shapePaint.get(id)]));if([...before.values()].some(v=>!v)){report('unsupported-shape-paint-target',ids);return;}
    let from,to;try{from=resolvedColor(node.colorFrom);to=resolvedColor(node.colorTo);}catch(error){report('animation-color-resolution-failed',error.message);return;}
    const property={'fillcolor':'fillColor','stroke.color':'strokeColor','style.color':'textColor'}[node.attributes[0]],textPatch=property==='textColor'?{overrideChildStyle:node.override==='childStyle'}:{};
    const release=claimPaint(ids,[property,...Object.keys(textPatch)],node);if(!release)return;
    const aborter=new AbortController();paintAborters.add(aborter);scope?.paintAborters.add(aborter);
    const cycle=node.autoReverse?2:1,speed=node.speed??1,iterations=Math.min((node.repeatCount??1)*cycle,node.duration>0?(node.repeatDuration??Infinity)/node.duration:Infinity);
    const clock=new Animation(new KeyframeEffect(null,[{},{}],{duration:node.duration/Math.abs(speed),iterations,direction:node.autoReverse?(speed<0?'alternate-reverse':'alternate'):(speed<0?'reverse':'normal'),fill:'forwards',easing:timingEasing(node)}),document.timeline);
    clock.pptxCycleIterations=cycle;animations.add(clock);scope?.animations.add(clock);clock.play();if(scope?.seeking)seekAnimation(clock);
    const active=()=>token===epoch&&!disposed&&!scope?.cancelled&&!aborter.signal.aborted;
    const frame=async()=>{const progress=clock.effect.getComputedTiming().progress;if(progress==null)return;const channels=from.slice(0,3).map((value,index)=>Math.round(value+(to[index]-value)*progress));const color={rgb:'#'+channels.map(value=>value.toString(16).padStart(2,'0')).join(''),alpha:(from[3]+(to[3]-from[3])*progress)/255};for(const id of ids)if(!await applyPaint(id,{[property]:color,...textPatch},aborter.signal)){aborter.abort();clock.cancel();break;}};
    try{while(active()&&clock.playState!=='finished'){await frame();await new Promise(resolve=>requestAnimationFrame(resolve));}if(active())await frame();}finally{release();clock.cancel();animations.delete(clock);const withdraw=()=>{aborter.abort();paintAborters.delete(aborter);scope?.paintAborters.delete(aborter);};if(active()&&node.fill==='freeze')freeze(node,withdraw);else if(!active()||node.fill!=='hold')withdraw();}
  }
  function naturalDuration(node){
    const delay=node.start.length?Math.min(...node.start.filter(c=>!c.event).map(c=>c.delay)):0;
    if(!Number.isFinite(delay))return Infinity;
    if(!node.children.length)return delay+node.duration*(node.autoReverse?2:1)*(node.repeatCount??1)/Math.abs(node.speed??1);
    const durations=node.children.map(naturalDuration);
    const duration=node.kind==='seq'?durations.reduce((a,b)=>a+b,0):Math.max(0,...durations);
    return delay+Math.min(duration*(node.autoReverse?2:1)*(node.repeatCount??1),node.repeatDuration??Infinity)/Math.abs(node.speed??1);
  }
  function iterationItems(node){
    const type=node.iteration.type,unit=type==='wd'?'w':'c',leaves=[];
    const collect=n=>{if(n.children.length)n.children.forEach(collect);else leaves.push(n);};if(node.children.length)node.children.forEach(collect);else collect(node);
    if(leaves.some(n=>!n.shapeId||n.media||n.kind==='cmd')){report('unsupported-iteration-target-behavior',node.id);return [];}
    const entries=shapes instanceof Map?[...shapes.entries()]:Object.entries(shapes);
    const matches=(leaf,key)=>leaf.targetIds?leaf.targetIds.some(base=>key.startsWith(base+':'+unit+':')):key.startsWith(leaf.shapeId+':p:');
    let keys;
    if(type==='el'){
      const targets=Array.from(new Set(leaves.flatMap(targetElements)));keys=targets.map(el=>entries.find(([id,value])=>!String(id).includes(':p:')&&(Array.isArray(value)?value:[value]).length===1&&(Array.isArray(value)?value[0]:value)===el)?.[0]).filter(v=>v!=null);
    }else keys=entries.map(([key])=>String(key)).filter(key=>new RegExp(':p:\\d+:'+unit+':\\d+$').test(key)&&leaves.some(leaf=>matches(leaf,key))).sort((a,b)=>{const aa=a.split(':'),bb=b.split(':');return Number(aa[0])-Number(bb[0])||Number(aa[2])-Number(bb[2])||Number(aa[4])-Number(bb[4]);});
    if(keys.length<=1){
      const textBases=Array.from(new Set(leaves.flatMap(leaf=>leaf.targetIds||[leaf.shapeId])));
      const texts=textBases.flatMap(id=>{const pieces=String(id).split(':');return pieces.length>1?[model.textTargets?.[pieces[0]]?.[Number(pieces[2])]||'']:model.textTargets?.[id]||[];});
      const count=type==='lt'?texts.reduce((sum,text)=>sum+Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)).length,0):type==='wd'?texts.reduce((sum,text)=>sum+Array.from(new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)).filter(v=>v.isWordLike).length,0):keys.length;
      if(count>1){report('missing-iteration-subtargets',{id:node.id,type,count});return [];}
      return [{...node,id:null,start:[],iteration:null}];
    }
    const clone=(n,key)=>{
      if(n.children.length){const nested=n.children.map(c=>clone(c,key)).filter(Boolean);return nested.length?{...n,id:null,iteration:null,children:nested}:null;}
      if(type!=='el'&&!matches(n,key))return null;
      if(type==='el'&&!targetElements(n).some(el=>elements(key).includes(el)))return null;
      return {...n,id:null,targetIds:[key],children:[]};
    };
    // MS-OI29500 2.1.1165(a): backwards selects the end of the target, rather than a previous time node.
    if(node.iteration.backwards)keys.reverse();
    return keys.map(key=>({...clone(node,key),start:[],iteration:null}));
  }
  const containsSubTime=n=>(n.subChildren||[]).length>0||n.children.some(containsSubTime);
  async function run(node,token,parent=null,scope=null,forceStart=false) {
    const active=()=>!disposed&&token===epoch&&!scope?.cancelled;
    if(!active())return;
    if(node.iteration&&containsSubTime(node)){report('unsupported-iteration-sub-time-combination',node.id);return;}
    scope?.nodes.add(node);
    if(node.start.length&&!forceStart&&!scope?.seeking) {
      await new Promise(resolve=>{
        let finished=false;
        const remove=[],conditionTimers=[];
        const complete=()=>{
          if(finished)return;finished=true;
          for(const off of remove)off();
          for(const id of conditionTimers){clearTimeout(id);timers.delete(id);}
          pending.delete(complete);scope?.waiters.delete(complete);resolve();
        };
        pending.add(complete);scope?.waiters.add(complete);
        const schedule=delay=>{if(Number.isFinite(delay))conditionTimers.push(timer(complete,delay));};
        // Start conditions form an OR list. Indefinite without an event never fires.
        for(const condition of node.start) {
          if(condition.bookmark){if(condition.event!=='onMediaBookmark'){report('runtime-unsupported-bookmark-trigger-event',condition.event);continue;}const name=`pptxbookmark:${condition.shapeId}:${condition.bookmark}`,handler=()=>schedule(condition.delay);root.addEventListener(name,handler);remove.push(()=>root.removeEventListener(name,handler));continue;}
          if(condition.timeNode) {
            const phase=['begin','end','onBegin','onEnd'].includes(condition.event)?condition.event:null;
            if(!phase){report('runtime-unsupported-time-node-event',condition);continue;}
            const state=timeNodeStates.get(condition.timeNode);
            if(state?.[phase]!=null) {schedule(Math.max(0,condition.delay-(performance.now()-state[phase])));continue;}
            const name=`${phase==='begin'||phase==='end'?'pptxtime':'pptxtarget'}:${phase}:${condition.timeNode}`;
            const handler=()=>schedule(condition.delay);root.addEventListener(name,handler);remove.push(()=>root.removeEventListener(name,handler));continue;
          }
          if(!condition.event){schedule(condition.delay);continue;}
          const target=condition.shapeId?elements(condition.shapeId)[0]:root;
          if(!target){report('missing-trigger-target',condition.shapeId);continue;}
          const eventName=condition.event==='onPrev'?'pptxprevious':condition.event==='onNext'?'pptxnext':condition.event==='onClick'?'click':null;
          if(!eventName){report('runtime-unsupported-start-event',condition.event);continue;}
          const handler=event=>{if(node.eventFilter==='cancelBubble')event.stopPropagation();schedule(condition.delay);};
          target.addEventListener(eventName,handler);
          remove.push(()=>target.removeEventListener(eventName,handler));
        }
      });
    }
    if(!active())return;
    if(parent?.kind==='seq'||parent?.kind==='excl')for(const sibling of parent.children)if(sibling!==node)thaw(sibling);
    const signalTarget=event=>{if(!node.id||!active())return;const state=timeNodeStates.get(node.id)||{};state[event]=performance.now();timeNodeStates.set(node.id,state);root.dispatchEvent(new Event(`pptxtarget:${event}:${node.id}`));};
    const signal=phase=>{if(!node.id||!active())return;const state=timeNodeStates.get(node.id)||{};state[phase]=performance.now();timeNodeStates.set(node.id,state);root.dispatchEvent(new Event(`pptxtime:${phase}:${node.id}`));if(!node.media||phase==='end')signalTarget(phase==='begin'?'onBegin':'onEnd');};
    signal('begin');
    const sameClickJobs=(node.subChildren||[]).filter(child=>child.masterRelation==='sameClick').map(child=>run(child,token,node,scope).catch(error=>report('sub-time-execution-failed',error.message)));

    if(node.iteration){const items=iterationItems(node),duration=node.children.length?Math.max(0,...node.children.map(naturalDuration)):node.duration,interval=node.iteration.interval??duration*node.iteration.percentage;if(!Number.isFinite(interval)||interval<0){report('invalid-runtime-iteration-interval',node.id);return;}await Promise.all(items.map(async(item,index)=>{await wait(interval*index,scope);if(active())await run(item,token,parent,scope,true);}));}
    else if(node.kind==='par'&&node.simpleTimingChild){const only=node.children[0],timed={...only,repeatCount:(only.repeatCount??1)*(node.repeatCount??1),repeatDuration:Math.min(only.repeatDuration??Infinity,node.repeatDuration??Infinity),autoReverse:only.autoReverse||node.autoReverse,speed:(only.speed??1)*(node.speed??1),acceleration:node.acceleration||only.acceleration,deceleration:node.deceleration||only.deceleration,timeFilter:node.timeFilter||only.timeFilter};await run(timed,token,node,scope);}
    else if(node.kind==='par')await Promise.all(node.children.map(c=>run(c,token,node,scope)));
    else if(node.kind==='seq'&&(node.next.length||node.previous.length))await runSequence(node,token,scope);
    else if(node.kind==='seq'){for(const c of node.children) {await run(c,token,node,scope);if(!active())break;}}
    else if(node.kind==='cmd') {
      const source=model.media.find(m=>String(m.shapeId)===String(node.shapeId));if(source?.source?.unavailableReason)return;
      const el=mediaElements.get(String(node.shapeId));
      if(!el){report('missing-media-command-target',node.shapeId);return;}
      const settings=mediaSettings.get(String(node.shapeId));
      if(settings){setMediaVolume(el,Math.max(0,Math.min(1,settings.volume)));el.muted=settings.mute;}
      const from=/^playFrom\(([^)]+)\)$/.exec(node.command||'');
      if(from){if(el.readyState>=1)el.currentTime=Number(from[1]);else listen(el,'loadedmetadata',()=>{el.currentTime=Number(from[1]);});}
      if(node.command==='pause')el.pause();
      else if(node.command==='stop'){el.pause();if(el.readyState>=1)el.currentTime=Number(el.dataset.pptxTrimStart||0);}
      else if(node.command==='togglePause'&&!el.paused)el.pause();
      else if(from||['play','resume','togglePause'].includes(node.command)){try{await el.play();}catch(e){report('media-command-play-rejected',e.message);return;}}
      else report('runtime-unsupported-media-command',node.command);
      if(Number.isFinite(node.duration)&&node.duration>0)await wait(node.duration,scope);
    }
    else if(node.media) {
      const source=model.media.find(m=>node.mediaRelationshipId?m.relationshipId===node.mediaRelationshipId:String(m.shapeId)===String(node.shapeId));if(source?.source?.unavailableReason)return;
      const el=mediaElements.get(node.mediaRelationshipId?'r:'+node.mediaRelationshipId:String(node.shapeId));
      if(!el){report('missing-media-target',node.shapeId);return;}
      const record=scope?{scope,node,element:el,active:true}:null;
      if(record){scope.media.set(el,record);if(!mediaOwners.has(el))mediaOwners.set(el,new Set());const owners=mediaOwners.get(el);if([...owners].some(owner=>owner.active&&!owner.scope.cancelled))report('unverified-overlapping-media-owner-priority',node.id);owners.add(record);}
      try{
      setMediaVolume(el,Math.min(1,Math.max(0,node.volume)));el.muted=node.mute;
      if(el.readyState>=1)el.currentTime=Number(el.dataset.pptxTrimStart||0);
      try{await el.play();}catch(e){report('media-playback-rejected',e.message);return;}
      if(!active()){if(!mediaBus?.keeps(el)&&(!record||!otherMediaOwner(record)))el.pause();return;}signalTarget('onBegin');
      if(scope?.seeking){await seekScopeMedia(scope);return;}
      if(node.duration===Infinity&&!node.end.length)await park(scope);
      else if(node.duration!==0||!el.ended)await new Promise(resolve=>{
        let stopTimer=null;const events=node.duration===0?['ended','pptxmediaended','error']:['pptxmediaended','error'];
        const finish=()=>{for(const name of events)el.removeEventListener(name,finish);if(stopTimer!=null){clearTimeout(stopTimer);timers.delete(stopTimer);}pending.delete(finish);scope?.waiters.delete(finish);resolve();};
        pending.add(finish);scope?.waiters.add(finish);for(const name of events)el.addEventListener(name,finish);
        if(Number.isFinite(node.duration)&&node.duration>0)stopTimer=timer(()=>{if(active())el.pause();finish();},node.duration);
      });
      }finally{if(record){record.active=false;mediaOwners.get(el)?.delete(record);if(!mediaOwners.get(el)?.size)mediaOwners.delete(el);}}
    }
    else {
      const targets=targetElements(node);if(!targets.length){report('missing-animation-target',node.targetIds||node.shapeId);return;}
      if(['animRot','animScale'].includes(node.kind)||(node.kind==='anim'&&node.attributes.some(v=>['ppt_w','ppt_h'].includes(v))))setGroupPivot(targets);
      if(node.kind==='animClr')await animateColor(node,token,scope);
      else if(node.kind==='set'&&['stroke.on','fill.on','fill.type'].includes(node.attributes[0])){
        const property=node.attributes[0],value=node.value;if((property==='fill.type'&&value!=='solid')||(property!=='fill.type'&&!['true','false','1','0'].includes(value))){report('unsupported-set-paint-value',{property,value});return;}
        const ids=paintIds(node),before=new Map(ids.map(id=>[id,shapePaint?.get(id)])),patch={[{'stroke.on':'strokeVisible','fill.on':'fillVisible','fill.type':'fillType'}[property]]:property==='fill.type'?value:['true','1'].includes(value)};
        const release=claimPaint(ids,Object.keys(patch),node);if(!release)return;const aborter=new AbortController();paintAborters.add(aborter);scope?.paintAborters.add(aborter);try{for(const id of ids)await applyPaint(id,patch,aborter.signal);if(Number.isFinite(node.duration)&&node.duration>0)await wait(node.duration,scope);}finally{release();const withdraw=()=>{aborter.abort();paintAborters.delete(aborter);scope?.paintAborters.delete(aborter);};if(active()&&node.fill==='freeze')freeze(node,withdraw);else if(!active()||node.fill!=='hold')withdraw();}
      }
      else if(node.kind==='set') {
        const previous=targets.map(el=>({el,visibility:el.style.visibility,opacity:el.style.opacity}));
        for(const el of targets){save(el);for(const property of node.attributes){if(property==='style.visibility')el.style.visibility=node.value;else if(property==='style.opacity')el.style.opacity=node.value;}}
        if(Number.isFinite(node.duration)&&node.duration>0)await wait(node.duration,scope);
        const restoreSet=()=>{for(const entry of previous){entry.el.style.visibility=entry.visibility;entry.el.style.opacity=entry.opacity;}};
        if(node.fill==='freeze'&&active())freeze(node,restoreSet);else if(node.fill!=='hold'&&active())restoreSet();
      }
      else if(node.kind==='animMotion') {
        if(!node.path.trim()){await Promise.all(targets.map(el=>animate(el,[{},{}],node,token,scope)));}
        else {
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        const bounds=root.getBoundingClientRect();
        const data=motionPath(node.path,bounds.width,bounds.height);
        if(!data){report('runtime-invalid-motion-path',node.path);return;}
        path.setAttribute('d',data);
        let length;try{length=path.getTotalLength();}catch(e){report('runtime-invalid-motion-path',e.message);return;}
        const frames=Array.from({length:121},(_,i)=>{const point=path.getPointAtLength(length*i/120);return {offset:i/120,transform:`translate(${point.x}px,${point.y}px)`};});
        await Promise.all(targets.map(el=>animate(el,frames,node,token,scope)));
        }
      } else {
        if(node.kind==='animEffect'&&node.transition==='in')for(const el of targets)el.style.opacity='';
        await Promise.all(targets.map(el=>animate(el,framesFor(node,targets),node,token,scope)));
      }
    }
    if(sameClickJobs.length)await Promise.all(sameClickJobs);
    if(['par','seq'].includes(node.kind)&&node.duration===Infinity&&active()&&!scope?.seeking)await park(scope);
    if(active()){signal('end');if(node.nodeType==='interactiveSeq'&&node.restart!=='never')run(node,token,parent).catch(e=>report('interactive-sequence-restart-failed',e.message));}
  }
  function otherMediaOwner(record){return [...(mediaOwners.get(record.element)||[])].some(owner=>owner!==record&&owner.active&&!owner.scope.cancelled);}
  async function seekScopeMedia(scope){
    for(const record of scope.media.values()){
      if(!record.active)continue;const {node,element:el}=record;
      if(otherMediaOwner(record)){report('unverified-overlapping-media-owner-priority',node.id);continue;}
      const simpleClock=(node.speed??1)===1&&(node.repeatCount??1)===1&&!node.autoReverse&&!node.timeFilter&&!node.acceleration&&!node.deceleration;
      if(!simpleClock||!Number.isFinite(node.duration)||el.readyState<1||!Number.isFinite(el.duration)){report('unverified-media-natural-end-seek',{node:node.id,duration:node.duration,readyState:el.readyState});el.pause();continue;}
      const start=Number(el.dataset.pptxTrimStart||0),tail=Number(el.dataset.pptxTrimEnd||0),end=Math.max(start,el.duration-tail),position=node.duration===0?end:Math.min(end,start+node.duration/1000);
      el.pause();
      if(Math.abs(el.currentTime-position)<1e-8)continue;
      await new Promise(resolve=>{let timeout=null,finished=false;const finish=()=>{if(finished)return;finished=true;el.removeEventListener('seeked',finish);if(timeout!=null){clearTimeout(timeout);timers.delete(timeout);}pending.delete(finish);scope.waiters.delete(finish);resolve();};pending.add(finish);scope.waiters.add(finish);el.addEventListener('seeked',finish,{once:true});timeout=timer(()=>{report('media-natural-end-seek-timeout',{node:node.id,position});finish();},2000);try{el.currentTime=position;}catch(error){report('media-natural-end-seek-failed',{node:node.id,message:error.message});finish();}});
    }
  }
  function stopScope(scope,restoreState=false) {
    scope.cancelled=true;for(const record of scope.media.values()){if(otherMediaOwner(record)){report('unverified-overlapping-media-owner-priority',record.node.id);continue;}record.element.pause();record.active=false;mediaOwners.get(record.element)?.delete(record);}
    for(const aborter of scope.paintAborters)aborter.abort();
    for(const done of [...scope.waiters])done();
    for(const animation of scope.animations){animation.cancel();animations.delete(animation);}
    for(const node of scope.nodes){thaw(node);if(node.id)timeNodeStates.delete(node.id);}
    if(restoreState){for(const [id,snapshot]of scope.beforePaint)restorePaint(id,snapshot);for(const [el,style]of scope.beforeStyles){if(style==null)el.removeAttribute('style');else el.setAttribute('style',style);}for(const [el,record]of scope.media){const state=scope.beforeMedia.get(el);if(!state||otherMediaOwner(record))continue;el.pause();if(el.readyState>=1)el.currentTime=state.time;if(!state.paused)el.play().catch(e=>report('media-rewind-play-rejected',e.message));}}
  }
  async function runSequence(node,token,outerScope) {
    let index=-1,complete=node.children.length===0,finishContainer=null,terminated=false,navigation=Promise.resolve();
    const scopes=[],removers=[];
    const active=()=>!disposed&&epoch===token&&!outerScope?.cancelled&&!terminated;
    const newScope=()=>({cancelled:false,seeking:false,waiters:new Set(),animations:new Set(),nodes:new Set(),media:new Map(),paintAborters:new Set(),beforePaint:new Map((shapes instanceof Map?[...shapes.keys()]:Object.keys(shapes)).map(id=>[String(id),shapePaint?.get(String(id))]).filter(([,snapshot])=>snapshot)),beforeStyles:new Map([...originalBounds.keys()].map(el=>[el,el.getAttribute('style')])),beforeMedia:new Map([...mediaElements.values()].map(el=>[el,{time:el.currentTime,paused:el.paused}]))});
    const triggered=child=>child.start.some(c=>!c.event&&!Number.isFinite(c.delay))&&!child.start.some(c=>Number.isFinite(c.delay)&&(!c.event||c.timeNode));
    const launch=(next,forced)=>{
      if(!active()||next<0||next>=node.children.length)return false;
      index=next;complete=false;
      const scope=newScope();scopes[index]=scope;
      scope.done=run(node.children[index],token,node,scope,forced).then(()=>{if(active()&&!scope.cancelled&&index===next){complete=true;const following=node.children[next+1];if(following&&!triggered(following))launch(next+1,false);else if(!following&&node.nodeType==='interactiveSeq')finishContainer?.();}}).catch(e=>report('sequence-execution-failed',e.message));
      return true;
    };
    const controller={
      canNext:()=>active()&&(index<node.children.length-1||!complete),
      canPrevious:()=>active()&&index>=0,
      next:()=>{
        if(!active())return false;
        navigation=navigation.then(async()=>{
          if(!active())return;
          const current=scopes[index],next=index+1;
          if(node.nodeType==='interactiveSeq'&&index===node.children.length-1){if(!complete&&node.restart==='whenNotActive')return;if(complete&&node.restart==='never')return;stopScope(current||newScope());launch(0,true);return;}
          if(current&&!complete){
            if(node.nextAction==='seek'){current.seeking=true;await seekScopeMedia(current);for(const anim of current.animations)seekAnimation(anim);for(const done of [...current.waiters])done();await current.done;}
            else if(!node.concurrent)stopScope(current);
          }
          if(!active())return;
          if(next<node.children.length){if(index<next)launch(next,true);}
          else complete=true;
        }).catch(e=>report('sequence-next-failed',e.message));
        return true;
      },
      previous:()=>{
        if(!active()||index<0)return false;
        navigation=navigation.then(()=>{if(!active())return;
        do{const scope=scopes[index];if(scope)stopScope(scope,true);index--;}while(node.previousAction==='skipTimed'&&index>=0&&!triggered(node.children[index]));
        complete=true;}).catch(e=>report('sequence-previous-failed',e.message));return true;
      }
    };
    sequenceControllers.add(controller);
    const add=(event,action,conditions)=>{
      for(const condition of conditions){
        const target=condition.bookmark?root:condition.shapeId?elements(condition.shapeId)[0]:root;
        if(!target){report('missing-sequence-navigation-target',condition.shapeId);continue;}
        const name=condition.bookmark?`pptxbookmark:${condition.shapeId}:${condition.bookmark}`:condition.event==='onClick'?'click':event;
        const handle=e=>{if(node.eventFilter==='cancelBubble')e.stopPropagation();if(Number.isFinite(condition.delay))timer(action,condition.delay);};
        target.addEventListener(name,handle);removers.push(()=>target.removeEventListener(name,handle));
      }
    };
    add('pptxnext',controller.next,node.next);add('pptxprevious',controller.previous,node.previous);
    if(node.nodeType==='mainSeq'){const handle=e=>{if(e.target?.closest?.('audio,video'))return;controller.next();};root.addEventListener('click',handle);removers.push(()=>root.removeEventListener('click',handle));}
    if(node.children[0]&&!triggered(node.children[0]))launch(0,false);
    await new Promise(resolve=>{const cleanup=()=>{terminated=true;for(const off of removers)off();for(const scope of scopes)if(scope)stopScope(scope);sequenceControllers.delete(controller);pending.delete(cleanup);outerScope?.waiters.delete(cleanup);resolve();};finishContainer=cleanup;pending.add(cleanup);outerScope?.waiters.add(cleanup);});
  }
  async function attachMedia() {
    listen(root,'pptxstopaudio',()=>{for(const el of mediaElements.values())if(el.localName==='audio'){el.pause();el.dispatchEvent(new Event('pptxmediaended'));}});
    for(const m of model.media) {
      if(m.source?.unavailableReason){report(m.source.unavailableReason,{relationshipId:m.relationshipId,target:m.source.target,category:'source-limitation'});continue;}
      const targets=m.shapeId==null?[root]:elements(m.shapeId);if(!targets.length){report('missing-media-shape',m.shapeId);continue;}
      if(!m.source||!resolveMedia){report('missing-media-resolver',m.relationshipId);continue;}
      let resolved;
      try{resolved=await resolveMedia(m.source,m);}catch(e){report('media-source-resolution-failed',e.message);continue;}
      if(disposed){if(resolved?.cleanup)resolved.cleanup();continue;}
      const url=typeof resolved==='string'?resolved:resolved?.url;
      if(!url){report('empty-media-source',m.relationshipId);continue;}
      const el=document.createElement(m.kind);el.src=url;el.controls=true;el.preload='metadata';el.playsInline=true;
      el.dataset.pptxShapeId=m.shapeId;el.dataset.pptxTrimStart=String(m.trimStart);el.dataset.pptxTrimEnd=String(m.trimEnd||0);el.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:auto';
      if(m.shapeId==null){el.hidden=true;el.controls=false;}
      targets[0].append(el);mediaElements.set(m.shapeId==null?'r:'+m.relationshipId:String(m.shapeId),el);
      const settings=mediaSettings.get(m.shapeId==null?'r:'+m.relationshipId:String(m.shapeId));
      el.volume=Number.isFinite(settings?.volume)?Math.max(0,Math.min(1,settings.volume)):1;el.muted=!!settings?.mute;
      if(settings?.slideCount>1&&!mediaBus)report('missing-presentation-media-bus',m.relationshipId);
      if(mediaBus)listeners.push(mediaBus.register(el,{slides:settings?.slideCount??1,duration:settings?.duration??0}));
      for(const end of settings?.end||[]){
        const event={onNext:'pptxnext',onPrev:'pptxprevious',onStopAudio:'pptxstopaudio'}[end.event];
        if(!event||end.shapeId||end.timeNode||end.bookmark||!Number.isFinite(end.delay))continue;
        listen(root,event,()=>{const finish=()=>{el.pause();el.dispatchEvent(new Event('pptxmediaended'));};if(end.delay>0)timer(finish,end.delay);else finish();});
      }
      if(resolved?.cleanup)listeners.push(resolved.cleanup);
      listen(el,'error',()=>report('media-decode-failed',{source:m.relationshipId,code:el.error?.code}));
      listen(el,'loadedmetadata',()=>{
        if(Number.isFinite(el.duration)&&(m.trimStart>=el.duration-(m.trimEnd||0)||(m.trimEnd||0)>=el.duration-m.trimStart)){report('invalid-media-trim-range',{source:m.relationshipId,duration:el.duration,start:m.trimStart,end:m.trimEnd});return;}
        if(m.trimStart)el.currentTime=m.trimStart;
        for(const bookmark of m.bookmarks||[])if(bookmark.time>el.duration)report('invalid-media-bookmark-time',{source:m.relationshipId,bookmark,duration:el.duration});
        if((m.fadeIn||0)+(m.fadeOut||0)>el.duration)report('invalid-media-fade-duration',{source:m.relationshipId,duration:el.duration,in:m.fadeIn,out:m.fadeOut});
      });
      if(m.fadeIn||m.fadeOut){
        let frame=null,baseVolume=mediaSettings.get(String(m.shapeId))?.volume??1,lastApplied=el.volume;
        const apply=()=>{const elapsed=Math.max(0,el.currentTime-m.trimStart),remaining=el.duration-(m.trimEnd||0)-el.currentTime;const gain=Math.max(0,Math.min(1,m.fadeIn?elapsed/m.fadeIn:1,m.fadeOut&&Number.isFinite(remaining)?remaining/m.fadeOut:1));lastApplied=baseVolume*gain;el.volume=lastApplied;};
        const tick=()=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;apply();if(!el.paused&&!el.ended)frame=requestAnimationFrame(tick);};
        const cancelFrame=()=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;};
        mediaEnvelopes.set(el,{setVolume(value){baseVolume=value;apply();}});
        listen(el,'play',tick);listen(el,'timeupdate',tick);listen(el,'seeked',tick);listen(el,'pause',cancelFrame);listen(el,'ended',cancelFrame);
        listen(el,'volumechange',()=>{if(Math.abs(el.volume-lastApplied)>1e-7){baseVolume=el.volume;apply();}});listeners.push(cancelFrame);
      }
      if(m.bookmarks?.length){
        let frame=null,lastTime=m.trimStart-Number.EPSILON;
        const checkBookmarks=()=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;const now=el.currentTime;if(now<lastTime)lastTime=now-Math.max(1,now)*1e-9;for(const bookmark of m.bookmarks)if(bookmark.time>lastTime&&bookmark.time<=now)root.dispatchEvent(new Event(`pptxbookmark:${m.shapeId}:${bookmark.name}`));lastTime=now;if(!el.paused&&!el.ended)frame=requestAnimationFrame(checkBookmarks);};
        const cancelFrame=()=>{if(frame!=null)cancelAnimationFrame(frame);frame=null;};
        listen(el,'play',()=>{cancelFrame();checkBookmarks();});listen(el,'timeupdate',()=>{if(!el.paused)checkBookmarks();});listen(el,'pause',cancelFrame);listen(el,'ended',cancelFrame);listeners.push(cancelFrame);
      }
      if(m.trimEnd>0)listen(el,'timeupdate',()=>{const end=el.duration-m.trimEnd;if(Number.isFinite(end)&&end>m.trimStart&&el.currentTime>=end){el.pause();el.currentTime=end;el.dispatchEvent(new Event('pptxmediaended'));}});
    }
  }
  function cancel() {
    epoch++;preparedEpoch=null;preparedReady=null;startedEpoch=null;for(const owners of mediaOwners.values())for(const owner of owners)owner.active=false;mediaOwners.clear();for(const aborter of paintAborters)aborter.abort();paintAborters.clear();paintOwners.clear();timeNodeStates.clear();for(const node of frozenByNode.keys())thaw(node);paintRestoration=Promise.all([...originalPaint].map(([id,snapshot])=>restorePaint(id,snapshot)));
    for(const id of timers)clearTimeout(id);timers.clear();
    for(const fn of pending)fn();pending.clear();
    for(const animation of animations)animation.cancel();animations.clear();
    for(const el of mediaElements.values())if(!mediaBus?.keeps(el))el.pause();
    for(const [el,style]of restore){if(style==null)el.removeAttribute('style');else el.setAttribute('style',style);}
  }
  function prepare() {
    if(disposed)return Promise.resolve();
    if(preparedEpoch===epoch&&startedEpoch!==epoch)return preparedReady;
    cancel();const token=epoch;preparedEpoch=token;
    for(const f of model.failures)onFailure(f);
    originalBounds.clear();for(const value of shapes instanceof Map?shapes.values():Object.values(shapes))for(const el of Array.isArray(value)?value:[value])if(!originalBounds.has(el))originalBounds.set(el,el.getBoundingClientRect());
    // Pre-start entrance objects are hidden until their timing node starts.
    const visit=(node,entrance=false)=>{
      const isEntrance=node.presetClass?node.presetClass==='entr':entrance;
      if(node.iteration&&containsSubTime(node)){report('unsupported-iteration-sub-time-combination',node.id);return;}
      if(node.iteration){for(const item of iterationItems(node))visit(item,isEntrance);return;}
      if(node.kind==='animEffect'&&node.transition==='in')for(const el of targetElements(node)){save(el);el.style.opacity='0';}
      if(isEntrance&&node.kind==='set'&&node.attributes[0]==='style.visibility'&&node.value==='visible')for(const el of targetElements(node)){save(el);el.style.visibility='hidden';}
      for(const c of node.children.concat(node.subChildren||[]))visit(c,isEntrance);
    };
    model.timeline.forEach(node=>visit(node));
    // Hide entrance layers synchronously, before resource resolution or any transition frame.
    preparedReady=(async()=>{
      await paintRestoration;if(disposed||token!==epoch)return;
      if(!mediaInitialization)mediaInitialization=attachMedia();
      await mediaInitialization;
    })();
    return preparedReady;
  }
  async function start() {
    if(disposed)return;
    const readiness=prepare(),token=epoch;await readiness;
    if(disposed||token!==epoch||startedEpoch===token)return;
    startedEpoch=token;
    model.timeline.forEach(n=>{run(n,token).catch(e=>report('timeline-execution-failed',e.message));});
    if(model.transition?.advanceAfter!=null)timer(onAdvance,model.transition.advanceAfter);
  }
  async function transition(previousRoot=null) {
    const token=epoch;if(disposed)return;
    if(model.transition?.sound){if(!audioBus)report('missing-presentation-audio-bus',model.transition.sound.relationshipId);else await audioBus.play(model.transition.sound,resolveMedia,f=>report(f.code,f.detail));}
    if(disposed||token!==epoch)return;
    const t=model.transition;if(!t||t.kind==='cut')return;
    const vector={l:['100%','0'],r:['-100%','0'],u:['0','100%'],d:['0','-100%']}[t.direction];
    const node={duration:t.duration,fill:'remove'};
    if(t.kind==='fade')await animate(root,[{opacity:0},{opacity:1}],node,token);
    else if(t.kind==='newsflash')await animate(root,[{transform:'rotate(720deg) scale(0)'},{transform:'rotate(0deg) scale(1)'}],node,token);
    else if(t.kind==='diamond')await animate(root,effectFrames({filter:'diamond(out)',transition:'in'}),node,token);
    else if(['plus','blinds','randomBar','wheel','comb','dissolve','strips'].includes(t.kind)){const bounds=root.getBoundingClientRect();await animate(root,transitionMaskFrames(t,bounds.width,bounds.height),node,token);}
    else if(t.kind==='wipe') {const frame=effectFrames({filter:`wipe(${{l:'left',r:'right',u:'up',d:'down'}[t.direction]})`,transition:'in'});await animate(root,frame,node,token);}
    else if(vector){const animationsToRun=[animate(root,[{transform:`translate(${vector[0]},${vector[1]})`},{transform:'translate(0,0)'}],node,token)];if(previousRoot&&t.kind==='push')animationsToRun.push(animate(previousRoot,[{transform:'translate(0,0)'},{transform:`translate(calc(-1 * ${vector[0]}),calc(-1 * ${vector[1]}))`}],node,token));if(t.kind==='pull'||t.kind==='cover')report('runtime-unsupported-overlap-transition',t.kind);await Promise.all(animationsToRun);}
    else report('unsupported-transition-direction',t.direction);
  }
  function dispose() {
    cancel();disposed=true;
    for(const remove of listeners.splice(0))remove();
    for(const el of mediaElements.values()){el.removeAttribute('src');el.load();el.remove();}mediaElements.clear();mediaEnvelopes.clear();
    for(const [el,style]of restore){if(style==null)el.removeAttribute('style');else el.setAttribute('style',style);}restore.clear();
  }
  return {prepare,start,cancel,dispose,transition,next:()=>{const consumed=[...sequenceControllers].some(c=>c.canNext());root.dispatchEvent(new Event('pptxnext'));return consumed;},previous:()=>{const consumed=[...sequenceControllers].some(c=>c.canPrevious());root.dispatchEvent(new Event('pptxprevious'));return consumed;},failures,mediaElements,get supported(){return failures.length===0;},stopAudio:()=>{mediaBus?.stopAudio();root.dispatchEvent(new Event('pptxstopaudio'));},conformanceStatus:'unverified'};
}
