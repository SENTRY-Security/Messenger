import { parseDrawingEffects, drawingEffectsExtent, renderDrawingEffects } from './pptx-effects.js';
import { renderEmfDib, UnsupportedMetafileError } from './pptx-metafile-dib.js';
import { renderWmfVector } from './pptx-metafile-wmf.js';
import { renderEmfVector } from './pptx-metafile-emf.js';
import { parseDrawingFill, createDrawingFillStyle, renderDrawingFill, drawBlipFill, readImageDpi } from './pptx-fills.js';
import { loadPptxFonts } from './pptx-fonts.js';
import { renderPptxChart, supportedChartExLayouts } from './pptx-charts.js';
import { BUILTIN_TABLE_STYLES } from './pptx-builtin-table-styles.js';
import { parseSlidePlayback, createPptxPlayback, createPptxAudioBus, createPptxMediaBus } from './pptx-playback.js';
import { parseGeometry, drawGeometry, clipGeometry, buildGeometryPaths, geometryFillStyle } from './pptx-geometry.js';
import { log } from '../../../core/log.js';
import { escapeHtml } from '../ui-utils.js';
import { t } from '/locales/index.js';

const JSZIP_URL = '/assets/libs/jszip.min.js';
let activePptxCleanup = null;

async function ensureJSZip() {
  if (typeof window.JSZip !== 'undefined') return window.JSZip;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSZIP_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('JSZip load failed'));
    document.head.appendChild(s);
  });
  return window.JSZip;
}

export function cleanupPptxViewer() {
  if (typeof activePptxCleanup === 'function') { try { activePptxCleanup(); } catch {} }
  activePptxCleanup = null;
}

function triggerDownload(url, filename) {
  const a = document.createElement('a'); a.href = url;
  if (filename) a.download = filename;
  a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove();
}

const PPTX_MIMES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12'
];
export function isPptxMime(ct) { if (!ct) return false; const l = ct.toLowerCase().split(';')[0].trim(); return PPTX_MIMES.some(m => l === m); }
export function isPptxFilename(name) { return name ? /\.(pptx|ppt|pptm)$/i.test(name) : false; }

// ═══════════════════════════════════════
// OOXML Parser — DOMParser based
// ═══════════════════════════════════════
const EMU_PX = 914400 / 96;
const emuToPx = (v) => Number(v) / EMU_PX;

// XML namespaces
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parseXml(xmlStr, capabilities = {}) {
  // Strict and Transitional OOXML carry equivalent structures in different namespaces.
  const normalized = xmlStr.replace(/http:\/\/purl\.oclc\.org\/ooxml\/drawingml\/main/g, NS_A)
    .replace(/http:\/\/purl\.oclc\.org\/ooxml\/presentationml\/main/g, NS_P)
    .replace(/http:\/\/purl\.oclc\.org\/ooxml\/officeDocument\/relationships/g, NS_R)
    .replace(/http:\/\/purl\.oclc\.org\/ooxml\/drawingml\/chart/g, 'http://schemas.openxmlformats.org/drawingml/2006/chart');
  const doc = new DOMParser().parseFromString(normalized, 'text/xml');
  const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const supported = new Set([NS_A, NS_P, NS_R, 'http://schemas.openxmlformats.org/drawingml/2006/chart']);
  // Process inner AlternateContent first and use only supported Choice namespaces.
  for (const alternate of [...doc.getElementsByTagNameNS(NS_MC, 'AlternateContent')].reverse()) {
    const choice = qnAll(alternate, NS_MC, 'Choice').find(el => {
      const required = (el.getAttribute('Requires') || '').trim().split(/\s+/).filter(Boolean);
      return required.length > 0 && required.every(prefix => {
        const namespace = el.lookupNamespaceURI(prefix);
        if (supported.has(namespace)) return true;
        if (namespace === NS_P14) return supportsPowerPoint2010Choice(el);
        if (!CHARTEX_CAPABILITY_NAMESPACES.has(namespace)) return false;
        const charts = dnAll(el, NS_CX, 'chart');
        return charts.length > 0 && charts.every(chart => capabilities.chartExRelationships?.has(chart.getAttributeNS(NS_R, 'id')));
      });
    });
    if (!choice) for (const candidate of qnAll(alternate, NS_MC, 'Choice')) {
      const requires=(candidate.getAttribute('Requires')||'').trim().split(/\s+/);
      if(requires.some(prefix=>candidate.lookupNamespaceURI(prefix)===NS_P14)){
        (doc._unsupportedExtensions ||= []).push({code:'unsupported-powerpoint-2010-choice',detail:[...candidate.getElementsByTagName('*')].filter(node=>node.namespaceURI===NS_P14).map(node=>node.localName)});
      }
    }
    if (!choice && capabilities.chartExRelationships) {
      const targets = qnAll(alternate, NS_MC, 'Choice').flatMap(el => dnAll(el, NS_CX, 'chart').map(chart => chart.getAttributeNS(NS_R, 'id'))).filter(Boolean);
      if (targets.length) (doc._chartFallbacks ||= []).push(...targets);
    }
    const branch = choice || qn(alternate, NS_MC, 'Fallback');
    if (branch) for (const node of [...branch.childNodes]) alternate.parentNode.insertBefore(node, alternate);
    alternate.remove();
  }
  return doc;
}


const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
function supportsPowerPoint2010Choice(choice) {
  const roots=[...choice.children];
  if(!roots.length||roots.some(node=>node.namespaceURI!==NS_P||!['timing','transition','pic'].includes(node.localName)))return false;
  const extensionNodes=[...choice.getElementsByTagName('*')].filter(node=>node.namespaceURI===NS_P14);
  const known=new Set(['media','trim','fade','bmkLst','bmk','bmkTgt']);
  if(extensionNodes.some(node=>!known.has(node.localName)))return false;
  for(const node of extensionNodes){
    const parent=node.parentElement;
    if(node.localName==='bmkTgt'&&(parent.namespaceURI!==NS_P||parent.localName!=='tgtEl'||parent.parentElement?.localName!=='cond'||parent.parentElement?.getAttribute('evt')!=='onMediaBookmark'))return false;
    if(node.localName==='bmk'&&(parent.namespaceURI!==NS_P14||parent.localName!=='bmkLst'))return false;
    if(['trim','fade','bmkLst'].includes(node.localName)&&(parent.namespaceURI!==NS_P14||parent.localName!=='media'))return false;
  }
  let knownDuration=false;
  for(const node of [...choice.getElementsByTagName('*')])for(const attribute of node.attributes){
    if(attribute.namespaceURI!==NS_P14)continue;
    if(node.namespaceURI===NS_P&&node.localName==='transition'&&attribute.localName==='dur')knownDuration=true;
    else return false;
  }
  return extensionNodes.length>0||knownDuration;
}
const NS_CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const CHARTEX_CAPABILITY_NAMESPACES = new Set([NS_CX, 'http://schemas.microsoft.com/office/drawing/2015/9/8/chartex', 'http://schemas.microsoft.com/office/drawing/2015/10/21/chartex']);
// Namespace recognition alone does not imply that every extension layout is implemented.
const IMPLEMENTED_CHARTEX_LAYOUTS = new Set(supportedChartExLayouts);
async function parseShapePartXml(xml, zip, relationships) {
  const chartExRelationships = new Set();
  for (const [id, target] of Object.entries(relationships || {})) {
    if (!/\/charts\//.test(target)) continue;
    const chartXml = await zip.file(resolvePath(target))?.async('string');
    if (!chartXml) continue;
    const chart = parseXml(chartXml);
    if (chart.documentElement.namespaceURI !== NS_CX) continue;
    const series = dnAll(chart, NS_CX, 'series');
    if (series.length && series.every(node => IMPLEMENTED_CHARTEX_LAYOUTS.has(node.getAttribute('layoutId')))) chartExRelationships.add(id);
  }
  const doc=parseXml(xml, { chartExRelationships });
  for(const failure of doc._unsupportedExtensions||[])log({pptxRenderingUnverified:failure});
  return doc;
}

// First direct child by namespace + localName
function qn(parent, ns, localName) {
  if (!parent) return null;
  for (const ch of parent.children) {
    if (ch.localName === localName && ch.namespaceURI === ns) return ch;
  }
  return null;
}

// All direct children by namespace + localName
function qnAll(parent, ns, localName) {
  if (!parent) return [];
  const result = [];
  for (const ch of parent.children) {
    if (ch.localName === localName && ch.namespaceURI === ns) result.push(ch);
  }
  return result;
}

// First descendant (any depth)
function dn(parent, ns, localName) {
  return parent?.getElementsByTagNameNS?.(ns, localName)?.[0] || null;
}

// All descendants as array
function dnAll(parent, ns, localName) {
  return [...(parent?.getElementsByTagNameNS?.(ns, localName) || [])];
}

// ── Theme ──
// Parsed once per file; holds real colors + fonts from theme1.xml
let documentFontAliases = {};
let documentFontMetrics = {};
let themeColors = {};
let themeFontMajor = 'Calibri';
let themeFontMinor = 'Calibri';
let themeFontFamilies = { major: {}, minor: {} };
let themeFormat = { fills: [], backgrounds: [], lines: [], effects: [], relationships: {} };
let themeBody = { attributes: {}, autoFitXml: null };

async function parseTheme(zip, slidePath = null) {
  themeColors = {}; themeFontMajor = 'Calibri'; themeFontMinor = 'Calibri'; themeFontFamilies = { major: {}, minor: {} }; themeFormat = { fills: [], backgrounds: [], lines: [], effects: [], relationships: {} }; themeBody = { attributes: {}, autoFitXml: null };
  try {
    let themePath = 'ppt/theme/theme1.xml', masterDoc = null, layoutDoc = null, overridePath = null;
    if (slidePath) {
      const slideRels = await zip.file(partRelsPath(slidePath))?.async('string');
      const layoutPath = relationshipPath(slideRels, slidePath, 'slideLayout');
      if (layoutPath) {
        const layoutXml = await zip.file(layoutPath)?.async('string');
        if (layoutXml) layoutDoc = parseXml(layoutXml);
        const layoutRels = await zip.file(partRelsPath(layoutPath))?.async('string');
        const masterPath = relationshipPath(layoutRels, layoutPath, 'slideMaster');
        overridePath = relationshipPath(layoutRels, layoutPath, 'themeOverride');
        if (masterPath) {
          const masterRels = await zip.file(partRelsPath(masterPath))?.async('string');
          themePath = relationshipPath(masterRels, masterPath, 'theme') || themePath;
          const masterXml = await zip.file(masterPath)?.async('string');
          if (masterXml) masterDoc = parseXml(masterXml);
        }
      }
      overridePath = relationshipPath(slideRels, slidePath, 'themeOverride') || overridePath;
    }
    const applyTheme = (doc, relationships) => {
      const clrScheme = dn(doc, NS_A, 'clrScheme');
      if (clrScheme) {
        for (const tag of ['dk1','dk2','lt1','lt2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink']) {
          const el = qn(clrScheme, NS_A, tag);
          const srgb = dn(el, NS_A, 'srgbClr'), sys = dn(el, NS_A, 'sysClr');
          if (srgb) themeColors[tag] = '#' + srgb.getAttribute('val');
          else if (sys) themeColors[tag] = '#' + (sys.getAttribute('lastClr') || '000000');
        }
      }
      const shapeDefault = dn(qn(doc.documentElement, NS_A, 'objectDefaults'), NS_A, 'spDef');
      const defaultBody = dn(shapeDefault, NS_A, 'bodyPr');
      if (defaultBody) themeBody = mergeBodyDefaults(themeBody, extractBodyDefaults(defaultBody));
      const format = dn(doc, NS_A, 'fmtScheme');
      if (format) for (const [key, tag] of [['fills','fillStyleLst'],['backgrounds','bgFillStyleLst'],['lines','lnStyleLst'],['effects','effectStyleLst']]) {
        const list = qn(format, NS_A, tag);
        if (list) { themeFormat[key] = [...list.children].map(el => new XMLSerializer().serializeToString(el)); themeFormat.relationships[key]=relationships; }
      }
      const major = dn(doc, NS_A, 'majorFont'), minor = dn(doc, NS_A, 'minorFont');
      if (major) themeFontMajor = qn(major, NS_A, 'latin')?.getAttribute('typeface') || 'Calibri';
      if (minor) themeFontMinor = qn(minor, NS_A, 'latin')?.getAttribute('typeface') || 'Calibri';
      for (const [name, element] of [['major', major], ['minor', minor]]) if (element) {
        const families = {};
        for (const tag of ['latin','ea','cs']) families[tag] = qn(element, NS_A, tag)?.getAttribute('typeface') || '';
        for (const font of qnAll(element, NS_A, 'font')) families[font.getAttribute('script')] = font.getAttribute('typeface');
        themeFontFamilies[name] = families;
      }
    };
    const themeXml = await zip.file(themePath)?.async('string');
    if (themeXml) applyTheme(parseXml(themeXml),await buildRelMapForPath(zip,themePath));
    const overrideXml = overridePath ? await zip.file(overridePath)?.async('string') : null;
    if (overrideXml) applyTheme(parseXml(overrideXml),await buildRelMapForPath(zip,overridePath));
    const defaultMap = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' };
    const map = { ...defaultMap };
    const applyMap = (el) => { if (el) for (const attr of el.attributes) map[attr.localName] = attr.value; };
    applyMap(dn(masterDoc, NS_P, 'clrMap'));
    const masterMap = { ...map };
    applyMap(dn(layoutDoc, NS_A, 'overrideClrMapping'));
    if (slidePath) {
      const slideXml = await zip.file(slidePath)?.async('string');
      if (slideXml) {
        const slide = parseXml(slideXml);
        if (dn(slide, NS_A, 'masterClrMapping')) Object.assign(map, masterMap);
        else applyMap(dn(slide, NS_A, 'overrideClrMapping'));
      }
    }
    const raw = { ...themeColors };
    for (const [from, to] of Object.entries(map)) if (raw[to]) themeColors[from] = raw[to];
  } catch {}
}
function snapshotTheme() {
  return { colors: { ...themeColors }, major: themeFontMajor, minor: themeFontMinor, families: structuredClone(themeFontFamilies), format: structuredClone(themeFormat), body: structuredClone(themeBody), fontAliases: { ...documentFontAliases }, fontMetrics: structuredClone(documentFontMetrics) };
}
function restoreTheme(theme) {
  if (!theme) return;
  documentFontAliases = theme.fontAliases || {}; documentFontMetrics = theme.fontMetrics || {};
  themeColors = theme.colors; themeFontMajor = theme.major; themeFontMinor = theme.minor; themeFontFamilies = theme.families || { major: {}, minor: {} }; themeFormat = theme.format || { fills: [], backgrounds: [], lines: [], effects: [] }; themeBody = theme.body || { attributes: {}, autoFitXml: null };
}

// Common font name → CSS web-safe fallback
const FONT_MAP = {
  'Calibri': '"Calibri","Pptx Carlito",sans-serif',
  'Arial': 'Arial,sans-serif',
  'Times New Roman': '"Times New Roman",serif',
  'Verdana': 'Verdana,sans-serif',
  'Georgia': 'Georgia,serif',
  'Tahoma': 'Tahoma,sans-serif',
  'Trebuchet MS': '"Trebuchet MS",sans-serif',
  'Courier New': '"Courier New",monospace',
  'Segoe UI': '"Segoe UI",-apple-system,sans-serif',
  'Meiryo': '"Meiryo","Hiragino Sans",sans-serif',
  'Microsoft JhengHei': '"Microsoft JhengHei","PingFang TC",sans-serif',
  'Microsoft YaHei': '"Microsoft YaHei","PingFang SC",sans-serif',
  '微軟正黑體': '"Microsoft JhengHei","PingFang TC",sans-serif',
  '微软雅黑': '"Microsoft YaHei","PingFang SC",sans-serif',
};

function resolveFont(rawFont, language = '', script = 'latin') {
  if (!rawFont) return null;
  const match = rawFont.match(/^\+(mj|mn)-(lt|ea|cs)$/);
  if (match) {
    const major = match[1] === 'mj', family = themeFontFamilies[major ? 'major' : 'minor'];
    const region = (language || '').toLowerCase();
    const langScript = region.startsWith('zh-tw') || region.startsWith('zh-hk') || region.includes('hant') ? 'Hant' : region.startsWith('zh') ? 'Hans' : region.startsWith('ja') ? 'Jpan' : region.startsWith('ko') ? 'Hang' : region.startsWith('ar') ? 'Arab' : region.startsWith('he') ? 'Hebr' : region.startsWith('hi') ? 'Deva' : region.startsWith('th') ? 'Thai' : null;
    const type = match[2] === 'lt' ? 'latin' : match[2];
    rawFont = family[type] || family[langScript || script] || (major ? themeFontMajor : themeFontMinor);
  }
  const embeddedName = Object.keys(documentFontAliases).find(name => name.toLowerCase() === rawFont.toLowerCase());
  if (embeddedName) return `"${documentFontAliases[embeddedName]}",sans-serif`;
  const mappedName = Object.keys(FONT_MAP).find(name => name.toLowerCase() === rawFont.toLowerCase());
  return FONT_MAP[mappedName] || `"${rawFont.replaceAll('"', '')}",sans-serif`;
}
function percentage(value, fallback = 0) {
  if (value == null) return fallback;
  return String(value).endsWith('%') ? parseFloat(value) / 100 : Number(value) / 100000;
}

// ── Color ──
function parseColor(el) {
  if (!el) return null;
  const colorTypes = ['srgbClr','scrgbClr','hslClr','schemeClr','sysClr','prstClr'];
  const node = colorTypes.includes(el.localName) ? el : [...el.children].find(child => child.namespaceURI === NS_A && colorTypes.includes(child.localName)) || [...el.getElementsByTagName('*')].find(child => child.namespaceURI === NS_A && colorTypes.includes(child.localName));
  if (!node) return null;
  const clamp = value => Math.max(0, Math.min(1, value));
  const linearize = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const encode = value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  let rgb, alpha = 1;
  if (node.localName === 'scrgbClr') rgb = ['r','g','b'].map(key => encode(clamp(percentage(node.getAttribute(key)))));
  else if (node.localName === 'hslClr') {
    const hue = Number(node.getAttribute('hue') || 0) / 60000 / 360, saturation = percentage(node.getAttribute('sat')), luminance = percentage(node.getAttribute('lum'));
    const channel = offset => { const k = ((hue * 12 + offset) % 12 + 12) % 12; return luminance - saturation * Math.min(luminance, 1-luminance) * Math.max(-1,Math.min(k-3,9-k,1)); };
    rgb = [channel(0),channel(8),channel(4)];
  } else {
    let value = node.localName === 'schemeClr' ? themeColors[node.getAttribute('val')] : node.localName === 'sysClr' ? '#' + (node.getAttribute('lastClr') || '000000') : node.localName === 'srgbClr' ? '#' + node.getAttribute('val') : null;
    if (node.localName === 'prstClr') {
      const names = { dk:'dark', lt:'light', med:'medium' };
      const name = (node.getAttribute('val') || '').replace(/^(dk|lt|med)(?=[A-Z])/, prefix => names[prefix]);
      const context = document.createElement('canvas').getContext('2d'); context.fillStyle = '#010203'; context.fillStyle = name; value = name === 'transparent' ? '#ffffff' : context.fillStyle;
      if (value === '#010203') throw new Error('Unknown DrawingML preset color: ' + name);
    }
    if (!value) return null;
    if (value.startsWith('rgba')) { const components = value.match(/[\d.]+/g).map(Number); rgb = components.slice(0,3).map(v=>v/255); alpha = components[3] ?? 1; }
    else if (/^#[0-9a-f]{6}$/i.test(value)) rgb = [1,3,5].map(i => parseInt(value.slice(i,i+2),16)/255);
    else throw new Error('Unsupported DrawingML color value: ' + value);
  }
  for (const transform of node.children) {
    const tag = transform.localName, value = percentage(transform.getAttribute('val'));
    if (tag === 'alpha') alpha = value;
    else if (tag === 'alphaMod') alpha *= value;
    else if (tag === 'alphaOff') alpha += value;
    else if (tag === 'tint' || tag === 'shade') rgb = rgb.map(channel => encode(clamp(tag === 'tint' ? 1 - (1-linearize(channel)) * value : linearize(channel) * value)));
    else if (['lum','lumMod','lumOff','sat','satMod','satOff','hue','hueMod','hueOff','comp'].includes(tag)) {
      const maximum = Math.max(...rgb), minimum = Math.min(...rgb), delta = maximum-minimum;
      let l = (maximum+minimum)/2, saturation = delta ? delta/(1-Math.abs(2*l-1)) : 0, hue = 0;
      if (delta) hue = (maximum === rgb[0] ? (rgb[1]-rgb[2])/delta : maximum === rgb[1] ? (rgb[2]-rgb[0])/delta+2 : (rgb[0]-rgb[1])/delta+4)/6;
      if (tag.startsWith('lum')) l = clamp(tag === 'lum' ? value : tag === 'lumMod' ? l*value : l+value);
      if (tag.startsWith('sat')) saturation = clamp(tag === 'sat' ? value : tag === 'satMod' ? saturation*value : saturation+value);
      if (tag.startsWith('hue')) { const angle = Number(transform.getAttribute('val')) / 60000 / 360; hue = tag === 'hue' ? angle : tag === 'hueMod' ? hue*value : hue+angle; }
      if (tag === 'comp') hue += 0.5;
      const channel = offset => { const k = ((hue*12+offset)%12+12)%12; return l-saturation*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1)); };
      rgb = [channel(0),channel(8),channel(4)];
    } else if (['red','green','blue','redMod','greenMod','blueMod','redOff','greenOff','blueOff'].includes(tag)) {
      const index = tag.startsWith('red') ? 0 : tag.startsWith('green') ? 1 : 2;
      const linear = linearize(rgb[index]); rgb[index] = encode(clamp(tag.endsWith('Mod') ? linear*value : tag.endsWith('Off') ? linear+value : value));
    } else if (tag === 'inv') rgb = rgb.map(channel => encode(1-linearize(channel)));
    else if (tag === 'gamma') rgb = rgb.map(channel => encode(clamp(channel)));
    else if (tag === 'invGamma') rgb = rgb.map(channel => linearize(clamp(channel)));
    else if (tag === 'gray') { const gray = encode(rgb.reduce((sum,channel,index)=>sum+linearize(channel)*[0.2126,0.7152,0.0722][index],0)); rgb = [gray,gray,gray]; }
    else throw new Error('DrawingML color transformation needs implementation: ' + tag);
    alpha = clamp(alpha); rgb = rgb.map(clamp);
  }
  const channels = rgb.map(channel => Math.round(clamp(channel)*255));
  return alpha < 1 ? `rgba(${channels.join(',')},${alpha})` : '#' + channels.map(channel=>channel.toString(16).padStart(2,'0')).join('');
}

function adjustLuminance(hex, mod, off) {
  // Simple luminance adjustment: convert to HSL, modify, convert back
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  l = Math.max(0, Math.min(1, l * mod + off));
  // HSL → RGB
  const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; };
  let rr, gg, bb;
  if (s === 0) { rr = gg = bb = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h + 1/3); gg = hue2rgb(p, q, h); bb = hue2rgb(p, q, h - 1/3);
  }
  return '#' + [rr, gg, bb].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

function parseFill(el) {
  if (!el) return null;
  if (qn(el, NS_A, 'noFill')) return null;
  const solid = qn(el, NS_A, 'solidFill');
  if (solid) return parseColor(solid);
  // Gradient fill → CSS linear-gradient with correct angle from <a:lin ang="...">
  const gradFill = qn(el, NS_A, 'gradFill');
  if (gradFill) {
    const stops = [];
    for (const gs of dnAll(gradFill, NS_A, 'gs')) {
      const pos = Number(gs.getAttribute('pos') || '0') / 1000;
      const c = parseColor(gs);
      if (c) stops.push(`${c} ${pos}%`);
    }
    // Parse gradient angle: OOXML ang is in 60000ths of a degree, convert to CSS degrees
    // OOXML: 0=left→right, 5400000=top→bottom; CSS: 0deg=bottom→top, 90deg=left→right
    const lin = dn(gradFill, NS_A, 'lin');
    const ooAngle = lin ? Number(lin.getAttribute('ang') || '0') / 60000 : 270;
    const cssAngle = ((ooAngle + 90) % 360 + 360) % 360;
    if (stops.length >= 2) return `linear-gradient(${cssAngle}deg,${stops.join(',')})`;
    if (stops.length === 1) return stops[0].split(' ')[0];
  }
  return null;
}

// Style-matrix references use phClr as the caller-selected color.
function captureColorParser() {
  const colors={...themeColors};
  return element=>{const previous=themeColors;themeColors=colors;try{return parseColor(element);}finally{themeColors=previous;}};
}

function resolveThemeReference(reference, line = false, drawing = false) {
  if (!reference) return null;
  const index = Number(reference.getAttribute('idx') || 0);
  if (!index) return null;
  const kind=line?'lines':index>=1001?'backgrounds':'fills';
  const list=themeFormat[kind];
  const xml = list[line || index < 1001 ? index - 1 : index - 1001];
  if (!xml) return null;
  const color = parseColor(reference), previous = themeColors.phClr;
  themeColors.phClr = color;
  try {
    const element = parseXml(xml).documentElement;
    const container = element.ownerDocument.createElementNS(NS_A, 'a:spPr');
    container.appendChild(element);
    return line ? parseLine(container) : drawing ? parseDrawingFill(container, { parseColor:captureColorParser(), renderingProfile:'office', resolveRelationship:id=>themeFormat.relationships?.[kind]?.[id] }) : parseFill(container);
  } finally {
    if (previous === undefined) delete themeColors.phClr;
    else themeColors.phClr = previous;
  }
}

// ── Line / Border ──
function parseLine(el) {
  const ln = qn(el, NS_A, 'ln');
  if (!ln) return null;
  const w = ln.getAttribute('w');
  const color = parseFill(ln);
  if (!color || color === 'none') return null;
  // Dash style
  const prstDash = dn(ln, NS_A, 'prstDash');
  const dashVal = prstDash ? prstDash.getAttribute('val') : null;
  let dash = null;
  if (dashVal) {
    const dashMap = {
      'dot': [2, 4], 'sysDot': [1, 3], 'dash': [6, 4], 'sysDash': [4, 3],
      'dashDot': [6, 3, 2, 3], 'lgDash': [10, 4], 'lgDashDot': [10, 3, 2, 3],
      'lgDashDotDot': [10, 3, 2, 3, 2, 3]
    };
    dash = dashMap[dashVal] || null;
  }
  const cap = ln.getAttribute('cap'); // flat, rnd, sq
  return {
    width: w ? emuToPx(w) : 1,
    color: typeof color === 'string' ? color : '#94a3b8',
    dash,
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt'
  };
}

function optionalBool(el, attr) {
  if (!el?.hasAttribute(attr)) return null;
  return ['1', 'true', 'on'].includes(el.getAttribute(attr));
}
function optionalUnderline(el) {
  if (!el?.hasAttribute('u')) return null;
  return el.getAttribute('u') !== 'none';
}
function optionalStrike(el) {
  if (!el?.hasAttribute('strike')) return null;
  return el.getAttribute('strike') !== 'noStrike';
}

// ── Text Run ──
function parseTextDrawingEffects(properties) {
  const explicit=qn(properties,NS_A,'effectLst')||qn(properties,NS_A,'effectDag');
  return explicit?parseDrawingEffects(explicit,{parseColor:captureColorParser(),renderingProfile:'office'}):null;
}
function parseTextRun(runEl) {
  const tEl = dn(runEl, NS_A, 't');
  const text = tEl ? tEl.textContent : '';
  if (!text) return null;
  const rPr = dn(runEl, NS_A, 'rPr');
  const sz = rPr?.getAttribute('sz');
  const fontSize = sz ? Number(sz) / 100 : null;
  const color = parseColor(qn(rPr, NS_A, 'solidFill'));
  const bold = optionalBool(rPr, 'b');
  const italic = optionalBool(rPr, 'i');
  const u = rPr?.getAttribute('u');
  const underline = optionalUnderline(rPr);
  const strike = optionalStrike(rPr);
  // Font
  const latin = rPr ? qn(rPr, NS_A, 'latin') : null;
  const ea = rPr ? qn(rPr, NS_A, 'ea') : null;
  const fontEa = ea?.getAttribute('typeface') || null;
  const fontCs = qn(rPr, NS_A, 'cs')?.getAttribute('typeface') || null;
  const language = rPr?.getAttribute('lang') || null;
  const font = latin ? latin.getAttribute('typeface') : (ea ? ea.getAttribute('typeface') : null);
  // Character spacing (spc in 1/100 pt)
  const spc = rPr?.getAttribute('spc');
  const letterSpacing = spc ? Number(spc) / 100 : null;
  // Superscript/subscript (baseline in %)
  const baselineRaw = rPr?.getAttribute('baseline');
  const baseline = baselineRaw != null ? percentage(baselineRaw) * 100 : null;
  // Hyperlink
  const hlinkClick = dn(runEl, NS_A, 'hlinkClick');
  const hlinkRid = hlinkClick ? (hlinkClick.getAttributeNS(NS_R, 'id') || hlinkClick.getAttribute('r:id')) : null;
  const effects = parseTextDrawingEffects(rPr);
  return { text, effects, fontSize, color, colorExplicit:color!=null||!!hlinkRid, bold, italic, underline, strike, font, fontEa, fontCs, language, letterSpacing, baseline, hlinkRid };
}

// ── Paragraph ──
function parseParagraph(pEl) {
  // Process children in document order to preserve run/break sequence
  const runs = [];
  for (const child of pEl.children) {
    if (child.namespaceURI !== NS_A) continue;
    if (child.localName === 'r' || child.localName === 'fld') {
      const run = parseTextRun(child);
      if (run) runs.push(run);
    } else if (child.localName === 'br') {
      runs.push({ text: '\n', fontSize: null, color: null, bold: false, italic: false, underline: false, strike: false, font: null, letterSpacing: null, baseline: null, hlinkRid: null });
    }
  }

  const pPr = qn(pEl, NS_A, 'pPr');
  let align = 'left';
  if (pPr) {
    const algn = pPr.getAttribute('algn');
    if (algn === 'ctr') align = 'center';
    else if (algn === 'r') align = 'right';
    else if (algn === 'just') align = 'justify';
  }
  // Bullet
  let bullet = null;
  if (pPr && !qn(pPr, NS_A, 'buNone')) {
    const buChar = qn(pPr, NS_A, 'buChar');
    if (buChar) bullet = buChar.getAttribute('char');
    else if (qn(pPr, NS_A, 'buAutoNum')) bullet = 'auto';
  }
  const buAutoNum = pPr ? qn(pPr, NS_A, 'buAutoNum') : null;
  const bulletStart = buAutoNum?.hasAttribute('startAt') ? Number(buAutoNum.getAttribute('startAt')) : null;
  const bulletType = buAutoNum?.getAttribute('type') || 'arabicPeriod';
  // Bullet color
  let bulletColor = null;
  const buClr = pPr ? qn(pPr, NS_A, 'buClr') : null;
  if (buClr) bulletColor = parseColor(buClr);
  // Indent level
  const lvl = pPr?.getAttribute('lvl');
  const indent = lvl ? parseInt(lvl) : 0;
  const eastAsianLineBreak = optionalBool(pPr, 'eaLnBrk') !== false;
  const hangingPunctuation = optionalBool(pPr, 'hangingPunct') === true;
  // Left margin (marL in EMU)
  const marL = pPr?.getAttribute('marL');
  const marginLeft = marL != null ? emuToPx(marL) : null;
  const hangingIndent = pPr?.hasAttribute('indent') ? emuToPx(pPr.getAttribute('indent')) : null;
  const explicitBullet = !!pPr && [...pPr.children].some(ch=>['buNone','buChar','buAutoNum'].includes(ch.localName));
  const bulletFont = qn(pPr, NS_A, 'buFont')?.getAttribute('typeface') || null;
  const bulletSizePoints = qn(pPr, NS_A, 'buSzPts')?.hasAttribute('val') ? Number(qn(pPr, NS_A, 'buSzPts').getAttribute('val'))/100 : null;
  const bulletSizePercent = qn(pPr, NS_A, 'buSzPct') ? percentage(qn(pPr, NS_A, 'buSzPct').getAttribute('val'),1) : null;
  // Line spacing
  const lnSpc = pPr ? qn(pPr, NS_A, 'lnSpc') : null;
  const spcPct = lnSpc ? dn(lnSpc, NS_A, 'spcPct') : null;
  const lineHeight = spcPct ? percentage(spcPct.getAttribute('val')) : null;
  const linePoints = lnSpc ? qn(lnSpc, NS_A, 'spcPts') : null;
  const lineSpacingPoints = linePoints ? Number(linePoints.getAttribute('val') || 0) / 100 : null;
  // Space before/after
  const spcBef = pPr ? qn(pPr, NS_A, 'spcBef') : null;
  const spcBefPts = spcBef ? dn(spcBef, NS_A, 'spcPts') : null;
  const beforePercent = qn(spcBef, NS_A, 'spcPct');
  const spaceBeforePct = beforePercent ? percentage(beforePercent.getAttribute('val')) : null;
  const spaceBefore = spcBefPts ? Number(spcBefPts.getAttribute('val') || '0') / 100 : spaceBeforePct === 0 ? 0 : null;
  const spcAft = pPr ? qn(pPr, NS_A, 'spcAft') : null;
  const spcAftPts = spcAft ? dn(spcAft, NS_A, 'spcPts') : null;
  const afterPercent = qn(spcAft, NS_A, 'spcPct');
  const spaceAfterPct = afterPercent ? percentage(afterPercent.getAttribute('val')) : null;
  const spaceAfter = spcAftPts ? Number(spcAftPts.getAttribute('val') || '0') / 100 : spaceAfterPct === 0 ? 0 : null;
  // Default run properties (defRPr) — full style fallback for runs without explicit rPr
  const defRPr = pPr ? qn(pPr, NS_A, 'defRPr') : null;
  const defSz = defRPr?.getAttribute('sz');
  const defaultFontSize = defSz ? Number(defSz) / 100 : null;
  const defaultColor = parseColor(qn(defRPr, NS_A, 'solidFill'));
  const defaultBold = optionalBool(defRPr, 'b');
  const defaultItalic = optionalBool(defRPr, 'i');
  const defU = defRPr?.getAttribute('u');
  const defaultUnderline = optionalUnderline(defRPr);
  const defaultStrike = optionalStrike(defRPr);
  const defLatin = defRPr ? qn(defRPr, NS_A, 'latin') : null;
  const defEa = defRPr ? qn(defRPr, NS_A, 'ea') : null;
  const defaultFont = defLatin ? defLatin.getAttribute('typeface') : (defEa ? defEa.getAttribute('typeface') : null);
  // endParaRPr — used when paragraph is otherwise empty (acts as default)
  const endParaRPr = qn(pEl, NS_A, 'endParaRPr');
  const endSz = endParaRPr?.getAttribute('sz');
  const endFontSize = endSz ? Number(endSz) / 100 : null;
  const endColor = parseColor(qn(endParaRPr, NS_A, 'solidFill'));
  return { runs, align, explicitAlign: !!pPr?.hasAttribute('algn'), bullet, explicitBullet, bulletStart, bulletType, bulletColor, bulletFont, bulletSizePoints, bulletSizePercent, indent, marginLeft, hangingIndent, eastAsianLineBreak, hangingPunctuation, lineHeight, lineSpacingPoints, spaceBefore, spaceAfter, spaceBeforePct, spaceAfterPct,
    defaultFontSize: defaultFontSize || endFontSize, defaultColor: defaultColor || endColor, defaultColorExplicit:defaultColor!=null||endColor!=null,
    defaultEffects:parseTextDrawingEffects(defRPr) ?? parseTextDrawingEffects(endParaRPr),
    defaultBold, defaultItalic, defaultUnderline, defaultStrike, defaultFont,
    defaultFontEa: defEa?.getAttribute('typeface') || null, defaultFontCs: qn(defRPr, NS_A, 'cs')?.getAttribute('typeface') || null, defaultLanguage: defRPr?.getAttribute('lang') || null };
}

// ── Shape position/size ──
function parseTransform(el) {
  // a:xfrm (inside p:spPr) or p:xfrm (inside p:graphicFrame)
  const xfrm = dn(el, NS_A, 'xfrm') || dn(el, NS_P, 'xfrm');
  if (!xfrm) return { x: 0, y: 0, w: 0, h: 0, rot: 0 };
  const off = qn(xfrm, NS_A, 'off');
  const ext = qn(xfrm, NS_A, 'ext');
  const rot = xfrm.getAttribute('rot');
  return {
    x: off ? emuToPx(off.getAttribute('x') || '0') : 0,
    y: off ? emuToPx(off.getAttribute('y') || '0') : 0,
    w: ext ? emuToPx(ext.getAttribute('cx') || '0') : 0,
    h: ext ? emuToPx(ext.getAttribute('cy') || '0') : 0,
    rot: rot ? Number(rot) / 60000 : 0,
    flipH: optionalBool(xfrm, 'flipH') === true,
    flipV: optionalBool(xfrm, 'flipV') === true
  };
}

// ── Table ──
function parseTable(tblEl,relMap={}) {
  // Parse column widths from tblGrid
  const colWidths = [];
  const tblGrid = qn(tblEl, NS_A, 'tblGrid');
  if (tblGrid) {
    for (const gc of qnAll(tblGrid, NS_A, 'gridCol')) {
      colWidths.push(emuToPx(gc.getAttribute('w') || '0'));
    }
  }
  const rowHeights = [];
  const rows = [];
  for (const tr of qnAll(tblEl, NS_A, 'tr')) {
    rowHeights.push(emuToPx(tr.getAttribute('h') || '0'));
    const cells = [];
    for (const tc of qnAll(tr, NS_A, 'tc')) {
      const paragraphs = [];
      const txBody = qn(tc, NS_A, 'txBody');
      if (txBody) {
        for (const p of qnAll(txBody, NS_A, 'p')) paragraphs.push(parseParagraph(p));
      }
      const tcPr = qn(tc, NS_A, 'tcPr');
      // Cell fill: use direct child lookup (qn) to avoid picking up border fills from lnB/lnT/lnL/lnR
      const directSolid = tcPr ? qn(tcPr, NS_A, 'solidFill') : null;
      const fill = parseFill(tcPr);
      // Per-side border colors and widths
      const borders = {};
      if (tcPr) {
        for (const [side, key] of [['lnB','b'],['lnT','t'],['lnL','l'],['lnR','r']]) {
          const ln = qn(tcPr, NS_A, side);
          if (ln) {
            const c = parseFill(ln);
            const w = ln.getAttribute('w');
            borders[key] = qn(ln, NS_A, 'noFill') ? null : { color: c, width: w ? emuToPx(w) : 1 };
          }
        }
      }
      const gridSpan = tc.getAttribute('gridSpan');
      const rowSpan = tc.getAttribute('rowSpan');
      const hMerge = optionalBool(tc, 'hMerge') === true;
      const vMerge = optionalBool(tc, 'vMerge') === true;
      const margin = { l: emuToPx(tcPr?.getAttribute('marL') ?? 91440), r: emuToPx(tcPr?.getAttribute('marR') ?? 91440),
        t: emuToPx(tcPr?.getAttribute('marT') ?? 45720), b: emuToPx(tcPr?.getAttribute('marB') ?? 45720) };
      const anchor = tcPr?.getAttribute('anchor') || 't';
      cells.push({ paragraphs, fill, drawingFill:parseDrawingFill(tcPr,{parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>relMap[id]}), hasFill: !!tcPr && [...tcPr.children].some(el => ['solidFill','gradFill','noFill','pattFill','blipFill','grpFill'].includes(el.localName)), borders, margin, anchor, gridSpan: gridSpan ? parseInt(gridSpan) : 1, rowSpan: rowSpan ? parseInt(rowSpan) : 1, hMerge, vMerge });
    }
    rows.push(cells);
  }
  const properties = qn(tblEl, NS_A, 'tblPr');
  const styled=applyTableStyle(rows,properties)||{};
  const ownBackground=parseDrawingFill(properties,{parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>relMap[id]});
  const tableBackground=ownBackground?parseFill(properties):styled.color;
  const tableDrawingFill=ownBackground||styled.drawingFill;
  return { tableBackground, tableDrawingFill, rows, colWidths, rowHeights, tableStyleId: qn(properties, NS_A, 'tableStyleId')?.textContent || defaultTableStyleId };
}

let documentTableStyles = new Map();
let defaultTableStyleId = null;
async function loadTableStyles(zip) {
  documentTableStyles = new Map(Object.entries(BUILTIN_TABLE_STYLES).map(([id, xml]) => [id.toUpperCase(), parseXml(xml).documentElement])); defaultTableStyleId = null;
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  const path = relationshipPath(rels, 'ppt/presentation.xml', 'tableStyles') || 'ppt/tableStyles.xml';
  const xml = await zip.file(path)?.async('string');
  if (!xml) return;
  const doc = parseXml(xml);doc._pptxRelationships=await buildRelMapForPath(zip,path); defaultTableStyleId = doc.documentElement.getAttribute('def');
  for (const style of dnAll(doc, NS_A, 'tblStyle')) documentTableStyles.set(style.getAttribute('styleId').toUpperCase(), style);
}
function tableStyleRegion(element) {
  if (!element) return {};
  const cell = qn(element, NS_A, 'tcStyle'), tx = qn(element, NS_A, 'tcTxStyle');
  const fill = qn(cell, NS_A, 'fill');
  const borders = {};
  const border = qn(cell, NS_A, 'tcBdr');
  for (const [tag, key] of [['left','l'],['right','r'],['top','t'],['bottom','b'],['insideH','insideH'],['insideV','insideV']]) {
    const side = qn(border, NS_A, tag), line = qn(side, NS_A, 'ln'), reference = qn(side, NS_A, 'lnRef');
    if (line) borders[key] = qn(line, NS_A, 'noFill') ? null : { color: parseFill(line), width: emuToPx(line.getAttribute('w') ?? 12700) };
    else if (reference) borders[key] = resolveThemeReference(reference, true);
  }
  const font = qn(tx, NS_A, 'font'), fontRef = qn(tx, NS_A, 'fontRef');
  const fillReference=qn(cell,NS_A,'fillRef');
  const drawingFill=fill?parseDrawingFill(fill,{parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>element.ownerDocument._pptxRelationships?.[id]}):fillReference?resolveThemeReference(fillReference,false,true):undefined;
  return { drawingFill, fill: fill ? parseFill(fill) : fillReference ? resolveThemeReference(fillReference) : undefined, borders,
    text: { bold: optionalBool(tx, 'b'), italic: optionalBool(tx, 'i'),
      color: parseColor(tx), font: font?.getAttribute('typeface') || (fontRef ? (fontRef.getAttribute('idx') === 'major' ? '+mj-lt' : '+mn-lt') : null) } };
}
function applyTableStyle(rows, properties) {
  const styleId = qn(properties, NS_A, 'tableStyleId')?.textContent || defaultTableStyleId;
  const style = documentTableStyles.get(styleId?.trim().toUpperCase()); if (!style || !rows.length) return;
  const tableBg=qn(style,NS_A,'tblBg'),tableBgRef=qn(tableBg,NS_A,'fillRef');
  const tableBackground = parseFill(tableBg) || resolveThemeReference(tableBgRef);
  const backgroundDrawingFill=parseDrawingFill(tableBg,{parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>style.ownerDocument._pptxRelationships?.[id]})||resolveThemeReference(tableBgRef,false,true);
  const flags = Object.fromEntries(['firstRow','lastRow','firstCol','lastCol','bandRow','bandCol'].map(key=>[key,optionalBool(properties,key)===true]));
  const rowCount = rows.length, colCount = Math.max(...rows.map(row=>row.length));
  for (let ri=0; ri<rowCount; ri++) for (let ci=0; ci<rows[ri].length; ci++) {
    const cell = rows[ri][ci], regions = ['wholeTbl'];
    if (flags.bandRow && !(flags.firstRow && ri===0) && !(flags.lastRow && ri===rowCount-1)) regions.push((ri-(flags.firstRow?1:0))%2===0?'band1H':'band2H');
    if (flags.bandCol && !(flags.firstCol && ci===0) && !(flags.lastCol && ci===colCount-1)) regions.push((ci-(flags.firstCol?1:0))%2===0?'band1V':'band2V');
    if (flags.lastCol && ci===colCount-1) regions.push('lastCol');
    if (flags.firstCol && ci===0) regions.push('firstCol');
    if (flags.lastRow && ri===rowCount-1) { regions.push('lastRow'); if(flags.lastCol&&ci===colCount-1)regions.push('seCell'); if(flags.firstCol&&ci===0)regions.push('swCell'); }
    if (flags.firstRow && ri===0) { regions.push('firstRow'); if(flags.lastCol&&ci===colCount-1)regions.push('neCell'); if(flags.firstCol&&ci===0)regions.push('nwCell'); }
    const merged = { borders:{}, text:{} };
    for(const region of regions) {
      const definition=tableStyleRegion(qn(style, NS_A, region));
      if(definition.fill!==undefined)merged.fill=definition.fill;
      if(definition.drawingFill!==undefined)merged.drawingFill=definition.drawingFill;
      const inherited = { ...definition.borders };
      if (ri > 0 && inherited.insideH !== undefined) inherited.t = inherited.insideH;
      if (ri < rowCount - 1 && inherited.insideH !== undefined) inherited.b = inherited.insideH;
      if (ci > 0 && inherited.insideV !== undefined) inherited.l = inherited.insideV;
      if (ci < colCount - 1 && inherited.insideV !== undefined) inherited.r = inherited.insideV;
      Object.assign(merged.borders, inherited);
      for(const [key,value]of Object.entries(definition.text||{}))if(value!=null)merged.text[key]=value;
    }
    if(!cell.hasFill && merged.fill!==undefined)cell.fill=merged.fill;
    if(!cell.hasFill && merged.drawingFill!==undefined)cell.drawingFill=merged.drawingFill;
    cell.borders={...merged.borders,...cell.borders};
    for(const para of cell.paragraphs) for(const [key,value] of Object.entries(merged.text)) {
      const property='default'+key[0].toUpperCase()+key.slice(1);
      if(para[property]==null)para[property]=value;
    }
  }
  return {color:tableBackground,drawingFill:backgroundDrawingFill};
}

// ── Shape parser ──
function parseShapeShadow(properties) {
  const shadow=qn(qn(properties,NS_A,'effectLst'),NS_A,'outerShdw');
  // MS-OI29500 2.1.1303: Office ignores non-100% outer shadow scaling.
  if(!shadow||percentage(shadow.getAttribute('sx'),1)!==1||percentage(shadow.getAttribute('sy'),1)!==1)return null;
  const distance=emuToPx(shadow.getAttribute('dist')||0),angle=Number(shadow.getAttribute('dir')||0)/60000*Math.PI/180;
  return {blur:emuToPx(shadow.getAttribute('blurRad')||0),dx:distance*Math.cos(angle),dy:distance*Math.sin(angle),color:parseColor(shadow)||'#000000'};
}

function parseShapeDrawingEffects(element, relationships = {}) {
  const properties = qn(element, NS_P, 'spPr');
  const explicit = qn(properties, NS_A, 'effectLst') || qn(properties, NS_A, 'effectDag');
  if (explicit) return parseDrawingEffects(explicit, {parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>relationships[id]});
  const reference = qn(qn(element, NS_P, 'style'), NS_A, 'effectRef');
  if (!reference) return null;
  const index = Number(reference.getAttribute('idx'));
  if (!Number.isInteger(index) || index < 0) throw new Error('invalid-effect-style-index');
  if (!index) return [];
  const xml = themeFormat.effects[index - 1];
  if (!xml) throw new Error('missing-theme-effect-style:' + index);
  const previous = themeColors.phClr;
  themeColors.phClr = parseColor(reference);
  try {return parseDrawingEffects(parseXml(xml).documentElement, {parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>themeFormat.relationships?.effects?.[id]});}
  finally {if(previous===undefined)delete themeColors.phClr;else themeColors.phClr=previous;}
}

function parseShape(spEl, relMap, phStyles) {
  const tf = parseTransform(spEl);
  tf.sourceId = dn(spEl, NS_P, 'cNvPr')?.getAttribute('id') || null;
  tf.geometry = parseGeometry(qn(spEl, NS_P, 'spPr'));
  tf.drawingFill = parseDrawingFill(qn(spEl, NS_P, 'spPr'), { parseColor:captureColorParser(), renderingProfile:'office', resolveRelationship:id=>relMap[id] });
  const hasOwnTransform = !!(dn(spEl, NS_A, 'xfrm') || dn(spEl, NS_P, 'xfrm'));
  // Placeholder type from nvSpPr/nvPr/ph
  const phInfo = extractPhFromShape(spEl);
  // Each xfrm component inherits separately; an explicit rotation alone does
  // not remove the layout extent. Pictures and graphic frames use nvPr too.
  const placeholderDefaults=resolvePlaceholderDefaults(phStyles,phInfo);
  tf.drawingEffects = parseShapeDrawingEffects(spEl, relMap) ?? placeholderDefaults?._effects?.models ?? [];
  const phTransform=placeholderDefaults?._transform;
  const ownTransform=qn(qn(spEl,NS_P,'spPr'),NS_A,'xfrm')||qn(spEl,NS_P,'xfrm');
  if(phTransform) {
    if(!qn(ownTransform,NS_A,'off')){tf.x=phTransform.x;tf.y=phTransform.y;}
    if(!qn(ownTransform,NS_A,'ext')){tf.w=phTransform.w;tf.h=phTransform.h;tf.geometry.coordinateWidth=tf.w*EMU_PX;tf.geometry.coordinateHeight=tf.h*EMU_PX;}
    for(const key of ['rot','flipH','flipV'])if(!ownTransform?.hasAttribute(key)&&phTransform[key]!=null)tf[key]=phTransform[key];
  }
  const hasMedia = [...spEl.getElementsByTagName('*')].some(el => ['videoFile', 'audioFile', 'wavAudioFile', 'media'].includes(el.localName));
  // Image via blip
  const blip = dn(spEl, NS_A, 'blip');
  const imageFill = blip?.parentElement;
  if (imageFill) tf.drawingFill = parseDrawingFill(imageFill, { parseColor:captureColorParser(), renderingProfile:'office', resolveRelationship:id=>relMap[id] });
  const fillRectElement = qn(qn(imageFill, NS_A, 'stretch'), NS_A, 'fillRect');
  tf.imageFillRect = Object.fromEntries(['l','t','r','b'].map(key => [key, percentage(fillRectElement?.getAttribute(key))]));
  const sourceRectElement = qn(imageFill, NS_A, 'srcRect');
  tf.imageSourceRect = Object.fromEntries(['l','t','r','b'].map(key => [key, percentage(sourceRectElement?.getAttribute(key))]));
  const embedId = blip ? (blip.getAttributeNS(NS_R, 'embed') || blip.getAttribute('r:embed')) : null;
  const isImageRef = embedId && relMap[embedId] && /\.(png|jpe?g|gif|bmp|svg|webp|emf|wmf|tiff?)$/i.test(relMap[embedId]);
  // Check if this shape also has text content (sp with blipFill + text)
  const txBodyEl = dn(spEl, NS_P, 'txBody');
  const hasTextContent = txBodyEl && qnAll(txBodyEl, NS_A, 'p').some(p => {
    for (const ch of p.children) {
      if (ch.namespaceURI === NS_A && (ch.localName === 'r' || ch.localName === 'fld')) return true;
    }
    return false;
  });
  if (isImageRef && !hasTextContent) {
    // Pure image shape (no text) — return as image
    const blipFill = blip.parentElement;
    const hasStretch = blipFill ? !!dn(blipFill, NS_A, 'stretch') : false;
    // Parse srcRect (image cropping) — values in 1/1000ths of percent
    const srcRectEl = blipFill ? dn(blipFill, NS_A, 'srcRect') : null;
    let srcRect = null;
    if (srcRectEl) {
      const l = parseInt(srcRectEl.getAttribute('l') || '0', 10) / 100000;
      const t = parseInt(srcRectEl.getAttribute('t') || '0', 10) / 100000;
      const r = parseInt(srcRectEl.getAttribute('r') || '0', 10) / 100000;
      const b = parseInt(srcRectEl.getAttribute('b') || '0', 10) / 100000;
      if (l || t || r || b) srcRect = { l, t, r, b };
    }
    const pictureProperties=qn(spEl,NS_P,'spPr');
    const pictureLine=qn(qn(pictureProperties,NS_A,'ln'),NS_A,'noFill') ? null : parseLine(pictureProperties) || resolveThemeReference(qn(qn(spEl,NS_P,'style'),NS_A,'lnRef'),true);
    return { type: 'image', ...tf, line: pictureLine, shadow:parseShapeShadow(pictureProperties), target: relMap[embedId], fillMode: hasStretch ? 'stretch' : 'contain', srcRect };
  }
  if (hasMedia && !isImageRef) return { type: 'media', ...tf };
  // Table
  const tblEl = dn(spEl, NS_A, 'tbl');
  if (tblEl) { const tbl = parseTable(tblEl,relMap); return { type: 'table', ...tf, ...tbl }; }
  // Chart (graphicFrame containing c:chart reference)
  const graphicData = dn(spEl, NS_A, 'graphicData');
  if (graphicData) {
    const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const chartEl = dn(graphicData, NS_C, 'chart') || dn(graphicData, 'http://schemas.microsoft.com/office/drawing/2014/chartex', 'chart') || graphicData.querySelector('chart');
    if (chartEl) {
      const chartRId = chartEl.getAttributeNS(NS_R, 'id') || chartEl.getAttribute('r:id');
      if (chartRId && relMap[chartRId]) {
        return { type: 'chart', ...tf, chartTarget: relMap[chartRId] };
      }
    }
  }
  const diagramIds = dn(graphicData, 'http://schemas.openxmlformats.org/drawingml/2006/diagram', 'relIds');
  if (diagramIds) {
    const diagramTargets = Object.fromEntries(['dm','lo','qs','cs'].map(key => [key, relMap[diagramIds.getAttributeNS(NS_R,key)]]));
    return { type:'smartart', ...tf, diagramTargets, relationships: relMap };
  }
  // Shape styles — look specifically at spPr, then a:style as fallback
  const spPr = dn(spEl, NS_P, 'spPr');
  let bgColor = spPr ? parseFill(spPr) : null;
  let line = spPr ? parseLine(spPr) : null;
  // Fallback to a:style theme references (fillRef, lnRef) when spPr has no explicit fill/line
  if (!bgColor || !line) {
    const styleEl = dn(spEl, NS_P, 'style');
    if (styleEl) {
      if (!bgColor && !qn(spPr, NS_A, 'noFill')) {
        const fillRef = dn(styleEl, NS_A, 'fillRef');
        if (fillRef) { bgColor = resolveThemeReference(fillRef); if (!tf.drawingFill) tf.drawingFill = resolveThemeReference(fillRef, false, true); }
      }
      if (!line && !qn(qn(spPr, NS_A, 'ln'), NS_A, 'noFill')) {
        const lnRef = dn(styleEl, NS_A, 'lnRef');
        if (lnRef) {
          line = resolveThemeReference(lnRef, true);
        }
      }
    }
  }
  // Preset geometry (rounded rect, etc.)
  const prstGeom = spPr ? dn(spPr, NS_A, 'prstGeom') : null;
  const geom = prstGeom ? (prstGeom.getAttribute('prst') || 'rect') : 'rect';
  const geometryXml = (qn(spPr, NS_A, 'custGeom') || qn(spPr, NS_A, 'prstGeom')) ? new XMLSerializer().serializeToString(qn(spPr, NS_A, 'custGeom') || qn(spPr, NS_A, 'prstGeom')) : null;
  const shadow=parseShapeShadow(spPr);
  // Text body
  const txBody = dn(spEl, NS_P, 'txBody');
  const paragraphs = [];
  // Parse lstStyle for default font sizes per indent level
  const lstStyle = txBody ? qn(txBody, NS_A, 'lstStyle') : null;
  const levelDefaults = {};
  if (lstStyle) {
    const defs = extractLstStyleDefaults(lstStyle);
    Object.assign(levelDefaults, defs);
  }
  // Merge placeholder styles from layout/master (lower priority)
  if (phStyles) {
    const phDefs = resolvePlaceholderDefaults(phStyles,phInfo)||phStyles.other||{};
    for (const [lvl, val] of Object.entries(phDefs)) {
      if (lvl.startsWith('_')) continue;
      levelDefaults[lvl]=mergeTextDefaults({[lvl]:val},{[lvl]:levelDefaults[lvl]||{}})[lvl];
    }
  }
  if (txBody) {
    for (const p of qnAll(txBody, NS_A, 'p')) {
      const para = parseParagraph(p);
      paragraphs.push(para);
      // Apply level defaults (lstStyle + placeholder) if paragraph/runs lack properties
      const lvlDef = levelDefaults[para.indent] || levelDefaults['def'] || levelDefaults[0];
      if (lvlDef) {
        if (!para.defaultFontSize && lvlDef.fontSize) para.defaultFontSize = lvlDef.fontSize;
        if (!para.defaultColor && lvlDef.color) para.defaultColor = lvlDef.color;
        if (para.defaultEffects == null && lvlDef.effects != null) para.defaultEffects = lvlDef.effects;
        if (para.defaultBold == null && lvlDef.bold != null) para.defaultBold = lvlDef.bold;
        if (para.defaultItalic == null && lvlDef.italic != null) para.defaultItalic = lvlDef.italic;
        if (para.defaultUnderline == null && lvlDef.underline != null) para.defaultUnderline = lvlDef.underline;
        if (para.defaultStrike == null && lvlDef.strike != null) para.defaultStrike = lvlDef.strike;
        if (!para.defaultFont && lvlDef.font) para.defaultFont = lvlDef.font;
        for (const key of ['fontEa','fontCs','language']) { const property = 'default' + key[0].toUpperCase() + key.slice(1); if (para[property] == null && lvlDef[key] != null) para[property] = lvlDef[key]; }
        if (!para.explicitAlign && lvlDef.align) para.align = lvlDef.align;
        for (const key of ['marginLeft','hangingIndent']) if (para[key]==null && lvlDef[key]!=null) para[key]=lvlDef[key];
        if(para.lineHeight==null&&para.lineSpacingPoints==null){para.lineHeight=lvlDef.lineHeight;para.lineSpacingPoints=lvlDef.lineSpacingPoints;}
        for (const key of ['spaceBefore','spaceAfter']) if (para[key]==null && para[key+'Pct']==null) { para[key]=lvlDef[key]; para[key+'Pct']=lvlDef[key+'Pct']; }
        if (!para.explicitBullet && (lvlDef.explicitBullet || lvlDef.bullet != null)) { para.bullet=lvlDef.bullet; for(const key of ['bulletStart','bulletType']) if(lvlDef[key]!=null)para[key]=lvlDef[key]; }
        for(const key of ['bulletColor','bulletFont'])if(para[key]==null&&lvlDef[key]!=null)para[key]=lvlDef[key];
        if(para.bulletSizePoints==null&&para.bulletSizePercent==null){para.bulletSizePoints=lvlDef.bulletSizePoints;para.bulletSizePercent=lvlDef.bulletSizePercent;}
      }
    }
  }
  tf.textEffectsUnverified = paragraphs.some(para=>para.runs.some(run=>(run.effects??para.defaultEffects)?.length));
  // Text body properties
  const bodyPr = txBody ? qn(txBody, NS_A, 'bodyPr') : null;
  const placeholder = resolvePlaceholderDefaults(phStyles,phInfo);
  const body = mergeBodyDefaults(mergeBodyDefaults(themeBody, placeholder?._body), extractBodyDefaults(bodyPr));
  const anchor = body.attributes.anchor;
  const noWrap = body.attributes.wrap === 'none';
  const vertText = body.attributes.vert;
  const fit = body.autoFitXml ? parseXml(body.autoFitXml).documentElement : null;
  const autoFit = fit?.localName === 'spAutoFit';
  const normAutofit = fit?.localName === 'normAutofit' ? fit : null;
  const fontScale = normAutofit ? percentage(normAutofit.getAttribute('fontScale'), 1) * 100 : 100;
  const lineSpacingReduction = normAutofit ? percentage(normAutofit.getAttribute('lnSpcReduction')) : 0;
  const margin = {
    l: emuToPx(body.attributes.lIns ?? 91440), r: emuToPx(body.attributes.rIns ?? 91440),
    t: emuToPx(body.attributes.tIns ?? 45720), b: emuToPx(body.attributes.bIns ?? 45720)
  };
  // Attach blip fill target for shapes that have both image fill and text
  const blipTarget = isImageRef ? relMap[embedId] : null;
  // Return shape if it has text OR visual fill/border/blip (decorative shapes)
  if (!paragraphs.length && !bgColor && !line && !blipTarget && (!tf.drawingFill || tf.drawingFill.kind === 'noFill')) return null;
  return { type: 'text', ...tf, paragraphs, bgColor, blipTarget, line, anchor, margin, geom, geometryXml, noWrap, autoFit, fontScale, lineSpacingReduction, shadow, vertText };
}

// Canvas-style affine multiplication: parent * child.
function multiplyAffine(p, c) {
  return [p[0]*c[0]+p[2]*c[1], p[1]*c[0]+p[3]*c[1],
    p[0]*c[2]+p[2]*c[3], p[1]*c[2]+p[3]*c[3],
    p[0]*c[4]+p[2]*c[5]+p[4], p[1]*c[4]+p[3]*c[5]+p[5]];
}

// Group coordinates remain local. Compose parent transforms instead of flattening
// rotation into child bounds, which loses shear under non-uniform group scaling.
function inverseAffine(m) {
  const determinant=m[0]*m[3]-m[1]*m[2];if(Math.abs(determinant)<1e-12)throw new Error('Singular group fill transform');
  return [m[3]/determinant,-m[1]/determinant,-m[2]/determinant,m[0]/determinant,(m[2]*m[5]-m[3]*m[4])/determinant,(m[1]*m[4]-m[0]*m[5])/determinant];
}

function parseGroupShapes(grpEl, relMap, phStyles) {
  const shapes = [];
  const groupId = qn(qn(grpEl, NS_P, 'nvGrpSpPr'), NS_P, 'cNvPr')?.getAttribute('id') || null;
  const groupProperties=qn(grpEl,NS_P,'grpSpPr');
  const groupFillModel=parseDrawingFill(groupProperties,{parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>relMap[id]});
  const xfrm = qn(groupProperties, NS_A, 'xfrm');
  const groupFillBounds={x:emuToPx(qn(xfrm,NS_A,'chOff')?.getAttribute('x')||0),y:emuToPx(qn(xfrm,NS_A,'chOff')?.getAttribute('y')||0),width:emuToPx(qn(xfrm,NS_A,'chExt')?.getAttribute('cx')||0),height:emuToPx(qn(xfrm,NS_A,'chExt')?.getAttribute('cy')||0)};
  let matrix = [1, 0, 0, 1, 0, 0];
  if (xfrm) {
    const off = qn(xfrm, NS_A, 'off'), ext = qn(xfrm, NS_A, 'ext');
    const chOff = qn(xfrm, NS_A, 'chOff'), chExt = qn(xfrm, NS_A, 'chExt');
    const gx = emuToPx(off?.getAttribute('x') || 0), gy = emuToPx(off?.getAttribute('y') || 0);
    const gw = emuToPx(ext?.getAttribute('cx') || 0), gh = emuToPx(ext?.getAttribute('cy') || 0);
    const cw = emuToPx(chExt?.getAttribute('cx') || 0), ch = emuToPx(chExt?.getAttribute('cy') || 0);
    const ox = emuToPx(chOff?.getAttribute('x') || 0), oy = emuToPx(chOff?.getAttribute('y') || 0);
    const sx = cw ? gw / cw : 1, sy = ch ? gh / ch : 1;
    const rad = Number(xfrm.getAttribute('rot') || 0) / 60000 * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const fx = optionalBool(xfrm, 'flipH') ? -1 : 1, fy = optionalBool(xfrm, 'flipV') ? -1 : 1;
    // T(center) * R * F * T(-center) * T(off) * S(ext/chExt) * T(-chOff).
    const orient = [cos*fx, sin*fx, -sin*fy, cos*fy, 0, 0];
    const cx = gx + gw/2, cy = gy + gh/2;
    orient[4] = cx - orient[0]*cx - orient[2]*cy;
    orient[5] = cy - orient[1]*cx - orient[3]*cy;
    matrix = multiplyAffine(orient, [sx, 0, 0, sy, gx-ox*sx, gy-oy*sy]);
  }
  const types = new Set(['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame']);
  for (const child of grpEl.children) {
    if (child.namespaceURI !== NS_P || !types.has(child.localName)) continue;
    const children = child.localName === 'grpSp' ? parseGroupShapes(child, relMap, phStyles) : [parseShape(child, relMap, phStyles)];
    for (const shape of children) {
      if (shape) {
        const ownGroup=shape.groupFill;
        const groupFill=(!ownGroup||ownGroup.model.kind==='grpFill')&&groupFillModel ? {model:groupFillModel,bounds:groupFillBounds,transform:inverseAffine(shape.groupTransform||[1,0,0,1,0,0])} : ownGroup;
        shapes.push({...shape,groupFill,groupIds:groupId?[groupId,...(shape.groupIds||[])]:shape.groupIds||[],groupTransform:multiplyAffine(matrix,shape.groupTransform||[1,0,0,1,0,0])});
      }
    }
  }
  return shapes;
}

function relationshipPath(relsXml, partPath, kind) {
  if (!relsXml) return null;
  for (const rel of parseXml(relsXml).getElementsByTagNameNS('*', 'Relationship')) {
    if (rel.getAttribute('Type')?.endsWith('/' + kind) && rel.getAttribute('TargetMode') !== 'External') {
      return resolvePathFrom(partPath.replace(/[^/]+$/, ''), rel.getAttribute('Target') || '');
    }
  }
  return null;
}
function playbackRelationships(relsXml) {
  const result = {};
  if (relsXml) for (const rel of parseXml(relsXml).getElementsByTagNameNS('*', 'Relationship')) {
    result[rel.getAttribute('Id')] = { target: rel.getAttribute('Target'), type: rel.getAttribute('Type'), external: rel.getAttribute('TargetMode') === 'External' };
  }
  return result;
}

function normalizeRelationships(relsXml, partPath) {
  if (!relsXml) return null;
  const doc = parseXml(relsXml);
  for (const rel of doc.getElementsByTagNameNS('*', 'Relationship')) {
    if (rel.getAttribute('TargetMode') !== 'External') {
      rel.setAttribute('Target', '/' + resolvePathFrom(partPath.replace(/[^/]+$/, ''), rel.getAttribute('Target') || ''));
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function buildRelMap(relsXml) {
  const map = {};
  if (!relsXml) return map;
  try {
    const doc = parseXml(relsXml);
    for (const rel of doc.getElementsByTagNameNS('*', 'Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target && rel.getAttribute('TargetMode') !== 'External') map[id] = target;
    }
  } catch {}
  return map;
}

function resolvePathFrom(base, target) {
  const r = target.startsWith('/') ? target.slice(1) : base + target;
  const parts = r.split('/'); const stack = [];
  for (const p of parts) { if (p === '..') stack.pop(); else if (p !== '.') stack.push(p); }
  return stack.join('/');
}
function resolvePath(target) {
  const r = target.startsWith('/') ? target.slice(1) : target.startsWith('ppt/') ? target : 'ppt/slides/' + target;
  const parts = r.split('/'); const stack = [];
  for (const p of parts) { if (p === '..') stack.pop(); else if (p !== '.') stack.push(p); }
  return stack.join('/');
}

function partRelsPath(path) {
  return path.replace(/([^/]+)$/, '_rels/$1.rels');
}
async function getSlideFiles(zip) {
  const presentation = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentation) {
    // Legacy partial-package previews may omit the presentation part.
    return Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
      .sort((a, b) => Number(a.match(/slide(\d+)/i)[1]) - Number(b.match(/slide(\d+)/i)[1]));
  }
  const doc = parseXml(presentation);
  const rels = buildRelMap(await zip.file('ppt/_rels/presentation.xml.rels')?.async('string'));
  return qnAll(dn(doc, NS_P, 'sldIdLst'), NS_P, 'sldId').map(el => {
    const id = el.getAttributeNS(NS_R, 'id');
    if (!rels[id]) throw new Error('Missing slide relationship: ' + id);
    return resolvePathFrom('ppt/', rels[id]);
  });
}

async function getSlideSize(zip) {
  try {
    const xmlStr = await zip.file('ppt/presentation.xml')?.async('string');
    if (!xmlStr) return { w: 960, h: 540 };
    const doc = parseXml(xmlStr);
    const sldSz = dn(doc, NS_P, 'sldSz');
    if (sldSz) return { w: emuToPx(sldSz.getAttribute('cx') || '0'), h: emuToPx(sldSz.getAttribute('cy') || '0') };
  } catch {}
  return { w: 960, h: 540 };
}

// ── Slide layout/master background ──
// Parse background from a bg element (handles solidFill, gradFill, bgRef, noFill)
function parseBgElement(bgEl) {
  if (!bgEl) return undefined; // no bg element = inherit from parent
  // Check for noFill (explicit "no background" = white)
  if (dn(bgEl, NS_A, 'noFill')) return '#ffffff';
  // Try solidFill / gradFill
  const fill = parseFill(qn(bgEl, NS_P, 'bgPr') || bgEl);
  if (fill) return fill;
  // Try bgRef with schemeClr (theme reference)
  const color = parseColor(bgEl);
  if (color) return color;
  // bg element exists but we can't parse it → treat as white (stop cascade)
  return '#ffffff';
}

async function getLayoutBg(slideDoc, relsXml, zip) {
  // Slide's own background
  const slideBg = dn(slideDoc, NS_P, 'bg');
  const slideBgColor = parseBgElement(slideBg);
  if (slideBgColor !== undefined) return slideBgColor;
  // Find layout from rels
  if (!relsXml) return null;
  const relsDoc = parseXml(relsXml);
  let layoutTarget = null;
  for (const rel of relsDoc.getElementsByTagNameNS('*', 'Relationship')) {
    const t = rel.getAttribute('Target') || '';
    if (rel.getAttribute('Type')?.endsWith('/slideLayout') && rel.getAttribute('TargetMode') !== 'External') { layoutTarget = t; break; }
  }
  if (!layoutTarget) return null;
  const layoutPath = resolvePath(layoutTarget);
  try {
    const layoutXmlStr = await zip.file(layoutPath)?.async('string');
    if (!layoutXmlStr) return null;
    const layoutDoc = parseXml(layoutXmlStr);
    const layoutBg = dn(layoutDoc, NS_P, 'bg');
    const layoutBgColor = parseBgElement(layoutBg);
    if (layoutBgColor !== undefined) return layoutBgColor;
    // Check master from layout rels
    const layoutRelsPath = partRelsPath(layoutPath);
    const layoutRelsStr = await zip.file(layoutRelsPath)?.async('string').catch(() => null);
    if (!layoutRelsStr) return null;
    const layoutRelsDoc = parseXml(layoutRelsStr);
    let masterTarget = null;
    for (const rel of layoutRelsDoc.getElementsByTagNameNS('*', 'Relationship')) {
      const t = rel.getAttribute('Target') || '';
      if (rel.getAttribute('Type')?.endsWith('/slideMaster') && rel.getAttribute('TargetMode') !== 'External') { masterTarget = t; break; }
    }
    if (!masterTarget) return null;
    const masterPath = resolvePathFrom(layoutPath.replace(/[^/]+$/, ''), masterTarget);
    const mParts = masterPath.split('/'); const mStack = [];
    for (const p of mParts) { if (p === '..') mStack.pop(); else if (p !== '.') mStack.push(p); }
    const masterXmlStr = await zip.file(mStack.join('/'))?.async('string');
    if (!masterXmlStr) return null;
    const masterDoc = parseXml(masterXmlStr);
    const masterBg = dn(masterDoc, NS_P, 'bg');
    const masterBgColor = parseBgElement(masterBg);
    if (masterBgColor !== undefined) return masterBgColor;
  } catch {}
  return null;
}

async function getDrawingBackground(slideDoc,relsXml,zip,slidePath) {
  let doc=slideDoc,relationships=buildRelMap(relsXml),part=slidePath;
  for(let level=0;level<3;level++) {
    const bg=dn(doc,NS_P,'bg');
    if(bg) {
      const properties=qn(bg,NS_P,'bgPr');
      if(properties)return parseDrawingFill(properties,{parseColor:captureColorParser(),renderingProfile:'office',resolveRelationship:id=>relationships[id]});
      return resolveThemeReference(qn(bg,NS_P,'bgRef'),false,true);
    }
    const kind=level===0?'slideLayout':'slideMaster';
    const target=relationshipPath(level===0?relsXml:await zip.file(partRelsPath(part))?.async('string'),part||'ppt/slides/slide1.xml',kind);
    if(!target)break;
    part=target;const xml=await zip.file(part)?.async('string');if(!xml)break;
    doc=parseXml(xml);relationships=await buildRelMapForPath(zip,part);
  }
  return null;
}

// ── Extract placeholder text styles from layout/master ──
function extractLstStyleDefaults(lstStyleEl) {
  const defaults = {};
  if (!lstStyleEl) return defaults;
  const lvlNames = ['defPPr', 'lvl1pPr', 'lvl2pPr', 'lvl3pPr', 'lvl4pPr', 'lvl5pPr', 'lvl6pPr', 'lvl7pPr', 'lvl8pPr', 'lvl9pPr'];
  for (let i = 0; i < lvlNames.length; i++) {
    const lvlPPr = qn(lstStyleEl, NS_A, lvlNames[i]);
    if (!lvlPPr || i === 0) continue; // Office ignores defPPr (MS-OI29500 2.1.1383).
    // Paragraph-level: alignment
    const algn = lvlPPr.getAttribute('algn');
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : (algn === 'l' ? 'left' : null);
    const dr = qn(lvlPPr, NS_A, 'defRPr');
    const lvlKey = i === 0 ? 'def' : i - 1;
    const paragraph = lstStyleEl.ownerDocument.createElementNS(NS_A,'p'), properties = lstStyleEl.ownerDocument.createElementNS(NS_A,'pPr');
    for(const attr of lvlPPr.attributes)properties.setAttribute(attr.name,attr.value);
    for(const ch of lvlPPr.childNodes)properties.appendChild(ch.cloneNode(true));
    paragraph.appendChild(properties);const parsed = parseParagraph(paragraph);
    const metrics = Object.fromEntries(['marginLeft','hangingIndent','lineHeight','lineSpacingPoints','spaceBefore','spaceAfter','spaceBeforePct','spaceAfterPct','bullet','bulletStart','bulletType','bulletColor','bulletFont','bulletSizePoints','bulletSizePercent'].map(key=>[key,parsed[key]]));
    if(parsed.defaultEffects!==null)metrics.effects=parsed.defaultEffects;
    if(parsed.explicitBullet)metrics.explicitBullet=true;else for(const key of ['bullet','bulletStart','bulletType'])delete metrics[key];
    if (!dr) {
      defaults[lvlKey] = { ...metrics, fontSize: null, color: null, bold: null, italic: null, underline: null, strike: null, font: null, align };
      continue;
    }
    const sz = dr.getAttribute('sz');
    const c = parseColor(qn(dr, NS_A, 'solidFill'));
    const b = optionalBool(dr, 'b');
    const it = optionalBool(dr, 'i');
    const u = dr.getAttribute('u');
    const ul = optionalUnderline(dr);
    const stk = optionalStrike(dr);
    const latin = qn(dr, NS_A, 'latin');
    const ea = qn(dr, NS_A, 'ea');
    defaults[lvlKey] = {
      ...metrics, fontSize: sz ? Number(sz) / 100 : null,
      color: c, bold: b, italic: it, underline: ul, strike: stk,
      font: latin ? latin.getAttribute('typeface') : null, fontEa: ea?.getAttribute('typeface') || null, fontCs: qn(dr, NS_A, 'cs')?.getAttribute('typeface') || null, language: dr.getAttribute('lang'),
      align
    };
  }
  return defaults;
}

function extractPhFromShape(spEl) {
  // Look for <p:nvSpPr><p:nvPr><p:ph type="..." idx="..."/>
  const nvSpPr = qn(spEl, NS_P, 'nvSpPr')||qn(spEl,NS_P,'nvPicPr')||qn(spEl,NS_P,'nvGraphicFramePr');
  if (!nvSpPr) return null;
  const nvPr = qn(nvSpPr, NS_P, 'nvPr');
  if (!nvPr) return null;
  const ph = qn(nvPr, NS_P, 'ph');
  if (!ph) return null;
  return { type: ph.getAttribute('type') || 'obj', idx: ph.getAttribute('idx') || '0' };
}

function resolvePlaceholderDefaults(styles,info) {
  if(!styles||!info)return null;
  const key=info.type+(info.idx?':'+info.idx:'');
  if(styles[key]?._source?.partType==='layout')return styles[key];
  for(const [name,properties]of Object.entries(styles))if(name.endsWith(':'+info.idx)&&properties._source?.partType==='layout')return properties;
  if(styles[key])return styles[key];
  // Slide-to-layout placeholder matching uses idx; layout-to-master uses type.
  if(info.idx)for(const [name,properties]of Object.entries(styles))if(name.endsWith(':'+info.idx)&&properties._source?.partType!=='master')return properties;
  return styles[info.type]||null;
}

function extractBodyDefaults(body) {
  if (!body) return { attributes: {}, autoFitXml: null };
  const fit = [...body.children].find(el => ['noAutofit','normAutofit','spAutoFit'].includes(el.localName));
  return { attributes: Object.fromEntries([...body.attributes].filter(attr => !attr.name.startsWith('xmlns')).map(attr => [attr.localName, attr.value])),
    autoFitXml: fit ? new XMLSerializer().serializeToString(fit) : null };
}
function mergeBodyDefaults(lower, higher) {
  return { attributes: { ...(lower?.attributes || {}), ...(higher?.attributes || {}) }, autoFitXml: higher?.autoFitXml ?? lower?.autoFitXml ?? null };
}

function extractPlaceholderStylesFromDoc(doc,partType='unknown',relationships={}) {
  const phStyles = {};
  const spTree = dn(doc, NS_P, 'spTree') || dn(doc, NS_P, 'cSld');
  if (!spTree) return phStyles;
  for (const sp of [...spTree.children].filter(child=>child.namespaceURI===NS_P&&['sp','pic','graphicFrame'].includes(child.localName))) {
    const phInfo = extractPhFromShape(sp);
    if (!phInfo) continue;
    // Extract transform (position/size) from layout/master placeholder
    const tf = parseTransform(sp);
    const txBody = dn(sp, NS_P, 'txBody');
    const lstStyle = txBody ? qn(txBody, NS_A, 'lstStyle') : null;
    const defaults = extractLstStyleDefaults(lstStyle);
    // Also check inline paragraphs for their defRPr (some layouts define style inline)
    if (txBody && Object.keys(defaults).length === 0) {
      const paras = qnAll(txBody, NS_A, 'p');
      for (const p of paras) {
        const pPr = qn(p, NS_A, 'pPr');
        const dr = pPr ? qn(pPr, NS_A, 'defRPr') : null;
        if (dr) {
          const sz = dr.getAttribute('sz');
          const c = parseColor(qn(dr, NS_A, 'solidFill'));
          const b = optionalBool(dr, 'b');
          const u = dr.getAttribute('u');
          const latin = qn(dr, NS_A, 'latin');
          const ea = qn(dr, NS_A, 'ea');
          const algn = pPr?.getAttribute('algn');
          defaults[0] = {
            fontSize: sz ? Number(sz) / 100 : null,
            effects:parseTextDrawingEffects(dr), color: c, bold: b, italic: optionalBool(dr, 'i'),
            underline: optionalUnderline(dr), strike: optionalStrike(dr),
            font: latin ? latin.getAttribute('typeface') : null, fontEa: ea?.getAttribute('typeface') || null, fontCs: qn(dr, NS_A, 'cs')?.getAttribute('typeface') || null, language: dr.getAttribute('lang'),
            align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : algn === 'l' ? 'left' : null
          };
          break;
        }
      }
    }
    const key = phInfo.type + (phInfo.idx ? ':' + phInfo.idx : '');
    defaults._source = {partType};
    defaults._transform = tf;
    defaults._body = extractBodyDefaults(qn(txBody, NS_A, 'bodyPr'));
    const effects = parseShapeDrawingEffects(sp,relationships);
    if (effects !== null) defaults._effects = {models:effects};
    const hasStyleDefaults = Object.keys(defaults).some(k => !k.startsWith('_'));
    phStyles[key] = defaults;
    // Also store by type alone for fallback
    if (!phStyles[phInfo.type] || !Object.keys(phStyles[phInfo.type]).some(k => !k.startsWith('_'))) {
      phStyles[phInfo.type] = defaults;
    }
  }
  return phStyles;
}

function mergeTextDefaults(lower = {}, higher = {}) {
  const merged = { ...lower };
  for (const [level, properties] of Object.entries(higher)) {
    if (level === '_body') { merged[level] = mergeBodyDefaults(lower[level], properties); continue; }
    if (level === '_transform') {
      if (properties?.w > 0 && properties?.h > 0) merged[level] = properties;
      continue;
    }
    merged[level] = { ...(lower[level] || {}) };
    if(properties?.bulletSizePoints!=null||properties?.bulletSizePercent!=null){delete merged[level].bulletSizePoints;delete merged[level].bulletSizePercent;}
    if(properties?.lineHeight!=null||properties?.lineSpacingPoints!=null){delete merged[level].lineHeight;delete merged[level].lineSpacingPoints;}
    if(properties?.explicitBullet){merged[level].bullet=properties.bullet;delete merged[level].bulletStart;delete merged[level].bulletType;}
    for (const key of ['spaceBefore','spaceAfter']) if (properties?.[key]!=null || properties?.[key+'Pct']!=null) { delete merged[level][key]; delete merged[level][key+'Pct']; }
    for (const [key, value] of Object.entries(properties || {})) if (value != null) merged[level][key] = value;
  }
  return merged;
}

async function getPlaceholderStyles(relsXml, zip) {
  const result = {};
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (presentationXml) result.other = extractLstStyleDefaults(dn(parseXml(presentationXml), NS_P, 'defaultTextStyle'));
  if (!relsXml) return result;
  try {
    const relsDoc = parseXml(relsXml);
    let layoutTarget = null;
    for (const rel of relsDoc.getElementsByTagNameNS('*', 'Relationship')) {
      const t = rel.getAttribute('Target') || '';
      if (rel.getAttribute('Type')?.endsWith('/slideLayout') && rel.getAttribute('TargetMode') !== 'External') { layoutTarget = t; break; }
    }
    if (!layoutTarget) return result;
    const layoutPath = resolvePath(layoutTarget);
    const layoutXmlStr = await zip.file(layoutPath)?.async('string');
    if (!layoutXmlStr) return result;
    const layoutDoc = parseXml(layoutXmlStr);
    // Extract styles from layout placeholders
    const layoutStyles = extractPlaceholderStylesFromDoc(layoutDoc,'layout',await buildRelMapForPath(zip,layoutPath));
    Object.assign(result, layoutStyles);

    // Also extract from txStyles in layout (rare but possible)
    // Now check slide master
    const layoutRelsPath = partRelsPath(layoutPath);
    const layoutRelsStr = await zip.file(layoutRelsPath)?.async('string').catch(() => null);
    if (!layoutRelsStr) return result;
    const layoutRelsDoc = parseXml(layoutRelsStr);
    let masterTarget = null;
    for (const rel of layoutRelsDoc.getElementsByTagNameNS('*', 'Relationship')) {
      const t = rel.getAttribute('Target') || '';
      if (rel.getAttribute('Type')?.endsWith('/slideMaster') && rel.getAttribute('TargetMode') !== 'External') { masterTarget = t; break; }
    }
    if (!masterTarget) return result;
    const masterPath = resolvePathFrom(layoutPath.replace(/[^/]+$/, ''), masterTarget);
    const mParts = masterPath.split('/'); const mStack = [];
    for (const p of mParts) { if (p === '..') mStack.pop(); else if (p !== '.') mStack.push(p); }
    const resolvedMasterPath = mStack.join('/');
    const masterXmlStr = await zip.file(resolvedMasterPath)?.async('string');
    if (!masterXmlStr) return result;
    const masterDoc = parseXml(masterXmlStr);
    // Extract from master placeholders (lower priority)
    const masterStyles = extractPlaceholderStylesFromDoc(masterDoc,'master',await buildRelMapForPath(zip,resolvedMasterPath));
    for (const [key, val] of Object.entries(masterStyles)) {
      result[key] = mergeTextDefaults(val, result[key]);
    }
    for(const [key,properties]of Object.entries(layoutStyles)) {
      const type=key.split(':')[0],canonical=type==='ctrTitle'?'title':type==='subTitle'?'body':type;
      const masterDefaults=masterStyles[canonical];
      if(masterDefaults)result[key]=mergeTextDefaults(masterDefaults,result[key]);
    }
    // Extract from master txStyles (p:txStyles) — title/body/other style
    const txStyles = dn(masterDoc, NS_P, 'txStyles');
    if (txStyles) {
      const styleMap = { titleStyle: 'title', bodyStyle: 'body', otherStyle: 'other' };
      for (const [tag, phType] of Object.entries(styleMap)) {
        const styleEl = qn(txStyles, NS_P, tag);
        if (styleEl) {
          const defs = extractLstStyleDefaults(styleEl);
          result[phType] = mergeTextDefaults(defs, result[phType]);
          for (const key of Object.keys(result)) if (key.startsWith(phType + ':')) result[key] = mergeTextDefaults(defs, result[key]);
          const aliases=phType==='title'?['ctrTitle']:phType==='body'?['subTitle','obj']:[];
          for(const alias of aliases){result[alias]=mergeTextDefaults(defs,result[alias]);for(const key of Object.keys(result))if(key.startsWith(alias+':'))result[key]=mergeTextDefaults(defs,result[key]);}
        }
      }
    }
  } catch (error) { throw error; }
  return result;
}

// ═══════════════════════════════════════
// Canvas Renderer
// ═══════════════════════════════════════

// Convert pt to canvas px at given DPI scale
const ptToPx = (pt) => pt * 4 / 3; // 1pt = 1.333px at 96dpi

function buildCanvasFont(run, defaultFontSize) {
  const fs = run.fontSize || defaultFontSize || 18;
  const sizePx = ptToPx(fs);
  const style = run.italic ? 'italic ' : '';
  const weight = run.bold ? '700 ' : '';
  const rawFont = run.font;
  const family = rawFont ? (resolveFont(rawFont) || 'sans-serif') : (resolveFont(themeFontMinor) || 'sans-serif');
  return `${style}${weight}${sizePx}px ${family}`;
}

// Load image from zip as ImageBitmap (or Image fallback)
async function loadZipImage(zip, imgPath, objectUrls) {
  const file = zip.file(imgPath);
  if (!file) return null;
  if(/\.(emf|wmf)$/i.test(imgPath)) {
    const bytes=await file.async('uint8array');
    let image;
    if(/\.wmf$/i.test(imgPath))image=renderWmfVector(bytes);
    else {
      try {image=renderEmfDib(bytes);}
      catch(error) {if(!(error instanceof UnsupportedMetafileError))throw error;image=renderEmfVector(bytes,{fontResolver:face=>resolveFont(face),fontResolverCSS:true});}
    }
    if(image.metafileUnverified?.length)log({pptxMetafileUnverified:{path:imgPath,traits:image.metafileUnverified}});
    return image;
  }
  const blob = await file.async('blob');
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  // Try createImageBitmap for better perf, fall back to Image
  try {
    return await createImageBitmap(blob);
  } catch {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
}

async function loadZipFillImage(zip,imgPath,objectUrls) {
  const file=zip.file(imgPath);if(!file)return null;
  let dpi=readImageDpi(await file.async('uint8array'));
  const image=await loadZipImage(zip,imgPath,objectUrls);
  const intrinsic=image?.metafileIntrinsic;
  if(intrinsic?.width>0&&intrinsic?.height>0)dpi={x:96*image.width/intrinsic.width,y:96*image.height/intrinsic.height,source:'metafile-logical-bounds'};
  return image?{image,dpi}:null;
}

// Parse CSS linear-gradient into canvas-usable stops
function parseGradientStops(gradientStr) {
  const m = gradientStr.match(/linear-gradient\((-?\d+(?:\.\d+)?)deg,(.+)\)/);
  if (!m) return null;
  const angle = Number(m[1]);
  const parts = m[2].split(/,(?![^(]*\))/);
  const stops = [];
  for (const p of parts) {
    const t = p.trim();
    const cm = t.match(/^(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s+(\d+(?:\.\d+)?)%$/);
    if (cm) stops.push({ color: cm[1], pos: Number(cm[2]) / 100 });
  }
  return stops.length >= 2 ? { angle, stops } : null;
}

function applyGradientFill(ctx, gradInfo, x, y, w, h) {
  const rad = (gradInfo.angle - 90) * Math.PI / 180;
  const cx = x + w / 2, cy = y + h / 2;
  const len = Math.max(w, h);
  const dx = Math.cos(rad) * len / 2, dy = Math.sin(rad) * len / 2;
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (const s of gradInfo.stops) grad.addColorStop(s.pos, s.color);
  return grad;
}

// Word-wrap text into lines that fit within maxWidth
// CJK-aware word wrap: breaks on whitespace for Latin, per-character for CJK
function wrapText(ctx, text, maxWidth) {
  if (maxWidth <= 0) return [text];
  if (ctx.measureText(text).width <= maxWidth) return [text];

  // Segment text into tokens: CJK chars are individual tokens, Latin words stay grouped
  const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}]/u;
  const tokens = [];
  let buf = '';
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (/\s/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);

  const lines = [];
  let line = '';
  for (const tok of tokens) {
    const test = line + tok;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = /\s/.test(tok) ? '' : tok;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function getBulletText(para, counter) {
  if (para.bullet !== 'auto') return `${para.bullet} `;
  if (para.bulletStart != null) counter.n = para.bulletStart;
  const n = counter.n++;
  const type = para.bulletType || 'arabicPeriod';
  let label = String(n);
  if (/^alpha/.test(type)) {
    let i = n; label = '';
    while (i > 0) { label = String.fromCharCode(97 + (i - 1) % 26) + label; i = Math.floor((i - 1) / 26); }
    if (type.startsWith('alphaUc')) label = label.toUpperCase();
  } else if (/^roman/.test(type)) {
    let i = n; label = '';
    for (const [value, glyph] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) {
      while (i >= value) { label += glyph; i -= value; }
    }
    if (type.startsWith('romanLc')) label = label.toLowerCase();
  }
  if (/ParenBoth$/.test(type)) return `(${label}) `;
  if (/ParenR$/.test(type)) return `${label}) `;
  if (/Plain$/.test(type)) return `${label} `;
  return `${label}. `;
}

function paragraphSegments(para, scale, fScale, defaultTextColor, autoNum) {
    const segments = [];
    if (para.bullet) {
      const bulletText = getBulletText(para, autoNum);
      const bFs = (para.bulletSizePoints ?? ((para.defaultFontSize || 18)*(para.bulletSizePercent??1))) * fScale;
      segments.push({
        text: bulletText, eastAsianLineBreak: para.eastAsianLineBreak, hangingPunctuation: para.hangingPunctuation,
        font: `${ptToPx(bFs) * scale}px ${resolveFont(para.bulletFont || themeFontMinor) || 'sans-serif'}`,
        color: para.bulletColor || defaultTextColor,
        fontSize: bFs, bullet: true, underline: false, strike: false, baseline: null
      });
    }
    for (const [runIndex,run] of para.runs.entries()) {
      if (run.text === '\n') { segments.push({ text: '\n' }); continue; }
      const fs = (run.fontSize || para.defaultFontSize || 18) * fScale;
      const effectiveFs = fs;
      const isBold = run.bold ?? para.defaultBold ?? false;
      const isItalic = run.italic ?? para.defaultItalic ?? false;
      const runFont = run.font || para.defaultFont;
      segments.push({
        text: run.text, eastAsianLineBreak: para.eastAsianLineBreak, hangingPunctuation: para.hangingPunctuation,
        font: `${isItalic ? 'italic ' : ''}${isBold ? '700 ' : ''}${ptToPx(effectiveFs) * scale}px ${resolveFont(runFont, run.language || para.defaultLanguage) || resolveFont(themeFontMinor) || 'sans-serif'}`,
        fontPrefix: `${isItalic ? 'italic ' : ''}${isBold ? '700 ' : ''}${ptToPx(effectiveFs) * scale}px `,
        fontEa: run.fontEa || para.defaultFontEa || '+mn-ea', fontCs: run.fontCs || para.defaultFontCs || '+mn-cs', language: run.language || para.defaultLanguage,
        color: run.hlinkRid ? (run.color || themeColors.hlink || '#0000ff') : (run.color || para.defaultColor || defaultTextColor),
        fontSize: fs,
        underline: run.underline ?? para.defaultUnderline ?? false,
        strike: run.strike ?? para.defaultStrike ?? false,
        baseline: run.baseline,
        letterSpacing: run.letterSpacing, scale,
        hlinkRid: run.hlinkRid, effects:run.effects??para.defaultEffects, effectOwner:run, effectRunIndex:runIndex, effectSource:run.effects!=null?'rPr':'defaultRPr'
      });
    }

  const resolved = [];
  for (const segment of segments) {
    if (!segment.fontPrefix) { resolved.push(segment); continue; }
    let category = null, text = '';
    const flush = () => {
      if (!text) return;
      const script = category === 'ea' ? (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? 'Jpan' : /\p{Script=Hangul}/u.test(text) ? 'Hang' : 'Hans') : category === 'cs' ? 'Arab' : 'latin';
      const token = category === 'ea' ? segment.fontEa : category === 'cs' ? segment.fontCs : null;
      resolved.push({ ...segment, text, font: token ? segment.fontPrefix + resolveFont(token, segment.language, script) : segment.font }); text = '';
    };
    for (const ch of segment.text) {
      const next = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch) ? 'ea' : /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(ch) ? 'cs' : 'latin';
      if (next !== category) { flush(); category = next; } text += ch;
    }
    flush();
  }
  return resolved;
}


// One shared layout result controls measurement, alignment and painting.
function wrapSegments(ctx, segments, maxWidth) {
  const lines = [];
  let line = [], width = 0;
  const flush = () => { lines.push(line); line = []; width = 0; };
  for (const seg of segments) {
    if (seg.text === '\n') { flush(); continue; }
    ctx.font = seg.font;
    if (seg.bullet) { line.push({...seg,width:0,bulletWidth:ctx.measureText(seg.text).width}); continue; }
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${ptToPx(seg.letterSpacing || 0) * (seg.scale || 1)}px`;
    const tokens = seg.text.match(/[\u2E80-\u9FFF\uF900-\uFAFF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF]+|\s+/gu) || [];
    for (const token of tokens) {
      const tw = ctx.measureText(token).width;
      if (line.length && width + tw > maxWidth) {
        const closing=/^[、。，．：；？！ー々ゝゞヽヾぁぃぅぇぉゃゅょっァィゥェォャュョッ）〕］｝〉》」』】〙〗〟’”]/u.test(token);
        if (!(seg.eastAsianLineBreak && closing && seg.hangingPunctuation)) {
          if(seg.eastAsianLineBreak&&closing) {
            const previous=line.pop();
            if(previous&&Array.from(previous.text).length>1){const chars=Array.from(previous.text),last=chars.pop();ctx.font=previous.font;const lastWidth=ctx.measureText(last).width;line.push({...previous,text:chars.join(''),width:previous.width-lastWidth});flush();line.push({...previous,text:last,width:lastWidth});width=lastWidth;ctx.font=seg.font;}
            else if(previous){flush();line.push(previous);width=previous.width;}
            else flush();
          } else flush();
        }
      }
      if (!line.length && /^\s+$/.test(token) && lines.length) continue;
      // A Latin token wider than the entire line still has to make progress.
      const chunks = tw > maxWidth ? Array.from(token) : [token];
      for (const chunk of chunks) {
        const cw = ctx.measureText(chunk).width;
        const closing=/^[、。，．：；？！）〕］｝〉》」』】〙〗〟’”]/u.test(chunk);
        if (line.length && width + cw > maxWidth && !(seg.eastAsianLineBreak&&closing&&seg.hangingPunctuation)) flush();
        const last = line[line.length - 1];
        if (last?.origin === seg) { last.text += chunk; last.width += cw; }
        else line.push({ ...seg, text: chunk, width: cw, origin: seg });
        width += cw;
      }
    }
  }
  if (line.length || !lines.length) lines.push(line);
  return lines;
}
function paragraphSpace(para, key, maxFs, scale) {
  return ptToPx(para[key+'Pct'] != null ? maxFs * para[key+'Pct'] : (para[key] ?? 0))*scale;
}
function paragraphFontMetrics(para, maxFs, scale, ctx, line = []) {
  const segments = line.length ? line : [{font:buildCanvasFont({font:para.defaultFont,fontSize:maxFs*scale},maxFs*scale),fontSize:maxFs}];
  let ascent=0,descent=0,gap=0;
  for (const segment of segments) {
    const pixels=ptToPx(segment.fontSize || maxFs)*scale;
    const font=segment.font;
    const family=Object.keys(documentFontMetrics).filter(name=>!name.includes('|')).find(name => font?.includes(`"${name}"`) || font?.includes(name+','));
    const weight=/\b(?:700|bold)\b/.test(font||'')?'700':'400',style=/\bitalic\b/.test(font||'')?'italic':'normal';
    const stored=family?(documentFontMetrics[`${family}|${weight}|${style}`]||documentFontMetrics[family]):null;
    let metrics;
    if(stored)metrics={ascent:stored.ascent*pixels,descent:stored.descent*pixels,gap:stored.gap*pixels};
    else if(ctx){ctx.font=font || buildCanvasFont({font:para.defaultFont},maxFs);const measured=ctx.measureText('Hg');metrics={ascent:measured.fontBoundingBoxAscent ?? measured.actualBoundingBoxAscent,descent:measured.fontBoundingBoxDescent ?? measured.actualBoundingBoxDescent,gap:0};}
    else metrics={ascent:pixels,descent:0,gap:0};
    ascent=Math.max(ascent,metrics.ascent||0);descent=Math.max(descent,metrics.descent||0);gap=Math.max(gap,metrics.gap||0);
  }
  return {ascent,descent,gap,line:ascent+descent+gap};
}
function paragraphLineHeight(para, maxFs, scale, reduction = 0, ctx = null, line = []) {
  return para.lineSpacingPoints != null ? ptToPx(para.lineSpacingPoints)*scale : paragraphFontMetrics(para,maxFs,scale,ctx,line).line*Math.max(0,(para.lineHeight??1)-reduction);
}

// Detect if a color is "dark" (luminance < 0.4)
function isDarkColor(hex) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 0.4;
}

const VERTICAL_FORMS = new Map(Array.from('、。:;!?(){}[]「」『』【】《》〈〉…').map((ch,i)=>[ch,Array.from('︑︒︓︔︕︖︵︶︷︸﹇﹈﹁﹂﹃﹄︻︼︽︾︿﹀︙')[i] || ch]));
function verticalTextLayout(ctx, shape, width, height, scale) {
  const margin=shape.margin || {l:9.6,r:9.6,t:4.8,b:4.8}, columns=[], counter={n:1};
  const available=Math.max(1,height-(margin.t+margin.b)*scale);
  for(const para of shape.paragraphs) {
    const segments=paragraphSegments(para,scale,(shape.fontScale??100)/100,'#000',counter);
    const largestFs=Math.max((para.defaultFontSize||18)*(shape.fontScale??100)/100,...segments.map(segment=>segment.fontSize||0));
    let glyphs=[],used=paragraphSpace(para,'spaceBefore',largestFs,scale),maxFs=para.defaultFontSize||18;
    const flush=()=>{columns.push({glyphs,used,width:paragraphLineHeight(para,maxFs,scale,shape.lineSpacingReduction||0,ctx,glyphs),para});glyphs=[];used=0;maxFs=para.defaultFontSize||18;};
    for(const segment of segments) for(const original of segment.text) {
      if(original==='\n'){flush();continue;}
      const text=VERTICAL_FORMS.get(original)||original,fs=segment.fontSize||18,advance=ptToPx(fs+(segment.letterSpacing||0))*scale;
      if(!shape.noWrap&&glyphs.length&&used+advance>available)flush();
      maxFs=Math.max(maxFs,fs);glyphs.push({...segment,text,original,offset:used,advance});used+=advance;
    }
    used+=paragraphSpace(para,'spaceAfter',largestFs,scale);
    if(glyphs.length||!columns.length)flush();
  }
  return {columns,margin,available,totalWidth:columns.reduce((sum,col)=>sum+col.width,0)};
}
function drawEastAsianVerticalText(ctx,shape,sx,sy,sw,sh,scale,defaultTextColor) {
  const layout=verticalTextLayout(ctx,shape,sw,sh,scale),m=layout.margin;
  let right=sx+sw-m.r*scale;
  const extra=Math.max(0,sw-(m.l+m.r)*scale-layout.totalWidth);
  if(shape.anchor==='ctr')right-=extra/2; else if(shape.anchor==='b')right-=extra;
  for(const column of layout.columns) {
    if (shape._paragraphFilter && !shape._paragraphFilter.includes(shape.paragraphs.indexOf(column.para))) { right -= column.width; continue; }
    const center=right-column.width/2;let top=sy+m.t*scale;
    if(column.para.align==='center')top+=Math.max(0,(layout.available-column.used)/2);
    else if(column.para.align==='right')top+=Math.max(0,layout.available-column.used);
    for(const glyph of column.glyphs) {
      ctx.save();ctx.font=glyph.font;ctx.fillStyle=glyph.color||defaultTextColor;ctx.textAlign='center';
      const metrics=ctx.measureText(glyph.text),ascent=metrics.actualBoundingBoxAscent||ptToPx(glyph.fontSize)*scale*.8,descent=metrics.actualBoundingBoxDescent||0;
      const x=center+ptToPx(glyph.fontSize)*scale*(glyph.baseline||0)/100,y=top+glyph.offset+glyph.advance/2;
      const upright=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFE10-\uFE4F\u3000-\u303F\uFF00-\uFFEF]/u.test(glyph.text);
      ctx.translate(x,y);if(!upright)ctx.rotate(Math.PI/2);ctx.fillText(glyph.text,0,(ascent-descent)/2);ctx.restore();
      if(glyph.underline||glyph.hlinkRid){ctx.strokeStyle=glyph.color||defaultTextColor;ctx.lineWidth=Math.max(scale,0.5);ctx.beginPath();ctx.moveTo(x+column.width/2,top+glyph.offset);ctx.lineTo(x+column.width/2,top+glyph.offset+glyph.advance);ctx.stroke();}
    }
    right-=column.width;
  }
}
function autoFitShape(shape) {
  if(shape.type!=='text'||!shape.autoFit||!shape.paragraphs?.length)return shape;
  const ctx=document.createElement('canvas').getContext('2d'),margin=shape.margin||{l:9.6,r:9.6,t:4.8,b:4.8};
  if(shape.vertText==='eaVert') {
    const vertical=verticalTextLayout(ctx,shape,shape.w,shape.h,1);
    shape.w=Math.max(shape.w,vertical.totalWidth+margin.l+margin.r);return shape;
  }
  const counter={n:1};let height=margin.t+margin.b,maxWidth=0;
  for(const para of shape.paragraphs) {
    const segments=paragraphSegments(para,1,(shape.fontScale??100)/100,'#000',counter);
    const available=Math.max(1,shape.w-margin.l-margin.r-(para.marginLeft||0));
    const lines=wrapSegments(ctx,segments,shape.noWrap?Infinity:available);
    const largestFs=Math.max((para.defaultFontSize||18)*(shape.fontScale??100)/100,...segments.map(seg=>seg.fontSize||0));
    height+=paragraphSpace(para,'spaceBefore',largestFs,1)+paragraphSpace(para,'spaceAfter',largestFs,1);
    for(const line of lines){const maxFs=Math.max(...line.map(seg=>seg.fontSize||0),para.defaultFontSize||18);height+=paragraphLineHeight(para,maxFs,1,shape.lineSpacingReduction||0,ctx,line);maxWidth=Math.max(maxWidth,line.reduce((sum,seg)=>sum+seg.width,0)+(para.marginLeft||0));}
  }
  if(shape.noWrap)shape.w=Math.max(shape.w,maxWidth+margin.l+margin.r);
  shape.h=Math.max(shape.h,height);return shape;
}

function drawTextShape(ctx, shape, sx, sy, sw, sh, scale, relMap, slideBgColor) {
  // Vertical text: rotate canvas context
  const isVert = shape.vertText === 'vert' || shape.vertText === 'vert270';
  if (isVert) {
    ctx.save();
    const cx = sx + sw / 2, cy = sy + sh / 2;
    ctx.translate(cx, cy);
    ctx.rotate(shape.vertText === 'vert270' ? -Math.PI / 2 : Math.PI / 2);
    ctx.translate(-cx, -cy);
    // Swap effective width/height for text layout
    const tmp = sw; sw = sh; sh = tmp;
    sx = sx + (tmp - sw) / 2; sy = sy + (sh - tmp) / 2 + (tmp - sh) / 2;
  }
  const m = shape.margin || { l: 9.6, r: 9.6, t: 4.8, b: 4.8 };
  const padL = m.l * scale, padR = m.r * scale, padT = m.t * scale, padB = m.b * scale;
  const contentW = sw - padL - padR;
  // normAutofit: scale font sizes by fontScale percentage
  const fScale = (shape.fontScale ?? 100) / 100;
  // Smart default text color: use white on dark backgrounds
  // Check shape's own bg first, then fall back to slide-level bg
  const effectiveBg = shape._textBackground || shape.bgColor || slideBgColor;
  let darkBg = false;
  if (effectiveBg && typeof effectiveBg === 'string') {
    if (effectiveBg.startsWith('linear-gradient')) {
      const firstColor = effectiveBg.match(/#[0-9a-fA-F]{6}/);
      darkBg = firstColor ? isDarkColor(firstColor[0]) : false;
    } else {
      darkBg = isDarkColor(effectiveBg);
    }
  }
  const defaultTextColor = darkBg ? '#ffffff' : (themeColors.tx1 || '#1e293b');
  if (shape.vertText === 'eaVert') { drawEastAsianVerticalText(ctx,shape,sx,sy,sw,sh,scale,defaultTextColor); return; }

  let totalContentH = 0;
  const autoNumMeasure = { n: 1 };
  for (const para of shape.paragraphs) {
    const paraLeftPad = (para.marginLeft || 0) * scale;
    const segments = paragraphSegments(para, scale, fScale, defaultTextColor, autoNumMeasure);
    const lines = wrapSegments(ctx, segments, shape.noWrap ? Infinity : Math.max(1, contentW - paraLeftPad));
    const largestFs=Math.max((para.defaultFontSize||18)*fScale,...segments.map(seg=>seg.fontSize||0));
    totalContentH += paragraphSpace(para,'spaceBefore',largestFs,scale)+paragraphSpace(para,'spaceAfter',largestFs,scale);
    for (const line of lines) {
      const maxFs = Math.max(...line.map(seg => seg.fontSize || 0), (para.defaultFontSize || 18) * fScale);
      totalContentH += paragraphLineHeight(para, maxFs, scale, shape.lineSpacingReduction || 0, ctx, line);
    }
  }

  let startY = sy + padT;
  if (shape.anchor === 'ctr') {
    startY = sy + padT + Math.max(0, (sh - padT - padB - totalContentH) / 2);
  } else if (shape.anchor === 'b') {
    startY = sy + sh - padB - totalContentH;
  }

  let curY = startY;
  const autoNum = { n: 1 };

  for (const [paragraphIndex, para] of shape.paragraphs.entries()) {
    const paintParagraph = !shape._paragraphFilter || shape._paragraphFilter.includes(paragraphIndex);
    const paraLeftPad = (para.marginLeft || 0) * scale;
    const segments = paragraphSegments(para, scale, fScale, defaultTextColor, autoNum);
    const largestFs=Math.max((para.defaultFontSize||18)*fScale,...segments.map(seg=>seg.fontSize||0));
    const spaceBefore=paragraphSpace(para,'spaceBefore',largestFs,scale),spaceAfter=paragraphSpace(para,'spaceAfter',largestFs,scale);
    curY += spaceBefore;
    const lineStartX = sx + padL + paraLeftPad;
    const lines = wrapSegments(ctx, segments, shape.noWrap ? Infinity : Math.max(1, contentW - paraLeftPad));

    // Draw each line
    for (const line of lines) {
      let maxFs = (para.defaultFontSize || 18) * fScale;
      for (const s of line) { if (s.fontSize > maxFs) maxFs = s.fontSize; }
      const lineH = paragraphLineHeight(para, maxFs, scale, shape.lineSpacingReduction || 0, ctx, line);

      // Calculate line width for alignment
      let totalLineW = 0;
      for (const s of line) {
        ctx.font = s.font;
        totalLineW += s.width;
      }

      let drawX = lineStartX;
      if (para.align === 'center') drawX = lineStartX + (contentW - paraLeftPad - totalLineW) / 2;
      else if (para.align === 'right') drawX = lineStartX + contentW - paraLeftPad - totalLineW;

      const baselineY = curY + paragraphFontMetrics(para, maxFs, scale, ctx, line).ascent;

      for (const seg of line) {
        if (!paintParagraph) { drawX += seg.width; continue; }
        ctx.font = seg.font;
        // Letter spacing (OOXML spc in 1/100 pt)
        if (seg.letterSpacing && ctx.letterSpacing !== undefined) {
          ctx.letterSpacing = `${ptToPx(seg.letterSpacing) * scale}px`;
        } else if (ctx.letterSpacing !== undefined) {
          ctx.letterSpacing = '0px';
        }
        // Hyperlinks: blue + underline
        const isLink = !!seg.hlinkRid;
        ctx.fillStyle = seg.color || '#000';

        let segY = baselineY;
        if (seg.baseline != null) segY = baselineY - ptToPx(seg.fontSize || maxFs) * scale * seg.baseline / 100;

        const segmentX=seg.bullet ? lineStartX+(para.hangingIndent||0)*scale : drawX;
        shape._recordTextPaint?.(ctx,{text:seg.text,x:segmentX,y:segY,width:seg.bullet?seg.bulletWidth:seg.width,bullet:seg.bullet});
        const tw = seg.width,decorationX=drawX;
        const paintTextSegment=target=>{
        target.font=seg.font;target.fillStyle=seg.color||'#000';
        if(target.letterSpacing!==undefined)target.letterSpacing=seg.letterSpacing?`${ptToPx(seg.letterSpacing)*scale}px`:'0px';
        target.fillText(seg.text,segmentX,segY);

        const segFs = seg.fontSize || maxFs;
        const ulOffset = Math.max(2, ptToPx(segFs) * scale * 0.12);
        if (seg.underline || isLink) {
          target.beginPath();
          target.strokeStyle = seg.color || '#000';
          target.lineWidth = Math.max(1, scale);
          target.moveTo(decorationX, segY + ulOffset);
          target.lineTo(decorationX + tw, segY + ulOffset);
          target.stroke();
        }
        if (seg.strike) {
          target.beginPath();
          target.strokeStyle = seg.color || '#000';
          target.lineWidth = Math.max(1, scale);
          const strikeY = segY - ptToPx(segFs) * scale * 0.35;
          target.moveTo(decorationX, strikeY);
          target.lineTo(decorationX + tw, strikeY);
          target.stroke();
        }
        };
        if(shape._textEffectJobs&&seg.effects?.length&&textEffectsSupported(seg.effects)){
          const metrics=ctx.measureText(seg.text),left=segmentX-metrics.actualBoundingBoxLeft,right=segmentX+metrics.actualBoundingBoxRight;
          let top=segY-metrics.actualBoundingBoxAscent,bottom=segY+metrics.actualBoundingBoxDescent;
          if(seg.underline||isLink)bottom=Math.max(bottom,segY+ulOffset+Math.max(1,scale)/2);
          if(seg.strike)top=Math.min(top,segY-ptToPx(segFs)*scale*.35-Math.max(1,scale)/2);
          const owner=seg.effectOwner||seg,job=shape._textEffectJobs.get(owner)||{effects:seg.effects,owner:{paragraph:paragraphIndex,run:seg.effectRunIndex,source:seg.effectSource},transform:ctx.getTransform(),paints:[],left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
          job.paints.push(paintTextSegment);job.left=Math.min(job.left,left);job.top=Math.min(job.top,top);job.right=Math.max(job.right,right);job.bottom=Math.max(job.bottom,bottom);shape._textEffectJobs.set(owner,job);
        }else paintTextSegment(ctx);
        drawX += tw;
      }
      curY += lineH;
    }
    curY += spaceAfter;
  }
  if (isVert) ctx.restore();
}

// ── Chart renderer (basic bar/line/pie from chart XML) ──
async function renderChartFill(ctx, fillNode, bounds, zip, chartPartPath, scale = 1, relationships=null) {
  const relMap = relationships||await buildRelMapForPath(zip, chartPartPath), urls = [];
  const model = parseDrawingFill(fillNode, { parseColor:captureColorParser(), renderingProfile:'office', resolveRelationship: id => relMap[id] });
  try {
    await renderDrawingFill(ctx, model, bounds, { parseColor:model.colorParser||captureColorParser(), renderingProfile:'office', shapeTransform:ctx.getTransform(),
      resolveImage: target => loadZipFillImage(zip, resolvePath(target), urls), dpi:96*scale });
  } finally { for (const url of urls) URL.revokeObjectURL(url); }
}

async function renderChartEffects(ctx, effectNode, bounds, paint, shape, zip, scale, options={}) {
  const colorParser=captureColorParser(),urls=[];
  const relationships=options.relationships||await buildRelMapForPath(zip,options.chartPartPath||resolvePath(shape.chartTarget));
  const effects=parseDrawingEffects(effectNode,{parseColor:colorParser,renderingProfile:'office',resolveRelationship:id=>relationships[id]});
  // Chart marks use the frame's local coordinates. Remove that frame from
  // the incoming context so effect directions and reflection anchors can be
  // evaluated in the slide coordinate system, independently of frame rotation.
  const kx=options.kx,ky=options.ky,m=shapeAffine(shape);
  const frame=new DOMMatrix([m[0],m[1]*ky/kx,m[2]*kx/ky,m[3],m[4]*kx,m[5]*ky]);
  const base=ctx.getTransform().multiply(frame.inverse());
  const corners=[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y],[bounds.x,bounds.y+bounds.height],[bounds.x+bounds.width,bounds.y+bounds.height]].map(([x,y])=>frame.transformPoint({x,y}));
  const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
  const worldBounds={x:left,y:top,width:Math.max(...corners.map(p=>p.x))-left,height:Math.max(...corners.map(p=>p.y))-top};
  ctx.save();
  try {
    ctx.setTransform(base);
    return await renderDrawingEffects(ctx,effects,worldBounds,async context=>{
      context.save();try{context.transform(frame.a,frame.b,frame.c,frame.d,frame.e,frame.f);await paint(context);}finally{context.restore();}
    },{parseColor:colorParser,renderingProfile:'office',dpi:96*scale,localBounds:bounds,shapeTransform:frame,container:'chartPrimitive',
      resolveImage:target=>loadZipFillImage(zip,resolvePath(target),urls)});
  } finally {ctx.restore();for(const url of urls)URL.revokeObjectURL(url);}
}

async function drawChart(ctx, shape, sx, sy, sw, sh, scale, zip) {
  shape.chartRenderEvidence = null;
  const result = await renderPptxChart({ ctx, shape, bounds: { x:sx, y:sy, width:sw, height:sh }, scale, zip,
    helpers: { loadZip: async buffer => (await ensureJSZip()).loadAsync(buffer), defaultFont: resolveFont(themeFontMinor), parseXml, parseColor, qn, qnAll, dn, dnAll, resolvePath, ptToPx, drawTextShape, resolveFont, parseLine, renderChartFill:(context,node,rect,archive,part,options)=>renderChartFill(context,node,rect,archive,part,scale,options?.relationships), renderChartEffects:(context,node,rect,paint,options)=>renderChartEffects(context,node,rect,paint,shape,zip,scale,{...options,kx:sw/shape.w,ky:sh/shape.h}), getChartThemeColors:()=>structuredClone(themeColors),getChartThemeFormat:()=>structuredClone(themeFormat),
      getChartPalette: () => ['accent1','accent2','accent3','accent4','accent5','accent6'].map(key => themeColors[key] || '#4472c4') } });
  shape.chartRenderEvidence = { target:shape.chartTarget, families:result.model.groups.map(group=>group.family), markCount:result.marks.length,effectPrimitiveCount:result.model.effectRenderEvidence?.length||0,effectOwners:result.model.effectRenderEvidence||[] };
  return result;
}

function drawTable(ctx, shape, sx, sy, sw, sh, scale, zip, objectUrls=[], preparedStyles=null) {
  if (!shape.rows || !shape.rows.length) return;
  const rowCount = shape.rows.length;
  const colCount = Math.max(...shape.rows.map(r => r.length));
  if (!colCount) return;

  // Calculate column positions from parsed widths or equal distribution
  const totalGridW = shape.colWidths?.length ? shape.colWidths.reduce((a, b) => a + b, 0) : 1;
  const colXs = [0]; // cumulative x positions as fraction of sw
  if (shape.colWidths?.length && totalGridW > 0) {
    let acc = 0;
    for (const w of shape.colWidths) { acc += w; colXs.push(acc / totalGridW); }
  } else {
    for (let i = 1; i <= colCount; i++) colXs.push(i / colCount);
  }

  // Row positions from parsed heights or equal distribution
  const totalGridH = shape.rowHeights?.length ? shape.rowHeights.reduce((a, b) => a + b, 0) : 1;
  const rowYs = [0];
  if (shape.rowHeights?.length && totalGridH > 0) {
    let acc = 0;
    for (const h of shape.rowHeights) { acc += h; rowYs.push(acc / totalGridH); }
  } else {
    for (let i = 1; i <= rowCount; i++) rowYs.push(i / rowCount);
  }

  const fillModels=[shape.tableDrawingFill,...shape.rows.flat().map(cell=>cell.drawingFill)];
  if(!preparedStyles&&fillModels.some(fill=>fill&&!['solidFill','noFill'].includes(fill.kind))) {
    return (async()=>{
      const styles=new Map();
      const prepare=async(key,fill,bounds)=>{
        if(fill)styles.set(key,await createDrawingFillStyle(ctx,fill,bounds,drawingFillOptions(ctx,{...shape,drawingFill:fill,geometry:parseGeometry(null)},zip,objectUrls,scale,bounds)));
      };
      await prepare(shape,shape.tableDrawingFill,{x:sx,y:sy,width:sw,height:sh});
      for(let ri=0;ri<rowCount;ri++)for(let ci=0;ci<shape.rows[ri].length;ci++) {
        const cell=shape.rows[ri][ci];if(cell.hMerge||cell.vMerge)continue;
        const endCol=Math.min(ci+(cell.gridSpan||1),colXs.length-1),endRow=Math.min(ri+(cell.rowSpan||1),rowYs.length-1);
        await prepare(cell,cell.drawingFill,{x:sx+colXs[ci]*sw,y:sy+rowYs[ri]*sh,width:(colXs[endCol]-colXs[ci])*sw,height:(rowYs[endRow]-rowYs[ri])*sh});
      }
      return drawTable(ctx,shape,sx,sy,sw,sh,scale,zip,objectUrls,styles);
    })();
  }
  const resolvedStyle=(key,fill,legacy,bounds)=>{
    if(fill){if(preparedStyles?.has(key))return preparedStyles.get(key);return fill.kind==='solidFill'?fill.color:null;}
    const gradient=legacy?.startsWith?.('linear-gradient')?parseGradientStops(legacy):null;
    return gradient?applyGradientFill(ctx,gradient,bounds.x,bounds.y,bounds.width,bounds.height):legacy;
  };
  const backgroundStyle=resolvedStyle(shape,shape.tableDrawingFill,shape.tableBackground,{x:sx,y:sy,width:sw,height:sh});
  if(backgroundStyle!=null){ctx.fillStyle=backgroundStyle;ctx.fillRect(sx,sy,sw,sh);}

  const padding = 4 * scale;
  const defaultFamily = resolveFont(themeFontMinor) || 'sans-serif';
  const defaultTextColor = themeColors.tx1 || '#1e293b';

  for (let ri = 0; ri < rowCount; ri++) {
    const row = shape.rows[ri];
    let colIdx = 0;
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci];
      // Every tc occupies one grid slot; merged continuation cells remain present.
      colIdx = ci;
      if (cell.hMerge || cell.vMerge) continue;

      const cx = sx + colXs[colIdx] * sw;
      const cy = sy + rowYs[ri] * sh;
      const endCol = Math.min(colIdx + (cell.gridSpan || 1), colXs.length - 1);
      const endRow = Math.min(ri + (cell.rowSpan || 1), rowYs.length - 1);
      const cw = (colXs[endCol] - colXs[colIdx]) * sw;
      const ch = (rowYs[endRow] - rowYs[ri]) * sh;
      colIdx++;

      // Prepared styles retain native patterns, image alpha and Office gradients.
      const cellStyle=resolvedStyle(cell,cell.drawingFill,cell.fill,{x:cx,y:cy,width:cw,height:ch});
      if(cellStyle!=null){ctx.fillStyle=cellStyle;ctx.fillRect(cx,cy,cw,ch);}
      // Cell borders (per-side)
      const bdr = cell.borders || {};
      const drawBorder = (x1, y1, x2, y2, side) => {
        const b = bdr[side];
        if (!b?.color) return;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b ? Math.max(b.width * scale, scale) : scale;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      };
      drawBorder(cx, cy, cx + cw, cy, 't');
      drawBorder(cx, cy + ch, cx + cw, cy + ch, 'b');
      drawBorder(cx, cy, cx, cy + ch, 'l');
      drawBorder(cx + cw, cy, cx + cw, cy + ch, 'r');

      ctx.save();
      ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
      drawTextShape(ctx, { paragraphs: cell.paragraphs, margin: cell.margin, anchor: cell.anchor,
        bgColor: cell.fill, fontScale: 100 }, cx, cy, cw, ch, scale, {}, shape.bgColor);

      ctx.restore();
    }
  }
}

function drawingFillOptions(ctx,shape,zip,objectUrls,scale,bounds) {
  const rad=(shape.rot||0)*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),fx=shape.flipH?-1:1,fy=shape.flipV?-1:1;
  const cx=(shape.x+shape.w/2)*scale,cy=(shape.y+shape.h/2)*scale;
  const local=[c*fx,s*fx,-s*fy,c*fy,cx-c*fx*cx+s*fy*cy,cy-s*fx*cx-c*fy*cy];
  const scaleGroup=fill=> {
    if(!fill)return null;
    const parentBounds={x:fill.bounds.x*scale,y:fill.bounds.y*scale,width:fill.bounds.width*scale,height:fill.bounds.height*scale};
    const transform=multiplyAffine(inverseAffine(local),[...(fill.transform||[1,0,0,1,0,0]).slice(0,4),(fill.transform?.[4]||0)*scale,(fill.transform?.[5]||0)*scale]);
    return {model:fill.model,bounds:parentBounds,transform,geometryBounds:parentBounds,geometryKind:'preset',presetName:'rect',geometryPaths:buildGeometryPaths(parseGeometry(null),parentBounds),shapeTransform:ctx.getTransform().multiply(new DOMMatrix(transform))};
  };
  const geometry=shape.geometry||parseGeometry(null),paths=buildGeometryPaths(geometry,bounds);
  return {geometryBounds:paths.fillBounds,geometryKind:geometry.kind,presetName:geometry.name,parseColor:shape.drawingFill?.colorParser||captureColorParser(),renderingProfile:'office',groupFill:scaleGroup(shape.groupFill),parentGroupFill:scaleGroup(shape.parentGroupFill),dpi:96*scale,shapeTransform:ctx.getTransform(),geometryPaths:paths,
    resolveImage:target=>loadZipFillImage(zip,resolvePath(target),objectUrls)};
}
async function paintSlideBackground(ctx,slideData,zip,objectUrls,scale) {
  const bounds={x:0,y:0,width:ctx.canvas.width,height:ctx.canvas.height};
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,bounds.width,bounds.height);
  if(slideData.backgroundFill) {
    await renderDrawingFill(ctx,slideData.backgroundFill,bounds,drawingFillOptions(ctx,{drawingFill:slideData.backgroundFill},zip,objectUrls,scale,bounds));
  } else {
    const gradient=slideData.bgColor?.startsWith?.('linear-gradient')?parseGradientStops(slideData.bgColor):null;
    ctx.fillStyle=gradient?applyGradientFill(ctx,gradient,0,0,bounds.width,bounds.height):slideData.bgColor||'#ffffff';ctx.fillRect(0,0,bounds.width,bounds.height);
    if(slideData.bgImage)ctx.drawImage(slideData.bgImage,0,0,bounds.width,bounds.height);
  }
}

function shapeAffine(shape) {
  const rad=(shape.rot||0)*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),fx=shape.flipH?-1:1,fy=shape.flipV?-1:1;
  const cx=shape.x+shape.w/2,cy=shape.y+shape.h/2;
  return multiplyAffine(shape.groupTransform||[1,0,0,1,0,0],[c*fx,s*fx,-s*fy,c*fy,cx-c*fx*cx+s*fy*cy,cy-s*fx*cx-c*fy*cy]);
}
async function drawShapeOnCanvas(ctx, shape, zip, canvasW, canvasH, slideSize, scale, objectUrls, slideBgColor) {
  if (!shape.drawingEffects?.length) return paintShapeOnCanvas(ctx,shape,zip,canvasW,canvasH,slideSize,scale,objectUrls,slideBgColor);
  if (shape._paragraphFilter) throw new Error('unverified-subshape-drawing-effects');
  const kx=canvasW/slideSize.w,ky=canvasH/slideSize.h,m=shapeAffine(shape);
  const localBounds={x:shape.x*kx,y:shape.y*ky,width:shape.w*kx,height:shape.h*ky};
  const shapeTransform=[m[0],m[1]*ky/kx,m[2]*kx/ky,m[3],m[4]*kx,m[5]*ky];
  const bounds=shapeBounds(shape,false),finalBounds={x:bounds.x*kx,y:bounds.y*ky,width:bounds.w*kx,height:bounds.h*ky};
  if(!(finalBounds.width>0&&finalBounds.height>0))return paintShapeOnCanvas(ctx,{...shape,shadow:null},zip,canvasW,canvasH,slideSize,scale,objectUrls,slideBgColor);
  const fillOptions=drawingFillOptions(ctx,shape,zip,objectUrls,scale,localBounds);
  return renderDrawingEffects(ctx,shape.drawingEffects,finalBounds,
    async context=>{const painted={...shape,shadow:null};await paintShapeOnCanvas(context,painted,zip,canvasW,canvasH,slideSize,scale,objectUrls,slideBgColor);if(shape.type==='chart')shape.chartRenderEvidence=painted.chartRenderEvidence;shape.textEffectRenderEvidence=painted.textEffectRenderEvidence;},
    {...fillOptions,localBounds,shapeTransform,container:'spPr'});
}

function textEffectsSupported(effects){return effects.every(effect=>['outerShdw','glow','innerShdw'].includes(effect.kind));}
async function paintTextEffectJobs(ctx,jobs,baseTransform,scale){
  const evidence=[];
  for(const job of jobs.values()){
    if(!(job.right>job.left&&job.bottom>job.top))continue;
    const localBounds={x:job.left,y:job.top,width:job.right-job.left,height:job.bottom-job.top};
    const basis=baseTransform.inverse().multiply(job.transform);
    const points=[[job.left,job.top],[job.right,job.top],[job.left,job.bottom],[job.right,job.bottom]].map(([x,y])=>basis.transformPoint({x,y}));
    const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bounds={x:left,y:top,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-top};
    ctx.save();try{ctx.setTransform(baseTransform);await renderDrawingEffects(ctx,job.effects,bounds,async target=>{target.save();try{target.transform(basis.a,basis.b,basis.c,basis.d,basis.e,basis.f);for(const paint of job.paints)paint(target);}finally{target.restore();}},
      {dpi:96*scale,renderingProfile:'office',localBounds,shapeTransform:basis,container:'rPr'});
      evidence.push({owner:job.owner,effects:job.effects.map(effect=>effect.kind),paintSegmentCount:job.paints.length,localInkBounds:localBounds,worldInkBounds:bounds,transform:[basis.a,basis.b,basis.c,basis.d,basis.e,basis.f]});
    }finally{ctx.restore();}
  }
  return evidence;
}
async function paintShapeOnCanvas(ctx, shape, zip, canvasW, canvasH, slideSize, scale, objectUrls, slideBgColor) {
  const shapeBaseTransform=ctx.getTransform();
  const sx = shape.x / slideSize.w * canvasW;
  const sy = shape.y / slideSize.h * canvasH;
  const sw = shape.w / slideSize.w * canvasW;
  const sh = shape.h / slideSize.h * canvasH;

  ctx.save();
  if (shape.groupTransform) {
    const [a, b, c, d, e, f] = shape.groupTransform;
    const kx = canvasW / slideSize.w, ky = canvasH / slideSize.h;
    ctx.transform(a, b * ky / kx, c * kx / ky, d, e * kx, f * ky);
  }
  // Shape rotation applies outside flips: T(center) * R * F * T(-center).
  if (shape.rot || shape.flipH || shape.flipV) {
    const cx = sx + sw / 2, cy = sy + sh / 2;
    ctx.translate(cx, cy);
    if (shape.rot) ctx.rotate(shape.rot * Math.PI / 180);
    ctx.scale(shape.flipH ? -1 : 1, shape.flipV ? -1 : 1);
    ctx.translate(-cx, -cy);
  }

  if (shape.type === 'image') {
    if(shape.shadow){ctx.shadowColor=shape.shadow.color;ctx.shadowBlur=shape.shadow.blur*scale;ctx.shadowOffsetX=shape.shadow.dx*scale;ctx.shadowOffsetY=shape.shadow.dy*scale;}
    if (shape.drawingFill) {
      ctx.save();
      clipGeometry(ctx, shape.geometry || parseGeometry(null), {x:sx,y:sy,width:sw,height:sh});
      const fillOptions=drawingFillOptions(ctx,shape,zip,objectUrls,scale,{x:sx,y:sy,width:sw,height:sh});
      if(fillOptions.geometryBounds)await renderDrawingFill(ctx, shape.drawingFill, {x:sx,y:sy,width:sw,height:sh},fillOptions);
      ctx.restore();
      if (shape.line) {
        ctx.strokeStyle=shape.line.color;ctx.lineWidth=shape.line.width*scale;
        if(shape.line.dash)ctx.setLineDash(shape.line.dash.map(v=>v*scale));
        if(shape.line.cap)ctx.lineCap=shape.line.cap;
        drawGeometry(ctx,shape.geometry||parseGeometry(null),{x:sx,y:sy,width:sw,height:sh},{fill:false,stroke:true});
        if(shape.line.dash)ctx.setLineDash([]);
      }
    } else {
    // Clip to shape geometry for images
    if (shape.geometry) clipGeometry(ctx, shape.geometry, { x: sx, y: sy, width: sw, height: sh });
    const imgPath = resolvePath(shape.target);
    try {
      const img = await loadZipImage(zip, imgPath, objectUrls);
      if (!img) throw new Error('Missing or invalid image part: ' + imgPath);
      if (img) {
        const imgW = img.width, imgH = img.height;
        // Apply srcRect cropping (values are fractions 0-1)
        const crop = shape.srcRect;
        const srcX = crop ? imgW * crop.l : 0;
        const srcY = crop ? imgH * crop.t : 0;
        const srcW = crop ? imgW * (1 - crop.l - crop.r) : imgW;
        const srcH = crop ? imgH * (1 - crop.t - crop.b) : imgH;

        if (shape.fillMode === 'stretch' || crop) {
          // Stretch or cropped → draw source region into shape bounds
          const rect = shape.imageFillRect || {l:0,t:0,r:0,b:0};
          ctx.drawImage(img, srcX, srcY, srcW, srcH, sx+rect.l*sw, sy+rect.t*sh, sw*(1-rect.l-rect.r), sh*(1-rect.t-rect.b));
        } else {
          // Cover-fit: fill shape bounds, crop excess (matches PPT behavior)
          const imgAspect = srcW / srcH;
          const shapeAspect = sw / sh;
          let dw, dh, dx, dy;
          if (imgAspect > shapeAspect) {
            dh = sh; dw = sh * imgAspect; dy = sy; dx = sx + (sw - dw) / 2;
          } else {
            dw = sw; dh = sw / imgAspect; dx = sx; dy = sy + (sh - dh) / 2;
          }
          ctx.drawImage(img, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
        }
      }
    } catch (error) { throw error; }
    }
  } else if (shape.type === 'table') {
    await drawTable(ctx, shape, sx, sy, sw, sh, scale,zip,objectUrls);
  } else if (shape.type === 'chart') {
    await drawChart(ctx, shape, sx, sy, sw, sh, scale, zip);
  } else if (shape.type === 'text') {
    const geom = shape.geom || 'rect';
    const isRect = geom === 'rect';

    // Apply shadow effect before fill
    if (shape.shadow) {
      ctx.shadowColor = shape.shadow.color;
      ctx.shadowBlur = shape.shadow.blur * scale;
      ctx.shadowOffsetX = shape.shadow.dx * scale;
      ctx.shadowOffsetY = shape.shadow.dy * scale;
    }

    const bounds={x:sx,y:sy,width:sw,height:sh};
    const fillOptions=drawingFillOptions(ctx,shape,zip,objectUrls,scale,bounds);
    const fillStyle=shape.drawingFill&&fillOptions.geometryBounds ? await createDrawingFillStyle(ctx,shape.drawingFill,bounds,fillOptions) : null;
    const hasFill=shape.drawingFill ? fillStyle != null : !!shape.bgColor;
    if (hasFill || shape.line) {
      const gradInfo = shape.bgColor?.startsWith?.('linear-gradient') ? parseGradientStops(shape.bgColor) : null;
      if (hasFill) ctx.fillStyle = shape.drawingFill ? fillStyle : gradInfo ? applyGradientFill(ctx, gradInfo, sx, sy, sw, sh) : shape.bgColor;
      if (shape.line) {
        ctx.strokeStyle = shape.line.color; ctx.lineWidth = shape.line.width * scale;
        if (shape.line.dash) ctx.setLineDash(shape.line.dash.map(v => v * scale));
        if (shape.line.cap) ctx.lineCap = shape.line.cap;
      }
      drawGeometry(ctx, shape.geometry || parseGeometry(null), { x: sx, y: sy, width: sw, height: sh }, {
        fill: hasFill, stroke: !!shape.line,
        fillPath: (context, path) => {
          const base = context.fillStyle;
          if (typeof base === 'string') { context.fillStyle = geometryFillStyle(context, base, path.fill); context.fill(path.path); context.fillStyle = base; }
          else {
            context.save(); context.clip(path.path); context.fill(path.path);
            const modes = { lighten: ['#fff', 0.4], lightenLess: ['#fff', 50 / 255], darken: ['#000', 0.4], darkenLess: ['#000', 50 / 255] };
            const shade = modes[path.fill];
            if (!shade) throw new Error('Unsupported geometry fill mode: ' + path.fill);
            context.fillStyle = shade[0]; context.globalAlpha *= shade[1]; context.fill(path.path); context.restore();
          }
        }
      });
      if (shape.line?.dash) ctx.setLineDash([]);
    }
    // Reset shadow before text rendering
    if (shape.shadow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Draw text
    if (shape.paragraphs && shape.paragraphs.length) {
      const rect = buildGeometryPaths(shape.geometry || parseGeometry(null), { x: sx, y: sy, width: sw, height: sh }).textRect;
      const jobs=new Map(),baseTransform=shapeBaseTransform;
      drawTextShape(ctx, {...shape,_textEffectJobs:jobs}, rect.l, rect.t, rect.r - rect.l, rect.b - rect.t, scale, {}, slideBgColor);
      shape.textEffectRenderEvidence=await paintTextEffectJobs(ctx,jobs,baseTransform,scale);
    }
  }

  ctx.restore();
}

// Collect visual shapes from a layout/master document (design elements)
function collectDocShapes(doc, relMap, phStyles) {
  const shapes = [];
  const spTree = dn(doc, NS_P, 'spTree');
  if (!spTree) return shapes;
  const shapeTypes = new Set(['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame']);
  for (const child of spTree.children) {
    if (child.namespaceURI !== NS_P || !shapeTypes.has(child.localName)) continue;
    // Skip placeholder shapes (text content handled by slide's own placeholders)
    if (extractPhFromShape(child)) continue;
    if (child.localName === 'grpSp') {
      shapes.push(...parseGroupShapes(child, relMap, phStyles));
    } else {
      const s = parseShape(child, relMap, phStyles);
      if (s) shapes.push(s);
    }
  }
  return shapes;
}

// Build a relMap for a given XML file's rels
async function buildRelMapForPath(zip, xmlPath) {
  const dir = xmlPath.replace(/[^/]+$/, '');
  const fileName = xmlPath.split('/').pop();
  const relsPath = dir + '_rels/' + fileName + '.rels';
  const relsStr = await zip.file(relsPath)?.async('string').catch(() => null);
  const relMap = {};
  if (relsStr) {
    const doc = parseXml(relsStr);
    for (const rel of doc.getElementsByTagNameNS('*', 'Relationship')) {
      const id = rel.getAttribute('Id'), t = rel.getAttribute('Target');
      if (id && t && rel.getAttribute('TargetMode') !== 'External') relMap[id] = '/' + resolvePathFrom(dir, t);
    }
  }
  return relMap;
}

// Collect shapes from layout and master (rendered behind slide content)
async function getLayoutShapes(relsXml, zip, phStyles, includeMaster = true) {
  const masterShapes = [];
  const layoutShapes = [];
  if (!relsXml) return [];
  try {
    const relsDoc = parseXml(relsXml);
    let layoutTarget = null;
    for (const rel of relsDoc.getElementsByTagNameNS('*', 'Relationship')) {
      const t = rel.getAttribute('Target') || '';
      if (rel.getAttribute('Type')?.endsWith('/slideLayout') && rel.getAttribute('TargetMode') !== 'External') { layoutTarget = t; break; }
    }
    if (!layoutTarget) return [];
    const layoutPath = resolvePath(layoutTarget);
    const layoutXmlStr = await zip.file(layoutPath)?.async('string');
    if (!layoutXmlStr) return [];
    const layoutRelMap = await buildRelMapForPath(zip, layoutPath);
    const layoutDoc = await parseShapePartXml(layoutXmlStr, zip, layoutRelMap);
    for (const id of layoutDoc._chartFallbacks || []) log({pptxChartFallbackUsed:{part:layoutPath,relationshipId:id,target:layoutRelMap[id],detail:"unsupported-extension-layout"}});

    // Check if layout wants to show master shapes (default: yes)
    const cSld = dn(layoutDoc, NS_P, 'cSld');
    const showMasterSp = optionalBool(layoutDoc.documentElement, 'showMasterSp') !== false;

    // Collect master shapes first (bottom layer)
    if (showMasterSp && includeMaster) {
      const layoutRelsPath = partRelsPath(layoutPath);
      const layoutRelsStr = await zip.file(layoutRelsPath)?.async('string').catch(() => null);
      if (layoutRelsStr) {
        const layoutRelsDoc = parseXml(layoutRelsStr);
        let masterTarget = null;
        for (const rel of layoutRelsDoc.getElementsByTagNameNS('*', 'Relationship')) {
          const t = rel.getAttribute('Target') || '';
          if (rel.getAttribute('Type')?.endsWith('/slideMaster') && rel.getAttribute('TargetMode') !== 'External') { masterTarget = t; break; }
        }
        if (masterTarget) {
          const masterPath = resolvePathFrom(layoutPath.replace(/[^/]+$/, ''), masterTarget);
          const masterXmlStr = await zip.file(masterPath)?.async('string');
          if (masterXmlStr) {
            const masterRelMap = await buildRelMapForPath(zip, masterPath);
            const masterDoc = await parseShapePartXml(masterXmlStr, zip, masterRelMap);
            for (const id of masterDoc._chartFallbacks || []) log({pptxChartFallbackUsed:{part:masterPath,relationshipId:id,target:masterRelMap[id],detail:"unsupported-extension-layout"}});
            masterShapes.push(...collectDocShapes(masterDoc, masterRelMap, phStyles));
          }
        }
      }
    }

    // Collect layout shapes (middle layer, above master)
    layoutShapes.push(...collectDocShapes(layoutDoc, layoutRelMap, phStyles));
  } catch (error) { throw error; }
  return [...masterShapes, ...layoutShapes];
}

async function expandSmartArt(shape, zip, phStyles) {
  const dataPath=shape.diagramTargets.dm?resolvePath(shape.diagramTargets.dm):null;
  const dataXml=dataPath?await zip.file(dataPath)?.async('string'):null;
  if(!dataXml)throw new Error('SmartArt diagram data part is missing');
  const data=parseXml(dataXml),extension=dn(data,'http://schemas.microsoft.com/office/drawing/2008/diagram','dataModelExt');
  const drawingId=extension?.getAttribute('relId');
  let drawingPath=drawingId&&shape.relationships[drawingId]?resolvePath(shape.relationships[drawingId]):null;
  if(!drawingPath) drawingPath=relationshipPath(await zip.file(partRelsPath(dataPath))?.async('string'),dataPath,'diagramDrawing');
  if(!drawingPath)throw new Error('SmartArt requires diagram layout generation: drawing cache not present');
  const drawingXml=await zip.file(drawingPath)?.async('string');
  if(!drawingXml)throw new Error('SmartArt diagram drawing part is missing: '+drawingPath);
  const drawing=parseXml(drawingXml),NS_DSP='http://schemas.microsoft.com/office/drawing/2008/diagram';
  const tree=dn(drawing,NS_DSP,'spTree');if(!tree)throw new Error('SmartArt drawing has no shape tree');
  const converted=drawing.implementation.createDocument(NS_P,'p:grpSp');
  const group=converted.documentElement,properties=converted.createElementNS(NS_P,'p:grpSpPr'),transform=converted.createElementNS(NS_A,'a:xfrm');
  for(const [tag,attributes]of [['off',{x:shape.x*EMU_PX,y:shape.y*EMU_PX}],['ext',{cx:shape.w*EMU_PX,cy:shape.h*EMU_PX}],['chOff',{x:0,y:0}],['chExt',{cx:shape.w*EMU_PX,cy:shape.h*EMU_PX}]]) {
    const child=converted.createElementNS(NS_A,'a:'+tag);for(const [key,value]of Object.entries(attributes))child.setAttribute(key,String(value));transform.append(child);
  }
  if(shape.rot)transform.setAttribute('rot',String(shape.rot*60000));if(shape.flipH)transform.setAttribute('flipH','1');if(shape.flipV)transform.setAttribute('flipV','1');properties.append(transform);group.append(properties);
  const convert=element=>{
    const ns=element.namespaceURI===NS_DSP?NS_P:element.namespaceURI;
    const node=converted.createElementNS(ns,(ns===NS_P?'p:':ns===NS_A?'a:':(element.prefix?element.prefix+':':''))+element.localName);
    for(const attr of element.attributes)if(attr.namespaceURI!=='http://www.w3.org/2000/xmlns/')node.setAttributeNS(attr.namespaceURI,attr.name,attr.value);
    for(const child of element.childNodes)node.append(child.nodeType===1?convert(child):converted.importNode(child,true));return node;
  };
  for(const child of tree.children)if(['sp','pic','cxnSp','grpSp','graphicFrame'].includes(child.localName))group.append(convert(child));
  const relationships=await buildRelMapForPath(zip,drawingPath);
  const expanded=parseGroupShapes(group,relationships,phStyles);
  if(!expanded.length)throw new Error('SmartArt cached drawing produced no renderable shapes');
  return expanded.map((child,index)=>({...child,sourceId:`${shape.sourceId}:diagram:${index}`,groupIds:[...(shape.groupIds||[]),shape.sourceId,...(child.groupIds||[])],inherited:shape.inherited,
    groupTransform:multiplyAffine(shape.groupTransform||[1,0,0,1,0,0],child.groupTransform||[1,0,0,1,0,0])}));
}

async function buildSlideCanvas(slideXmlStr, relsXml, zip, slideSize, objectUrls, slidePath = null) {
  await loadTableStyles(zip);
  if (slidePath) { await parseTheme(zip, slidePath); relsXml = normalizeRelationships(relsXml, slidePath); }
  const relMap = buildRelMap(relsXml);
  const slideDoc = await parseShapePartXml(slideXmlStr, zip, relMap);
  for (const id of slideDoc._chartFallbacks || []) log({pptxChartFallbackUsed:{part:slidePath,relationshipId:id,target:relMap[id],detail:"unsupported-extension-layout"}});
  const bgColor = await getLayoutBg(slideDoc, relsXml, zip) || '#ffffff';

  // Get placeholder text styles from layout/master for font size inheritance
  const phStyles = await getPlaceholderStyles(relsXml, zip);

  const backgroundFill=await getDrawingBackground(slideDoc,relsXml,zip,slidePath);
  const bgImage=null;

  // Collect layout shapes first (design elements behind slide content)
  const layoutShapes = await getLayoutShapes(relsXml, zip, phStyles, optionalBool(slideDoc.documentElement, 'showMasterSp') !== false);

  // Collect slide shapes in document order (preserves z-order: later elements render on top)
  const allShapes = layoutShapes.map(shape => ({ ...shape, inherited: true }));
  const spTree = dn(slideDoc, NS_P, 'spTree');
  if (spTree) {
    const shapeTypes = new Set(['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame']);
    for (const child of spTree.children) {
      if (child.namespaceURI !== NS_P || !shapeTypes.has(child.localName)) continue;
      if (child.localName === 'grpSp') {
        allShapes.push(...parseGroupShapes(child, relMap, phStyles));
      } else {
        const s = parseShape(child, relMap, phStyles);
        if (s) allShapes.push(s);
      }
    }
  }

  // Return slide data for rendering — slideBgColor used for text color detection
  for(let index=0;index<allShapes.length;index++) if(allShapes[index].type==='smartart') { const expanded=await expandSmartArt(allShapes[index],zip,phStyles);allShapes.splice(index,1,...expanded);index+=expanded.length-1; }
  for (const shape of allShapes) autoFitShape(shape);
  const playback = parseSlidePlayback(slideDoc, playbackRelationships(relsXml));
  const renderingUnverified=[];
  for(const shape of allShapes)if(shape.textEffectsUnverified || shape.rows?.flat().some(cell=>cell.paragraphs?.some(para=>para.runs.some(run=>(run.effects??para.defaultEffects)?.length)))){
    const failure={code:'unverified-text-run-drawing-effects',detail:String(shape.sourceId),part:slidePath};
    renderingUnverified.push(failure);log({pptxRenderingUnverified:failure});
  }
  const effectTargets=new Set(allShapes.filter(shape=>!shape.inherited&&(shape.drawingEffects?.length||shape.paragraphs?.some(para=>para.runs.some(run=>(run.effects??para.defaultEffects)?.length)))).map(shape=>String(shape.sourceId)));
  const checkEffectTarget=(node,iterated=false)=>{
    const iteration=iterated||!!node.iteration;
    if(effectTargets.has(String(node.shapeId))&&(node.targetIds?.length||iteration)){
      playback.failures.push({code:'unverified-subshape-drawing-effects',detail:String(node.shapeId)});playback.supported=false;
    }
    for(const child of [...(node.children||[]),...(node.subChildren||[])])checkEffectTarget(child,iteration);
  };
  for(const node of playback.timeline)checkEffectTarget(node);

  for (const media of playback.media) {
    const target = allShapes.find(shape => !shape.inherited && shape.sourceId === media.shapeId);
    const affine = target?.groupTransform;
    if (target && (target.rot || target.flipH || target.flipV || (affine && (Math.abs(affine[1]) > 1e-9 || Math.abs(affine[2]) > 1e-9 || affine[0] < 0 || affine[3] < 0)))) {
      playback.failures.push({code:'unsupported-transformed-media',detail:media.shapeId}); playback.supported = false;
    }
  }
  return { bgColor, bgImage, backgroundFill, shapes: allShapes, relMap, slideBgColor: bgColor, theme: snapshotTheme(), playback, renderingUnverified };
}

function renderSlideToCanvas(canvas, slideData, slideSize, zip, objectUrls) {
  restoreTheme(slideData.theme);
  const dpr = window.devicePixelRatio || 1;
  // Use container width to determine canvas size
  const displayW = canvas.parentElement?.clientWidth || canvas.clientWidth || 360;
  const aspect = slideSize.h / slideSize.w;
  const displayH = Math.round(displayW * aspect);

  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.aspectRatio = `${slideSize.w}/${slideSize.h}`;
  canvas.width = Math.round(displayW * dpr);
  canvas.height = Math.round(displayH * dpr);

  const ctx = canvas.getContext('2d');
  const scale = canvas.width / slideSize.w;

  // Draw shapes sequentially (images are async)
  const slideBgColor = slideData.slideBgColor || slideData.bgColor;
  return (async () => {
    await paintSlideBackground(ctx,slideData,zip,objectUrls,scale);
    for (const shape of slideData.shapes) {
      await drawShapeOnCanvas(ctx, shape, zip, canvas.width, canvas.height, slideSize, scale, objectUrls, slideBgColor);
    }
  })();
}

function shapeBounds(shape, includeEffects = true, kx = 1, ky = kx) {
  const m=shapeAffine(shape);
  const corners=[[shape.x,shape.y],[shape.x+shape.w,shape.y],[shape.x,shape.y+shape.h],[shape.x+shape.w,shape.y+shape.h]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
  const left=Math.min(...corners.map(p=>p[0])),top=Math.min(...corners.map(p=>p[1]));
  let bounds={x:left,y:top,width:Math.max(...corners.map(p=>p[0]))-left,height:Math.max(...corners.map(p=>p[1]))-top};
  const textEffects=(shape.paragraphs||[]).flatMap(para=>para.runs.flatMap(run=>textEffectsSupported(run.effects??para.defaultEffects??[])?run.effects??para.defaultEffects??[]:[]));
  const allEffects=[...(shape.drawingEffects||[]),...textEffects];
  if(includeEffects&&allEffects.length){
    const pixelBounds={x:bounds.x*kx,y:bounds.y*ky,width:bounds.width*kx,height:bounds.height*ky};
    const extent=drawingEffectsExtent(allEffects,pixelBounds,{dpi:96*kx,container:'spPr',localBounds:{x:shape.x*kx,y:shape.y*ky,width:shape.w*kx,height:shape.h*ky},shapeTransform:[m[0],m[1]*ky/kx,m[2]*kx/ky,m[3],m[4]*kx,m[5]*ky]});
    const left=Math.floor(extent.x),top=Math.floor(extent.y),right=Math.ceil(extent.x+extent.width),bottom=Math.ceil(extent.y+extent.height);
    bounds={x:left/kx,y:top/ky,width:(right-left)/kx,height:(bottom-top)/ky};
  }
  return {x:bounds.x,y:bounds.y,w:bounds.width,h:bounds.height};
}
// Iteration slices copy pixels from the fully shaped paragraph. No text is
// reflowed or re-rendered, and each alpha pixel belongs to exactly one slice.
function recordIterationPaint(records,ctx,segment) {
  if(!segment.text)return;
  const matrix=ctx.getTransform(),inverse=matrix.inverse(),metrics=ctx.measureText(segment.text);
  const ascent=metrics.fontBoundingBoxAscent||metrics.actualBoundingBoxAscent||1;
  const descent=metrics.fontBoundingBoxDescent||metrics.actualBoundingBoxDescent||1;
  const graphemes=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(segment.text)];
  let prefix='';
  for(const part of graphemes) {
    const start=ctx.measureText(prefix).width;prefix+=part.segment;
    const end=ctx.measureText(prefix).width;
    records.push({text:part.segment,bullet:segment.bullet,x:segment.x+start,y:segment.y-ascent,width:Math.max(0,end-start),height:ascent+descent,inverse});
  }
}
function buildIterationLayers(textCanvas,paragraphLayer,records,shapeId,paragraphIndex,targets,cropBounds) {
  // Joining scripts and standard discretionary ligatures cannot be isolated
  // into glyphs by advance boundaries; retain paragraph targets and fail the
  // missing glyph target explicitly instead of inventing independently shaped text.
  const text=records.filter(record=>!record.bullet).map(record=>record.text).join('');
  if(!records.length||/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Thai}]/u.test(text)||/(?:ff|fi|fl)/i.test(text))return false;
  const ctx=textCanvas.getContext('2d'),original=ctx.getImageData(0,0,textCanvas.width,textCanvas.height);
  const owners=new Int32Array(textCanvas.width*textCanvas.height);owners.fill(-1);
  const bounds=records.map(()=>({left:textCanvas.width,top:textCanvas.height,right:-1,bottom:-1}));
  for(let y=0;y<textCanvas.height;y++)for(let x=0;x<textCanvas.width;x++) {
    const offset=y*textCanvas.width+x;if(!original.data[offset*4+3])continue;
    let owner=0,distance=Infinity;
    for(let i=0;i<records.length;i++) {
      const r=records[i],m=r.inverse,px=m.a*(x+.5)+m.c*(y+.5)+m.e,py=m.b*(x+.5)+m.d*(y+.5)+m.f;
      const dx=Math.max(r.x-px,0,px-r.x-r.width),dy=Math.max(r.y-py,0,py-r.y-r.height);
      const d=dx*dx+dy*dy;if(d<distance){owner=i;distance=d;}
    }
    owners[offset]=owner;const b=bounds[owner];b.left=Math.min(b.left,x);b.top=Math.min(b.top,y);b.right=Math.max(b.right,x);b.bottom=Math.max(b.bottom,y);
  }
  const letters=[];
  for(let i=0;i<records.length;i++) {
    const r=records[i],b=bounds[i],empty=b.right<b.left;
    if(empty){b.left=0;b.top=0;b.right=0;b.bottom=0;}
    const layer=document.createElement('div');layer.className='pptx-glyph-layer';
    layer.style.cssText=`position:absolute;left:${(b.left-cropBounds.left)/cropBounds.width*100}%;top:${(b.top-cropBounds.top)/cropBounds.height*100}%;width:${(b.right-b.left+1)/cropBounds.width*100}%;height:${(b.bottom-b.top+1)/cropBounds.height*100}%;pointer-events:none`;
    const paint=document.createElement('canvas');paint.width=b.right-b.left+1;paint.height=b.bottom-b.top+1;paint.style.cssText='display:block;width:100%;height:100%';
    if(!empty) {
      const context=paint.getContext('2d'),pixels=context.createImageData(paint.width,paint.height);
      for(let y=b.top;y<=b.bottom;y++)for(let x=b.left;x<=b.right;x++) {
        const offset=y*textCanvas.width+x;if(owners[offset]!==i)continue;
        pixels.data.set(original.data.subarray(offset*4,offset*4+4),((y-b.top)*paint.width+x-b.left)*4);
      }
      context.putImageData(pixels,0,0);
    }
    layer.append(paint);paragraphLayer.append(layer);
    if(!r.bullet) {layer.dataset.pptxGlyphIndex=String(letters.length);letters.push({text:r.text,layer});}
  }
  if(shapeId) {
    const prefix=`${shapeId}:p:${paragraphIndex}`;
    letters.forEach((letter,index)=>targets.set(`${prefix}:c:${index}`,[letter.layer]));
    const fullText=letters.map(letter=>letter.text).join(''),wordSegments=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(fullText)];
    let wordIndex=0;
    for(const word of wordSegments)if(word.isWordLike) {
      let offset=0;const layers=[];
      for(const letter of letters) {if(offset>=word.index&&offset<word.index+word.segment.length)layers.push(letter.layer);offset+=letter.text.length;}
      targets.set(`${prefix}:w:${wordIndex++}`,layers);
    }
  }
  return true;
}

// Paint into a detached canvas, then commit atomically. Animation cancellation must
// never allow a late image/font decode to overwrite the restored appearance.
function createShapePaint(records, slideData, canvas, slideSize, zip, objectUrls) {
  const colorParser = captureColorParser();
  const allowed = new Set(['fillColor','strokeColor','fillVisible','strokeVisible','fillType','textColor','overrideChildStyle']);
  const failures=[],failureSubscribers=new Set();
  let disposed=false;
  const publishFailure=detail=>{const failure={code:'shape-paint-restore-failed',detail};failures.push(failure);log({pptxShapePaintFailure:failure});for(const subscriber of failureSubscribers)subscriber(failure);};
  const color = value => {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
    if (value && /^#[0-9a-f]{6}$/i.test(value.rgb) && Number.isFinite(value.alpha) && value.alpha >= 0 && value.alpha <= 1) {
      const channels=[1,3,5].map(i=>parseInt(value.rgb.slice(i,i+2),16));
      return `rgba(${channels.join(',')},${value.alpha})`;
    }
    throw new Error('Invalid animation paint color');
  };
  const supported = id => {
    const entry=records.get(String(id));
    return entry && !entry.group && ['text','image'].includes(entry.shape.type) ? entry : null;
  };
  const paint = async (id,state,{signal}={}) => {
    if(disposed)return {supported:false,detail:'cancelled-shape-paint'};
    const entry=supported(id);
    if(!entry)return {supported:false,detail:'unsupported-shape-paint-target'};
    const version=++entry.version;
    return renderDocument(async()=>{
      if(disposed || signal?.aborted || version!==entry.version)return {supported:false,detail:'cancelled-shape-paint'};
      restoreTheme(slideData.theme);
      const shape={...entry.shape,...(entry.shape.type==='text'&&!entry.shape.drawingEffects?.length?{_paragraphFilter:[]}: {})};
      if(state.fillColor!=null) {shape.drawingFill={kind:'solidFill',color:color(state.fillColor)};shape.bgColor=shape.drawingFill.color;}
      if(state.fillType==='solid' && shape.drawingFill?.kind!=='solidFill')return {supported:false,detail:'solid-fill-requires-color'};
      if(state.fillVisible===false){shape.drawingFill={kind:'noFill'};shape.bgColor=null;}
      if(state.strokeColor!=null){
        if(!shape.line)return {supported:false,detail:'stroke-color-requires-outline'};
        shape.line={...shape.line,color:color(state.strokeColor)};
      }
      if(state.strokeVisible===true&&!shape.line)return {supported:false,detail:'stroke-on-requires-outline'};
      if(state.strokeVisible===false)shape.line=null;
      const scratch=document.createElement('canvas');scratch.width=entry.paint.width;scratch.height=entry.paint.height;
      const context=scratch.getContext('2d');context.translate(-entry.bounds.x*entry.kx,-entry.bounds.y*entry.ky);
      const paintUrls=[];
      try {await drawShapeOnCanvas(context,shape,zip,canvas.width,canvas.height,slideSize,entry.kx,paintUrls,slideData.slideBgColor);}
      catch(error){if(disposed||signal?.aborted||version!==entry.version)return {supported:false,detail:'cancelled-shape-paint'};throw error;}
      finally {for(const url of paintUrls)URL.revokeObjectURL(url);}
      const textPaints=[];
      const textChanged=state.textColor!==entry.committedState?.textColor||state.overrideChildStyle!==entry.committedState?.overrideChildStyle;
      if(textChanged)for(const paragraph of entry.textPaints||[]){
        const textCanvas=document.createElement('canvas');textCanvas.width=entry.paint.width;textCanvas.height=entry.paint.height;
        const textContext=textCanvas.getContext('2d');textContext.translate(-entry.bounds.x*entry.kx,-entry.bounds.y*entry.ky);
        const paragraphs=entry.shape.paragraphs.map(para=>({...para,runs:para.runs.map(run=>({...run}))}));
        if(state.textColor!=null){
          const value=color(state.textColor);
          for(const para of paragraphs){
            if(state.overrideChildStyle||!para.defaultColorExplicit)para.defaultColor=value;
            for(const run of para.runs)if(state.overrideChildStyle||!(run.colorExplicit||para.defaultColorExplicit)){run.color=value;}
          }
        }
        await drawShapeOnCanvas(textContext,{...paragraph.template,paragraphs},zip,canvas.width,canvas.height,slideSize,entry.kx,[],slideData.slideBgColor);
        for(const slice of paragraph.slices){
          const image=textContext.getImageData(slice.x,slice.y,slice.canvas.width,slice.canvas.height);
          for(let i=0;i<slice.alpha.length;i++)if(!slice.alpha[i])image.data.fill(0,i*4,i*4+4);
          textPaints.push({canvas:slice.canvas,image});
        }
      }
      if(disposed || signal?.aborted || version!==entry.version)return {supported:false,detail:'cancelled-shape-paint'};
      const target=entry.paint.getContext('2d');target.save();target.setTransform(1,0,0,1,0,0);
      target.clearRect(0,0,entry.paint.width,entry.paint.height);target.drawImage(scratch,0,0);target.restore();
      for(const text of textPaints)text.canvas.getContext('2d').putImageData(text.image,0,0);
      entry.committedState={...state};return {supported:true};
    });
  };
  const prepareState=entry=>{entry.baseState||={...entry.state};entry.paintHistory||=new Map();entry.paintSignals||=new Map();};
  const recomputeState=entry=>{
    entry.state={...entry.baseState};
    for(const [key,history]of entry.paintHistory){
      const active=history.filter(update=>!update.signal.aborted);
      if(active.length){entry.paintHistory.set(key,active);entry.state[key]=active.at(-1).value;}else entry.paintHistory.delete(key);
    }
    for(const [signal,callback]of entry.paintSignals)if(![...entry.paintHistory.values()].some(history=>history.some(update=>update.signal===signal))){signal.removeEventListener('abort',callback);entry.paintSignals.delete(signal);}
  };
  const validation=(entry,state)=>{
    if(state.textColor!=null&&entry.shape.type!=='text')return 'unsupported-text-paint-target';
    if(state.textColor!=null&&entry.shape.drawingEffects?.length)return 'unverified-text-paint-drawing-effects';
    if(state.textColor!=null&&(entry.textPaints||[]).some(paragraph=>!paragraph.slices.some(slice=>slice.alpha.some(value=>value))))return 'text-color-requires-visible-original-glyphs';
    if(state.fillType==='solid'&&state.fillColor==null&&entry.shape.drawingFill?.kind!=='solidFill')return 'solid-fill-requires-color';
    if(state.strokeColor!=null&&!entry.shape.line)return 'stroke-color-requires-outline';
    if(state.strokeVisible===true&&!entry.shape.line)return 'stroke-on-requires-outline';
    return null;
  };
  return {
    failures,
    dispose(){disposed=true;for(const entry of records.values())if(!entry.group){entry.version++;for(const [signal,callback]of entry.paintSignals||[])signal.removeEventListener('abort',callback);entry.paintSignals?.clear();entry.paintHistory?.clear();}failureSubscribers.clear();},
    subscribeFailure(listener){failureSubscribers.add(listener);return ()=>failureSubscribers.delete(listener);},
    get(id){const entry=supported(id);return entry?{id:String(id),state:{...entry.state}}:null;},
    apply(id,patch,options={}){
      if(disposed)return Promise.resolve({supported:false,detail:'cancelled-shape-paint'});
      const entry=supported(id);
      if(!entry)return Promise.resolve({supported:false,detail:'unsupported-shape-paint-target'});
      if(!patch || Object.keys(patch).some(key=>!allowed.has(key)) || (patch.fillType!=null&&patch.fillType!=='solid') || ['fillVisible','strokeVisible','overrideChildStyle'].some(key=>patch[key]!=null&&typeof patch[key]!=='boolean'))return Promise.resolve({supported:false,detail:'unsupported-shape-paint-property'});
      try {if(patch.fillColor!=null)color(patch.fillColor);if(patch.strokeColor!=null)color(patch.strokeColor);if(patch.textColor!=null)color(patch.textColor);}catch(error){return Promise.resolve({supported:false,detail:error.message});}
      if(options.signal?.aborted)return Promise.resolve({supported:false,detail:'cancelled-shape-paint'});
      prepareState(entry);recomputeState(entry);
      const problem=validation(entry,{...entry.state,...patch});
      if(problem)return Promise.resolve({supported:false,detail:problem});
      for(const [key,value]of Object.entries(patch)){
        if(options.signal){
          const history=(entry.paintHistory.get(key)||[]).filter(update=>update.signal!==options.signal);
          history.push({signal:options.signal,value});entry.paintHistory.set(key,history);
        }else {entry.baseState[key]=value;entry.paintHistory.delete(key);}
      }
      if(options.signal&&!entry.paintSignals.has(options.signal)){
        const callback=()=>{recomputeState(entry);paint(id,entry.state).then(result=>{if(!result.supported&&result.detail!=='cancelled-shape-paint')publishFailure(result.detail);}).catch(error=>publishFailure(error.message));};
        entry.paintSignals.set(options.signal,callback);options.signal.addEventListener('abort',callback,{once:true});
      }
      recomputeState(entry);
      return paint(id,entry.state,options);
    },
    restore(id,snapshot,options={}){
      if(disposed)return Promise.resolve({supported:false,detail:'cancelled-shape-paint'});
      if(!snapshot || snapshot.id!==String(id))return Promise.resolve({supported:false,detail:'invalid-shape-paint-snapshot'});
      const entry=supported(id);if(!entry)return Promise.resolve({supported:false,detail:'unsupported-shape-paint-target'});
      if(options.signal?.aborted)return Promise.resolve({supported:false,detail:'cancelled-shape-paint'});
      prepareState(entry);
      if(options.properties!=null){
        if(!Array.isArray(options.properties)||options.properties.some(key=>!allowed.has(key)))return Promise.resolve({supported:false,detail:'unsupported-shape-paint-property'});
        for(const key of options.properties){entry.paintHistory.delete(key);if(Object.prototype.hasOwnProperty.call(snapshot.state,key))entry.baseState[key]=snapshot.state[key];else delete entry.baseState[key];}
      }else {entry.baseState={...snapshot.state};entry.paintHistory.clear();}
      recomputeState(entry);
      return paint(id,entry.state,options);
    },
    resolveColor(descriptor){
      if(!descriptor || !['srgbClr','schemeClr','prstClr','sysClr','scrgbClr','hslClr'].includes(descriptor.kind))return null;
      const node=document.createElementNS(NS_A,'a:'+descriptor.kind);
      if(descriptor.value!=null)node.setAttribute('val',descriptor.value);
      for(const [name,value]of Object.entries(descriptor.attributes||{}))node.setAttribute(name,String(value));
      for(const transform of descriptor.transforms||[]){const child=document.createElementNS(NS_A,'a:'+transform.kind);if(transform.value!=null)child.setAttribute('val',String(transform.value));node.append(child);}
      return colorParser(node);
    }
  };
}

async function buildShapeLayers(wrapper, canvas, slideData, slideSize, zip, objectUrls) {
  restoreTheme(slideData.theme);
  const host = document.createElement('div');
  host.className = 'pptx-shape-layers'; host.style.cssText = 'position:absolute;inset:0;display:none;pointer-events:none;overflow:hidden';
  wrapper.append(host);
  const targets = new Map(), paintRecords = new Map();
  const kx = canvas.width / slideSize.w, ky = canvas.height / slideSize.h;
  for (const shape of slideData.shapes) {
    const bounds = shapeBounds(shape,true,kx,ky);
    if (!(bounds.w > 0 && bounds.h > 0)) continue;
    const layer = document.createElement('div');
    layer.dataset.pptxShapeId = shape.sourceId || '';
    layer.style.cssText = `position:absolute;left:${bounds.x / slideSize.w * 100}%;top:${bounds.y / slideSize.h * 100}%;width:${bounds.w / slideSize.w * 100}%;height:${bounds.h / slideSize.h * 100}%;pointer-events:auto`;
    const paint = document.createElement('canvas');
    paint.width = Math.max(1, Math.ceil(bounds.w * kx)); paint.height = Math.max(1, Math.ceil(bounds.h * ky));
    paint.style.cssText = 'width:100%;height:100%;display:block'; layer.append(paint); host.append(layer);
    const ctx = paint.getContext('2d'); ctx.translate(-bounds.x * kx, -bounds.y * ky);
    await drawShapeOnCanvas(ctx, shape.type === 'text' && shape.paragraphs?.length && !shape.drawingEffects?.length ? { ...shape, _paragraphFilter: [] } : shape, zip, canvas.width, canvas.height, slideSize, kx, objectUrls, slideData.slideBgColor);
    if (!shape.inherited && shape.sourceId) paintRecords.set(String(shape.sourceId),{shape,paint,bounds,kx,ky,version:0,state:{},textPaints:[]});
    for(const id of shape.inherited?[]:(shape.groupIds||[]))paintRecords.set(String(id),{group:true});
    if (shape.type === 'text' && !shape.drawingEffects?.length) for (let index = 0; index < (shape.paragraphs?.length || 0); index++) {
      const textCanvas = document.createElement('canvas'); textCanvas.width = paint.width; textCanvas.height = paint.height;
      const textContext = textCanvas.getContext('2d'); textContext.translate(-bounds.x*kx,-bounds.y*ky);
      const iterationRecords=[];
      await drawShapeOnCanvas(textContext, { ...shape, drawingFill:null, bgColor:null, line:null, blipTarget:null, shadow:null, _textBackground:shape.bgColor, _paragraphFilter:[index], _recordTextPaint:(context,segment)=>recordIterationPaint(iterationRecords,context,segment) }, zip, canvas.width, canvas.height, slideSize, kx, objectUrls, slideData.slideBgColor);
      const pixels = textContext.getImageData(0,0,textCanvas.width,textCanvas.height).data;
      let left=textCanvas.width,top=textCanvas.height,right=-1,bottom=-1;
      for(let y=0;y<textCanvas.height;y++)for(let x=0;x<textCanvas.width;x++)if(pixels[(y*textCanvas.width+x)*4+3]) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
      const nonempty = right >= left;
      if(!nonempty){left=0;top=0;right=0;bottom=0;}
      const paragraphLayer = document.createElement('div'); paragraphLayer.className='pptx-paragraph-layer';
      paragraphLayer.dataset.pptxParagraphIndex=String(index);
      paragraphLayer.style.cssText=`position:absolute;left:${left/paint.width*100}%;top:${top/paint.height*100}%;width:${(right-left+1)/paint.width*100}%;height:${(bottom-top+1)/paint.height*100}%;pointer-events:none`;
      const crop=document.createElement('canvas');crop.width=right-left+1;crop.height=bottom-top+1;crop.style.cssText='display:block;width:100%;height:100%';
      if(nonempty)crop.getContext('2d').drawImage(textCanvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height);
      const iterationNeeded=slideData.playback.requiresGlyphTargets||slideData.playback.failures.some(failure=>failure.code==='unsupported-text-iteration');
      const sliced=iterationNeeded&&buildIterationLayers(textCanvas,paragraphLayer,iterationRecords,!shape.inherited?shape.sourceId:null,index,targets,{left,top,width:crop.width,height:crop.height});
      if(!sliced)paragraphLayer.append(crop);layer.append(paragraphLayer);
      const paintRecord=!shape.inherited&&paintRecords.get(String(shape.sourceId));
      if(paintRecord){
        const slices=[...paragraphLayer.querySelectorAll('canvas')].map(leaf=>{
          const parent=leaf.parentElement;
          const x=left+(parent===paragraphLayer?0:Math.round(parseFloat(parent.style.left)/100*crop.width));
          const y=top+(parent===paragraphLayer?0:Math.round(parseFloat(parent.style.top)/100*crop.height));
          const data=leaf.getContext('2d').getImageData(0,0,leaf.width,leaf.height).data;
          return {canvas:leaf,x,y,alpha:Uint8Array.from({length:leaf.width*leaf.height},(_,i)=>data[i*4+3])};
        });
        paintRecord.textPaints.push({slices,template:{...shape,drawingFill:null,bgColor:null,line:null,blipTarget:null,shadow:null,_textBackground:shape.bgColor,_paragraphFilter:[index]}});
      }
      if(!shape.inherited&&shape.sourceId)targets.set(`${shape.sourceId}:p:${index}`,[paragraphLayer]);
    }
    for (const id of (shape.inherited ? [] : [shape.sourceId, ...(shape.groupIds || [])])) {
      if (id == null) continue;
      targets.set(String(id), [...(targets.get(String(id)) || []), layer]);
    }
  }
  return { host, targets, shapePaint:createShapePaint(paintRecords,slideData,canvas,slideSize,zip,objectUrls) };
}

let documentRenderQueue = Promise.resolve();
function renderDocument(task) {
  const result = documentRenderQueue.then(task);
  documentRenderQueue = result.catch(() => {});
  return result;
}
export function renderPptxThumbnail(buffer, canvas) {
  return renderDocument(() => renderPptxThumbnailDocument(buffer, canvas));
}
export function renderPptxViewer(options) {
  return renderDocument(() => renderPptxViewerDocument(options));
}

// ═══════════════════════════════════════
// Thumbnail — render first slide to canvas for chat bubble preview
// ═══════════════════════════════════════
async function renderPptxThumbnailDocument(buffer, canvas) {
  if (!canvas) return false;
  let fontContext;
  try {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(buffer);
    fontContext = await loadPptxFonts(zip, { parseXml, resolvePartPath: resolvePathFrom, relationshipNamespace: NS_R, presentationNamespace: NS_P });
    documentFontAliases = fontContext.aliases; documentFontMetrics = fontContext.metrics;
    canvas.pptxFontDiagnostics = fontContext.diagnostics;
    const slideSize = await getSlideSize(zip);
    await parseTheme(zip);
    const slidePath = (await getSlideFiles(zip))[0];
    if (!slidePath) return false;
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) return false;
    const slideRels = await zip.file(partRelsPath(slidePath))?.async('string');
    const objectUrls = [];
    const slideData = await buildSlideCanvas(slideXml, slideRels, zip, slideSize, objectUrls, slidePath);
    // Render to canvas at thumbnail size
    const targetW = 240;
    const aspect = slideSize.h / slideSize.w;
    const targetH = Math.round(targetW * aspect);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(targetW * dpr);
    canvas.height = Math.round(targetH * dpr);
    canvas.style.width = targetW + 'px';
    canvas.style.height = targetH + 'px';
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / slideSize.w;
    await paintSlideBackground(ctx,slideData,zip,objectUrls,scale);
    for (const shape of slideData.shapes) {
      await drawShapeOnCanvas(ctx, shape, zip, canvas.width, canvas.height, slideSize, scale, objectUrls, slideData.slideBgColor || slideData.bgColor);
    }
    // Cleanup object URLs
    for (const u of objectUrls) { try { URL.revokeObjectURL(u); } catch {} }
    return true;
  } catch (err) {
    log({ pptxThumbnailError: err?.message || err });
    return false;
  }
  finally { fontContext?.dispose(); }
}

// ═══════════════════════════════════════
// Main Viewer — Vertical scroll layout
// ═══════════════════════════════════════
async function renderPptxViewerDocument({ url, blob, name, modalApi }) {
  const { openModal, closeModal, showConfirmModal } = modalApi || {};
  let JSZip;
  try { JSZip = await ensureJSZip(); } catch (err) { log({ jszipLoadError: err?.message || err }); return false; }

  const modalEl = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  const modalTitle = document.getElementById('modalTitle');
  const closeBtn = document.getElementById('modalClose');
  const closeArea = document.getElementById('modalCloseArea');
  if (!modalEl || !body || !modalTitle) return false;

  cleanupPptxViewer();
  modalEl.classList.add('pptx-modal');
  window.__setLandscapeAllowed?.(true);
  modalTitle.textContent = '';

  body.innerHTML = `
    <div class="pptx-viewer">
      <div class="pptx-toolbar">
        <button type="button" class="pptx-btn" id="pptxCloseBtn" aria-label="${t('viewer.close')}">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M8 3l-5 5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="pptx-title" title="${escapeHtml(name || 'PowerPoint')}">${escapeHtml(name || 'PowerPoint')}</div>
        <span class="pptx-page-label" id="pptxPageLabel">– / –</span>
        <div class="pptx-actions">
          <button type="button" class="pptx-btn" id="pptxPlay">播放</button>
          <button type="button" class="pptx-btn" id="pptxPrevious" hidden>上一張</button>
          <button type="button" class="pptx-btn" id="pptxNext" hidden>下一張</button>
          <button type="button" class="pptx-btn" id="pptxStop" hidden>結束播放</button>
          <button type="button" class="pptx-btn" id="pptxDownload" aria-label="${t('viewer.downloadPptx')}">
            <svg viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 11v2h10v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="pptx-stage" id="pptxStage">
        <div class="pptx-loading" id="pptxLoading">${t('common.loading')}</div>
      </div>
    </div>`;
  openModal?.();

  const loadingEl = body.querySelector('#pptxLoading');
  const stageEl = body.querySelector('#pptxStage');
  const pageLabel = body.querySelector('#pptxPageLabel');
  const objectUrls = [];
  let fontContext;
  const audioBus = createPptxAudioBus();
  const mediaBus = createPptxMediaBus();
  const cleanup = () => { mediaBus.dispose(); audioBus.dispose(); fontContext?.dispose(); for (const u of objectUrls) { try { URL.revokeObjectURL(u); } catch {} } objectUrls.length = 0; };

  try {
    let arrayBuffer;
    if (blob) arrayBuffer = await blob.arrayBuffer();
    else if (url) { const r = await fetch(url); arrayBuffer = await r.arrayBuffer(); }
    else throw new Error('No data source');

    const zip = await JSZip.loadAsync(arrayBuffer);
    fontContext = await loadPptxFonts(zip, { parseXml, resolvePartPath: resolvePathFrom, relationshipNamespace: NS_R, presentationNamespace: NS_P });
    documentFontAliases = fontContext.aliases; documentFontMetrics = fontContext.metrics;
    body.pptxFontDiagnostics = fontContext.diagnostics;
    // Parse theme for real colors + fonts
    themeColors = {}; themeFontMajor = 'Calibri'; themeFontMinor = 'Calibri'; themeFontFamilies = { major: {}, minor: {} };
    await parseTheme(zip);
    const slideSize = await getSlideSize(zip);

    const slideFiles = await getSlideFiles(zip);

    if (!slideFiles.length) throw new Error('No slides found');
    if (loadingEl) loadingEl.remove();

    // Build all slides as canvases
    const slideEls = [];
    const slideDataList = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const slideXml = await zip.file(slideFiles[i])?.async('string');
      if (!slideXml) continue;
      const relsXml = await zip.file(partRelsPath(slideFiles[i]))?.async('string');
      const slideData = await buildSlideCanvas(slideXml, relsXml, zip, slideSize, objectUrls, slideFiles[i]);

      const wrapper = document.createElement('div');
      wrapper.className = 'pptx-slide';
      wrapper.style.cssText = `position:relative;width:100%;`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pptx-slide-canvas';
      wrapper.appendChild(canvas);

      // Slide number overlay
      const numEl = document.createElement('div');
      numEl.className = 'pptx-slide-num';
      numEl.textContent = `${i + 1}`;
      wrapper.appendChild(numEl);

      stageEl.appendChild(wrapper);
      slideEls.push(wrapper);
      slideDataList.push({ canvas, slideData, wrapper });
    }

    for (const { canvas, slideData } of slideDataList) {
      await renderSlideToCanvas(canvas, slideData, slideSize, zip, objectUrls);
    }
    pageLabel.textContent = `${slideEls.length} ${t('viewer.pptxSlides')}`;
    const controllers = [];
    let presenting = false, currentSlide = 0, presentationEpoch = 0, viewerDisposed = false;
    const stageOriginalStyle = stageEl.getAttribute('style');
    // The scrolling stage has flex height and toolbar padding. Its dimensions
    // cannot define slide coordinates; use a separate fixed-ratio frame.
    const presentationFrame=document.createElement('div');
    presentationFrame.className='pptx-presentation-frame';
    presentationFrame.style.cssText=`position:relative;width:100%;max-width:720px;aspect-ratio:${slideSize.w}/${slideSize.h};flex:0 0 auto;overflow:hidden`;
    const reportFailure = (entry, failure) => {
      entry.wrapper.dataset.pptxConformance = 'failed';
      (entry.failures ||= []).push(failure);
      log({ pptxPlaybackFailure: failure });
      let notice = entry.wrapper.querySelector('.pptx-playback-failure');
      if (!notice) { notice = document.createElement('div'); notice.className = 'pptx-playback-failure'; notice.style.cssText = 'position:absolute;left:0;bottom:0;padding:8px;background:#fff;color:#b91c1c;z-index:5'; entry.wrapper.append(notice); }
      notice.textContent = '此投影片含目前無法完整播放的效果或媒體。';
    };
    const activateSlide = async (index) => {
      if (!presenting || viewerDisposed || index < 0 || index >= slideDataList.length) return;
      const token = ++presentationEpoch;
      mediaBus.enterSlide(index);
      const previous = currentSlide; controllers[previous]?.cancel(); currentSlide = index;
      for (let i = 0; i < slideDataList.length; i++) {
        slideDataList[i].wrapper.style.display = (i === index || (i === previous && index !== previous)) ? 'block' : 'none';
        slideDataList[i].wrapper.style.zIndex = i === index ? '2' : '1';
        slideDataList[i].wrapper.style.visibility = i === index ? 'hidden' : '';
      }
      const entry = slideDataList[index];
      if (!entry.layers) {
        entry.layerInitialization ||= renderDocument(() => buildShapeLayers(entry.wrapper, entry.canvas, entry.slideData, slideSize, zip, objectUrls));
        entry.layers = await entry.layerInitialization;
        if (viewerDisposed) { entry.layers.host.remove(); cleanup(); return; }
      }
      if (!presenting || viewerDisposed || token !== presentationEpoch) return;
      if (!controllers[index]) {
        const model = entry.slideData.playback;
        entry.failures = [];
        entry.layers.shapePaint.subscribeFailure(failure=>reportFailure(entry,failure));
        controllers[index] = createPptxPlayback({ audioBus, mediaBus, model, root: entry.wrapper, shapes: entry.layers.targets, shapePaint: entry.layers.shapePaint,
          onFailure: failure => reportFailure(entry, failure), onAdvance: () => activateSlide(index + 1),
          resolveMedia: async source => {
            if (source.external) return source.target;
            const path = resolvePath(source.target);
            const file = zip.file(path); if (!file) throw new Error('Missing media part: ' + path);
            const extension = path.split('.').pop().toLowerCase();
            const mime = {mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg'}[extension] || 'application/octet-stream';
            const mediaUrl = URL.createObjectURL(new Blob([await file.async('uint8array')], { type: mime }));
            objectUrls.push(mediaUrl);
            let revoked=false;
            // Resource reads can finish after the viewer's global cleanup. The
            // playback owner also releases a late result when it is disposed.
            return {url:mediaUrl,cleanup:()=>{if(revoked)return;revoked=true;URL.revokeObjectURL(mediaUrl);const at=objectUrls.indexOf(mediaUrl);if(at>=0)objectUrls.splice(at,1);}};
          }
        });
      }
      if (!presenting || viewerDisposed || token !== presentationEpoch) return;
      const bg = entry.slideData;
      const ctx = entry.canvas.getContext('2d');
      await paintSlideBackground(ctx,bg,zip,objectUrls,entry.canvas.width/slideSize.w);
      if (!presenting || viewerDisposed || token !== presentationEpoch) return;
      entry.layers.host.style.display = 'block';
      // prepare() synchronously pre-hides entrance targets, then resolves media
      // and paint restoration without starting authored timing or media playback.
      const readiness = controllers[index].prepare();
      // A reused controller can restore roots saved by its earlier transition.
      // Reassert this activation's visibility after its synchronous cancel.
      for (let i = 0; i < slideDataList.length; i++) {
        const wrapper = slideDataList[i].wrapper;
        wrapper.style.display = (i === index || (i === previous && index !== previous)) ? 'block' : 'none';
        wrapper.style.zIndex = i === index ? '2' : '1';
        wrapper.style.visibility = i === index ? 'hidden' : '';
      }
      await readiness;
      if (!presenting || viewerDisposed || token !== presentationEpoch) return;
      entry.wrapper.style.visibility = '';
      pageLabel.textContent = `${index + 1} / ${slideDataList.length}`;
      await controllers[index].transition(index === previous ? null : slideDataList[previous]?.wrapper);
      if (presenting && !viewerDisposed && token === presentationEpoch) {
        if (index !== previous) slideDataList[previous].wrapper.style.display = 'none';
        // Reuse the prepared epoch: start must not restore entrance styles or
        // replay asynchronous preparation after the outgoing slide has ended.
        await controllers[index].start();
      }
    };
    const stopPresentation = async () => {
      presenting = false; const token = ++presentationEpoch;
      for (const id of ['pptxPrevious','pptxNext','pptxStop']) body.querySelector('#'+id).hidden = true;
      body.querySelector('#pptxPlay').hidden = false;
      mediaBus.stop(); audioBus.stop();
      // cancel restores saved transition styles; restore scrolling CSS afterward.
      for (const controller of controllers) controller?.cancel();
      for(const entry of slideDataList){entry.wrapper.style.cssText='position:relative;width:100%';const label=entry.wrapper.querySelector('.pptx-slide-num');if(label)label.hidden=false;if(entry.layers)entry.layers.host.style.display='none';stageEl.append(entry.wrapper);}
      presentationFrame.remove();
      if (stageOriginalStyle == null) stageEl.removeAttribute('style'); else stageEl.setAttribute('style', stageOriginalStyle);
      await renderDocument(async () => { if (viewerDisposed || presenting || token !== presentationEpoch) return; for (const entry of slideDataList) { if (viewerDisposed || presenting || token !== presentationEpoch) return; entry.wrapper.style.cssText = 'position:relative;width:100%'; if (entry.layers) entry.layers.host.style.display = 'none'; await renderSlideToCanvas(entry.canvas, entry.slideData, slideSize, zip, objectUrls); } });
    };
    body.querySelector('#pptxPlay')?.addEventListener('click', () => {
      presenting = true;
      stageEl.style.overflow='hidden';
      stageEl.append(presentationFrame);
      for (const entry of slideDataList) {presentationFrame.append(entry.wrapper);entry.wrapper.style.cssText = 'position:absolute;inset:0;width:100%;max-width:none';const label=entry.wrapper.querySelector('.pptx-slide-num');if(label)label.hidden=true;}
      for (const id of ['pptxPrevious','pptxNext','pptxStop']) body.querySelector('#'+id).hidden = false;
      body.querySelector('#pptxPlay').hidden = true;
      activateSlide(0).catch(error => reportFailure(slideDataList[currentSlide], {code:'playback-error',detail:error.message}));
    });
    body.querySelector('#pptxPrevious')?.addEventListener('click', () => { if (presenting && !controllers[currentSlide]?.previous()) activateSlide(currentSlide - 1).catch(error => reportFailure(slideDataList[currentSlide], {code:'playback-error',detail:error.message})); });
    body.querySelector('#pptxNext')?.addEventListener('click', () => { if (presenting && !controllers[currentSlide]?.next()) activateSlide(currentSlide + 1).catch(error => reportFailure(slideDataList[currentSlide], {code:'playback-error',detail:error.message})); });
    body.querySelector('#pptxStop')?.addEventListener('click', () => stopPresentation());

    // ── Pinch-to-zoom ──
    let zoomScale = 1;
    let zoomOriginX = 0, zoomOriginY = 0;
    let panX = 0, panY = 0;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchMidX = 0, pinchMidY = 0;
    let panStartX = 0, panStartY = 0;
    let panStartPanX = 0, panStartPanY = 0;
    let isPanning = false;

    function applyZoom() {
      stageEl.style.transformOrigin = `${zoomOriginX}px ${zoomOriginY}px`;
      stageEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    }

    function resetZoom() {
      zoomScale = 1; panX = 0; panY = 0;
      stageEl.style.transform = '';
      stageEl.style.transformOrigin = '';
    }

    function getTouchDist(t1, t2) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0], t1 = e.touches[1];
        pinchStartDist = getTouchDist(t0, t1);
        pinchStartScale = zoomScale;
        const rect = stageEl.getBoundingClientRect();
        pinchMidX = ((t0.clientX + t1.clientX) / 2 - rect.left) / zoomScale - panX / zoomScale;
        pinchMidY = ((t0.clientY + t1.clientY) / 2 - rect.top) / zoomScale - panY / zoomScale;
        zoomOriginX = pinchMidX;
        zoomOriginY = pinchMidY;
        isPanning = false;
      } else if (e.touches.length === 1 && zoomScale > 1) {
        isPanning = true;
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        panStartPanX = panX;
        panStartPanY = panY;
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches[0], e.touches[1]);
        const newScale = Math.max(1, Math.min(5, pinchStartScale * (dist / pinchStartDist)));
        zoomScale = newScale;

        // Adjust pan to keep pinch center stable
        if (zoomScale <= 1) { panX = 0; panY = 0; }
        applyZoom();
      } else if (e.touches.length === 1 && isPanning && zoomScale > 1) {
        e.preventDefault();
        panX = panStartPanX + (e.touches[0].clientX - panStartX);
        panY = panStartPanY + (e.touches[0].clientY - panStartY);
        applyZoom();
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) {
        if (zoomScale <= 1.05) resetZoom();
        isPanning = false;
      }
    };

    // Double-tap to reset zoom
    let lastTap = 0;
    const onDoubleTap = (e) => {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        if (zoomScale > 1.05) {
          resetZoom();
        } else {
          zoomScale = 2.5;
          const rect = stageEl.getBoundingClientRect();
          zoomOriginX = (e.touches[0].clientX - rect.left);
          zoomOriginY = (e.touches[0].clientY - rect.top);
          panX = 0; panY = 0;
          applyZoom();
        }
      }
      lastTap = now;
    };

    stageEl.addEventListener('touchstart', onTouchStart, { passive: false });
    stageEl.addEventListener('touchstart', onDoubleTap, { passive: false });
    stageEl.addEventListener('touchmove', onTouchMove, { passive: false });
    stageEl.addEventListener('touchend', onTouchEnd, { passive: true });

    // Scroll-based page tracking
    let scrollTick = false;
    const onScroll = () => {
      if (scrollTick) return;
      scrollTick = true;
      requestAnimationFrame(() => {
        const stageRect = stageEl.getBoundingClientRect();
        const mid = stageRect.top + stageRect.height * 0.35;
        let current = 1;
        for (let i = 0; i < slideEls.length; i++) {
          const r = slideEls[i].getBoundingClientRect();
          if (r.top <= mid && r.bottom > mid) { current = i + 1; break; }
          if (r.top > mid) break;
          current = i + 1;
        }
        pageLabel.textContent = `${current} / ${slideEls.length}`;
        scrollTick = false;
      });
    };
    stageEl.addEventListener('scroll', onScroll, { passive: true });

    // Download — inline confirm overlay (showConfirmModal destroys viewer)
    body.querySelector('#pptxDownload')?.addEventListener('click', (e) => {
      e.preventDefault();
      const proceed = () => triggerDownload(url, name || 'file.pptx');
      const msg = t('drive.downloadPdfConfirm');
      if (msg) {
        const overlay = document.createElement('div');
        overlay.className = 'word-confirm-overlay';
        overlay.innerHTML = `<div class="word-confirm-box"><div class="word-confirm-msg">${escapeHtml(msg)}</div><div class="word-confirm-actions"><button type="button" class="word-confirm-cancel">${escapeHtml(t('common.cancel'))}</button><button type="button" class="word-confirm-ok">${escapeHtml(t('drive.download') || t('modal.confirm'))}</button></div></div>`;
        (body.querySelector('.pptx-viewer') || body).appendChild(overlay);
        overlay.querySelector('.word-confirm-cancel')?.addEventListener('click', () => overlay.remove(), { once: true });
        overlay.querySelector('.word-confirm-ok')?.addEventListener('click', () => { overlay.remove(); proceed(); }, { once: true });
        return;
      }
      proceed();
    });

    // Close
    const doClose = () => activePptxCleanup?.();
    body.querySelector('#pptxCloseBtn')?.addEventListener('click', doClose);
    closeBtn?.addEventListener('click', doClose, { once: true });
    closeArea?.addEventListener('click', doClose, { once: true });

    const prevCleanup = activePptxCleanup;
    activePptxCleanup = () => {
      if (typeof prevCleanup === 'function') prevCleanup();
      viewerDisposed = true; presenting = false; presentationEpoch++;
      for(const entry of slideDataList)entry.layers?.shapePaint.dispose();
      for (const controller of controllers) controller?.dispose();
      // Playback layers are viewer-owned resources, including a prepared host
      // whose media read is still pending. Detach them after controller disposal.
      for(const entry of slideDataList)entry.layers?.host.remove();
      cleanup();
      stageEl.removeEventListener('scroll', onScroll);
      stageEl.removeEventListener('touchstart', onTouchStart);
      stageEl.removeEventListener('touchstart', onDoubleTap);
      stageEl.removeEventListener('touchmove', onTouchMove);
      stageEl.removeEventListener('touchend', onTouchEnd);
      resetZoom();
      window.__setLandscapeAllowed?.(false);
      modalEl.classList.remove('pptx-modal');
      closeModal?.();
      activePptxCleanup = null;
    };
  } catch (err) {
    log({ pptxViewerError: err?.message || err, stack: err?.stack || null });
    body.pptxError = { message: err?.message || String(err), stack: err?.stack || null };
    stageEl.innerHTML = `
      <div class="viewer-error-state">
        <div class="viewer-error-msg">${escapeHtml(t('viewer.pptxLoadFailed', { error: err?.message || err }))}</div>
        <button type="button" class="viewer-error-download" id="pptxErrorDownload">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 11v2h10v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${t('viewer.downloadPptx')}
        </button>
      </div>`;
    stageEl.querySelector('#pptxErrorDownload')?.addEventListener('click', () => triggerDownload(url, name || 'file.pptx'));
    const doClose = () => activePptxCleanup?.();
    body.querySelector('#pptxCloseBtn')?.addEventListener('click', doClose);
    closeBtn?.addEventListener('click', doClose, { once: true });
    closeArea?.addEventListener('click', doClose, { once: true });
    const prevCleanup = activePptxCleanup;
    activePptxCleanup = () => { if (typeof prevCleanup === 'function') prevCleanup(); cleanup(); window.__setLandscapeAllowed?.(false); modalEl.classList.remove('pptx-modal'); closeModal?.(); activePptxCleanup = null; };
    return false;
  }
  return true;
}
