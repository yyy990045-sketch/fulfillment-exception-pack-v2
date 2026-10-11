"""Build offline OSM geometry and same-network planning matrices. No solver changes."""
import argparse
import collections
import hashlib
import heapq
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'frontend/public/demo/city-delivery/geo-city/v1'
sys.path.insert(0, str(ROOT / 'tools/city-delivery-decision'))
from evidence_v3 import standardize
from standard import validate_scene

BOXES = {'hangzhou': [120.05, 30.25, 120.09, 30.28], 'berlin': [13.393, 52.514, 13.414, 52.526]}
MOTOR_ROADS = {'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service'}
TAGS = {'building', 'building:levels', 'height', 'name', 'highway', 'lanes', 'width', 'oneway', 'junction', 'maxspeed', 'access', 'motor_vehicle', 'vehicle', 'motorcar', 'bridge', 'tunnel', 'layer', 'landuse', 'leisure', 'natural', 'type'}

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf8')

def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    d = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8 * 2 * math.atan2(math.sqrt(d), math.sqrt(1-d))

def inside(point, box):
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]

def rings(members, role):
    parts = [[(p['lon'], p['lat']) for p in m['geometry']] for m in members if m.get('role') == role and m.get('geometry')]
    result = []
    while parts:
        ring = parts.pop(0)
        while ring[0] != ring[-1]:
            match = next((i for i, p in enumerate(parts) if p[0] == ring[-1] or p[-1] == ring[-1]), None)
            if match is None:
                raise ValueError('Unclosed OSM multipolygon member ring')
            part = parts.pop(match)
            ring.extend((part if part[0] == ring[-1] else part[::-1])[1:])
        if len(ring) >= 4:
            result.append(ring)
    return result

def contains(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result

def polygon(e):
    if e['type'] == 'relation':
        outer, inner = rings(e['members'], 'outer'), rings(e['members'], 'inner')
        polygons = [[r, *[h for h in inner if contains(h[0], r)]] for r in outer]
        return {'type': 'MultiPolygon', 'coordinates': polygons}
    coords = [(p['lon'], p['lat']) for p in e.get('geometry', [])]
    if len(coords) < 4 or coords[0] != coords[-1]:
        return None
    return {'type': 'Polygon', 'coordinates': [coords]}

def height(tags):
    for key, factor, source in [('height', 1, 'OSM height 标签'), ('building:levels', 3.2, '估计：OSM楼层 × 3.2m')]:
        match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)(?:\s*m)?', tags.get(key, ''))
        if match and 0 < float(match[1])*factor < 400:
            return round(float(match[1])*factor, 2), source
    return 6, '估计：缺少高度/楼层标签，统一6m'

def feature(e, geometry, properties):
    return {'type': 'Feature', 'id': f"{e['type']}-{e['id']}", 'properties': properties, 'geometry': geometry}

def build_region(name, source):
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    if source:
        original = json.loads(Path(source).read_text(encoding='utf8'))
        raw = copy.deepcopy(original)
        for e in raw['elements']:
            e['tags'] = {k: v for k, v in e.get('tags', {}).items() if k in TAGS}
        dump(folder/'osm-snapshot.json', raw)
    else:
        raw = json.loads((folder/'osm-snapshot.json').read_text(encoding='utf8'))
    elements = raw['elements']
    box = BOXES[name]
    member_ids = {m['ref'] for e in elements if e['type'] == 'relation' and 'building' in e.get('tags', {}) for m in e.get('members', [])}
    buildings, land, roads = [], [], []
    nodes, graph = {}, collections.defaultdict(list)
    for e in elements:
        tags = e.get('tags', {})
        if 'building' in tags and e['id'] not in member_ids:
            geom = polygon(e)
            if geom:
                h, source_label = height(tags)
                buildings.append(feature(e, geom, {'osmId': e['id'], 'name': tags.get('name'), 'heightM': h, 'heightSource': source_label}))
        elif 'highway' not in tags and any(k in tags for k in ('landuse', 'natural', 'leisure')):
            geom = polygon(e)
            if geom:
                land.append(feature(e, geom, {k: tags[k] for k in ('landuse', 'natural', 'leisure', 'name') if k in tags}))
        if 'highway' not in tags or not e.get('geometry'):
            continue
        coords = [[p['lon'], p['lat']] for p in e['geometry']]
        if len(coords) < 2:
            continue
        drive = tags['highway'] in MOTOR_ROADS and all(tags.get(k) not in ('no', 'private') for k in ('access', 'motor_vehicle', 'vehicle', 'motorcar'))
        roads.append(feature(e, {'type': 'LineString', 'coordinates': coords}, {'wayId': e['id'], 'highway': tags['highway'], 'name': tags.get('name'), 'lanes': tags.get('lanes'), 'width': tags.get('width'), 'driveAllowed': drive, 'oneway': tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')}))
        if not drive:
            continue
        speed_tag = tags.get('maxspeed', '')
        speed = min(25, float(speed_tag)) if re.fullmatch(r'[0-9]+', speed_tag) and float(speed_tag) > 0 else 25
        for node_id, point in zip(e['nodes'], coords):
            nodes[str(node_id)] = point
        direction = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')
        for a, b, pa, pb in zip(e['nodes'], e['nodes'][1:], coords, coords[1:]):
            if not inside(pa, box) or not inside(pb, box):
                continue
            meters = distance(pa, pb)
            if meters == 0:
                continue
            seconds = meters / (speed/3.6)
            edge = {'meters': meters, 'seconds': seconds, 'wayId': e['id'], 'speedKph': speed}
            if direction not in ('yes', '1', 'true'):
                graph[str(b)].append({'to': str(a), **edge})
            if direction != '-1':
                graph[str(a)].append({'to': str(b), **edge})
    for label, feats in [('buildings', buildings), ('roads', roads), ('land', land)]:
        dump(folder/(label+'.geojson'), {'type': 'FeatureCollection', 'features': feats})
    dump(folder/'network.json', {'nodes': nodes, 'edges': dict(graph)})
    h_counts = collections.Counter(f['properties']['heightSource'] for f in buildings)
    metadata = {'region': '柏林 Mitte · 真实地理 / 合成配送' if name == 'berlin' else '杭州城西 · 历史配送地理示意', 'bbox': box, 'origin': {'lon': (box[0]+box[2])/2, 'lat': (box[1]+box[3])/2}, 'snapshotDate': raw['osm3s']['timestamp_osm_base'], 'buildingCount': len(buildings), 'roadCount': len(roads), 'routableWayCount': sum(r['properties']['driveAllowed'] for r in roads), 'heightSources': dict(h_counts), 'roadModel': 'OSM节点连通和单行标签；公开机动车道路，配送可达道路允许；不含转向限制、实时交通、限高限重检查。', 'speedModel': '每段平均速度 min(OSM maxspeed,25km/h)，未知时25km/h；分钟=秒/60。', 'source': 'https://www.openstreetmap.org/copyright', 'endpoint': 'https://overpass-api.de/api/interpreter', 'snapshotSha256': hashlib.sha256((folder/'osm-snapshot.json').read_bytes()).hexdigest(), 'buildingPolicy': 'height标签优先；楼层×3.2m为估计；无标签统一6m估计，不声称实测高度。'}
    dump(folder/'metadata.json', metadata)
    return nodes, graph, metadata

def shortest(nodes, graph, start, end):
    queue, costs, previous = [(0, start)], {start: 0}, {}
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != costs[node]:
            continue
        if node == end:
            break
        for edge in graph.get(node, []):
            value = cost+edge['meters']
            if value < costs.get(edge['to'], math.inf):
                costs[edge['to']] = value
                previous[edge['to']] = (node, edge)
                heapq.heappush(queue, (value, edge['to']))
    if end not in costs:
        raise ValueError(f'No motor road path: {start} -> {end}')
    current, ids, ways, seconds = end, [end], [], 0
    while current != start:
        parent, edge = previous[current]
        seconds += edge['seconds']
        ways.append(edge['wayId'])
        ids.append(parent)
        current = parent
    ids.reverse()
    return {'coordinates': [nodes[n] for n in ids], 'nodeIds': ids, 'wayIds': ways[::-1], 'distanceKm': round(costs[end]/1000, 3), 'travelMinutes': round(seconds/60, 2), 'lengthMeters': round(costs[end], 4)}

def reach(graph, start):
    found, stack = {start}, [start]
    while stack:
        for edge in graph.get(stack.pop(), []):
            if edge['to'] not in found:
                found.add(edge['to']); stack.append(edge['to'])
    return found

def build_task(nodes, graph, metadata):
    base = json.loads((ROOT/'frontend/public/demo/city-delivery/v2/scenario.json').read_text(encoding='utf8'))
    scene = standardize(base)
    scene['scenarioId'] = 'city-geo-berlin-mitte-009'
    scene['name'] = '柏林Mitte · 九店路网配送任务'
    scene['source'] = {'dataType': 'synthetic', 'name': 'OSM Mitte offline road graph · 2026-10-11', 'description': '真实WGS84道路/建筑；合成仓库、门店、包装件和车辆。地理坐标与同源路网矩阵见geo-city/v1/berlin；不代表企业配送。', 'license': 'OSM-derived database: ODbL 1.0; synthetic task: project-owned', 'authorization': 'OpenStreetMap contributors开放数据，保留署名；合成订单为Owner授权比赛演示。'}
    central = min(graph, key=lambda n: distance(nodes[n], [13.401, 52.520]))
    reverse = collections.defaultdict(list)
    for a, edges in graph.items():
        for e in edges:
            reverse[e['to']].append({'to': a})
    component = reach(graph, central) & reach(reverse, central)
    points = [[13.401,52.520],[13.3945,52.525],[13.402,52.525],[13.411,52.5245],[13.413,52.519],[13.410,52.515],[13.403,52.515],[13.395,52.515],[13.394,52.520],[13.406,52.5208]]
    locations = []
    for stop, target in zip([scene['warehouse'], *scene['stops']], points):
        node = min(component, key=lambda n: distance(nodes[n], target))
        lon, lat = nodes[node]
        stop['x'] = round((lon-metadata['origin']['lon'])*111320*math.cos(math.radians(metadata['origin']['lat']))/1000, 7)
        stop['y'] = round((lat-metadata['origin']['lat'])*111320/1000, 7)
        stop['name'] = 'Mitte中心仓' if stop['stopId']=='DEPOT' else '地理门店 '+stop['stopId'][1:]
        if stop['stopId']!='DEPOT':
            stop['address'] = f'合成配送点 · WGS84 {lat:.7f}, {lon:.7f}'
            stop['timeWindow'] = {'start': '08:00', 'end': '10:30'}
        locations.append({'stopId': stop['stopId'], 'name': stop['name'], 'lon': lon, 'lat': lat, 'roadNodeId': node, 'x': stop['x'], 'y': stop['y'], 'locationSource': '合成配送点，定位到OSM公开机动车路网节点'})
    paths = {a['stopId']+'>'+b['stopId']: shortest(nodes, graph, a['roadNodeId'], b['roadNodeId']) for a in locations for b in locations}
    scene['routing']['distanceMatrixKm'] = [[paths[a['stopId']+'>'+b['stopId']]['distanceKm'] for b in locations] for a in locations]
    scene['routing']['travelTimeMatrixMinutes'] = [[paths[a['stopId']+'>'+b['stopId']]['travelMinutes'] for b in locations] for a in locations]
    validate_scene(scene)
    folder = OUT/'berlin'
    dump(folder/'task.json', scene)
    dump(folder/'paths.json', {'scenarioId': scene['scenarioId'], 'locations': locations, 'paths': paths, 'routing': scene['routing']})

def build_legacy():
    folder = ROOT/'frontend/public/demo/city-delivery/geo-hangzhou-xixi/v1'
    old = json.loads((folder/'scenario.json').read_text(encoding='utf8'))
    roads = json.loads((folder/'roads.geojson').read_text(encoding='utf8'))['features']
    nodes, graph = {}, collections.defaultdict(list)
    for f in roads:
        coords = f['geometry']['coordinates']
        for a, b in zip(coords, coords[1:]):
            keys = [f'{p[1]:.7f},{p[0]:.7f}' for p in (a,b)]
            for key, point in zip(keys, (a,b)):
                nodes[key] = point
            meters = distance(a,b)
            for i,j in ((0,1),(1,0)):
                graph[keys[i]].append({'to': keys[j], 'meters': meters, 'seconds': meters/1000*2*60, 'wayId': f['properties']['wayId']})
    locations = [{'stopId': s['stopId'], 'name': s['name'], 'lon': s['geo']['lon'], 'lat': s['geo']['lat'], 'roadNodeId': s['geo']['roadNodeId']} for s in [old['warehouse'], *old['stops']]]
    paths = {a['stopId']+'>'+b['stopId']: shortest(nodes,graph,a['roadNodeId'],b['roadNodeId']) for a in locations for b in locations}
    dump(OUT/'hangzhou/paths.json', {'scenarioId': 'city-delivery-multivehicle-synthetic-001', 'locations': locations, 'paths': paths, 'historicalIllustrationOnly': True, 'roadModel': '旧快照无向道路示意，未检查单行/转向规则；历史50/38km、费用与时效完全保留，不用示意路网距离重算业务。'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--hangzhou-snapshot')
    parser.add_argument('--berlin-snapshot')
    args = parser.parse_args()
    build_region('hangzhou', args.hangzhou_snapshot)
    nodes, graph, metadata = build_region('berlin', args.berlin_snapshot)
    build_task(nodes, graph, metadata)
    build_legacy()
    print(json.dumps(metadata, ensure_ascii=False))
