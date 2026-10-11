import { PRESET_GEOMETRIES } from './pptx-preset-geometries.js';

// ECMA-376 Part 1 §20.1.9; angle units are 1/60000 degree.
const ANGLE = Math.PI / 10800000;
const TURN = Math.PI * 2;
const child = (n, name) => n.children.find(c => c.tag === name);
function xmlNode(element) {
  return { tag: element.localName, attrs: Object.fromEntries(Array.from(element.attributes, a => [a.localName, a.value])), children: Array.from(element.children, xmlNode) };
}
export class UnsupportedGeometryError extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedGeometryError'; }
}
// A spPr input preserves its xfrm/ext coordinate space (EMU). When passing only
// custGeom/prstGeom XML, callers may supply coordinateWidth/Height on the result.
export function parseGeometry(input) {
  if (typeof input === 'string') {
    const doc = new DOMParser().parseFromString(input, 'application/xml');
    if (doc.querySelector('parsererror')) throw new UnsupportedGeometryError('Malformed DrawingML geometry');
    input = doc.documentElement;
  }
  if (!input) return { kind: 'preset', name: 'rect', definition: PRESET_GEOMETRIES.rect, adjustments: [] };
  const node = input.tag ? input : xmlNode(input);
  const geom = ['prstGeom', 'custGeom'].includes(node.tag) ? node : node.children.find(c => ['prstGeom', 'custGeom'].includes(c.tag));
  if (!geom) return parseGeometry(null);
  const ext = child(node, 'xfrm') && child(child(node, 'xfrm'), 'ext');
  const coordinateBounds = ext ? { coordinateWidth: Number(ext.attrs.cx), coordinateHeight: Number(ext.attrs.cy) } : {};
  if (geom.tag === 'custGeom') return { kind: 'custom', definition: geom, adjustments: [], ...coordinateBounds };
  const name = geom.attrs.prst;
  if (!PRESET_GEOMETRIES[name]) throw new UnsupportedGeometryError(`Unknown preset geometry: ${name}`);
  return { kind: 'preset', name, definition: PRESET_GEOMETRIES[name], adjustments: child(geom, 'avLst')?.children || [], ...coordinateBounds };
}

export function evaluateGuide(formula, variables) {
  const [op, ...tokens] = formula.trim().split(/\s+/);
  const args = tokens.map(token => {
    const value = /^[-+]?\d+(?:\.\d+)?$/.test(token) ? Number(token) : variables[token];
    if (!Number.isFinite(value)) throw new UnsupportedGeometryError(`Undefined/non-finite geometry operand: ${token}`);
    return value;
  });
  const [x, y, z] = args;
  const arity = { val: 1, '*/': 3, '+-': 3, '+/': 3, '?:': 3, abs: 1, at2: 2, cat2: 3, cos: 2, max: 2, min: 2, mod: 3, pin: 3, sat2: 3, sin: 2, sqrt: 1, tan: 2 };
  if (arity[op] !== args.length) throw new UnsupportedGeometryError(`Unsupported/malformed geometry formula: ${formula}`);
  let result;
  switch (op) {
    case 'val': result = x; break;
    case '*/': result = z === 0 ? 0 : x * y / z; break;
    case '+-': result = x + y - z; break;
    case '+/': result = z === 0 ? 0 : (x + y) / z; break;
    case '?:': result = x > 0 ? y : z; break;
    case 'abs': result = Math.abs(x); break;
    case 'at2': result = Math.atan2(y, x) / ANGLE; break;
    case 'cat2': result = x * Math.cos(Math.atan2(z, y)); break;
    case 'sat2': result = x * Math.sin(Math.atan2(z, y)); break;
    case 'cos': result = x * Math.cos(y * ANGLE); break;
    case 'sin': result = x * Math.sin(y * ANGLE); break;
    case 'tan': result = x * Math.tan(y * ANGLE); break;
    case 'max': result = Math.max(x, y); break;
    case 'min': result = Math.min(x, y); break;
    case 'mod': result = Math.hypot(x, y, z); break;
    case 'pin': result = Math.max(x, Math.min(y, z)); break;
    // MS-OI29500 §2.1.1311(b): Office takes the absolute value first.
    case 'sqrt': result = Math.sqrt(Math.abs(x)); break;
  }
  if (!Number.isFinite(result)) throw new UnsupportedGeometryError(`Non-finite geometry formula: ${formula}`);
  return result;
}
function variablesFor(width, height) {
  const v = { w: width, h: height, l: 0, t: 0, r: width, b: height, hc: width / 2, vc: height / 2, ss: Math.min(width, height), ls: Math.max(width, height), cd: 21600000 };
  for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    v[`wd${divisor}`] = width / divisor; v[`hd${divisor}`] = height / divisor; v[`ssd${divisor}`] = v.ss / divisor; v[`cd${divisor}`] = v.cd / divisor;
  }
  for (const [num, den] of [[3, 4], [3, 8], [5, 8], [7, 8]]) v[`${num}cd${den}`] = v.cd * num / den;
  return v;
}
function resolve(token, v) { return evaluateGuide(`val ${token}`, v); }
function curveBoundsCollector() {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const add = p => { left = Math.min(left,p.x); top = Math.min(top,p.y); right = Math.max(right,p.x); bottom = Math.max(bottom,p.y); };
  const quadratic = (a,b,c,t) => (1-t)*(1-t)*a+2*(1-t)*t*b+t*t*c;
  const cubic = (a,b,c,d,t) => (1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;
  const roots = (a,b,c) => { if (a===0) return b===0?[]:[-c/b]; const discriminant=b*b-4*a*c; if(discriminant<0)return[];const q=-.5*(b+(b<0?-1:1)*Math.sqrt(discriminant));return q===0?[-b/(2*a)]:[q/a,c/q]; };
  return { line(a,b) { add(a);add(b); },
    quadratic(a,b,c) { add(a);add(c);for(const axis of ['x','y']){const denominator=a[axis]-2*b[axis]+c[axis],t=denominator?(a[axis]-b[axis])/denominator:-1;if(t>0&&t<1)add({x:quadratic(a.x,b.x,c.x,t),y:quadratic(a.y,b.y,c.y,t)});} },
    cubic(a,b,c,d) { add(a);add(d);for(const axis of ['x','y'])for(const t of roots(-a[axis]+3*b[axis]-3*c[axis]+d[axis],2*(a[axis]-2*b[axis]+c[axis]),b[axis]-a[axis]))if(t>0&&t<1)add({x:cubic(a.x,b.x,c.x,d.x,t),y:cubic(a.y,b.y,c.y,d.y,t)}); },
    ellipse(cx,cy,rx,ry,start,delta) { const point=angle=>({x:cx+rx*Math.cos(angle),y:cy+ry*Math.sin(angle)});add(point(start));add(point(start+delta));for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){const relative=delta>=0?((angle-start)%TURN+TURN)%TURN:((start-angle)%TURN+TURN)%TURN;if(relative<=Math.abs(delta)+1e-12)add(point(angle));} },
    transformed(sx,sy,x,y) { if(left===Infinity)return null;const l=Math.min(left*sx+x,right*sx+x),r=Math.max(left*sx+x,right*sx+x),t=Math.min(top*sy+y,bottom*sy+y),b=Math.max(top*sy+y,bottom*sy+y);return{x:l,y:t,width:r-l,height:b-t,l,t,r,b}; }
  };
}
function unionPathBounds(values) {
  const boxes=values.filter(Boolean);if(!boxes.length)return null;
  const l=Math.min(...boxes.map(b=>b.l)),t=Math.min(...boxes.map(b=>b.t)),r=Math.max(...boxes.map(b=>b.r)),b=Math.max(...boxes.map(b=>b.b));return{x:l,y:t,width:r-l,height:b-t,l,t,r,b};
}
// bounds are output canvas coordinates; guide literals remain in source space.
export function buildGeometryPaths(geometry, bounds) {
  const x = bounds.x ?? 0, y = bounds.y ?? 0;
  const w = bounds.width ?? bounds.w, h = bounds.height ?? bounds.h;
  if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0) throw new UnsupportedGeometryError('Invalid geometry bounds');
  const cw = geometry.coordinateWidth ?? w, ch = geometry.coordinateHeight ?? h;
  if (![cw, ch].every(Number.isFinite) || cw < 0 || ch < 0) throw new UnsupportedGeometryError('Invalid geometry coordinate bounds');
  const definition = geometry.definition, v = variablesFor(cw, ch);
  const overrides = new Map(geometry.adjustments.map(g => [g.attrs.name, g.attrs.fmla]));
  for (const g of child(definition, 'avLst')?.children || []) v[g.attrs.name] = evaluateGuide(overrides.get(g.attrs.name) || g.attrs.fmla, v);
  for (const g of child(definition, 'gdLst')?.children || []) v[g.attrs.name] = evaluateGuide(g.attrs.fmla, v);
  const pathList = child(definition, 'pathLst');
  if (!pathList) throw new UnsupportedGeometryError('Geometry has no path list');
  const paths = pathList.children.map(node => {
    const pw = node.attrs.w ? resolve(node.attrs.w, v) : cw, ph = node.attrs.h ? resolve(node.attrs.h, v) : ch;
    const sx = pw === 0 ? 0 : w / pw, sy = ph === 0 ? 0 : h / ph;
    const local = new Path2D(), extrema = curveBoundsCollector(); let current = { x: 0, y: 0 }, start = current, subpathDrawn = false;
    const point = n => ({ x: resolve(n.attrs.x, v), y: resolve(n.attrs.y, v) });
    for (const command of node.children) {
      const pointCount = { moveTo: 1, lnTo: 1, quadBezTo: 2, cubicBezTo: 3, close: 0, arcTo: 0 }[command.tag];
      if (pointCount === undefined || command.children.length !== pointCount || command.children.some(n => n.tag !== 'pt')) throw new UnsupportedGeometryError(`Malformed/unsupported geometry path command: ${command.tag}`);
      const points = command.children.map(point);
      switch (command.tag) {
        case 'moveTo': current = points[0]; start = current; subpathDrawn = false; local.moveTo(current.x, current.y); break;
        case 'lnTo': subpathDrawn = true; extrema.line(current,points[0]); current = points[0]; local.lineTo(current.x, current.y); break;
        case 'quadBezTo': subpathDrawn = true; extrema.quadratic(current,points[0],points[1]); local.quadraticCurveTo(points[0].x, points[0].y, points[1].x, points[1].y); current = points[1]; break;
        case 'cubicBezTo': subpathDrawn = true; extrema.cubic(current,points[0],points[1],points[2]); local.bezierCurveTo(points[0].x, points[0].y, points[1].x, points[1].y, points[2].x, points[2].y); current = points[2]; break;
        case 'close': if(subpathDrawn)extrema.line(current,start); local.closePath(); current = start; break;
        case 'arcTo': {
          const rx = Math.abs(resolve(command.attrs.wR, v)), ry = Math.abs(resolve(command.attrs.hR, v));
          const angle = resolve(command.attrs.stAng, v) * ANGLE, sweep = resolve(command.attrs.swAng, v) * ANGLE;
          if (!rx || !ry) break;
          // DrawingML uses the radial angle; Canvas uses the ellipse parameter.
          const parameter = a => Math.atan2(rx * Math.sin(a), ry * Math.cos(a));
          const a0 = parameter(angle), a1 = parameter(angle + sweep);
          let delta = a1 - a0;
          if (sweep >= 0) { while (delta < -1e-12) delta += TURN; } else { while (delta > 1e-12) delta -= TURN; }
          if (Math.abs(sweep) >= TURN - 1e-10) delta = Math.sign(sweep) * TURN;
          const cx = current.x - rx * Math.cos(a0), cy = current.y - ry * Math.sin(a0);
          if(delta!==0) { extrema.ellipse(cx,cy,rx,ry,a0,delta); subpathDrawn = true; }
          local.ellipse(cx, cy, rx, ry, 0, a0, a0 + delta, sweep < 0);
          current = { x: cx + rx * Math.cos(a0 + delta), y: cy + ry * Math.sin(a0 + delta) };
          break;
        }
        default: throw new UnsupportedGeometryError(`Unsupported geometry path command: ${command.tag}`);
      }
    }
    const path = new Path2D(); path.addPath(local, new DOMMatrix([sx, 0, 0, sy, x, y]));
    return { path, bounds: extrema.transformed(sx,sy,x,y), fill: node.attrs.fill || 'norm', stroke: node.attrs.stroke !== '0' && node.attrs.stroke !== 'false', extrusionOk: node.attrs.extrusionOk !== '0' && node.attrs.extrusionOk !== 'false' };
  });
  const rect = child(definition, 'rect');
  const textRect = rect ? Object.fromEntries(['l', 't', 'r', 'b'].map(k => [k, resolve(rect.attrs[k], v) * (k === 'l' || k === 'r' ? (cw ? w / cw : 0) : (ch ? h / ch : 0)) + (k === 'l' || k === 'r' ? x : y)])) : { l: x, t: y, r: x + w, b: y + h };
  return { paths, pathBounds: unionPathBounds(paths.map(p=>p.bounds)), fillBounds: unionPathBounds(paths.filter(p=>p.fill!=='none').map(p=>p.bounds)), textRect, guides: v };
}
export function clipGeometry(ctx, geometry, bounds) {
  const result = buildGeometryPaths(geometry, bounds), combined = new Path2D();
  for (const p of result.paths) if (p.fill !== 'none') combined.addPath(p.path);
  ctx.clip(combined, 'nonzero'); return result;
}
export function geometryFillStyle(ctx, baseStyle, mode) {
  // MS-OI29500 §2.1.1327: Less modes use 50/255, not the rounded 20%.
  const amount = { lighten: 102 / 255, lightenLess: 50 / 255, darken: -102 / 255, darkenLess: -50 / 255 }[mode];
  if (mode === 'norm') return baseStyle;
  if (amount === undefined || typeof baseStyle !== 'string') throw new UnsupportedGeometryError(`Geometry fill mode requires fillPath callback: ${mode}`);
  const sample = document.createElement('canvas'); sample.width = sample.height = 1;
  const color = sample.getContext('2d'); color.fillStyle = baseStyle; color.fillRect(0, 0, 1, 1);
  const rgba = Array.from(color.getImageData(0, 0, 1, 1).data);
  for (let i = 0; i < 3; i++) rgba[i] = Math.round(amount >= 0 ? rgba[i] + (255 - rgba[i]) * amount : rgba[i] * (1 + amount));
  return `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`;
}
export function drawGeometry(ctx, geometry, bounds, options = {}) {
  if (options.clip) return clipGeometry(ctx, geometry, bounds);
  const result = buildGeometryPaths(geometry, bounds);
  for (const p of result.paths) {
    if (options.fill !== false && p.fill !== 'none') {
      if (p.fill === 'norm') ctx.fill(p.path, 'nonzero');
      else if (options.fillPath) options.fillPath(ctx, p);
      else { const fill = ctx.fillStyle; ctx.fillStyle = geometryFillStyle(ctx, fill, p.fill); ctx.fill(p.path, 'nonzero'); ctx.fillStyle = fill; }
    }
    if (options.stroke !== false && p.stroke) ctx.stroke(p.path);
  }
  return result;
}
