import { chartStyleDescriptor, chartColorNode, chartSeriesColorRule, selectLegacyChartStyle, instantiateChartThemeStyle, parseExternalChartTextStyles, chartColorStyleNode } from './pptx-chart-styles.js';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const supportedChartExLayouts = Object.freeze(['funnel','waterfall','clusteredColumn','boxWhisker','treemap','sunburst']);
const kids = (n, name) => Array.from(n?.children || []).filter(e => e.localName === name);
const one = (n, name) => kids(n, name)[0] || null;
const descendants = (n, name) => Array.from(n?.getElementsByTagNameNS('*', name) || []);
const val = (n, name, fallback = null) => one(n, name)?.getAttribute('val') ?? fallback;
const number = (n, name, fallback = null) => { const s = val(n, name); return s == null ? fallback : Number(s); };
function xmlBool(value, fallback = false) {
  if (value == null) return fallback;
  if (['1', 'true', 'on'].includes(value)) return true;
  if (['0', 'false', 'off'].includes(value)) return false;
  fail(`Invalid chart boolean: ${value}`);
}
const enabled = (n, name, fallback = false) => xmlBool(val(n, name), fallback);
const PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
const AUTO_MARKERS = ['diamond', 'square', 'triangle', 'x', 'star', 'circle', 'plus'];
const FAMILIES = new Set(['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'areaChart', 'area3DChart', 'pieChart', 'pie3DChart', 'doughnutChart', 'ofPieChart', 'scatterChart', 'bubbleChart', 'radarChart', 'stockChart', 'surfaceChart', 'surface3DChart']);
export class UnsupportedChartError extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedChartError'; }
}
function fail(message) { throw new UnsupportedChartError(message); }
export function chartCache(source, numeric = true) {
  if (!source) return [];
  const container = ['numLit', 'strLit', 'numCache', 'strCache'].includes(source.localName) ? source : descendants(source, 'numCache')[0] || descendants(source, 'strCache')[0] || one(source, 'numLit') || one(source, 'strLit');
  if (!container) {
    if (descendants(source, 'f').length) fail('Referenced chart data has no cached values; workbook evaluation required');
    return [];
  }
  const count = number(container, 'ptCount', 0);
  if (!Number.isInteger(count) || count < 0 || count > 1000000) fail('Invalid chart cached point count');
  const data = Array(count).fill(null), seen = new Set();
  for (const pt of kids(container, 'pt')) {
    const i = Number(pt.getAttribute('idx')), text = one(pt, 'v')?.textContent;
    if (!Number.isInteger(i) || i < 0 || i > 1000000 || seen.has(i)) fail('Invalid/duplicate chart point index');
    seen.add(i);
    if (numeric) { const n = text == null || text.trim() === '' ? null : Number(text); data[i] = Number.isFinite(n) ? n : null; }
    else data[i] = text ?? '';
  }
  return data;
}
function categories(node) {
  const multi = descendants(node, 'multiLvlStrCache')[0];
  if (!multi) return chartCache(node, false);
  const levels = kids(multi, 'lvl').map(level => {
    const values = [];
    for (const pt of kids(level, 'pt')) values[Number(pt.getAttribute('idx'))] = one(pt, 'v')?.textContent || '';
    return values;
  });
  return Array.from({ length: number(multi, 'ptCount', Math.max(0, ...levels.map(l => l.length))) }, (_, i) => levels.map(l => l[i]).filter(Boolean).join('\n'));
}
function textModel(node, helpers) {
  if (!node) return { text: '', runs: [] };
  const rich = one(one(node, 'tx'), 'rich') || one(node, 'rich');
  if (rich) {
    const runs = [];
    for (const p of kids(rich, 'p')) {
      if (runs.length) runs.push({ text: '\n' });
      for (const run of Array.from(p.children)) {
        if (run.localName === 'br') { runs.push({ text: '\n' }); continue; }
        const t = one(run, 't'); if (!t) continue;
        const properties = one(run, 'rPr'), defaults = one(one(p, 'pPr'), 'defRPr');
        const attribute = name => properties?.getAttribute(name) ?? defaults?.getAttribute(name);
        const size = attribute('sz'), typeface = (one(properties, 'latin') || one(defaults, 'latin'))?.getAttribute('typeface');
        runs.push({ text: t.textContent, size: size == null ? null : Number(size) / 100 * 96 / 72, bold: xmlBool(attribute('b'), null), italic: xmlBool(attribute('i'), null), font: typeface ? helpers.resolveFont?.(typeface) || typeface : null, color: helpers.parseColor?.(one(properties, 'solidFill') || one(defaults, 'solidFill')) });
      }
    }
    return { text: runs.map(r => r.text).join(''), runs };
  }
  const tx = one(node, 'tx') || node;
  const cache = chartCache(tx, false);
  return { text: one(tx, 'v')?.textContent || cache.filter(v => v != null).join(' ') || '', runs: [] };
}
function shapeStyle(node, helpers) {
  const sp = one(node, 'spPr'), line = one(sp, 'ln');
  const fill = one(sp, 'solidFill');
  return { color: helpers.parseColor?.(fill) || null, noFill: one(sp, 'noFill') ? true : fill ? false : null, fillNode: one(sp, 'gradFill') || one(sp, 'blipFill') || one(sp, 'pattFill'), lineColor: helpers.parseColor?.(one(line, 'solidFill')) || null, noLine: one(line, 'noFill') ? true : line ? false : null, lineWidth: line?.hasAttribute('w') ? Number(line.getAttribute('w')) / 9525 : null, dash: val(line, 'prstDash'), effectNode:one(sp,'effectLst')||one(sp,'effectDag'), spPr: sp };
}
function mergeStyle(base, override) {
  const merged = { ...base, ...Object.fromEntries(Object.entries(override || {}).filter(([key, value]) => key !== 'spPr' && value != null)) };
  if (override && (override.color != null || override.noFill === true)) { merged.fillNode = null; merged.fillRelationships = null; }
  if (override?.fillNode) merged.color = null;
  return merged;
}
function textStyle(node, helpers, inherited = {}) {
  const properties = descendants(one(node, 'txPr'), 'defRPr')[0];
  if (!properties) return inherited;
  const font = one(properties, 'latin')?.getAttribute('typeface');
  return { ...inherited, size: properties.hasAttribute('sz') ? Number(properties.getAttribute('sz')) / 100 * 96 / 72 : inherited.size, bold: xmlBool(properties.getAttribute('b'), inherited.bold), italic: xmlBool(properties.getAttribute('i'), inherited.italic), font: font ? helpers.resolveFont?.(font) || font : inherited.font, color: helpers.parseColor?.(one(properties, 'solidFill')) || inherited.color };
}
export function splitOfPie(group) {
  const values = group.series[0]?.vals || [], count = values.length, total = values.reduce((s, v) => s + Math.abs(v || 0), 0);
  const type = group.splitType || 'pos', position = group.splitPosition ?? Math.ceil(count / 3);
  if (type === 'pos' && (!Number.isInteger(position) || position < 0 || position > 32000) || type === 'percent' && !(position >= 0 && position <= 100) || !Number.isFinite(position)) fail('Invalid ofPie split position');
  return values.map((v, index) => ({ value: Math.abs(v || 0), rawValue: v, index })).filter(p => p.rawValue != null).reduce((result, p) => {
    let secondary;
    switch (type) {
      case 'pos': case 'auto': secondary = p.index >= count - position; break;
      case 'percent': secondary = total > 0 && p.value / total * 100 < position; break;
      case 'val': secondary = p.value < position; break;
      case 'cust': secondary = group.customSplit.includes(p.index); break;
      default: fail(`Unsupported ofPie split type: ${type}`);
    }
    result[secondary ? 'secondary' : 'primary'].push(p); return result;
  }, { primary: [], secondary: [], total });
}
function dataLabels(node, helpers) {
  if (!node) return null;
  return { showVal: one(node, 'showVal') ? enabled(node, 'showVal') : null, showCatName: one(node, 'showCatName') ? enabled(node, 'showCatName') : null, showSerName: one(node, 'showSerName') ? enabled(node, 'showSerName') : null, showPercent: one(node, 'showPercent') ? enabled(node, 'showPercent') : null, showBubbleSize: one(node, 'showBubbleSize') ? enabled(node, 'showBubbleSize') : null, showLegendKey: one(node, 'showLegendKey') ? enabled(node, 'showLegendKey') : null, position: val(node, 'dLblPos'), separator: one(node, 'separator')?.textContent || null, deleted: one(node, 'delete') ? enabled(node, 'delete') : null, format: one(node, 'numFmt')?.getAttribute('formatCode'), text: textModel(node, helpers), individual: kids(node, 'dLbl').map(n => ({ index: number(n, 'idx'), ...dataLabels(n, helpers) })) };
}
function parseAxis(node, helpers, baseFont) {
  const scaling = one(node, 'scaling');
  const logBase = number(scaling, 'logBase');
  if (logBase != null && !(logBase >= 2 && logBase <= 1000)) fail('Invalid chart logarithmic base');
  return { id: val(node, 'axId'), type: node.localName, position: val(node, 'axPos'), min: number(scaling, 'min'), max: number(scaling, 'max'), logBase, reverse: val(scaling, 'orientation') === 'maxMin', deleted: enabled(node, 'delete'), crossId: val(node, 'crossAx'), crosses: val(node, 'crosses', 'autoZero'), crossesAt: number(node, 'crossesAt'), crossBetween: val(node, 'crossBetween', 'between'), majorUnit: number(node, 'majorUnit'), minorUnit: number(node, 'minorUnit'), labelPosition: val(node, 'tickLblPos', 'nextTo'), numberFormat: one(node, 'numFmt')?.getAttribute('formatCode'), majorGrid: !!one(node, 'majorGridlines'), minorGrid: !!one(node, 'minorGridlines'), title: textModel(one(node, 'title'), helpers), textStyle: textStyle(node, helpers, baseFont), style: shapeStyle(node, helpers), node };
}
async function materializeChartExCaches(doc, chartZip, partPath, helpers) {
  const dims = [...descendants(doc, 'numDim'), ...descendants(doc, 'strDim')].filter(n => !one(n, 'lvl'));
  if (!dims.length) return;
  const parse = helpers.parseXml || (xml => new DOMParser().parseFromString(xml, 'application/xml'));
  let workbookZip = chartZip;
  if (!workbookZip.file('xl/workbook.xml')) {
    const external = one(one(doc.documentElement, 'chartData'), 'externalData'), id = external?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const folder = partPath.slice(0, partPath.lastIndexOf('/') + 1), filename = partPath.slice(partPath.lastIndexOf('/') + 1);
    const relFile = chartZip.file(`${folder}_rels/${filename}.rels`);
    if (!id || !relFile || !helpers.loadZip) fail('ChartEx uncached data requires embedded workbook ZIP loader');
    const rel = descendants(parse(await relFile.async('text')), 'Relationship').find(n => n.getAttribute('Id') === id);
    if (!rel || rel.getAttribute('TargetMode') === 'External') fail('ChartEx workbook relationship missing or external');
    const segments = (folder + rel.getAttribute('Target')).split('/'), resolved = [];
    for (const segment of segments) { if (segment === '..') resolved.pop(); else if (segment && segment !== '.') resolved.push(segment); }
    const file = chartZip.file(resolved.join('/')); if (!file) fail('ChartEx embedded workbook missing');
    workbookZip = await helpers.loadZip(await file.async('arraybuffer'));
  }
  const workbook = parse(await workbookZip.file('xl/workbook.xml').async('text'));
  const relationships = parse(await workbookZip.file('xl/_rels/workbook.xml.rels').async('text'));
  const names = new Map(descendants(workbook, 'definedName').map(n => [n.getAttribute('name'), n.textContent]));
  const sharedFile = workbookZip.file('xl/sharedStrings.xml'), shared = sharedFile ? descendants(parse(await sharedFile.async('text')), 'si').map(n => descendants(n, 't').map(t => t.textContent).join('')) : [];
  const sheets = new Map();
  const col = letters => Array.from(letters.toUpperCase()).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  for (const dimension of dims) {
    const reference = one(dimension, 'f')?.textContent, formula = names.get(reference) || reference;
    const match = /^'?([^!]+?)'?!(\$?([A-Z]+)\$?(\d+))(?::\$?([A-Z]+)\$?(\d+))?$/.exec(formula || '');
    if (!match) fail(`Unsupported ChartEx workbook range: ${formula}`);
    const sheetName = match[1].replace(/''/g, "'"), sheet = descendants(workbook, 'sheet').find(n => n.getAttribute('name') === sheetName);
    if (!sheet) fail(`ChartEx worksheet missing: ${sheetName}`);
    if (!sheets.has(sheetName)) {
      const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const target = descendants(relationships, 'Relationship').find(n => n.getAttribute('Id') === id)?.getAttribute('Target');
      const file = target && workbookZip.file(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
      if (!file) fail('ChartEx worksheet relationship missing');
      const cells = new Map();
      for (const cell of descendants(parse(await file.async('text')), 'c')) {
        const type = cell.getAttribute('t'), raw = one(cell, 'v')?.textContent;
        const value = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? descendants(cell, 't').map(n => n.textContent).join('') : type === 'e' ? null : raw;
        cells.set(cell.getAttribute('r'), value);
      }
      sheets.set(sheetName, cells);
    }
    const c1 = col(match[3]), c2 = col(match[5] || match[3]), r1 = Number(match[4]), r2 = Number(match[6] || match[4]);
    if (c2 < c1 || r2 < r1 || (c2 - c1 + 1) * (r2 - r1 + 1) > 1000000) fail('Invalid ChartEx workbook range bounds');
    const numeric = dimension.localName === 'numDim';
    if (numeric && c1 !== c2 && r1 !== r2) fail('Two-dimensional ChartEx numeric range needs dimension semantics');
    const letters = n => { let out = ''; while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); } return out; };
    const levels = numeric && r1 === r2 ? 1 : c2 - c1 + 1;
    for (let level = 0; level < levels; level++) {
      const values = [];
      if (numeric && r1 === r2) for (let c = c1; c <= c2; c++) values.push(sheets.get(sheetName).get(`${letters(c)}${r1}`));
      else for (let r = r1; r <= r2; r++) values.push(sheets.get(sheetName).get(`${letters(numeric ? c1 + level : c2 - level)}${r}`));
      const node = doc.createElementNS(CX, 'cx:lvl'); node.setAttribute('ptCount', String(values.length));
      values.forEach((value, idx) => { if (value == null) return; const pt = doc.createElementNS(CX, 'cx:pt'); pt.setAttribute('idx', String(idx)); pt.textContent = value; node.appendChild(pt); }); dimension.appendChild(node);
    }
  }
}
function chartExDimension(dimension, numeric) {
  if (!dimension) return [];
  const level = one(dimension, 'lvl');
  if (!level) fail('ChartEx dimension has no cached level; workbook evaluation required');
  const count = Number(level.getAttribute('ptCount') || 0);
  if (!Number.isInteger(count) || count < 0 || count > 1000000) fail('Invalid ChartEx cached point count');
  const values = Array(count).fill(null), seen = new Set();
  for (const point of kids(level, 'pt')) {
    const i = Number(point.getAttribute('idx'));
    if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i)) fail('Invalid/duplicate ChartEx point index');
    seen.add(i); const text = point.textContent;
    values[i] = numeric ? text.trim() && Number.isFinite(Number(text)) ? Number(text) : null : text;
  }
  return values;
}
export function boxWhiskerStatistics(values, quartileMethod = 'exclusive') {
  if (!['inclusive', 'exclusive'].includes(quartileMethod)) fail('Invalid box-whisker quartile method');
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const median = data => { const n = data.length; return n ? n % 2 ? data[(n - 1) / 2] : (data[n / 2 - 1] + data[n / 2]) / 2 : sorted[0]; };
  const n = sorted.length, midpoint = Math.floor(n / 2), included = n % 2 && quartileMethod === 'inclusive';
  const q1 = median(sorted.slice(0, midpoint + (included ? 1 : 0))), q2 = median(sorted), q3 = median(sorted.slice(midpoint + (n % 2 && !included ? 1 : 0)));
  const iqr = q3 - q1, lowerFence = q1 - 1.5 * iqr, upperFence = q3 + 1.5 * iqr, inside = sorted.filter(v => v >= lowerFence && v <= upperFence);
  return { q1, median: q2, q3, lower: inside[0] ?? sorted[0], upper: inside.at(-1) ?? sorted.at(-1), outliers: sorted.filter(v => v < lowerFence || v > upperFence), nonoutliers: inside, mean: sorted.reduce((a, v) => a + v, 0) / n, count: n };
}
function histogramData(values, binning) {
  const numbers = values.filter(Number.isFinite); if (!numbers.length) return { values: [], categories: [], bins: [] };
  const sizeNode = one(binning, 'binSize'), countNode = one(binning, 'binCount');
  const sizeValue = sizeNode ? Number(sizeNode.textContent || sizeNode.getAttribute('val')) : null, countValue = countNode ? Number(countNode.textContent || countNode.getAttribute('val')) : null;
  if (sizeValue == null && countValue == null) fail('Automatic ChartEx histogram binning requires Microsoft Scott-rule oracle');
  if (sizeValue != null && !(sizeValue > 0 && Number.isFinite(sizeValue)) || countValue != null && !(Number.isInteger(countValue) && countValue > 0 && countValue <= 1000000)) fail('Invalid ChartEx histogram bin size/count');
  const min = Math.min(...numbers), max = Math.max(...numbers);
  const underRaw = binning?.getAttribute('underflow'), overRaw = binning?.getAttribute('overflow'), threshold = raw => raw == null || raw === 'auto' ? null : Number(raw);
  const under = threshold(underRaw), over = threshold(overRaw);
  if (under != null && !Number.isFinite(under) || over != null && !Number.isFinite(over) || under != null && over != null && under >= over) fail('Invalid histogram overflow/underflow');
  const start = under ?? min, end = over ?? max, regularCount = countValue == null ? null : countValue - (under != null ? 1 : 0) - (over != null ? 1 : 0);
  if (regularCount != null && regularCount < 1) fail('Histogram binCount must include at least one regular bin after under/overflow');
  const size = sizeValue ?? ((end - start) / regularCount || 1);
  const closed = binning?.getAttribute('intervalClosed') || 'r'; if (!['l', 'r'].includes(closed)) fail('Invalid histogram interval closure');
  const count = regularCount ?? Math.max(1, closed === 'l' && over == null ? Math.floor((end - start) / size) + 1 : Math.ceil((end - start) / size)); if (count > 1000000) fail('Histogram bin count too large');
  const bins = [];
  if (under != null) bins.push({ lower: -Infinity, upper: under, count: 0, label: `≤${under}` });
  for (let i = 0; i < count; i++) { const lower = start + i * size, upper = start + (i + 1) * size; bins.push({ lower, upper, count: 0, label: closed === 'r' ? `${i === 0 && under == null ? '[' : '('}${lower},${upper}]` : `[${lower},${upper})` }); }
  if (over != null) bins.push({ lower: over, upper: Infinity, count: 0, label: `>${over}` });
  for (const value of numbers) {
    let bin;
    if (under != null && value <= under) bin = bins[0];
    else if (over != null && value > over) bin = bins[bins.length - 1];
    else { const index = closed === 'r' ? Math.max(0, Math.ceil((value - start) / size) - 1) : Math.floor((value - start) / size); bin = bins[(under != null ? 1 : 0) + Math.min(count - 1, index)]; }
    if (bin) bin.count++;
  }
  return { values: bins.map(b => b.count), categories: bins.map(b => b.label), bins };
}
export function chartHierarchy(levels, values) {
  const root = { name: '', children: [], value: 0, depth: 0 }, carry = Array(levels.length).fill(null);
  for (let index = 0; index < values.length; index++) {
    const value = values[index]; if (value == null || value === 0) continue; if (value < 0) fail('Negative hierarchy sizes require Microsoft rendering oracle');
    let last = -1; for (let d = 0; d < levels.length; d++) if (levels[d][index] != null && levels[d][index] !== '') last = d;
    if (last < 0) fail('Hierarchy size has no category path');
    const path = [];
    for (let d = 0; d <= last; d++) {
      const label = levels[d][index];
      if (label != null && label !== '') { if (carry[d] !== label) carry.fill(null, d + 1); carry[d] = label; }
      if (carry[d] == null) fail('Hierarchy category has no parent label'); path.push(carry[d]);
    }
    let node = root; node.value += value;
    for (let d = 0; d < path.length; d++) { let child = node.children.find(n => n.name === path[d]); if (!child) { child = { name: path[d], children: [], value: 0, depth: d + 1, indices: [] }; node.children.push(child); } child.value += value; child.indices.push(index); node = child; }
    node.directValue = (node.directValue || 0) + value;
  }
  const validate = node => { if (node.children.length && node.directValue) fail('Mixed parent and child hierarchy sizes require Microsoft rendering oracle'); node.children.forEach(validate); }; validate(root);
  return root;
}
function squarify(nodes, rect) {
  const area = rect.width * rect.height, total = nodes.reduce((sum, n) => sum + n.value, 0);
  const pending = nodes.filter(n => n.value > 0).map((node, i) => ({ node, area: total ? area * node.value / total : 0, i })).sort((a, b) => b.area - a.area || a.i - b.i), placed = [];
  let bounds = { ...rect }, row = [];
  const worst = (items, length) => { if (!items.length || !length) return Infinity; const sum = items.reduce((s, n) => s + n.area, 0), min = Math.min(...items.map(n => n.area)), max = Math.max(...items.map(n => n.area)); return Math.max(length * length * max / (sum * sum), sum * sum / (length * length * min)); };
  const layout = () => { const sum = row.reduce((a, n) => a + n.area, 0), vertical = bounds.width >= bounds.height, side = vertical ? bounds.height : bounds.width, thickness = side ? sum / side : 0; let offset = 0;
    for (const item of row) { const length = thickness ? item.area / thickness : 0; const r = vertical ? { x: bounds.x, y: bounds.y + offset, width: thickness, height: length } : { x: bounds.x + offset, y: bounds.y, width: length, height: thickness }; placed.push({ node: item.node, rect: r }); offset += length; }
    if (vertical) { bounds.x += thickness; bounds.width -= thickness; } else { bounds.y += thickness; bounds.height -= thickness; } row = [];
  };
  while (pending.length) { const next = pending[0], side = Math.min(bounds.width, bounds.height); if (!row.length || worst([...row, next], side) <= worst(row, side)) row.push(pending.shift()); else layout(); } if (row.length) layout(); return placed;
}
function chartExLabels(node, helpers) {
  if (!node) return null;
  const visibility = one(node, 'visibility'), body=one(one(node,'txPr'),'bodyPr');
  const rotationDegrees=body?.hasAttribute('rot') ? Number(body.getAttribute('rot'))/60000 : undefined;
  if(rotationDegrees!=null && !Number.isFinite(rotationDegrees)) fail('Invalid ChartEx data label rotation');
  return { rotationDegrees, showVal: xmlBool(visibility?.getAttribute('value'), null), showCatName: xmlBool(visibility?.getAttribute('categoryName'), null), showSerName: xmlBool(visibility?.getAttribute('seriesName'), null), position: node.getAttribute('pos'), text: textModel(node, helpers), individual: kids(node, 'dataLabel').map(label => ({ ...chartExLabels(label, helpers), index: Number(label.getAttribute('idx')) })), separator: one(node, 'separator')?.textContent, format: one(node, 'numFmt')?.getAttribute('formatCode') };
}
function parseChartEx(root, helpers) {
  const chart = one(root, 'chart'), plot = one(chart, 'plotArea'), region = one(plot, 'plotAreaRegion');
  if (!region) fail('ChartEx plotAreaRegion is missing');
  const data = new Map();
  for (const block of kids(one(root, 'chartData'), 'data')) {
    const id = block.getAttribute('id'); if (data.has(id)) fail('Duplicate ChartEx data id'); data.set(id, block);
  }
  const groups = [];
  for (const node of kids(region, 'series')) {
    if (xmlBool(node.getAttribute('hidden'))) continue;
    const layoutId = node.getAttribute('layoutId');
    if (!supportedChartExLayouts.includes(layoutId)) fail(`Unsupported ChartEx layout: ${layoutId}`);
    const block = data.get(val(node, 'dataId')); if (!block) fail('ChartEx series references missing data id');
    const dims = kids(block, 'numDim'), values = dims.find(n => n.getAttribute('type') === (['treemap', 'sunburst'].includes(layoutId) ? 'size' : 'val'));
    if (!values) fail('ChartEx funnel value dimension is missing');
    const vals = chartExDimension(values, true);
    if (layoutId === 'funnel' && vals.some(v => v != null && v < 0)) fail('Negative funnel values require Microsoft rendering oracle');
    const cats = kids(block, 'strDim').find(n => n.getAttribute('type') === 'cat');
    const series = { index: Number(node.getAttribute('formatIdx') || groups.length), order: groups.length, name: one(one(one(node, 'tx'), 'txData'), 'v')?.textContent || helpers.localizeSeriesName?.(groups.length + 1) || `Series${groups.length + 1}`, vals, xs: [], sizes: [], categories: chartExDimension(cats, false), style: shapeStyle(node, helpers), points: kids(node, 'dataPt').map(p => ({ index: Number(p.getAttribute('idx')), style: shapeStyle(p, helpers) })), node };
    if (layoutId === 'waterfall' && !cats) series.categories = vals.map((_,index)=>String(index+1));
    if (['treemap', 'sunburst'].includes(layoutId)) { // Native Office caches enumerate levels leaf-first; hierarchy traversal is parent-first.
      series.categoryLevels = kids(cats, 'lvl').map(level => chartExDimension({ children: [level] }, false)).reverse(); series.hierarchy = chartHierarchy(series.categoryLevels, vals); }
    series.labels = chartExLabels(one(node, 'dataLabels'), helpers);
    if (layoutId === 'boxWhisker') { const properties = one(node, 'layoutPr'), quartileMethod = one(properties, 'statistics')?.getAttribute('quartileMethod') || 'exclusive';
      const partitions = new Map();
      vals.forEach((value,index)=>{ const category=series.categories[index] ?? ''; if (!partitions.has(category)) partitions.set(category,{category,values:[],sampleIndices:[]}); const box=partitions.get(category); box.values.push(value); box.sampleIndices.push(index); });
      series.boxes = Array.from(partitions.values()).map(box=>({...box,statistics:boxWhiskerStatistics(box.values,quartileMethod)}));
      series.statistics = series.boxes.length === 1 ? series.boxes[0].statistics : null; const visibility = one(properties, 'visibility'); series.visibility = { meanMarker: xmlBool(visibility?.getAttribute('meanMarker'), true), meanLine: xmlBool(visibility?.getAttribute('meanLine')), outliers: xmlBool(visibility?.getAttribute('outliers'), true), nonoutliers: xmlBool(visibility?.getAttribute('nonoutliers')) }; }
    if (layoutId === 'clusteredColumn') { const bins = histogramData(vals, one(one(node, 'layoutPr'), 'binning')); series.rawValues = vals; series.vals = bins.values; series.categories = bins.categories; series.bins = bins.bins; }
    const scaling = descendants(plot, 'catScaling')[0], rawGap = scaling?.getAttribute('gapWidth');
    const gap = rawGap == null || rawGap === 'auto' ? 0.3 : Number(rawGap);
    if (!Number.isFinite(gap) || gap < 0) fail('Invalid ChartEx category gap width');
    groups.push({ family: layoutId === 'clusteredColumn' ? 'histogramChart' : layoutId + 'Chart', layoutId, series: [series], horizontal: layoutId === 'funnel', subtotals: kids(one(one(node, 'layoutPr'), 'subtotals'), 'idx').map(n => Number(n.getAttribute('val'))), axisIds: kids(plot, 'axis').map(a => a.getAttribute('id')), grouping: 'standard', gapWidth: layoutId === 'clusteredColumn' ? gap * 100 : gap, labels: null, node });
  }
  if (!groups.length) fail('ChartEx has no visible supported series');
  if (groups.every(g => g.family === 'boxWhiskerChart')) { const series = groups.flatMap(g => g.series); groups.splice(1); groups[0].series = series; groups[0].categories = Array.from(new Set(series.flatMap(s=>s.boxes.map(b=>b.category)))); }
  const baseFont = textStyle(root, helpers, { font: helpers.defaultFont }), legend = one(chart, 'legend');
  const axes = kids(plot, 'axis').map(node => {
    const scaling = one(node, 'valScaling'), numeric = name => { const raw = scaling?.getAttribute(name); if (raw == null || raw === 'auto') return null; const n = Number(raw); if (!Number.isFinite(n)) fail('Invalid ChartEx value-axis scaling'); return n; };
    return { id: node.getAttribute('id'), type: scaling ? 'valAx' : 'catAx', position: scaling ? 'l' : 'b', min: numeric('min'), max: numeric('max'), majorUnit: numeric('majorUnit'), minorUnit: numeric('minorUnit'), deleted: xmlBool(node.getAttribute('hidden')), labelPosition: one(node, 'tickLabels') ? 'nextTo' : 'none', majorGrid: !!one(node, 'majorGridlines'), textStyle: textStyle(node, helpers, baseFont), style: shapeStyle(node, helpers) };
  });
  const titleNode = one(chart,'title'), title = textModel(titleNode,helpers);
  title.overlay = xmlBool(titleNode?.getAttribute('overlay'));
  title.position = titleNode?.getAttribute('pos') || 't';
  if (titleNode && !one(titleNode,'tx') && !title.text) { title.text = helpers.localizeChartTitle?.() || 'Chart Title'; title.automaticText = true; }
  return { chartEx: true, groups, axes, baseFont, title, legend: legend ? { position: legend.getAttribute('pos') || 'r', overlay: xmlBool(legend.getAttribute('overlay')), textStyle: textStyle(legend, helpers, baseFont), deletedEntries: [] } : null, chartStyle: shapeStyle(root, helpers), plotStyle: shapeStyle(plot, helpers), blankMode: 'gap', layout: null };
}
export function parseChartDocument(doc, helpers = {}) {
  const root = doc.documentElement || doc;
  if (root.namespaceURI === CX && root.localName === 'chartSpace') return parseChartEx(root, helpers);
  if (root.namespaceURI !== C || root.localName !== 'chartSpace') fail(`Unsupported chart namespace/root: ${root.namespaceURI}/${root.localName}`);
  const chart = one(root, 'chart'), plot = one(chart, 'plotArea');
  if (!plot) fail('Chart plotArea is missing');
  const view = one(chart, 'view3D'), pie3D = !!one(plot, 'pie3DChart');
  const camera = { rotX: number(view, 'rotX', pie3D ? 30 : 15), rotY: number(view, 'rotY', pie3D ? 0 : 20), rightAngles: enabled(view, 'rAngAx', !pie3D), perspective: number(view, 'perspective', 30), heightPercent: number(view, 'hPercent', 100), depthPercent: number(view, 'depthPercent', 100) };
  if (![camera.rotX, camera.rotY, camera.perspective, camera.heightPercent, camera.depthPercent].every(Number.isFinite) || Math.abs(camera.rotX) > 90 || camera.rotY < 0 || camera.rotY > 360 || camera.perspective < 0 || camera.perspective > 240 || camera.heightPercent <= 0 || camera.depthPercent <= 0) fail('Invalid chart 3D camera');
  if (view && !Array.from(plot.children).some(n => n.localName.includes('3D')) && !(one(plot, 'surfaceChart') && camera.rotX === 90)) fail('3D view on unsupported chart family');
  const groups = [];
  for (const node of Array.from(plot.children)) {
    if (!node.localName.endsWith('Chart')) continue;
    if (!FAMILIES.has(node.localName)) fail(`Unsupported chart family: ${node.localName}`);
    const series = kids(node, 'ser').map(ser => {
      const labels = dataLabels(one(ser, 'dLbls'), helpers);
      const vals = chartCache(one(ser, 'val') || one(ser, 'yVal')), xSource = one(ser, 'xVal');
      let xs = chartCache(xSource);
      if (['scatterChart', 'bubbleChart'].includes(node.localName)) {
        if (!xSource) xs = vals.map((_, i) => i + 1);
        else if (descendants(xSource, 'strCache').length && xs.every(v => v == null)) {
          const strings = chartCache(xSource, false);
          if (strings.some(v => v != null && v.trim() !== '')) xs = strings.map((v, i) => v == null ? null : i + 1);
        }
      }
      return { index: number(ser, 'idx', 0), order: number(ser, 'order', 0), name: one(ser, 'tx') ? textModel(one(ser, 'tx'), helpers).text : (helpers.localizeSeriesName?.(number(ser, 'idx', 0) + 1) || `Series${number(ser, 'idx', 0) + 1}`), vals, xs, sizes: chartCache(one(ser, 'bubbleSize')), categories: categories(one(ser, 'cat')), style: shapeStyle(ser, helpers), marker: { symbol: val(one(ser, 'marker'), 'symbol', null), size: number(one(ser, 'marker'), 'size', 5) * 96 / 72, style: shapeStyle(one(ser, 'marker'), helpers) }, smooth: enabled(ser, 'smooth', enabled(node, 'smooth')), explosion: number(ser, 'explosion', 0), labels, points: kids(ser, 'dPt').map(p => ({ index: number(p, 'idx'), style: shapeStyle(p, helpers), explosion: number(p, 'explosion', 0) })), node: ser };
    }).sort((a, b) => a.order - b.order);
    groups.push({ family: node.localName, series, axisIds: kids(node, 'axId').map(a => a.getAttribute('val')), grouping: val(node, 'grouping', ['barChart', 'bar3DChart'].includes(node.localName) ? 'clustered' : 'standard'), horizontal: val(node, 'barDir', 'col') === 'bar', gapWidth: number(node, 'gapWidth', 150), gapDepth: number(node, 'gapDepth', 150), barShape: val(node, 'shape', 'box'), overlap: number(node, 'overlap'), varyColors: enabled(node, 'varyColors'), firstSliceAngle: number(node, 'firstSliceAng', 0), holeSize: number(node, 'holeSize', 10), scatterStyle: val(node, 'scatterStyle', 'lineMarker'), radarStyle: val(node, 'radarStyle', 'standard'), bubbleScale: number(node, 'bubbleScale', 100), bubbleSizeRepresents: val(node, 'sizeRepresents', 'area'), showNegativeBubbles: enabled(node, 'showNegBubbles'), ofPieType: val(node, 'ofPieType', 'pie'), splitType: val(node, 'splitType'), splitPosition: number(node, 'splitPos'), secondPieSize: number(node, 'secondPieSize', 75), customSplit: kids(one(node, 'custSplit'), 'secondPiePt').map(p => Number(p.getAttribute('val'))), wireframe: enabled(node, 'wireframe'), bands: kids(one(node, 'bandFmts'), 'bandFmt').map(n => ({ index: number(n, 'idx'), style: shapeStyle(n, helpers) })), labels: dataLabels(one(node, 'dLbls'), helpers), node });
  }
  if (!groups.length || !groups.some(g => g.series.length)) fail('Chart has no supported data series');
  let styleSelection, styleDefaults;
  try { styleSelection = selectLegacyChartStyle(root); styleDefaults = chartStyleDescriptor(styleSelection.id); } catch (error) { fail(error.message); }
  const baseFont = textStyle(root, helpers, { font: helpers.defaultFont });
  const axes = Array.from(plot.children).filter(n => ['catAx', 'dateAx', 'valAx', 'serAx'].includes(n.localName)).map(n => parseAxis(n, helpers, baseFont));
  const legend = one(chart, 'legend');
  const manual = one(one(plot, 'layout'), 'manualLayout');
  let title = enabled(chart, 'autoTitleDeleted') ? { text: '', runs: [] } : textModel(one(chart, 'title'), helpers);
  if (!title.text && !enabled(chart, 'autoTitleDeleted') && one(chart, 'title') && groups.length === 1 && groups[0].series.length === 1) title = { text: groups[0].series[0].name, runs: [] };
  title.overlay = enabled(one(chart,'title'),'overlay');
  return { groups, axes, baseFont, camera, walls: { back: shapeStyle(one(chart, 'backWall'), helpers), side: shapeStyle(one(chart, 'sideWall'), helpers), floor: shapeStyle(one(chart, 'floor'), helpers) }, title, legend: legend ? { position: val(legend, 'legendPos', 'r'), overlay: enabled(legend, 'overlay'), textStyle: textStyle(legend, helpers, baseFont), deletedEntries: kids(legend, 'legendEntry').filter(e => enabled(e, 'delete')).map(e => number(e, 'idx')) } : null, blankMode: val(chart, 'dispBlanksAs', 'gap'), styleId: styleSelection.id, styleSelection, styleDefaults, chartStyle: shapeStyle(root, helpers), plotStyle: shapeStyle(plot, helpers), layout: manual ? { x: number(manual, 'x', 0), y: number(manual, 'y', 0), w: number(manual, 'w', 1), h: number(manual, 'h', 1), xMode: val(manual, 'xMode', 'factor'), yMode: val(manual, 'yMode', 'factor'), wMode: val(manual, 'wMode', 'factor'), hMode: val(manual, 'hMode', 'factor'), target: val(manual, 'layoutTarget', 'outer') } : null };
}
function axisScale(axis, values, percent = false, tickTarget = null) {
  const finite = values.filter(Number.isFinite), positive = finite.filter(v => v > 0), log = axis?.logBase;
  let min = percent ? Math.min(0, ...finite) : Math.min(0, ...finite), max = percent ? Math.max(1, ...finite) : Math.max(1, ...finite);
  if (log) {
    if (!positive.length) fail('Logarithmic chart axis has no positive data');
    min = log ** Math.floor(Math.log(Math.min(...positive)) / Math.log(log)); max = log ** Math.ceil(Math.log(Math.max(...positive)) / Math.log(log)); if (min === max) max *= log;
  }
  let step = null;
  if (tickTarget && !log && !percent) {
    const rough = Math.max(1e-12, max - min) / Math.max(2, tickTarget), power = 10 ** Math.floor(Math.log10(rough)), normalized = rough / power;
    step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
    min = Math.floor(min / step) * step; max = (Math.floor(max / step) + 1) * step;
  }
  min = axis?.min ?? min; max = axis?.max ?? max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min) || (log && min <= 0)) fail('Invalid chart axis limits');
  const transform = v => log ? Math.log(v) / Math.log(log) : v;
  const lower = transform(min), span = transform(max) - lower;
  return { min, max, log, step, reverse: !!axis?.reverse, fraction(v) { const f = (transform(v) - lower) / span; return axis?.reverse ? 1 - f : f; }, value(f) { const t = lower + span * f; return log ? log ** t : t; } };
}
function formatNumber(value, format, percent) {
  if (format?.includes('%') || percent) return `${Math.round(value * 100)}%`;
  const decimals = /\.(0+)/.exec(format || '')?.[1].length;
  if (decimals != null) return value.toFixed(decimals);
  return String(Math.round(value * 100) / 100);
}
function linePath(ctx, points, smooth) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (!smooth) ctx.lineTo(points[i].x, points[i].y);
    else {
      const p0 = points[Math.max(0, i - 2)], p1 = points[i - 1], p2 = points[i], p3 = points[Math.min(points.length - 1, i + 1)];
      ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
    }
  }
}
function marker(ctx, symbol, x, y, radius) {
  if (symbol === 'none') return;
  ctx.beginPath();
  switch (symbol) {
    case 'square': ctx.rect(x - radius, y - radius, radius * 2, radius * 2); break;
    case 'diamond': ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y); ctx.closePath(); break;
    case 'triangle': ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y + radius); ctx.lineTo(x - radius, y + radius); ctx.closePath(); break;
    case 'x': ctx.moveTo(x - radius, y - radius); ctx.lineTo(x + radius, y + radius); ctx.moveTo(x - radius, y + radius); ctx.lineTo(x + radius, y - radius); ctx.stroke(); return;
    case 'plus': ctx.moveTo(x - radius, y); ctx.lineTo(x + radius, y); ctx.moveTo(x, y - radius); ctx.lineTo(x, y + radius); ctx.stroke(); return;
    case 'dash': ctx.moveTo(x - radius, y); ctx.lineTo(x + radius, y); ctx.stroke(); return;
    case 'dot': ctx.arc(x, y, radius / 2, 0, Math.PI * 2); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? radius * 0.4 : radius; i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); break;
    case 'picture': fail('Chart picture markers require image renderer'); break;
    default: ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
  ctx.fill(); ctx.stroke();
}
function applyStyle(ctx, style, color, scale) {
  ctx.fillStyle = style.color || color; ctx.strokeStyle = style.lineColor || color; ctx.lineWidth = (style.lineWidth ?? 1.5) * scale;
  const patterns = { dash: [4, 3], dot: [1, 2], dashDot: [4, 2, 1, 2], lgDash: [8, 3], lgDashDot: [8, 2, 1, 2], sysDash: [3, 1], sysDot: [1, 1] };
  ctx.setLineDash((patterns[style.dash] || []).map(v => v * scale));
}
async function paintChartRectangle(ctx,style,color,rect,scale,helpers,zip,part,model) {
  const paint=async context=>{
    applyStyle(context,style,color,scale);
    if(!style.noFill) {
      if(style.fillNode) {
        if(!helpers.renderChartFill) fail('Chart rectangle fill requires fill renderer');
        await helpers.renderChartFill(context,style.fillNode,rect,zip,part,{relationships:style.fillRelationships});
      } else context.fillRect(rect.x,rect.y,rect.width,rect.height);
    }
    if(!style.noLine&&style.lineColor) context.strokeRect(rect.x,rect.y,rect.width,rect.height);
  };
  // An authored empty effectLst clears the inherited effect style; it needs no
  // raster pass. effectDag must still reach the renderer's explicit support gate.
  if(style.effectNode && (style.effectNode.localName === 'effectDag' || style.effectNode.children.length > 0)) {
    if(!helpers.renderChartEffects) fail('Chart primitive effects require full-frame effect renderer');
    await helpers.renderChartEffects(ctx,style.effectNode,rect,paint,{chartPartPath:part,relationships:style.effectRelationships});
    (model.effectRenderEvidence ||= []).push({kind:'rectangle',owner:style.effectOwner||part,themeReference:style.effectThemeReference||null,fullMicrosoftPixelsVerified:false});
  } else await paint(ctx);
}
function paintText(ctx, text, x, y, scale, size = 10, align = 'center', style = {}) {
  ctx.fillStyle = style.color || '#404040'; ctx.font = `${style.bold ? 'bold ' : ''}${style.italic ? 'italic ' : ''}${(style.size || size) * scale}px ${style.font || 'sans-serif'}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  String(text).split('\n').forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.2 * scale));
}
export function paintChartRichText(ctx, model, x, y, scale = 1, inherited = {}, placement = {}) {
  const lines = [[]], source = model.runs?.length ? model.runs : [{ text: model.text }];
  ctx.save();
  try {
    for (const run of source) {
      const style = mergeStyle(inherited, run), size = style.size || 14;
      if (!(Number.isFinite(size) && size > 0)) fail('Invalid chart rich-text font size');
      const font = `${style.bold ? 'bold ' : ''}${style.italic ? 'italic ' : ''}${size * scale}px ${style.font || 'sans-serif'}`;
      const fragments = String(run.text ?? '').split('\n');
      fragments.forEach((text, i) => { if (i) lines.push([]); ctx.font = font; ctx.textBaseline = 'middle'; const measured=ctx.measureText(text); lines.at(-1).push({ text, style, size, font, width: measured.width, ascent: measured.actualBoundingBoxAscent }); });
    }
    const metrics = lines.map(line => ({ width: line.reduce((sum, run) => sum + run.width, 0), height: Math.max(14, ...line.map(run => run.size)) * 1.2 * scale }));
    // Automatic hierarchy titles are top-aligned inside their authored body
    // insets. Measure their ink ascent in the same baseline mode used to paint;
    // a font-size constant does not describe the loaded font's glyph bounds.
    const firstAscent = Math.max(0,...lines[0].map(run=>Number.isFinite(run.ascent)?run.ascent:run.size*scale/2));
    let baseline = y + (placement.verticalAnchor === 'inkTop' ? firstAscent : 0);
    const firstBaseline = baseline;
    lines.forEach((line, i) => { let cursor = x - metrics[i].width / 2; for (const run of line) { ctx.font = run.font; ctx.fillStyle = run.style.color || '#404040'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; if (run.text) ctx.fillText(run.text, cursor, baseline); cursor += run.width; } baseline += metrics[i].height; });
    return { lines: metrics, width: Math.max(0, ...metrics.map(line => line.width)), height: metrics.reduce((sum, line) => sum + line.height, 0), firstBaseline };
  } finally { ctx.restore(); }
}
function crossing(axis, scale) {
  const value = axis?.crossesAt ?? (axis?.crosses === 'max' ? scale.max : axis?.crosses === 'min' ? scale.min : Math.max(scale.min, Math.min(scale.max, 0)));
  return Math.max(scale.min, Math.min(scale.max, scale.log && value <= 0 ? scale.min : value));
}
function axisTicks(scale, axis) {
  if (axis?.majorUnit != null && !(axis.majorUnit > 0)) fail('Invalid chart axis major unit');
  if (!axis?.majorUnit && !scale.step) return Array.from({ length: 5 }, (_, i) => scale.value(i / 4));
  const result = [], unit = axis?.majorUnit || scale.step;
  const lo = scale.log ? Math.log(scale.min) / Math.log(scale.log) : scale.min;
  const hi = scale.log ? Math.log(scale.max) / Math.log(scale.log) : scale.max;
  const start = Math.ceil(lo / unit) * unit;
  if ((hi - start) / unit > 2000) fail('Chart axis has too many explicit major ticks');
  for (let value = start; value <= hi + unit * 1e-9; value += unit) result.push(scale.log ? scale.log ** value : value);
  return result;
}
function clipValuePolygon(polygon, threshold, above) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], pInside = above ? p.value >= threshold : p.value <= threshold, qInside = above ? q.value >= threshold : q.value <= threshold;
    if (pInside) out.push(p);
    if (pInside !== qInside) { const t = (threshold - p.value) / (q.value - p.value); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z == null ? undefined : p.z + (q.z - p.z) * t, value: threshold }); }
  }
  return out;
}
export function projectChartPoint(point, camera) {
  const ax = camera.rotX * Math.PI / 180, ay = camera.rotY * Math.PI / 180;
  const x = point.x - 0.5, y = (point.y - 0.5) * camera.heightPercent / 100, z = (point.z - 0.5) * camera.depthPercent / 100;
  if (camera.rightAngles) return { x: x + z * Math.sin(ay) * 0.5, y: y - z * Math.sin(ax) * 0.5, depth: z };
  const rx = x * Math.cos(ay) + z * Math.sin(ay), rz = -x * Math.sin(ay) + z * Math.cos(ay), ry = y * Math.cos(ax) - rz * Math.sin(ax), depth = y * Math.sin(ax) + rz * Math.cos(ax);
  const focal = camera.perspective / 240;
  const factor = 1 / Math.max(0.05, 1 + depth * focal);
  return { x: rx * factor, y: ry * factor, depth };
}
function chartProjector(camera, bounds, limits = { x: [0, 1], y: [0, 1], z: [0, 1] }) {
  const corners = [];
  for (const x of limits.x) for (const y of limits.y) for (const z of limits.z) corners.push(projectChartPoint({ x, y, z }, camera));
  const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y)), w = Math.max(...corners.map(p => p.x)) - left, h = Math.max(...corners.map(p => p.y)) - top;
  const factor = Math.min(bounds.width / (w || 1), bounds.height / (h || 1)), ox = bounds.x + (bounds.width - w * factor) / 2, oy = bounds.y + (bounds.height - h * factor) / 2;
  return point => { const p = projectChartPoint(point, camera); return { x: ox + (p.x - left) * factor, y: oy + (p.y - top) * factor, depth: p.depth }; };
}
function shadedChartColor(ctx, color, amount) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const sample = canvas.getContext('2d'); sample.fillStyle = color; sample.fillRect(0, 0, 1, 1);
  const c = Array.from(sample.getImageData(0, 0, 1, 1).data);
  for (let i = 0; i < 3; i++) c[i] = Math.round(amount >= 0 ? c[i] + (255 - c[i]) * amount : c[i] * (1 + amount));
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
}
async function renderChart3D(ctx, d, model, plotRect, ys, palette, scale, helpers, zip, partPath) {
  const { group, count, stacked } = d, projector = chartProjector(model.camera, plotRect, group.family === 'pie3DChart' ? { x: [0, 1], y: [0.3, 0.6], z: [0, 1] } : undefined), faces = [], marks = [], labels = [], stacksPositive = Array(count).fill(0), stacksNegative = Array(count).fill(0);
  const face = (points, color, style, shade = 0) => { const vertices = points.map(projector); faces.push({ vertices, color, style, shade, depth: vertices.reduce((s, p) => s + p.depth, 0) / vertices.length }); };
  const box = (x0, x1, y0, y1, z0, z1, color, style) => {
    const p = [{ x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }];
    for (const [indices, shade] of [[[4, 5, 6, 7], -0.3], [[0, 4, 7, 3], -0.2], [[1, 5, 6, 2], -0.2], [[3, 2, 6, 7], -0.3], [[0, 1, 5, 4], 0.2], [[0, 1, 2, 3], 0]]) face(indices.map(i => p[i]), color, style, shade);
  };
  const catIndex = i => d.xAxis?.reverse ? count - 1 - i : i;
  const valueY = value => Math.max(0, Math.min(1, 1 - ys.fraction(value)));
  if (group.family !== 'pie3DChart') {
    const wallFaces = [
      { style: model.walls.back, points: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }] },
      { style: model.walls.side, points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 0 }] },
      { style: model.walls.floor, points: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }] }
    ];
    for (const wall of wallFaces) {
      const vertices = wall.points.map(projector), wallPath = new Path2D(); vertices.forEach((p, i) => i ? wallPath.lineTo(p.x, p.y) : wallPath.moveTo(p.x, p.y)); wallPath.closePath();
      if (wall.style.fillNode) { if (!helpers.renderChartFill) fail('3D chart wall texture requires fill renderer'); ctx.save(); try { ctx.clip(wallPath); await helpers.renderChartFill(ctx, wall.style.fillNode, plotRect, zip, partPath, {relationships:wall.style.fillRelationships}); } finally { ctx.restore(); } }
      else if (!wall.style.noFill) { ctx.fillStyle = wall.style.color || '#f2f2f2'; ctx.fill(wallPath); }
      if (!wall.style.noLine) { ctx.strokeStyle = wall.style.lineColor || '#bfbfbf'; ctx.lineWidth = (wall.style.lineWidth || 1) * scale; ctx.stroke(wallPath); }
    }
    const axisLine = points => { const p = points.map(projector); ctx.beginPath(); linePath(ctx, p, false); ctx.stroke(); };
    ctx.setLineDash([]); ctx.strokeStyle = d.yAxis?.style.lineColor || '#808080'; ctx.lineWidth = scale;
    if (!d.yAxis?.deleted) for (const tick of axisTicks(ys, d.yAxis)) {
      const f = ys.fraction(tick);
      if (d.yAxis?.majorGrid !== false) axisLine(group.horizontal ? [{ x: f, y: 0, z: 1 }, { x: f, y: 1, z: 1 }, { x: f, y: 1, z: 0 }] : [{ x: 1, y: 1 - f, z: 1 }, { x: 0, y: 1 - f, z: 1 }, { x: 0, y: 1 - f, z: 0 }]);
      if (d.yAxis?.labelPosition !== 'none') { const p = projector(group.horizontal ? { x: f, y: 1, z: 0 } : { x: 0, y: 1 - f, z: 0 }); labels.push({ text: formatNumber(tick, d.yAxis?.numberFormat, d.percent), x: p.x - (group.horizontal ? 0 : 4 * scale), y: p.y + (group.horizontal ? (model.baseFont.size || 12) * scale : 0), align: group.horizontal ? 'center' : 'right', style: d.yAxis?.textStyle || model.baseFont }); }
    }
    axisLine([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }]);
    if (!d.xAxis?.deleted && d.xAxis?.labelPosition !== 'none') for (let i = 0; i < count; i++) {
      const text = group.series.find(s => s.categories[i] != null)?.categories[i]; if (!text) continue;
      const t = group.family === 'bar3DChart' ? (catIndex(i) + 0.5) / count : count === 1 ? 0.5 : catIndex(i) / (count - 1), p = projector(group.horizontal ? { x: 0, y: t, z: 0 } : { x: t, y: 1, z: 0 });
      labels.push({ text, x: p.x - (group.horizontal ? 4 * scale : 0), y: p.y + (group.horizontal ? 0 : (model.baseFont.size || 12) * scale), align: group.horizontal ? 'right' : 'center', style: d.xAxis?.textStyle || model.baseFont });
    }
  }
  if (group.family === 'bar3DChart') {
    if (group.barShape !== 'box') fail(`3D bar solid is not implemented: ${group.barShape}`);
    const seriesCount = group.series.length, separateDepth = group.grouping === 'standard', cluster = separateDepth || stacked ? 1 : seriesCount, catSlot = 1 / count, width = catSlot / (cluster + group.gapWidth / 100);
    for (const [si, ser] of group.series.entries()) for (let i = 0; i < count; i++) {
      const raw = ser.vals[i]; if (raw == null || ys.log && raw <= 0) continue;
      const value = d.value(raw, i), stack = value >= 0 ? stacksPositive : stacksNegative, from = stacked ? stack[i] : ys.log ? ys.min : Math.max(ys.min, Math.min(ys.max, 0)), to = stacked ? from + value : value;
      if (stacked) stack[i] = to;
      const center = (catIndex(i) + 0.5) / count, x0 = center - width * cluster / 2 + (separateDepth || stacked ? 0 : si * width), x1 = x0 + width;
      const zSlot = separateDepth ? 1 / seriesCount : 1, depth = zSlot / (1 + group.gapDepth / 100), z0 = (separateDepth ? si * zSlot : 0) + (zSlot - depth) / 2, z1 = z0 + depth;
      const style = mergeStyle(ser.style, ser.points.find(p => p.index === i)?.style), color = style.color || palette[(group.varyColors ? i : ser.index) % palette.length], y0 = Math.min(valueY(from), valueY(to)), y1 = Math.max(valueY(from), valueY(to));
      if (group.horizontal) box(1 - y1, 1 - y0, x0, x1, z0, z1, color, style); else box(x0, x1, y0, y1, z0, z1, color, style);
      const p = projector(group.horizontal ? { x: ys.fraction(to), y: center, z: z0 } : { x: center, y: valueY(to), z: z0 });
      marks.push({ family: group.family, series: si, point: i, value: raw, from, to, x: p.x, y: p.y, solid: { x0, x1, y0, y1, z0, z1 } });
    }
  } else if (group.family === 'pie3DChart') {
    const ser = group.series[0]; if (!ser) fail('3D pie has no series');
    const total = ser.vals.reduce((s, v) => s + Math.abs(v || 0), 0); let angle = group.firstSliceAngle * Math.PI / 180 - Math.PI / 2;
    for (let i = 0; i < ser.vals.length; i++) {
      const raw = ser.vals[i]; if (raw == null || !total) continue; const sweep = Math.abs(raw) / total * Math.PI * 2, mid = angle + sweep / 2, point = ser.points.find(p => p.index === i), style = mergeStyle(ser.style, point?.style), color = style.color || palette[i % palette.length], explosion = (point?.explosion || ser.explosion) / 100 * 0.45;
      const cx = 0.5 + Math.cos(mid) * explosion, cz = 0.5 + Math.sin(mid) * explosion, top = 0.35, bottom = 0.55, segments = Math.max(1, Math.ceil(sweep / (Math.PI / 90))), outline = [];
      for (let j = 0; j <= segments; j++) { const a = angle + sweep * j / segments; outline.push({ x: cx + Math.cos(a) * 0.45, y: top, z: cz + Math.sin(a) * 0.45 }); }
      const center = { x: cx, y: top, z: cz }; face([center, ...outline], color, style, 0.08);
      for (let j = 1; j < outline.length; j++) { const p = outline[j - 1], q = outline[j]; face([p, q, { ...q, y: bottom }, { ...p, y: bottom }], color, style, -0.3); }
      face([center, outline[0], { ...outline[0], y: bottom }, { ...center, y: bottom }], color, style, -0.2); face([center, outline.at(-1), { ...outline.at(-1), y: bottom }, { ...center, y: bottom }], color, style, -0.2);
      const p = projector({ x: cx + Math.cos(mid) * 0.3, y: top, z: cz + Math.sin(mid) * 0.3 }); marks.push({ family: group.family, series: 0, point: i, value: raw, fraction: Math.abs(raw) / total, angle, sweep, x: p.x, y: p.y }); angle += sweep;
    }
  } else if (group.family === 'surface3DChart') {
    if (group.series.length < 2 || count < 2) fail('3D surface requires at least a two-by-two numeric grid');
    const ticks = axisTicks(ys, d.yAxis), bands = [ys.min, ...ticks.filter(v => v > ys.min && v < ys.max), ys.max];
    for (let r = 0; r < group.series.length - 1; r++) for (let c = 0; c < count - 1; c++) {
      const vertex = (row, col) => { const value = group.series[row].vals[col]; return { x: catIndex(col) / (count - 1), y: value == null ? null : valueY(value), z: row / (group.series.length - 1), value }; };
      const a = vertex(r, c), b = vertex(r, c + 1), e = vertex(r + 1, c), f = vertex(r + 1, c + 1);
      for (const triangle of [[a, b, f], [a, f, e]]) {
        if (triangle.some(p => p.value == null)) continue;
        for (let bi = 0; bi < bands.length - 1; bi++) { const polygon = clipValuePolygon(clipValuePolygon(triangle, bands[bi], true), bands[bi + 1], false); if (polygon.length < 3) continue; const style = group.bands.find(band => band.index === bi)?.style || {}, color = style.color || palette[bi % palette.length]; face(polygon, color, style, 0); const p = projector(polygon[0]); marks.push({ family: group.family, band: bi, min: bands[bi], max: bands[bi + 1], x: p.x, y: p.y, polygon: polygon.map(projector) }); }
      }
    }
  } else if (['line3DChart', 'area3DChart'].includes(group.family)) {
    for (const [si, ser] of group.series.entries()) {
      const zSlot = 1 / group.series.length, z0 = (si + 0.2) * zSlot, z1 = (si + 0.8) * zSlot, color = ser.style.color || palette[ser.index % palette.length], points = [];
      for (let i = 0; i < count; i++) { const raw = ser.vals[i]; if (raw == null || ys.log && raw <= 0) { points.push(null); continue; } const value = d.value(raw, i), stack = value >= 0 ? stacksPositive : stacksNegative, from = stacked ? stack[i] : ys.log ? ys.min : Math.max(ys.min, Math.min(ys.max, 0)), to = stacked ? from + value : value; if (stacked) stack[i] = to; const p = { x: count === 1 ? 0.5 : catIndex(i) / (count - 1), y: valueY(to), z: z0, base: valueY(from) }; points.push(p); const projected = projector(p); marks.push({ family: group.family, series: si, point: i, value: raw, from, to, x: projected.x, y: projected.y }); }
      for (let i = 1; i < points.length; i++) { const p = points[i - 1], q = points[i]; if (!p || !q) continue; face([p, q, { ...q, z: z1 }, { ...p, z: z1 }], color, ser.style, 0.15); if (group.family === 'area3DChart') { face([p, q, { ...q, y: q.base }, { ...p, y: p.base }], color, ser.style); face([{ ...p, z: z1 }, { ...q, z: z1 }, { ...q, y: q.base, z: z1 }, { ...p, y: p.base, z: z1 }], color, ser.style, -0.2); } }
    }
  } else fail(`Unsupported 3D chart family: ${group.family}`);
  // Paint distant surfaces first; no 3D family is substituted with a 2D bar.
  faces.sort((a, b) => b.depth - a.depth);
  for (const f of faces) {
    const path = new Path2D(); f.vertices.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath();
    applyStyle(ctx, { ...f.style, color: shadedChartColor(ctx, f.color, f.shade) }, f.color, scale);
    if (group.wireframe && group.family === 'surface3DChart') { ctx.stroke(path); continue; }
    if (f.style.fillNode) { if (!helpers.renderChartFill) fail('3D chart texture requires fill renderer'); ctx.save(); try { ctx.clip(path); await helpers.renderChartFill(ctx, f.style.fillNode, plotRect, zip, partPath, {relationships:f.style.fillRelationships}); } finally { ctx.restore(); } }
    else if (!f.style.noFill) ctx.fill(path);
    if (!f.style.noLine && f.style.lineColor) ctx.stroke(path);
  }
  return { marks, faces, labels };
}
function applyLegacyStyleColors(model, doc, helpers) {
  if (!model.styleDefaults || !helpers.getChartThemeColors || !helpers.parseColor) return;
  const descriptor = model.styleDefaults, format = helpers.getChartThemeFormat?.();
  const resolve = rule => {
    const fill = doc.createElementNS(A,'a:solidFill'); fill.appendChild(chartColorNode(rule,doc));
    return helpers.parseColor(fill);
  };
  const defaults = (style, rule, intensity = null) => {
    if (style.color != null || style.noFill || style.fillNode) return;
    const themed = intensity && instantiateChartThemeStyle(format,'fills',intensity,rule,doc,helpers.parseXml);
    if (themed?.node.localName === 'noFill') { style.noFill = true; return; }
    if (themed && themed.node.localName !== 'solidFill') { style.fillNode = themed.node; style.fillRelationships = themed.relationships; }
    else style.color = themed ? helpers.parseColor(themed.node) : resolve(rule);
  };
  const defaultLine = (style, rule, intensity = 'subtle', factor = 1) => {
    if (style.spPr && one(style.spPr,'ln')) return;
    if (intensity === 'none') { style.noLine = true; return; }
    const themed = instantiateChartThemeStyle(format,'lines',intensity,rule,doc,helpers.parseXml);
    style.lineColor = themed ? helpers.parseColor(one(themed.node,'solidFill')) || resolve(rule) : resolve(rule);
    if (themed?.node.hasAttribute('w')) style.lineWidth = Number(themed.node.getAttribute('w')) / 9525 * factor;
    if (themed) style.dash = val(themed.node,'prstDash');
    style.noLine = !!one(themed?.node,'noFill');
  };
  const defaultEffect=(style,rule,intensity)=>{
    if(style.effectNode||intensity==='none') return;
    const themed=instantiateChartThemeStyle(format,'effects',intensity,rule,doc,helpers.parseXml);
    if(!themed) return;
    style.effectNode=one(themed.node,'effectLst')||one(themed.node,'effectDag');
    style.effectRelationships=themed.relationships;
    style.effectOwner='theme-effect-style';style.effectThemeReference=intensity;
    // Scene/bevel defaults are retained but do not become a false claim that
    // a two-dimensional raster effect implements the whole 3-D style entry.
    style.effectTemplate3DPending=!!(one(themed.node,'scene3d')||one(themed.node,'sp3d'));
  };
  defaults(model.chartStyle, descriptor.chartArea.fill,descriptor.chartArea.fillTheme);
  defaultLine(model.chartStyle,descriptor.chartArea.line,descriptor.chartArea.lineTheme);
  if (!model.groups.some(g => g.family.includes('3D'))) defaults(model.plotStyle,descriptor.plotArea.fill,descriptor.plotArea.fillTheme);
  const highest = Math.max(0,...model.groups.flatMap(g=>g.series.map(s=>s.index)));
  for (const group of model.groups) for (const series of group.series) {
    const rule = chartSeriesColorRule(descriptor,series.index,highest);
    const fillSupported = ['barChart','bar3DChart','area3DChart','line3DChart','pie3DChart'].includes(group.family);
    defaults(series.style,rule,fillSupported ? descriptor.series[group.family.includes('3D') ? 'fillTheme3D' : 'fillTheme2D'] : null);
    if(['barChart','histogramChart','waterfallChart','funnelChart'].includes(group.family)) defaultEffect(series.style,descriptor.series.effectColor,descriptor.series.effectTheme);
    const lineFamily = ['lineChart','scatterChart','radarChart','stockChart'].includes(group.family);
    if (series.style.lineColor == null && !series.style.noLine) {
      const border = descriptor.series.border;
      if (lineFamily) defaultLine(series.style,rule,'subtle',descriptor.series.lineWidthFactor);
      else if (border) series.style.lineColor = resolve(chartSeriesColorRule(descriptor,series.index,highest,'border'));
      else if (series.style.noLine == null) series.style.noLine = true;
    }
    if (group.varyColors || ['pieChart','pie3DChart','doughnutChart','ofPieChart'].includes(group.family)) {
      for (let i=0;i<series.vals.length;i++) {
        let point=series.points.find(p=>p.index===i);
        if (!point) {point={index:i,style:{}};series.points.push(point);}
        defaults(point.style,chartSeriesColorRule(descriptor,i,Math.max(0,series.vals.length-1)),fillSupported ? descriptor.series[group.family.includes('3D') ? 'fillTheme3D' : 'fillTheme2D'] : null);
      }
    }
  }
  // Theme fill/effect selectors and application-defined fade endpoints still require Office comparison.
  model.styleConformance = {legacyColorsApplied:true,themeFillReferencesApplied:!!format,themeLineReferencesApplied:!!format,themeEffectsVerified:false,themeEffectPendingFamilies:descriptor.series.effectTheme==='none'?[]:model.groups.filter(group=>!['barChart','histogramChart','waterfallChart','funnelChart'].includes(group.family)).map(group=>group.family),fadePixelsVerified:false,themeFillPendingFamilies:['pieChart','doughnutChart','ofPieChart','areaChart','radarChart','bubbleChart']};
}
async function applyExternalChartTextStyles(model, zip, part, helpers) {
  const folder = part.slice(0,part.lastIndexOf('/')+1), filename = part.slice(part.lastIndexOf('/')+1);
  const relFile = zip.file(`${folder}_rels/${filename}.rels`); if (!relFile) return;
  const parse = helpers.parseXml || (xml => new DOMParser().parseFromString(xml,'application/xml'));
  const relation = descendants(parse(await relFile.async('text')),'Relationship').find(n=>n.getAttribute('Type')?.endsWith('/chartStyle'));
  if (!relation) return;
  if (relation.getAttribute('TargetMode') === 'External') fail('External chartStyle relationship requires local resource');
  const segments = [], target = relation.getAttribute('Target');
  for (const segment of (target.startsWith('/') ? target : folder+target).split('/')) { if(segment==='..') segments.pop(); else if(segment && segment!=='.') segments.push(segment); }
  const file = zip.file(segments.join('/')); if (!file) fail('Authored chartStyle part is missing');
  const document = parse(await file.async('text'));
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'chartStyle' || document.documentElement.namespaceURI !== 'http://schemas.microsoft.com/office/drawing/2012/chartStyle') fail('Malformed authored chartStyle part');
  model.externalChartStyle=document.documentElement;
  model.externalChartStyleOwner=segments.join('/');
  try { model.externalTextStyles = parseExternalChartTextStyles(document.documentElement,helpers); } catch(error) { fail(error.message); }
  for (const axis of model.axes) axis.textStyle = {...model.externalTextStyles[axis.type==='valAx'?'valueAxis':'categoryAxis'],...axis.textStyle};
  if (model.legend) model.legend.textStyle = {...model.externalTextStyles.legend,...model.legend.textStyle};
  model.externalStyleConformance = {textRoleDefaultsApplied:true,fullStyleRenderingVerified:false};
}
async function applyExternalChartColorStyle(model, zip, part, helpers, doc, fallback) {
  const folder=part.slice(0,part.lastIndexOf('/')+1),filename=part.slice(part.lastIndexOf('/')+1);
  const relFile=zip.file(`${folder}_rels/${filename}.rels`); if(!relFile) return fallback;
  const parse=helpers.parseXml||(xml=>new DOMParser().parseFromString(xml,'application/xml'));
  const relationships=parse(await relFile.async('text'));
  if(relationships.querySelector('parsererror')) fail('Malformed chart relationships');
  const relations=descendants(relationships,'Relationship').filter(node=>node.getAttribute('Type')?.endsWith('/chartColorStyle'));
  if(!relations.length) return fallback;
  if(relations.length!==1) fail('Ambiguous chartColorStyle relationships');
  const relation=relations[0],target=relation.getAttribute('Target');
  if(relation.getAttribute('TargetMode')==='External'||!target) fail('Authored chartColorStyle requires a local part');
  const segments=[];
  for(const segment of (target.startsWith('/')?target:folder+target).split('/')) {
    if(segment==='..') {if(!segments.length) fail('Chart color style path escapes the package');segments.pop();}
    else if(segment&&segment!=='.') segments.push(segment);
  }
  const owner=segments.join('/'),file=zip.file(owner); if(!file) fail('Authored chartColorStyle part is missing');
  const document=parse(await file.async('text')),root=document.documentElement;
  if(document.querySelector('parsererror')||root.namespaceURI!=='http://schemas.microsoft.com/office/drawing/2012/chartStyle'||root.localName!=='colorStyle') fail('Malformed authored chartColorStyle part');
  const names=new Set(['scrgbClr','srgbClr','hslClr','sysClr','schemeClr','prstClr']);
  const count=Array.from(root.children).filter(n=>n.namespaceURI===A&&names.has(n.localName)).length*Math.max(1,kids(root,'variation').length);
  if(count>1000000) fail('Chart color style contains too many variations');
  const palette=[],colorNodes=[];
  try {
    for(let index=0;index<count;index++) {
      const fill=doc.createElementNS(A,'a:solidFill'); fill.appendChild(chartColorStyleNode(root,index,doc));
      const color=helpers.parseColor?.(fill); if(!color) fail('Chart color style requires a resolved DrawingML color');
      palette.push(color);colorNodes.push(fill.firstElementChild);
    }
    if(!palette.length) fail('Chart color style has no palette colors');
  } catch(error) {fail(error.message);}
  model.colorStyleConformance={owner,method:root.getAttribute('meth'),colorCount:palette.length,paletteApplied:true,fullStyleRenderingVerified:false};
  model.externalColorNodes=colorNodes;
  return palette;
}
function applyExternalBoxPointStyles(model,helpers,doc,palette) {
  const role=one(model.externalChartStyle,'dataPoint'); if(!role) return;
  for(const group of model.groups.filter(group=>group.family==='boxWhiskerChart')) for(const series of group.series) {
    const template=doc.importNode(role,true),color=model.externalColorNodes?.[series.index%model.externalColorNodes.length];
    let fallback=color;
    if(!fallback) {
      const hex=/^#([0-9a-f]{6})$/i.exec(palette[series.index%palette.length]);
      if(!hex) fail('Chart dataPoint style placeholder requires a resolved color node');
      fallback=doc.createElementNS(A,'a:srgbClr');fallback.setAttribute('val',hex[1]);
    }
    for(const placeholder of descendants(template,'schemeClr').filter(node=>node.namespaceURI===A&&node.getAttribute('val')==='phClr')) {
      const replacement=doc.importNode(fallback,true);
      for(const transform of Array.from(placeholder.children)) replacement.appendChild(doc.importNode(transform,true));
      placeholder.replaceWith(replacement);
    }
    const authored=series.style,defaults=shapeStyle(template,helpers);
    // Defaults do not replace authored series fill, noFill, line or point overrides.
    series.style=mergeStyle(defaults,authored);series.style.spPr=authored.spPr;
    series.style.externalVisualRole='dataPoint';
    series.style.externalVisualOwner=model.externalChartStyleOwner;
  }
  if(model.groups.some(group=>group.family==='boxWhiskerChart')) {
    model.externalStyleConformance.visualRoleDefaultsApplied=['boxWhiskerChart.dataPoint.spPr'];
    model.externalStyleConformance.visualRoleReferencesVerified=false;
  }
}
export async function renderPptxChart({ ctx, shape, bounds, scale = 1, zip, helpers = {} }) {
  const resolved = helpers.resolvePath ? helpers.resolvePath(shape.chartTarget) : shape.chartTarget.replace(/^\//, '');
  const path = resolved.replace(/^\//, ''), file = zip.file(path) || zip.file(shape.chartTarget.replace(/^\//, ''));
  if (!file) fail(`Chart part is missing: ${path}`);
  const xml = await file.async('text');
  const doc = helpers.parseXml ? helpers.parseXml(xml) : new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) fail('Malformed chart XML');
  if (doc.documentElement.namespaceURI === CX) await materializeChartExCaches(doc, zip, path, helpers);
  const model = parseChartDocument(doc, helpers);
  let palette = helpers.getChartPalette?.() || helpers.themeColors && ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(k => helpers.themeColors[k]) || PALETTE;
  palette=await applyExternalChartColorStyle(model,zip,path,helpers,doc,palette);
  applyLegacyStyleColors(model,doc,helpers);
  await applyExternalChartTextStyles(model,zip,path,helpers);
  applyExternalBoxPointStyles(model,helpers,doc,palette);
  for(const group of model.groups) if(!['barChart','histogramChart','waterfallChart','funnelChart'].includes(group.family)) {
    const styles=group.series.flatMap(series=>[series.style,...series.points.map(point=>point.style)]);
    if(styles.some(style=>style.effectNode&&(style.effectNode.localName==='effectDag'||style.effectNode.children.length))) fail(`Chart primitive effect bounds are not implemented for ${group.family}`);
  }
  const { x, y, width, height } = bounds, fontSize = model.baseFont.size, pad = fontSize ? fontSize * 2 / 3 * scale : 8 * scale;
  let plotRect = { x: x + 3 * pad, y: y + pad, width: width - 5 * pad, height: height - 4 * pad };
  if (fontSize) {
    ctx.save(); ctx.font = `${fontSize * scale}px ${model.baseFont.font || 'sans-serif'}`;
    const maxValue = Math.max(1, ...model.groups.flatMap(g => g.series.flatMap(s => s.vals)).filter(Number.isFinite));
    const left = pad + ctx.measureText(String(Math.ceil(maxValue))).width + fontSize / 2 * scale;
    ctx.restore(); plotRect = { x: x + left, y: y + pad, width: width - left - pad, height: height - pad - (fontSize * 1.6 * scale + pad) };
  }
  const hierarchyLayout = model.chartEx && model.groups.every(group=>['sunburstChart','treemapChart'].includes(group.family));
  const bodyTitleLayout=hierarchyLayout || model.chartEx && model.groups.every(group=>group.family==='boxWhiskerChart');
  if(hierarchyLayout) {
    // Hierarchy charts have no Cartesian axis labels; reserve symmetric chart padding.
    plotRect={x:x+pad,y:y+pad,width:width-2*pad,height:height-2*pad};
    model.layoutConformance={axisFreeHierarchy:true,automaticMicrosoftLayoutVerified:false};
  }
  if (model.title.text && !model.title.overlay) { const titleStyle=model.externalTextStyles?.title; const titleHeight = hierarchyLayout && titleStyle?.size ? (titleStyle.size+(titleStyle.bodyInsets?.top||0)+(titleStyle.bodyInsets?.bottom||0))*scale : fontSize ? fontSize * 2.1 * scale : 22 * scale; plotRect.y += titleHeight; plotRect.height -= titleHeight; }
  if (model.legend && !model.legend.overlay) {
    if (['r', 'tr'].includes(model.legend.position)) plotRect.width -= Math.min(width * 0.25, 100 * scale);
    if (model.legend.position === 'l') { plotRect.x += Math.min(width * 0.25, 100 * scale); plotRect.width -= Math.min(width * 0.25, 100 * scale); }
    if (model.legend.position === 'b') plotRect.height -= 20 * scale;
    if (model.legend.position === 't') { plotRect.y += 20 * scale; plotRect.height -= 20 * scale; }
  }
  if (model.layout) {
    const l = model.layout;
    if (![l.x, l.y, l.w, l.h].every(Number.isFinite)) fail('Invalid chart manual layout');
    plotRect = { x: x + l.x * width, y: y + l.y * height, width: l.w * width, height: l.h * height };
  }
  if (!(plotRect.width > 0 && plotRect.height > 0)) fail('Chart plot rectangle has no area');
  const marks = [], projectedFaces = [], axisById = new Map(model.axes.map(a => [a.id, a]));
  ctx.save();
  try {
    if (!model.chartStyle.noFill) {
      if (model.chartStyle.fillNode) { if (!helpers.renderChartFill) fail('Chart picture/gradient/pattern background requires fill renderer'); await helpers.renderChartFill(ctx, model.chartStyle.fillNode, bounds, zip, path, {relationships:model.chartStyle.fillRelationships}); }
      else { ctx.fillStyle = model.chartStyle.color || '#ffffff'; ctx.fillRect(x, y, width, height); }
    }
    if (!model.chartStyle.noLine && model.chartStyle.lineColor) { applyStyle(ctx,model.chartStyle,'#ffffff',scale); ctx.strokeRect(x,y,width,height); }
    if (!model.plotStyle.noFill && model.plotStyle.fillNode) { if (!helpers.renderChartFill) fail('Chart plot picture/gradient/pattern background requires fill renderer'); await helpers.renderChartFill(ctx, model.plotStyle.fillNode, plotRect, zip, path, {relationships:model.plotStyle.fillRelationships}); }
    else if (!model.plotStyle.noFill && model.plotStyle.color) { ctx.fillStyle = model.plotStyle.color; ctx.fillRect(plotRect.x, plotRect.y, plotRect.width, plotRect.height); }
    if (model.title.text) {
      if (helpers.drawChartText) helpers.drawChartText(ctx, model.title, { x: x + width / 2, y: y + 14 * scale, width, height: 22 * scale }, scale);
      else {
        const titleStyle={bold:true,...model.externalTextStyles?.title,...model.baseFont};
        const bodyTop=bodyTitleLayout && titleStyle.bodyInsets ? y+pad+titleStyle.bodyInsets.top*scale : null;
        const painted=paintChartRichText(ctx,model.title,x+width/2,bodyTop??y+(fontSize?fontSize:14)*scale,scale,titleStyle,bodyTop!=null?{verticalAnchor:'inkTop'}:{});
        if(bodyTop!=null) model.titlePaintLayout={kind:'body-inset-ink-top',contentTop:bodyTop,firstBaseline:painted.firstBaseline,automaticMicrosoftLayoutVerified:false};
      }
    }
    const groupData = model.groups.map(group => {
      const count = group.family === 'boxWhiskerChart' ? Math.max(1,group.categories.length) : Math.max(1, ...group.series.map(s => s.vals.length));
      const pos = Array(count).fill(0), neg = Array(count).fill(0);
      for (const ser of group.series) ser.vals.forEach((v, i) => { if (v != null) (v >= 0 ? pos : neg)[i] += v; });
      const percent = group.grouping === 'percentStacked', stacked = percent || group.grouping === 'stacked';
      const value = (v, i) => percent ? v / ((v >= 0 ? pos[i] : -neg[i]) || 1) : v;
      let values = stacked ? [...pos.map((v, i) => percent && v ? 1 : v), ...neg.map(v => percent && v ? -1 : v)] : group.series.flatMap(s => s.vals);
      if (group.family === 'waterfallChart') { let total = 0; values = [0]; for (const [i, v] of group.series[0].vals.entries()) { if (v == null) continue; total = group.subtotals.includes(i) ? v : total + v; values.push(total); } }
      const axes = group.axisIds.map(id => axisById.get(id)).filter(Boolean);
      const categoryAxis = axes.find(a => a.type !== 'valAx');
      const numericAxes = axes.filter(a => a.type === 'valAx');
      const xy = ['scatterChart', 'bubbleChart'].includes(group.family);
      const xAxis = xy ? numericAxes.find(a => ['b', 't'].includes(a.position)) || numericAxes[0] : categoryAxis;
      const yAxis = xy ? numericAxes.find(a => a !== xAxis) || numericAxes[1] : numericAxes[0];
      return { group, count, pos, neg, percent, stacked, value, values, xAxis, yAxis, xy };
    });
    const axisValues = new Map();
    for (const d of groupData) {
      const key = d.yAxis?.id || 'defaultY'; axisValues.set(key, [...(axisValues.get(key) || []), ...d.values]);
      if (d.xy) { const xKey = d.xAxis?.id || 'defaultX'; axisValues.set(xKey, [...(axisValues.get(xKey) || []), ...d.group.series.flatMap(s => s.xs)]); }
    }
    const paintedAxes = new Set();
    for (const d of groupData) {
      const { group, count, stacked, percent, xy } = d;
      // Microsoft native SDK boxWhisker gold rounds the full sample extent,
      // including outliers, to five nice intervals. Keep this candidate profile
      // separate from authored scaling and other application-defined layouts.
      const automaticBoxProfile=model.chartEx && group.family==='boxWhiskerChart' && d.yAxis?.min==null && d.yAxis?.max==null && d.yAxis?.majorUnit==null && !d.yAxis?.logBase;
      const tickTarget=automaticBoxProfile?5:fontSize?Math.floor((group.horizontal?plotRect.width:plotRect.height)/(fontSize*scale*(group.horizontal?4:1.4))):null;
      const ys = axisScale(d.yAxis, axisValues.get(d.yAxis?.id || 'defaultY'), percent, tickTarget);
      (model.axisRenderEvidence ||= []).push({id:d.yAxis?.id||'defaultY',family:group.family,min:ys.min,max:ys.max,majorUnit:d.yAxis?.majorUnit??ys.step,automaticBoxProfile,automaticMicrosoftLayoutVerified:false});
      const xs = xy ? axisScale(d.xAxis, axisValues.get(d.xAxis?.id || 'defaultX'), false, fontSize ? Math.floor(plotRect.width / (fontSize * scale * 4)) : null) : null;
      const categoryIndex = i => d.xAxis?.reverse ? count - 1 - i : i;
      const cat = i => group.horizontal ? plotRect.y + (categoryIndex(i) + 0.5) * plotRect.height / count : plotRect.x + (categoryIndex(i) + 0.5) * plotRect.width / count;
      const yc = v => group.horizontal ? plotRect.x + ys.fraction(v) * plotRect.width : plotRect.y + (1 - ys.fraction(v)) * plotRect.height;
      const xc = v => plotRect.x + xs.fraction(v) * plotRect.width;
      const axisKey = d.yAxis?.id || 'defaultY';
      if (!group.family.includes('3D') && !['pieChart', 'doughnutChart', 'ofPieChart', 'radarChart', 'funnelChart', 'treemapChart', 'sunburstChart'].includes(group.family) && !paintedAxes.has(axisKey)) {
        paintedAxes.add(axisKey); ctx.setLineDash([]); ctx.lineWidth = scale;
        if (!d.yAxis?.deleted) for (const tick of axisTicks(ys, d.yAxis)) {
          const position = yc(tick);
          if (d.yAxis?.majorGrid !== false) { ctx.strokeStyle = '#d9d9d9'; ctx.beginPath(); if (group.horizontal) { ctx.moveTo(position, plotRect.y); ctx.lineTo(position, plotRect.y + plotRect.height); } else { ctx.moveTo(plotRect.x, position); ctx.lineTo(plotRect.x + plotRect.width, position); } ctx.stroke(); }
          if (d.yAxis?.labelPosition !== 'none') paintText(ctx, formatNumber(tick, d.yAxis?.numberFormat, percent), group.horizontal ? position : plotRect.x - 4 * scale, group.horizontal ? plotRect.y + plotRect.height + (fontSize || 12) * scale : position, scale, 9, group.horizontal ? 'center' : 'right', d.yAxis?.textStyle || model.baseFont);
        }
        if (!d.xAxis?.deleted) {
          const base = yc(crossing(d.xAxis, ys)); ctx.strokeStyle = d.xAxis?.style.lineColor || '#808080'; ctx.beginPath(); if (group.horizontal) { ctx.moveTo(base, plotRect.y); ctx.lineTo(base, plotRect.y + plotRect.height); } else { ctx.moveTo(plotRect.x, base); ctx.lineTo(plotRect.x + plotRect.width, base); } ctx.stroke();
          if (xy) for (const tick of axisTicks(xs, d.xAxis)) paintText(ctx, formatNumber(tick, d.xAxis?.numberFormat), xc(tick), plotRect.y + plotRect.height + (fontSize || 12) * scale, scale, 9, 'center', d.xAxis?.textStyle || model.baseFont);
          else for (let i = 0; i < count; i++) { const label = group.categories?.[i] ?? group.series.find(s => s.categories[i] != null)?.categories[i] ?? ''; if (label && d.xAxis?.labelPosition !== 'none') paintText(ctx, label, group.horizontal ? plotRect.x - 4 * scale : cat(i), group.horizontal ? cat(i) : plotRect.y + plotRect.height + (fontSize || 12) * scale, scale, 8, group.horizontal ? 'right' : 'center', d.xAxis?.textStyle || model.baseFont); }
        }
      }
      const positiveStack = Array(count).fill(0), negativeStack = Array(count).fill(0);
      let threeDLabels = [];
      ctx.save(); ctx.beginPath(); ctx.rect(plotRect.x, plotRect.y, plotRect.width, plotRect.height); ctx.clip();
      try {
        if (group.family === 'funnelChart') {
          if (model.groups.length !== 1) fail('Multiple visible funnel series require Microsoft layout oracle');
          const ser = group.series[0], max = Math.max(0, ...ser.vals.filter(Number.isFinite)), slot = plotRect.height / count;
          for (let i = 0; i < ser.vals.length; i++) {
            const value = ser.vals[i]; if (value == null) continue;
            const w = max ? plotRect.width * value / max : 0, h = slot / (1 + group.gapWidth), rect = { x: plotRect.x + (plotRect.width - w) / 2, y: plotRect.y + slot * i + (slot - h) / 2, width: w, height: h };
            const style = mergeStyle(ser.style, ser.points.find(p => p.index === i)?.style); applyStyle(ctx, style, palette[ser.index % palette.length], scale);
            await paintChartRectangle(ctx,style,palette[ser.index%palette.length],rect,scale,helpers,zip,path,model);
            marks.push({ family: group.family, series: 0, point: i, value, category: ser.categories[i], x: rect.x + w / 2, y: rect.y + h / 2, rect });
          }
        } else if (['treemapChart', 'sunburstChart'].includes(group.family)) {
          if (model.groups.length !== 1) fail('Multiple hierarchy series require Microsoft layout oracle');
          const ser = group.series[0], root = ser.hierarchy;
          if (group.family === 'treemapChart') {
            const visit = (node, rect, colorIndex) => {
              for (const [i, item] of squarify(node.children, rect).entries()) {
                const branchColor = node.depth === 0 ? i : colorIndex, color = palette[branchColor % palette.length];
                if (item.node.children.length) visit(item.node, item.rect, branchColor);
                else { ctx.fillStyle = color; ctx.fillRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = scale; ctx.strokeRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height); marks.push({ family: group.family, series: 0, point: item.node.indices[0], value: item.node.value, category: item.node.name, rect: item.rect, x: item.rect.x + item.rect.width / 2, y: item.rect.y + item.rect.height / 2, hierarchyDepth: item.node.depth }); }
              }
            }; visit(root, plotRect, 0);
          } else {
            const depth = node => Math.max(node.depth, ...node.children.map(depth)), maxDepth = depth(root), radius = Math.min(plotRect.width, plotRect.height) / 2, cx = plotRect.x + plotRect.width / 2, cy = plotRect.y + plotRect.height / 2;
            const visit = (node, start, sweep, colorIndex) => {
              let angle = start;
              // Office paints descending sibling values; preserve source identity for colors and caches.
              const ordered = node.children.map((child, identity) => ({child, identity})).sort((a,b) => b.child.value - a.child.value || a.identity - b.identity);
              for (const {identity:i, child} of ordered) {
                const arc = node.value ? sweep * child.value / node.value : 0, branchColor = node.depth === 0 ? i : colorIndex, inner = radius * (node.depth + 1) / (maxDepth + 1), outer = radius * (child.depth + 1) / (maxDepth + 1), mid = angle + arc / 2;
                ctx.fillStyle = palette[branchColor % palette.length]; ctx.beginPath(); ctx.arc(cx, cy, outer, angle, angle + arc); if (inner) ctx.arc(cx, cy, inner, angle + arc, angle, true); else ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = scale; ctx.stroke(); marks.push({ family: group.family, series: 0, point: child.indices[0], value: child.value, category: child.name, x: cx + Math.cos(mid) * (inner + outer) / 2, y: cy + Math.sin(mid) * (inner + outer) / 2, angle, sweep: arc, inner, radius: outer, hierarchyDepth: child.depth, colorIdentity: branchColor, color:palette[branchColor % palette.length] }); if (child.children.length) visit(child, angle, arc, branchColor); angle += arc;
              }
            }; if (maxDepth) visit(root, -Math.PI / 2, Math.PI * 2, 0);
          }
        } else if (group.family === 'boxWhiskerChart') {
          const categorySlot = plotRect.width / group.categories.length, slot = categorySlot / group.series.length, boxWidth = slot / (1 + group.gapWidth), previousMeans = new Map();
          for (const [ci,category] of group.categories.entries()) for (const [si, ser] of group.series.entries()) {
            const box = ser.boxes.find(b=>b.category===category), stats = box?.statistics; if (!stats) continue;
            const cx = plotRect.x + categorySlot * ci + slot * (si + 0.5), y1 = yc(stats.q1), y3 = yc(stats.q3), style = ser.style;
            applyStyle(ctx, style, palette[ser.index % palette.length], scale);
            const rect = { x: cx - boxWidth / 2, y: Math.min(y1, y3), width: boxWidth, height: Math.abs(y1 - y3) };
            if (!style.noFill) { if (style.fillNode) { if (!helpers.renderChartFill) fail('Box-whisker fill requires fill renderer'); await helpers.renderChartFill(ctx, style.fillNode, rect, zip, path, {relationships:style.fillRelationships}); } else ctx.fillRect(rect.x, rect.y, rect.width, rect.height); }
            ctx.strokeStyle = style.lineColor || '#404040'; ctx.lineWidth = (style.lineWidth || 1) * scale;
            if (!style.noLine) { ctx.strokeRect(rect.x, rect.y, rect.width, rect.height); ctx.beginPath(); ctx.moveTo(rect.x, yc(stats.median)); ctx.lineTo(rect.x + boxWidth, yc(stats.median)); for (const [end, quartile] of [[stats.lower, stats.q1], [stats.upper, stats.q3]]) { ctx.moveTo(cx, yc(end)); ctx.lineTo(cx, yc(quartile)); ctx.moveTo(cx - boxWidth / 4, yc(end)); ctx.lineTo(cx + boxWidth / 4, yc(end)); } ctx.stroke(); }
            if (ser.visibility.meanMarker) { ctx.beginPath(); ctx.moveTo(cx - 3 * scale, yc(stats.mean) - 3 * scale); ctx.lineTo(cx + 3 * scale, yc(stats.mean) + 3 * scale); ctx.moveTo(cx - 3 * scale, yc(stats.mean) + 3 * scale); ctx.lineTo(cx + 3 * scale, yc(stats.mean) - 3 * scale); ctx.stroke(); }
            const previousMean = previousMeans.get(si); if (ser.visibility.meanLine && previousMean) { ctx.beginPath(); ctx.moveTo(previousMean.x, previousMean.y); ctx.lineTo(cx, yc(stats.mean)); ctx.stroke(); } previousMeans.set(si,{ x: cx, y: yc(stats.mean) });
            for (const value of [...(ser.visibility.outliers ? stats.outliers : []), ...(ser.visibility.nonoutliers ? stats.nonoutliers : [])]) { ctx.beginPath(); ctx.arc(cx, yc(value), 2 * scale, 0, Math.PI * 2); ctx.stroke(); }
            marks.push({ family: group.family, series: si, point: ci, category, sampleIndices:box.sampleIndices, value: stats.median, statistics: stats, x: cx, y: yc(stats.median), rect });
          }
        } else if (group.family === 'waterfallChart') {
          if (model.groups.length !== 1) fail('Multiple waterfall series require Microsoft layout oracle');
          const ser = group.series[0], slot = plotRect.width / count, bw = slot / (1 + group.gapWidth); let total = 0, previous = null;
          for (let i = 0; i < ser.vals.length; i++) {
            const v = ser.vals[i]; if (v == null) continue;
            const subtotal = group.subtotals.includes(i), from = subtotal ? 0 : total, to = subtotal ? v : total + v;
            const rect = { x: plotRect.x + i * slot + (slot - bw) / 2, y: Math.min(yc(from), yc(to)), width: bw, height: Math.abs(yc(to) - yc(from)) };
            const style = mergeStyle(ser.style, ser.points.find(p => p.index === i)?.style); applyStyle(ctx, style, palette[subtotal ? 2 : v >= 0 ? 0 : 1], scale);
            await paintChartRectangle(ctx,style,palette[subtotal?2:v>=0?0:1],rect,scale,helpers,zip,path,model);
            if (previous) { ctx.strokeStyle = '#808080'; ctx.lineWidth = scale; ctx.beginPath(); ctx.moveTo(previous.x, yc(from)); ctx.lineTo(rect.x, yc(from)); ctx.stroke(); }
            marks.push({ family: group.family, series: 0, point: i, value: v, from, to, subtotal, rect, x: rect.x + bw / 2, y: yc(to) }); previous = { x: rect.x + bw }; total = to;
          }
        } else if (group.family.includes('3D')) {
          const rendered = await renderChart3D(ctx, d, model, plotRect, ys, palette, scale, helpers, zip, path);
          marks.push(...rendered.marks); projectedFaces.push(...rendered.faces); threeDLabels = rendered.labels;
        } else if (['pieChart', 'doughnutChart'].includes(group.family)) {
          const ringCount = group.family === 'doughnutChart' ? group.series.length : 1, radius = Math.min(plotRect.width, plotRect.height) * 0.45, hole = group.family === 'doughnutChart' ? radius * Math.max(10, Math.min(90, group.holeSize)) / 100 : 0, cx = plotRect.x + plotRect.width / 2, cy = plotRect.y + plotRect.height / 2;
          for (let si = 0; si < ringCount; si++) {
            const ser = group.series[si], total = ser.vals.reduce((sum, v) => sum + Math.abs(v || 0), 0);
            if (!total) continue;
            let angle = group.firstSliceAngle * Math.PI / 180 - Math.PI / 2;
            const outer = hole + (radius - hole) * (si + 1) / ringCount, inner = hole + (radius - hole) * si / ringCount;
            ser.vals.forEach((v, i) => {
              if (v == null) return; const sweep = Math.abs(v) / total * Math.PI * 2, mid = angle + sweep / 2, point = ser.points.find(p => p.index === i), explode = (point?.explosion || ser.explosion) / 100 * radius, px = cx + Math.cos(mid) * explode, py = cy + Math.sin(mid) * explode;
              const style = mergeStyle(ser.style, point?.style); applyStyle(ctx, style, palette[i % palette.length], scale);
              ctx.beginPath(); ctx.arc(px, py, outer, angle, angle + sweep); if (inner) ctx.arc(px, py, inner, angle + sweep, angle, true); else ctx.lineTo(px, py); ctx.closePath(); if (!style.noFill) ctx.fill(); if (!style.noLine && style.lineColor) ctx.stroke();
              marks.push({ family: group.family, series: si, point: i, value: v, x: px + Math.cos(mid) * (inner + outer) / 2, y: py + Math.sin(mid) * (inner + outer) / 2, fraction: Math.abs(v) / total, angle, sweep, radius: outer, inner }); angle += sweep;
            });
          }
        } else if (group.family === 'ofPieChart') {
          if (group.series.length !== 1) fail('ofPie requires exactly one data series');
          const parts = splitOfPie(group), ser = group.series[0];
          if (!parts.total) continue;
          if (!(group.secondPieSize >= 5 && group.secondPieSize <= 200)) fail('Invalid ofPie secondary pie size');
          const ratio = group.secondPieSize / 100, gap = group.gapWidth / 100, radius = Math.min(plotRect.height * 0.42 / Math.max(1, ratio), plotRect.width / (2 * (1 + ratio) + gap)), secondaryRadius = radius * ratio;
          const cy = plotRect.y + plotRect.height / 2, cx = plotRect.x + radius, secondaryX = cx + radius + gap * radius + secondaryRadius;
          const secondaryTotal = parts.secondary.reduce((s, p) => s + p.value, 0), fraction = secondaryTotal / parts.total;
          const primary = [...parts.primary, ...(parts.secondary.length ? [{ index: ser.vals.length, value: secondaryTotal, rawValue: secondaryTotal, category: helpers.localizeOther?.() || 'Other' }] : [])];
          let angle = Math.PI * fraction;
          for (const point of primary) {
            const sweep = point.value / parts.total * Math.PI * 2, mid = angle + sweep / 2, style = mergeStyle(ser.style, ser.points.find(p => p.index === point.index)?.style); applyStyle(ctx, style, palette[point.index % palette.length], scale);
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, angle, angle + sweep); ctx.closePath(); if (!style.noFill) ctx.fill(); if (!style.noLine && style.lineColor) ctx.stroke();
            marks.push({ family: group.family, part: 'primary', series: 0, point: point.index, value: point.rawValue, fraction: point.value / parts.total, category: point.category, x: cx + Math.cos(mid) * radius * 0.6, y: cy + Math.sin(mid) * radius * 0.6, angle, sweep }); angle += sweep;
          }
          let secondaryAngle = -Math.PI / 2, bottom = cy + secondaryRadius;
          for (const point of parts.secondary) {
            const style = mergeStyle(ser.style, ser.points.find(p => p.index === point.index)?.style), sweep = point.value / (secondaryTotal || 1) * Math.PI * 2; applyStyle(ctx, style, palette[point.index % palette.length], scale);
            let mx, my;
            if (group.ofPieType === 'bar') { const h = point.value / (secondaryTotal || 1) * secondaryRadius * 2, w = secondaryRadius; if (!style.noFill) ctx.fillRect(secondaryX - w / 2, bottom - h, w, h); mx = secondaryX; my = bottom - h / 2; bottom -= h; }
            else if (group.ofPieType === 'pie') { ctx.beginPath(); ctx.moveTo(secondaryX, cy); ctx.arc(secondaryX, cy, secondaryRadius, secondaryAngle, secondaryAngle + sweep); ctx.closePath(); if (!style.noFill) ctx.fill(); mx = secondaryX + Math.cos(secondaryAngle + sweep / 2) * secondaryRadius * 0.6; my = cy + Math.sin(secondaryAngle + sweep / 2) * secondaryRadius * 0.6; secondaryAngle += sweep; }
            else fail(`Unsupported ofPie secondary chart type: ${group.ofPieType}`);
            marks.push({ family: group.family, part: 'secondary', series: 0, point: point.index, value: point.rawValue, fraction: point.value / parts.total, x: mx, y: my, sweep });
          }
          if (parts.secondary.length) { ctx.strokeStyle = '#808080'; ctx.lineWidth = scale; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(cx + Math.cos(Math.PI * fraction) * radius, cy - Math.sin(Math.PI * fraction) * radius); ctx.lineTo(secondaryX - secondaryRadius * (group.ofPieType === 'bar' ? 0.5 : 1), cy - secondaryRadius); ctx.moveTo(cx + Math.cos(Math.PI * fraction) * radius, cy + Math.sin(Math.PI * fraction) * radius); ctx.lineTo(secondaryX - secondaryRadius * (group.ofPieType === 'bar' ? 0.5 : 1), cy + secondaryRadius); ctx.stroke(); }
        } else if (group.family === 'surfaceChart') {
          if (group.series.length < 2 || count < 2) fail('Surface charts require at least a two-by-two numeric grid');
          const thresholds = axisTicks(ys, d.yAxis), bands = [ys.min, ...thresholds.filter(v => v > ys.min && v < ys.max), ys.max];
          const rows = group.series.length;
          for (let row = 0; row < rows - 1; row++) for (let col = 0; col < count - 1; col++) {
            const vertex = (r, c) => ({ x: plotRect.x + (d.xAxis?.reverse ? count - 1 - c : c) / (count - 1) * plotRect.width, y: plotRect.y + (1 - r / (rows - 1)) * plotRect.height, value: group.series[r].vals[c] });
            const p00 = vertex(row, col), p10 = vertex(row, col + 1), p01 = vertex(row + 1, col), p11 = vertex(row + 1, col + 1);
            for (const triangle of [[p00, p10, p11], [p00, p11, p01]]) {
              if (triangle.some(p => p.value == null)) continue;
              for (let bi = 0; bi < bands.length - 1; bi++) {
                const polygon = clipValuePolygon(clipValuePolygon(triangle, bands[bi], true), bands[bi + 1], false);
                if (polygon.length < 3) continue;
                const style = group.bands.find(b => b.index === bi)?.style || {};
                applyStyle(ctx, style, palette[bi % palette.length], scale);
                if (group.wireframe) {
                  for (const threshold of [bands[bi], bands[bi + 1]]) {
                    const intersections = [];
                    for (let e = 0; e < 3; e++) { const p = triangle[e], q = triangle[(e + 1) % 3]; if ((p.value < threshold && q.value >= threshold) || (p.value >= threshold && q.value < threshold)) { const t = (threshold - p.value) / (q.value - p.value); intersections.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); } }
                    if (intersections.length === 2) { ctx.beginPath(); ctx.moveTo(intersections[0].x, intersections[0].y); ctx.lineTo(intersections[1].x, intersections[1].y); ctx.stroke(); }
                  }
                } else if (!style.noFill) { ctx.beginPath(); linePath(ctx, polygon, false); ctx.closePath(); ctx.fill(); }
                marks.push({ family: group.family, band: bi, min: bands[bi], max: bands[bi + 1], polygon });
              }
            }
          }
        } else if (group.family === 'radarChart') {
          const cx = plotRect.x + plotRect.width / 2, cy = plotRect.y + plotRect.height / 2, radius = Math.min(plotRect.width, plotRect.height) * 0.42;
          ctx.setLineDash([]); ctx.strokeStyle = '#d9d9d9';
          for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2 - Math.PI / 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); ctx.stroke(); }
          group.series.forEach((ser, si) => { const points = ser.vals.map((v, i) => { if (v == null) return null; const a = categoryIndex(i) / count * Math.PI * 2 - Math.PI / 2, r = ys.fraction(v) * radius; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, point: i, value: v }; }); applyStyle(ctx, ser.style, palette[si % palette.length], scale); ctx.beginPath(); linePath(ctx, points.filter(Boolean), false); ctx.closePath(); if (group.radarStyle === 'filled' && !ser.style.noFill) ctx.fill(); if (!ser.style.noLine) ctx.stroke(); points.filter(Boolean).forEach(p => { marks.push({ family: group.family, series: si, ...p }); if (group.radarStyle === 'marker') marker(ctx, ser.marker.symbol || 'circle', p.x, p.y, ser.marker.size * scale / 2); }); });
        } else if (group.family === 'stockChart') {
          if (![3, 4].includes(group.series.length)) fail('Stock charts require high/low/close or open/high/low/close series');
          for (let i = 0; i < count; i++) { const values = group.series.map(s => s.vals[i]); if (values.some(v => v == null)) continue; const offset = values.length === 4 ? 1 : 0, high = yc(values[offset]), low = yc(values[offset + 1]), close = yc(values[offset + 2]), px = cat(i), half = plotRect.width / count * 0.2; ctx.strokeStyle = '#404040'; ctx.lineWidth = scale; ctx.beginPath(); ctx.moveTo(px, high); ctx.lineTo(px, low); ctx.moveTo(px, close); ctx.lineTo(px + half, close); if (offset) { const open = yc(values[0]); ctx.moveTo(px - half, open); ctx.lineTo(px, open); } ctx.stroke(); marks.push({ family: group.family, point: i, x: px, y: close, high, low, values }); }
        } else {
          for (const [si, ser] of group.series.entries()) {
            const seriesColor = palette[(ser.index ?? si) % palette.length]; applyStyle(ctx, ser.style, seriesColor, scale);
            const points = [];
            for (let i = 0; i < count; i++) {
              let raw = ser.vals[i]; if (raw == null && model.blankMode === 'zero') raw = 0;
              if (raw == null || ys.log && raw <= 0 || xy && (ser.xs[i] == null || xs.log && ser.xs[i] <= 0)) { points.push(null); continue; }
              const value = d.value(raw, i), stack = value >= 0 ? positiveStack : negativeStack, from = stacked ? stack[i] : ys.log ? ys.min : Math.max(ys.min, Math.min(ys.max, 0)), to = stacked ? from + value : value; if (stacked) stack[i] = to;
              const px = xy ? xc(ser.xs[i]) : group.horizontal ? yc(to) : cat(i), py = group.horizontal ? cat(i) : yc(to);
              const point = ser.points.find(p => p.index === i), style = mergeStyle(ser.style, point?.style); applyStyle(ctx, style, group.varyColors ? palette[i % palette.length] : seriesColor, scale);
              const mark = { family: group.family, series: si, point: i, x: px, y: py, value: raw, from, to, xValue: ser.xs[i], bubbleSize: ser.sizes[i] }; marks.push(mark); points.push({ ...mark, base: yc(from) });
              if (['barChart', 'histogramChart'].includes(group.family)) {
                const slot = (group.horizontal ? plotRect.height : plotRect.width) / count;
                const n = stacked ? 1 : group.series.length, overlap = stacked ? 1 : (group.overlap || 0) / 100;
                const clusterUnits = n - (n - 1) * overlap, barWidth = slot / (clusterUnits + group.gapWidth / 100), offset = -barWidth * clusterUnits / 2 + (stacked ? 0 : si * barWidth * (1 - overlap)), p0 = yc(from), p1 = yc(to);
                const rect = group.horizontal ? { x: Math.min(p0, p1), y: cat(i) + offset, width: Math.abs(p1 - p0), height: barWidth } : { x: cat(i) + offset, y: Math.min(p0, p1), width: barWidth, height: Math.abs(p1 - p0) };
                await paintChartRectangle(ctx,style,group.varyColors?palette[i%palette.length]:seriesColor,rect,scale,helpers,zip,path,model); Object.assign(mark,{rect});
              } else if (group.family === 'bubbleChart') {
                const size = ser.sizes[i]; if (size == null || size < 0 && !group.showNegativeBubbles) continue;
                const maxSize = Math.max(1, ...group.series.flatMap(s => s.sizes).filter(v => v != null).map(Math.abs));
                const fraction = Math.abs(size) / maxSize, radius = Math.min(plotRect.width, plotRect.height) * 0.12 * group.bubbleScale / 100 * (group.bubbleSizeRepresents === 'w' ? fraction : Math.sqrt(fraction));
                ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); if (!style.noFill) ctx.fill(); if (!style.noLine) ctx.stroke(); mark.radius = radius;
              } else if (group.family === 'scatterChart' && !['line', 'smooth', 'none'].includes(group.scatterStyle) || group.family === 'lineChart' && ser.marker.symbol && ser.marker.symbol !== 'none') marker(ctx, !ser.marker.symbol || ser.marker.symbol === 'auto' ? AUTO_MARKERS[si % AUTO_MARKERS.length] : ser.marker.symbol, px, py, ser.marker.size * scale / 2);
            }
            if (['lineChart', 'areaChart', 'scatterChart'].includes(group.family) && !(group.family === 'scatterChart' && group.scatterStyle === 'marker')) {
              applyStyle(ctx, ser.style, seriesColor, scale);
              const segments = []; let segment = [];
              for (const p of points) { if (p) segment.push(p); else if (model.blankMode !== 'span') { if (segment.length) segments.push(segment); segment = []; } } if (segment.length) segments.push(segment);
              for (const part of segments) {
                ctx.beginPath(); linePath(ctx, part, ser.smooth || group.scatterStyle.startsWith('smooth'));
                if (group.family === 'areaChart') { for (let j = part.length - 1; j >= 0; j--) ctx.lineTo(part[j].x, part[j].base); ctx.closePath(); if (!ser.style.noFill) ctx.fill(); }
                if (!ser.style.noLine && group.family !== 'areaChart') ctx.stroke();
              }
            }
          }
        }
      } finally { ctx.restore(); }
      if (group.family === 'funnelChart') for (const mark of marks.filter(m => m.family === group.family)) if (mark.category) paintText(ctx, mark.category, plotRect.x - 4 * scale, mark.y, scale, 9, 'right', model.baseFont);
      for (const label of threeDLabels) paintText(ctx, label.text, label.x, label.y, scale, 9, label.align, label.style);
      for (const mark of marks.filter(m => m.family === group.family)) {
        const ser = group.series[mark.series || 0]; if (!ser) continue;
        const inheritedLabels = group.labels || ser.labels ? { text: { text: '', runs: [] }, individual: [], ...group.labels, ...Object.fromEntries(Object.entries(ser.labels || {}).filter(([key, value]) => value != null && !(key === 'text' && !value.text) && !(key === 'individual' && !value.length))) } : null;
        const common = inheritedLabels, individual = common?.individual?.find(l => l.index === mark.point), labels = individual ? { ...common, ...Object.fromEntries(Object.entries(individual).filter(([key, value]) => value != null && !(key === 'text' && !value.text))) } : common;
        if (!labels || labels.deleted) continue;
        const strings = labels.text.text ? [labels.text.text] : [labels.showSerName ? ser.name : '', labels.showCatName ? mark.category || ser.categories[mark.point] : '', labels.showVal ? formatNumber(mark.value, labels.format) : '', labels.showPercent && mark.fraction != null ? formatNumber(mark.fraction, '%') : '', labels.showBubbleSize ? formatNumber(mark.bubbleSize, labels.format) : ''].filter(Boolean);
        if (strings.length) {
          let lx = mark.x, ly = labels.position === 'ctr' ? mark.y : mark.y - 7 * scale;
          if (mark.rect) {
            const r = mark.rect, pos = labels.position;
            if (pos === 'ctr') { lx = r.x + r.width / 2; ly = r.y + r.height / 2; }
            else if (pos === 'inBase') { lx = group.horizontal ? (mark.to >= mark.from ? r.x + 10 * scale : r.x + r.width - 10 * scale) : r.x + r.width / 2; ly = group.horizontal ? r.y + r.height / 2 : (mark.to >= mark.from ? r.y + r.height - 7 * scale : r.y + 7 * scale); }
            else if (pos === 'inEnd') { lx = group.horizontal ? (mark.to >= mark.from ? r.x + r.width - 10 * scale : r.x + 10 * scale) : r.x + r.width / 2; ly = group.horizontal ? r.y + r.height / 2 : (mark.to >= mark.from ? r.y + 7 * scale : r.y + r.height - 7 * scale); }
            else if (pos === 'outEnd' && !group.horizontal && mark.to < mark.from) { ly = r.y + r.height + 10 * scale; }
            else if (group.horizontal) { lx = mark.to >= mark.from ? r.x + r.width + 12 * scale : r.x - 12 * scale; ly = r.y + r.height / 2; }
          }
          const labelStyle=model.externalTextStyles?.dataLabel;
          let rotation=labels.rotationDegrees ?? labelStyle?.rotationDegrees;
          if(rotation==null && group.family==='sunburstChart' && labels.position==='ctr') {
            let radial=Math.atan2(Math.sin(mark.angle+mark.sweep/2),Math.cos(mark.angle+mark.sweep/2));
            if(Math.cos(radial)<0) radial+=radial<0?Math.PI:-Math.PI;
            rotation=radial*180/Math.PI;
          }
          ctx.save();
          try {
            if(rotation) {ctx.translate(lx,ly);ctx.rotate(rotation*Math.PI/180);ctx.translate(-lx,-ly);}
            paintText(ctx, strings.join(labels.separator || ', '), lx, ly, scale, 9, 'center', labelStyle);
          } finally {ctx.restore();}
        }
      }
    }
    if (model.legend) {
      const entries = model.groups.flatMap(g => g.family === 'waterfallChart' ? ['increase','decrease','total'].map((role,index)=>({role,name:helpers.localizeWaterfallLegend?.(role) || ['Increase','Decrease','Total'][index],color:palette[index]})) : ['pieChart', 'doughnutChart', 'ofPieChart'].includes(g.family) ? g.series[0].categories.map((name, i) => ({ name, color: palette[i % palette.length] })) : g.series.map((s, i) => ({ name: s.name || `Series ${i + 1}`, color: s.style.color || palette[s.index % palette.length] }))).filter((_, i) => !model.legend.deletedEntries.includes(i));
      model.legend.entries = entries;
      entries.forEach((entry, i) => { const vertical = ['r', 'l', 'tr'].includes(model.legend.position), lineHeight = (fontSize ? fontSize * 1.2 : 16) * scale, lx = vertical ? (model.legend.position === 'l' ? x + pad : plotRect.x + plotRect.width + pad) : x + pad + i * width / Math.max(1, entries.length), ly = vertical ? plotRect.y + plotRect.height / 2 + (i - (entries.length - 1) / 2) * lineHeight : model.legend.position === 't' ? y + (model.title.text ? 38 : 12) * scale : y + height - 10 * scale; ctx.fillStyle = entry.color; ctx.fillRect(lx, ly - 4 * scale, 8 * scale, 8 * scale); paintText(ctx, entry.name, lx + 12 * scale, ly, scale, 9, 'left', model.legend.textStyle); });
    }
    return { model, plotRect, marks, projectedFaces };
  } finally { ctx.restore(); }
}
