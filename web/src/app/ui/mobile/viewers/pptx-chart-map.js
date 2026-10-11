// Independent inverse of Microsoft Bing Maps point-compression mathematics.
// Operates on authored ChartEx geographic caches only; never calls Bing APIs.
const MAP_CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const GEO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export class UnsupportedChartMapError extends Error {
  constructor(message) { super(message); this.name='UnsupportedChartMapError'; }
}
const mapFail = message => { throw new UnsupportedChartMapError(message); };
function unpairGeo(value) {
  let diagonal=Math.floor((Math.sqrt(8*value+1)-1)/2);
  const triangle = n=>n*(n+1)/2;
  while (triangle(diagonal)>value) diagonal--;
  while (triangle(diagonal+1)<=value) diagonal++;
  const latitude=value-triangle(diagonal), longitude=diagonal-latitude;
  return [latitude%2 ? -(latitude+1)/2 : latitude/2,longitude%2 ? -(longitude+1)/2 : longitude/2];
}
export function decodeCompressedGeoPoints(encoded) {
  if (typeof encoded!=='string') mapFail('Invalid compressed geographic point string');
  const points=[]; let packed=0,multiplier=1,latitude=0,longitude=0;
  for (const character of encoded) {
    const digit=GEO_ALPHABET.indexOf(character);
    if (digit<0) mapFail('Invalid geographic point alphabet');
    packed+=(digit%32)*multiplier;
    if (!Number.isSafeInteger(packed)) mapFail('Geographic point precision exceeds exact integer range');
    if (digit>=32) { multiplier*=32; if (!Number.isSafeInteger(multiplier)) mapFail('Geographic point varint is too long'); continue; }
    const [dy,dx]=unpairGeo(packed); latitude+=dy; longitude+=dx;
    if (longitude>18000000) longitude-=36000000;
    if (longitude<-18000000) longitude+=36000000;
    if (Math.abs(latitude)>9000000 || Math.abs(longitude)>18000000) mapFail('Geographic coordinate is outside latitude/longitude limits');
    points.push([latitude/100000,longitude/100000]); packed=0;multiplier=1;
  }
  if (multiplier!==1) mapFail('Truncated geographic point varint');
  return points;
}
export function encodeCompressedGeoPoints(points) {
  let latitude=0,longitude=0; const result=[];
  for (const point of points) {
    if (!Array.isArray(point) || point.length!==2 || !point.every(Number.isFinite) || Math.abs(point[0])>90 || Math.abs(point[1])>180) mapFail('Invalid geographic input coordinate');
    const nextLat=Math.round(point[0]*100000),nextLon=Math.round(point[1]*100000);
    let dy=nextLat-latitude,dx=nextLon-longitude;
    if (dx>18000000) dx-=36000000;
    if (dx<-18000000) dx+=36000000;
    latitude=nextLat;longitude=nextLon;
    dy=dy<0 ? -2*dy-1 : 2*dy; dx=dx<0 ? -2*dx-1 : 2*dx;
    let value=(dy+dx)*(dy+dx+1)/2+dy;
    if (!Number.isSafeInteger(value)) mapFail('Geographic pair exceeds exact integer precision');
    do { const remainder=value%32;value=(value-remainder)/32;result.push(GEO_ALPHABET[remainder+(value?32:0)]); } while (value);
  }
  return result.join('');
}
export function parseGeoCacheClear(clear) {
  const CX='http://schemas.microsoft.com/office/drawing/2014/chartex';
  if(clear.namespaceURI!==CX||clear.localName!=='clear') mapFail('Invalid geographic clear namespace');
  const elements=Array.from(clear.getElementsByTagNameNS(CX,'geoData'));
  return elements.map(entity=>{
    if(['west','east','north','south','entityId','entityName'].some(key=>!entity.hasAttribute(key)||entity.getAttribute(key).trim()==='')) mapFail('Geographic entity is missing required bounds or identity');
    const bounds=Object.fromEntries(['west','east','north','south'].map(key=>[key,Number(entity.getAttribute(key))]));
    if (!Object.values(bounds).every(Number.isFinite)||Math.abs(bounds.west)>180||Math.abs(bounds.east)>180||Math.abs(bounds.north)>90||Math.abs(bounds.south)>90||bounds.north<bounds.south) mapFail('Invalid geographic entity bounding limits');
    const polygons=Array.from(entity.getElementsByTagNameNS('*','geoPolygon')).map(polygon=>{
      const [version,...encodedRings]=(polygon.getAttribute('pcaRings')||'').split(',');
      if (version!=='1' || !encodedRings.length) mapFail('Unsupported geographic polygon compression version');
      const rings=encodedRings.map(decodeCompressedGeoPoints),count=rings.reduce((sum,ring)=>sum+ring.length,0);
      const declared=Number(polygon.getAttribute('numPoints'));
      if (!Number.isInteger(declared)||declared!==count) mapFail('Geographic polygon point count does not match compressed rings');
      if (rings.some(ring=>ring.length<3||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])) mapFail('Geographic polygon ring is not closed');
      return {id:polygon.getAttribute('polygonId'),rings,count};
    });
    return {name:entity.getAttribute('entityName'),id:entity.getAttribute('entityId'),bounds,polygons};
  });
}
export async function decodeChartGeoCache(cache,helpers={}) {
  const children=Array.from(cache?.children||[]),clear=children.find(n=>n.localName==='clear');
  if (clear) return {clear,entities:parseGeoCacheClear(clear)};
  const binary=children.find(n=>n.localName==='binary');if (!binary) mapFail('Chart geographic cache has neither clear nor binary content');
  let bytes;try {bytes=Uint8Array.from(atob(binary.textContent.replace(/\s+/g,'')),character=>character.charCodeAt(0));}catch{mapFail('Malformed geographic cache base64');}
  async function inflate(input) {
    if (helpers.inflateRaw) return helpers.inflateRaw(input,8*1024*1024);
    const stream=new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),chunks=[];let length=0;
    for (;;) { const {value,done}=await reader.read();if(done) break;length+=value.length;if(length>8*1024*1024){await reader.cancel();mapFail('Geographic cache exceeds decoded size limit');}chunks.push(value); }
    const output=new Uint8Array(length);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
  }
  let decoded;
  try {decoded=await inflate(bytes);}catch(error){
    // Office caches can end at the byte-aligned RFC1951 sync-flush boundary, without a final block.
    if (bytes.length<4||bytes.at(-4)!==0||bytes.at(-3)!==0||bytes.at(-2)!==255||bytes.at(-1)!==255) mapFail('Geographic cache DEFLATE decoding failed: '+error.message);
    const terminated=new Uint8Array(bytes.length+2);terminated.set(bytes);terminated.set([3,0],bytes.length);
    try {decoded=await inflate(terminated);}catch(failure){mapFail('Geographic cache truncated DEFLATE decoding failed: '+failure.message);}
  }
  if (decoded.length>8*1024*1024) mapFail('Geographic cache exceeds decoded size limit');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(decoded),doc=helpers.parseXml?.(xml)||new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='clear') mapFail('Decoded geographic cache is not a complete clear XML document');
  return {clear:doc.documentElement,entities:parseGeoCacheClear(doc.documentElement)};
}

// Resolve authored geographic queries through cached coordinates and entity IDs.
// Display names can differ from data categories (e.g. Cameroun / Cameroon).
export function resolveGeoCategoryEntities(cacheData, categories) {
  const clear=cacheData.clear, descendants=name=>Array.from(clear.getElementsByTagNameNS(MAP_CX,name));
  const child=(node,name)=>Array.from(node.children||[]).find(n=>n.namespaceURI===MAP_CX&&n.localName===name);
  const coordinates=node=>{const latitude=Number(node?.getAttribute('latitude')),longitude=Number(node?.getAttribute('longitude'));if(!node||!node.hasAttribute('latitude')||!node.hasAttribute('longitude')||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180) mapFail('Invalid cached geographic lookup coordinate');return `${latitude},${longitude}`;};
  const pointEntities=new Map();
  for(const result of descendants('geoDataPointToEntityQueryResult')) {
    const query=child(result,'geoDataPointQuery'),entity=child(result,'geoDataPointToEntityQuery');
    if(!query||!entity?.hasAttribute('entityId')) mapFail('Incomplete cached point-to-entity lookup');
    const key=coordinates(query),id=entity.getAttribute('entityId');
    if(pointEntities.has(key)&&pointEntities.get(key)!==id) mapFail('Ambiguous cached point-to-entity lookup');
    pointEntities.set(key,id);
  }
  const queryEntities=new Map(),byId=new Map(cacheData.entities.map(entity=>[entity.id,entity]));
  for(const result of descendants('geoLocationQueryResult')) {
    const query=child(result,'geoLocationQuery');if(!query) mapFail('Missing cached geographic category query');
    const locations=Array.from(result.getElementsByTagNameNS(MAP_CX,'geoLocation'));
    // Scalar country categories are supported here; hierarchical query composition remains explicit.
    const category=query.getAttribute('countryRegion');if(category==null) continue;
    const ids=Array.from(new Set(locations.map(location=>pointEntities.get(coordinates(location))).filter(id=>id!=null)));
    if(ids.length>1) mapFail(`Ambiguous cached geographic category: ${category}`);
    if(ids.length===1) {
      const entity=byId.get(ids[0]);if(!entity) mapFail('Geographic category points to absent polygon entity');
      if(queryEntities.has(category)&&queryEntities.get(category).id!==entity.id) mapFail('Conflicting cached geographic category lookup');
      queryEntities.set(category,entity);
    }
  }
  return categories.map((category,index)=>{
    if(category==null||String(category).trim()==='') return {index,category,entity:null};
    const entity=queryEntities.get(String(category));if(!entity) mapFail(`Geographic category lacks complete cached entity lookup: ${category}`);
    return {index,category,entity};
  });
}
