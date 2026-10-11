import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const out = path.join(root, 'frontend/public/demo/city-delivery/geo-hangzhou-xixi/v1');
const roadsRaw = JSON.parse(fs.readFileSync('/tmp/hz-roads-small.json', 'utf8'));
const buildingsRaw = JSON.parse(fs.readFileSync('/tmp/hz-building-geom-all.json', 'utf8'));
const v2 = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/demo/city-delivery/v2/scenario.json'), 'utf8'));
const plans = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/demo/city-delivery/v2/plans.json'), 'utf8'));

fs.mkdirSync(out, { recursive: true });

const bbox = { south: 30.255, west: 120.055, north: 30.265, east: 120.075 };
const origin = { lat: (bbox.south + bbox.north) / 2, lon: (bbox.west + bbox.east) / 2 };
const latScale = 111320;
const lonScale = 111320 * Math.cos(origin.lat * Math.PI / 180);
const xy = ({ lat, lon }) => ({ x: (lon - origin.lon) * lonScale, y: (lat - origin.lat) * latScale });
const distance = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y));
const nodeKey = ({ lat, lon }) => `${lat.toFixed(7)},${lon.toFixed(7)}`;

const roadFeatures = roadsRaw.elements.filter(e => e.geometry?.length > 1).map(e => ({
  type: 'Feature',
  id: `road-${e.id}`,
  properties: { wayId: e.id, highway: e.tags?.highway ?? 'road', name: e.tags?.name ?? '未命名道路', lanes: e.tags?.lanes ?? null, surface: e.tags?.surface ?? null, oneway: e.tags?.oneway === 'yes' },
  geometry: { type: 'LineString', coordinates: e.geometry.map(p => [p.lon, p.lat]) },
}));

const graph = new Map();
const geoNodes = new Map();
function addEdge(a, b, wayId) {
  const ak = nodeKey(a); const bk = nodeKey(b);
  geoNodes.set(ak, a); geoNodes.set(bk, b);
  if (!graph.has(ak)) graph.set(ak, []); if (!graph.has(bk)) graph.set(bk, []);
  const w = distance(xy(a), xy(b));
  graph.get(ak).push({ to: bk, weight: w, wayId });
  graph.get(bk).push({ to: ak, weight: w, wayId });
}
for (const e of roadsRaw.elements) {
  const g = e.geometry ?? [];
  for (let i = 1; i < g.length; i += 1) addEdge(g[i - 1], g[i], e.id);
}

function nearestNode(point) {
  let best = null; let bestDistance = Infinity;
  for (const [key, candidate] of geoNodes) { const d = distance(xy(point), xy(candidate)); if (d < bestDistance) { bestDistance = d; best = key; } }
  return { key: best, point: geoNodes.get(best), distanceM: bestDistance };
}
function shortestPath(start, finish) {
  const dist = new Map([[start, 0]]); const previous = new Map(); const queue = [[0, start]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]); const [cost, key] = queue.shift();
    if (key === finish) break; if (cost !== dist.get(key)) continue;
    for (const edge of graph.get(key) ?? []) { const next = cost + edge.weight; if (next < (dist.get(edge.to) ?? Infinity)) { dist.set(edge.to, next); previous.set(edge.to, { key, wayId: edge.wayId }); queue.push([next, edge.to]); } }
  }
  if (!dist.has(finish)) throw new Error(`No road path ${start} -> ${finish}`);
  const keys = []; const segments = new Set(); let current = finish;
  while (current !== start) { keys.push(current); const prev = previous.get(current); segments.add(prev.wayId); current = prev.key; }
  keys.push(start); keys.reverse();
  return { coordinates: keys.map(k => { const p = geoNodes.get(k); return [p.lon, p.lat]; }), distanceKm: dist.get(finish) / 1000, roadSegmentIds: [...segments] };
}

const candidates = [...geoNodes.entries()].map(([key, point]) => ({ key, point }));
const center = { lat: origin.lat, lon: origin.lon };
const depot = nearestNode(center);
const anchors = [depot];
while (anchors.length < 10) {
  const next = candidates.filter(c => !anchors.some(a => a.key === c.key)).sort((a, b) => {
    const da = Math.min(...anchors.map(a => distance(xy(a.point), xy(a.point))));
    const db = Math.min(...anchors.map(a => distance(xy(b.point), xy(a.point))));
    return db - da;
  })[0];
  if (!next) break; anchors.push(next);
}
const stores = v2.stops.map((store, index) => {
  const anchor = anchors[index + 1] ?? anchors[(index % (anchors.length - 1)) + 1];
  const p = anchor.point;
  return { ...store, x: xy(p).x / 1000, y: xy(p).y / 1000, geo: { lat: p.lat, lon: p.lon, roadNodeId: anchor.key }, locationSource: 'OSM road node' };
});
const warehouse = { ...v2.warehouse, x: xy(depot.point).x / 1000, y: xy(depot.point).y / 1000, geo: { lat: depot.point.lat, lon: depot.point.lon, roadNodeId: depot.key }, locationSource: 'OSM road node' };
const nodeById = { DEPOT: depot.key, ...Object.fromEntries(stores.map(s => [s.stopId, s.geo.roadNodeId])) };
const routeGeometries = {};
const geoPlans = plans.plans.map(plan => ({
  planId: plan.planId,
  scenarioId: 'city-delivery-geo-hangzhou-xixi-001',
  totals: plan.totals,
  routes: plan.routes.map(route => {
    const ids = ['DEPOT', ...route.stopOrder, 'DEPOT']; const parts = []; const roadSegmentIds = new Set(); let roadDistanceKm = 0;
    for (let i = 1; i < ids.length; i += 1) { const segment = shortestPath(nodeById[ids[i - 1]], nodeById[ids[i]]); parts.push(...(i === 1 ? segment.coordinates : segment.coordinates.slice(1))); segment.roadSegmentIds.forEach(id => roadSegmentIds.add(id)); roadDistanceKm += segment.distanceKm; }
    const geometryId = `${plan.planId}-${route.vehicleId}`; routeGeometries[geometryId] = { type: 'Feature', id: geometryId, properties: { planId: plan.planId, vehicleId: route.vehicleId, stopOrder: route.stopOrder, roadDistanceKm: +roadDistanceKm.toFixed(3), roadTravelMinutes: Math.round(roadDistanceKm * 2 * 60), roadSegmentIds: [...roadSegmentIds] }, geometry: { type: 'LineString', coordinates: parts } };
    return { vehicleId: route.vehicleId, stopOrder: route.stopOrder, routeGeometryId: geometryId, roadDistanceKm: +roadDistanceKm.toFixed(3), roadTravelMinutes: Math.round(roadDistanceKm * 2 * 60), roadSegmentIds: [...roadSegmentIds], planDistanceKm: route.distanceKm, planDrivingMinutes: route.drivingMinutes, costs: route.costs, active: route.active !== false };
  }),
}));

const buildingFeatures = buildingsRaw.elements.filter(e => e.geometry?.length >= 3).map(e => {
  const tags = e.tags ?? {}; const levels = Number(tags['building:levels']); const height = Number(tags.height?.replace?.(' m', ''));
  const h = Number.isFinite(height) ? height : Number.isFinite(levels) ? levels * 3.2 : 6;
  return { type: 'Feature', id: `building-${e.id}`, properties: { osmId: e.id, name: tags.name ?? null, building: tags.building ?? 'yes', heightM: +h.toFixed(1), heightSource: Number.isFinite(height) ? 'OSM height' : Number.isFinite(levels) ? 'OSM building:levels × 3.2m' : 'estimated default 6m' }, geometry: { type: 'Polygon', coordinates: [[...e.geometry.map(p => [p.lon, p.lat]), [e.geometry[0].lon, e.geometry[0].lat]]] } };
});

const scenario = { ...v2, scenarioId: 'city-delivery-geo-hangzhou-xixi-001', name: '杭州城西真实道路空间演示', source: { dataType: 'synthetic', name: 'OSM-derived spatial demo', description: '真实 OSM 道路与建筑轮廓叠加合成配送订单；不是企业订单。', license: 'ODbL 1.0 for OpenStreetMap-derived data; project-owned synthetic orders', authorization: '用于本项目本地演示；保留 OSM attribution。' }, warehouse, stops: stores, geo: { region: '杭州城西固定区域', bbox, origin, coordinateSystem: 'WGS84', roadNetworkVersion: 'osm-overpass-2026-10-11', heightPolicy: 'height > building:levels × 3.2m > estimated 6m' }, routing: { nodeIds: ['DEPOT', ...stores.map(s => s.stopId)], returnToDepot: true, distanceMatrixSource: 'road-network-shortest-path', timeMatrixSource: 'road-distance × 2 min/km', distanceMatrixKm: [], travelTimeMatrixMinutes: [] } };
const allNodes = ['DEPOT', ...stores.map(s => s.stopId)]; for (const a of allNodes) { scenario.routing.distanceMatrixKm.push([]); scenario.routing.travelTimeMatrixMinutes.push([]); for (const b of allNodes) { const path = shortestPath(nodeById[a], nodeById[b]); scenario.routing.distanceMatrixKm.at(-1).push(+path.distanceKm.toFixed(3)); scenario.routing.travelTimeMatrixMinutes.at(-1).push(Math.round(path.distanceKm * 2 * 60)); } }

fs.writeFileSync(path.join(out, 'scenario.json'), JSON.stringify(scenario, null, 2));
fs.writeFileSync(path.join(out, 'roads.geojson'), JSON.stringify({ type: 'FeatureCollection', source: 'OpenStreetMap Overpass API', features: roadFeatures }));
fs.writeFileSync(path.join(out, 'buildings.geojson'), JSON.stringify({ type: 'FeatureCollection', source: 'OpenStreetMap Overpass API', features: buildingFeatures }));
fs.writeFileSync(path.join(out, 'stores.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { stopId: 'DEPOT', name: warehouse.name, role: 'warehouse' }, geometry: { type: 'Point', coordinates: [warehouse.geo.lon, warehouse.geo.lat] } }, ...stores.map(s => ({ type: 'Feature', properties: { stopId: s.stopId, name: s.name, role: 'store' }, geometry: { type: 'Point', coordinates: [s.geo.lon, s.geo.lat] } }))] }));
fs.writeFileSync(path.join(out, 'plans.json'), JSON.stringify({ schemaVersion: 'geo-1.0', scenarioId: scenario.scenarioId, plans: geoPlans }, null, 2));
fs.writeFileSync(path.join(out, 'route-geometries.json'), JSON.stringify({ schemaVersion: 'geo-1.0', scenarioId: scenario.scenarioId, type: 'FeatureCollection', features: Object.values(routeGeometries) }, null, 2));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ schemaVersion: 'geo-1.0', scenarioId: scenario.scenarioId, region: scenario.geo.region, files: { scenario: 'scenario.json', roads: 'roads.geojson', buildings: 'buildings.geojson', stores: 'stores.geojson', plans: 'plans.json', routeGeometries: 'route-geometries.json', contract: 'decision-contract.json' }, source: scenario.source, capabilities: ['real-osm-road-geometry', 'osm-building-footprints', 'building-height-source', 'route-plan-overlay'], boundary: ['orders and plan costs remain synthetic', 'no live traffic', 'no online routing service', 'road geometry is local OSM snapshot'] }, null, 2));
fs.writeFileSync(path.join(out, 'decision-contract.json'), JSON.stringify({ schemaVersion: 'geo-1.0', scenarioId: scenario.scenarioId, geometrySource: 'OpenStreetMap Overpass API snapshot', routeDistanceFields: { roadDistanceKm: 'local shortest path along OSM road graph', planDistanceKm: 'existing business plan metric carried for comparison' }, heightSource: 'OSM height/building:levels/estimated marker', compatibility: 'does not alter v1/v2' }, null, 2));
fs.writeFileSync(path.join(out, 'LICENSE.md'), `# 地理数据来源\n\n道路与建筑来源：OpenStreetMap contributors，通过 Overpass API 获取。\n许可证：ODbL 1.0，须保留 attribution。\n查询区域：${JSON.stringify(bbox)}。\n获取日期：2026-10-11。\n订单、门店名称与车辆方案为项目合成演示数据，不是企业真实业务。\n`);
console.log(JSON.stringify({ roads: roadFeatures.length, buildings: buildingFeatures.length, routes: Object.keys(routeGeometries).length, out }));
