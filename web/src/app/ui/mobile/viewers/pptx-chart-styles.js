// Fact-based interpretation of ISO/IEC 29500-1:2012 §21.2.3.46, Tables 1–6.
// Microsoft differences: MS-OI29500 §2.1.1598(a,b). No third-party style table is imported.
const STYLE_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const colorRule = (scheme, transform = null, value = null) => ({ scheme, transform, value });
const schemes = ['accent1','accent2','accent3','accent4','accent5','accent6'];
export const CHART_COLOR_PATTERNS = [null,
  [88500,55000,78000,92500,70000,30000].map(value => colorRule('dk1','tint',value)),
  schemes.map(scheme => colorRule(scheme)),
  schemes.map(scheme => colorRule(scheme,'shade',50000)),
  [5000,55000,78000,15000,70000,30000].map(value => colorRule('dk1','tint',value))
];
export function chartStyleDescriptor(styleId) {
  if (!Number.isInteger(styleId) || styleId < 1 || styleId > 48) throw new RangeError('Chart legacy ST_Style must be 1..48');
  const slot = (styleId - 1) % 8, fade = slot >= 2, accent = fade ? schemes[slot - 2] : null;
  const pattern = fade ? null : slot === 1 ? 2 : styleId === 41 ? 4 : 1;
  const intensity = styleId >= 17 && styleId <= 32 || styleId >= 41;
  const seriesEffect = styleId <= 8 || styleId >= 33 && styleId <= 40 ? 'none' : styleId <= 16 ? 'subtle' : styleId <= 24 ? 'moderate' : 'intense';
  let border = null;
  if (styleId >= 9 && styleId <= 16) border = colorRule('lt1');
  if (styleId === 33) border = colorRule('dk1','shade',50000);
  if (styleId === 34) border = { pattern: 3 };
  if (styleId >= 35 && styleId <= 40) border = colorRule(accent,'shade',50000);
  const plotColor = styleId <= 32 ? colorRule('bg1') : styleId <= 34 ? colorRule('dk1','tint',20000) : styleId <= 40 ? colorRule(schemes[styleId - 35]) : colorRule('dk1','tint',95000);
  const upFill = styleId === 33 || styleId === 34 || styleId >= 35 && styleId <= 40 || styleId === 42 ? colorRule('lt1') : fade ? colorRule(accent,'tint',25000) : colorRule('dk1','tint',slot === 1 ? 5000 : 25000);
  const downFill = styleId === 42 ? colorRule('dk1') : fade ? colorRule(accent,'shade',25000) : colorRule('dk1','tint',slot === 1 ? 95000 : 85000);
  const areaLine = styleId <= 40 ? colorRule(styleId <= 32 ? 'tx1' : 'dk1','tint',75000) : colorRule('lt1');
  return {
    id: styleId, fontTheme: 'minor', defaultFontPt: 10, titleFontFactor: 1.2, titleBold: true,
    fontColor: colorRule(styleId <= 32 ? 'tx1' : 'dk1'),
    chartArea: { fill: colorRule(styleId <= 32 ? 'bg1' : styleId <= 40 ? 'lt1' : 'dk1'), fillTheme: 'subtle', lineTheme: styleId <= 40 ? 'subtle' : 'none', line: areaLine },
    plotArea: { fill: plotColor, fillTheme: 'subtle', fillTheme3D: 'none', lineTheme: 'none' },
    walls: { fill: plotColor, fillTheme: styleId <= 32 ? 'none' : 'subtle', lineTheme: 'none' },
    floor: { fill: plotColor, fillTheme: styleId <= 32 ? 'none' : 'subtle', lineTheme: styleId <= 40 ? 'subtle' : 'none', line: areaLine },
    dataTable: { fillTheme: 'none', lineTheme: 'subtle', line: areaLine },
    axisMajorGrid: { line: colorRule(styleId <= 32 ? 'tx1' : 'dk1'), lineTheme: 'subtle' },
    minorGrid: { line: colorRule('tx1','tint',styleId <= 40 ? 50000 : 90000), lineTheme: 'subtle' },
    otherLine: { line: styleId <= 32 ? colorRule('tx1') : styleId <= 34 ? colorRule('dk1') : styleId <= 40 ? colorRule('dk1','shade',25000) : colorRule('lt1'), lineTheme: 'subtle' },
    series: { pattern, fadeAccent: accent, fillTheme2D: intensity ? 'intense' : 'subtle', fillTheme3D: [18,26,42].includes(styleId) ? 'intense' : 'subtle', effectTheme: seriesEffect, effectColor: colorRule('dk1'), border, lineWidthFactor: styleId <= 8 ? 3 : styleId >= 25 && styleId <= 32 ? 7 : 5 },
    upDown: { upFill, downFill, fillTheme: intensity ? 'intense' : 'subtle', effectTheme: seriesEffect, effectColor: colorRule('dk1'), lineTheme: intensity ? 'none' : 'subtle', line: intensity ? null : styleId <= 16 ? colorRule('tx1') : styleId >= 35 && styleId <= 40 ? colorRule(accent,'shade',25000) : colorRule('dk1') }
  };
}
export const CHART_STYLE_PRESETS = Object.freeze(Array.from({ length:48 },(_,index)=>chartStyleDescriptor(index+1)));
export function chartColorNode(rule, doc) {
  const node = doc.createElementNS(STYLE_A,'a:schemeClr'); node.setAttribute('val',rule.scheme);
  if (rule.transform) { const transform = doc.createElementNS(STYLE_A,'a:'+rule.transform); transform.setAttribute('val',String(rule.value)); node.appendChild(transform); }
  return node;
}
export function chartSeriesColorRule(descriptor, index, highestIndex, role = 'fill') {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(highestIndex) || highestIndex < index) throw new RangeError('Invalid chart formatting index');
  if (role === 'border' && descriptor.series.border) {
    const border = descriptor.series.border; return border.pattern ? CHART_COLOR_PATTERNS[border.pattern][index%6] : border;
  }
  if (!descriptor.series.fadeAccent) return CHART_COLOR_PATTERNS[descriptor.series.pattern][index%6];
  // ISO suggests this fade; exact application-defined endpoints remain a Microsoft pixel-oracle gate.
  const percent = -70 + 140 * index / (highestIndex + 1);
  return percent < 0 ? colorRule(descriptor.series.fadeAccent,'shade',Math.round((100 + percent)*1000)) : colorRule(descriptor.series.fadeAccent,'tint',Math.round(percent*1000));
}

// c14:style is a distinct extension enumeration; its value is never coerced into ST_Style.
export function selectLegacyChartStyle(root) {
  const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const children = n => Array.from(n?.children || []);
  const direct = children(root).find(n => n.namespaceURI === C && n.localName === 'style');
  if (direct) return {id:Number(direct.getAttribute('val')),source:'direct',extensionUnverified:false};
  for (const alternate of children(root).filter(n => n.namespaceURI === MC && n.localName === 'AlternateContent')) {
    for (const choice of children(alternate).filter(n => n.namespaceURI === MC && n.localName === 'Choice')) {
      const prefixes = (choice.getAttribute('Requires') || '').trim().split(/\s+/).filter(Boolean);
      if (prefixes.length && prefixes.every(prefix => choice.lookupNamespaceURI(prefix) === C)) {
        const style = children(choice).find(n => n.namespaceURI === C && n.localName === 'style');
        if (style) return {id:Number(style.getAttribute('val')),source:'supportedChoice',extensionUnverified:false};
      }
    }
    const fallback = children(alternate).find(n => n.namespaceURI === MC && n.localName === 'Fallback');
    const style = children(fallback).find(n => n.namespaceURI === C && n.localName === 'style');
    if (style) return {id:Number(style.getAttribute('val')),source:'fallback',extensionUnverified:true};
    if (children(alternate).some(n => children(n).some(c => c.localName === 'style'))) throw new RangeError('Unsupported extension chart style has no legacy fallback');
  }
  return {id:2,source:'default',extensionUnverified:false};
}
export function instantiateChartThemeStyle(format, kind, intensity, rule, doc, parseXml) {
  const index={none:0,subtle:1,moderate:2,intense:3}[intensity];
  if(index==null) throw new RangeError('Unknown chart theme style intensity');
  if(!index) return null;
  const xml=format?.[kind]?.[index-1];if(!xml) return null;
  const parsed=parseXml?.(xml)||new DOMParser().parseFromString(xml,'application/xml');
  if(parsed.querySelector('parsererror')) throw new RangeError('Malformed chart theme formatting style');
  const node=doc.importNode(parsed.documentElement,true);
  for(const placeholder of Array.from(node.getElementsByTagNameNS(STYLE_A,'schemeClr')).filter(n=>n.getAttribute('val')==='phClr')) {
    const resolved=chartColorNode(rule,doc);
    for(const transform of Array.from(placeholder.children)) resolved.appendChild(transform.cloneNode(true));
    placeholder.replaceWith(resolved);
  }
  return {node,relationships:format.relationships?.[kind]||{}};
}

// Text defaults from the authored Office chartStyle part; values are hundredths of a point.
export function parseExternalChartTextStyles(root, helpers = {}) {
  const roles = {};
  for (const element of Array.from(root.children || [])) {
    const child = name => Array.from(element.children).find(n => n.localName === name);
    const properties = child('defRPr'), fontRef = child('fontRef');
    if (!properties && !fontRef) continue;
    const style = {};
    if (properties?.hasAttribute('sz')) {
      const hundredths = Number(properties.getAttribute('sz'));
      if (!Number.isFinite(hundredths) || hundredths <= 0) throw new RangeError('Invalid chartStyle text size');
      style.size = hundredths / 100 * 96 / 72;
    }
    for (const [attribute,key] of [['b','bold'],['i','italic']]) if (properties?.hasAttribute(attribute)) {
      const raw = properties.getAttribute(attribute);
      if (!['1','0','true','false','on','off'].includes(raw)) throw new RangeError('Invalid chartStyle text boolean');
      style[key] = ['1','true','on'].includes(raw);
    }
    const color = helpers.parseColor?.(Array.from(properties?.children||[]).find(n=>n.localName==='solidFill')) || helpers.parseColor?.(fontRef); if(color) style.color = color;
    const latin = properties?.getElementsByTagNameNS(STYLE_A,'latin')[0];
    style.font = latin?.getAttribute('typeface') ? helpers.resolveFont?.(latin.getAttribute('typeface')) || latin.getAttribute('typeface') : helpers.resolveFont?.(fontRef?.getAttribute('idx') === 'major' ? '+mj-lt' : '+mn-lt') || helpers.defaultFont;
    const body = child('bodyPr');
    if(body) {
      if(body.hasAttribute('rot')) { const rotation=Number(body.getAttribute('rot')); if(!Number.isFinite(rotation)) throw new RangeError('Invalid external chart body rotation'); style.rotationDegrees=rotation/60000; }
      style.bodyInsets = {};
      for(const [attribute,key,fallback] of [['lIns','left',91440],['rIns','right',91440],['tIns','top',45720],['bIns','bottom',45720]]) {
        const raw=body.hasAttribute(attribute)?Number(body.getAttribute(attribute)):fallback;
        if(!Number.isFinite(raw)) throw new RangeError('Invalid external chart text body inset');
        style.bodyInsets[key]=raw/9525;
      }
    }
    roles[element.localName] = style;
  }
  return roles;
}

// MS-ODRAWXML CT_ColorStyle: each variation applies to the whole base color list.
// Linear brightness endpoint selection needs a Microsoft application oracle.
export function chartColorStyleNode(root,index,doc) {
  if(!Number.isInteger(index)||index<0) throw new RangeError('Invalid external chart color index');
  if(root.getAttribute('meth')!=='cycle') throw new RangeError('External chart linear/preset color method requires verified brightness endpoints');
  const colorNames=new Set(['scrgbClr','srgbClr','hslClr','sysClr','schemeClr','prstClr']);
  const colors=Array.from(root.children).filter(n=>n.namespaceURI===STYLE_A&&colorNames.has(n.localName));
  if(!colors.length) throw new RangeError('External chart color style has no colors');
  const variations=Array.from(root.children).filter(n=>n.localName==='variation');
  const offset=index%(colors.length*Math.max(1,variations.length)),node=doc.importNode(colors[offset%colors.length],true);
  if(variations.length) for(const transform of Array.from(variations[Math.floor(offset/colors.length)].children)) node.appendChild(doc.importNode(transform,true));
  return node;
}
