"""Independent edge/OSM provenance, units and matrix replay; no solver mock."""
import hashlib
import json
import math
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'frontend/public/demo/city-delivery/geo-city/v1/berlin'
def read(name):return json.loads((BASE/name).read_text(encoding='utf8'))
network,paths,task,meta=map(read,['network.json','paths.json','task.json','metadata.json'])
ways={e['id']:e for e in read('osm-snapshot.json')['elements'] if e['type']=='way'}
assert hashlib.sha256((BASE/'osm-snapshot.json').read_bytes()).hexdigest()==meta['snapshotSha256']
def meters(a,b):
    lon1,lat1,lon2,lat2=map(math.radians,[*a,*b])
    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 2*6371008.8*math.asin(math.sqrt(h))
count=0
for a,edges in network['edges'].items():
    for edge in edges:
        b=edge['to'];way=ways[edge['wayId']];ids=list(map(str,way['nodes']));forward=any(x==a and y==b for x,y in zip(ids,ids[1:]));reverse=any(x==b and y==a for x,y in zip(ids,ids[1:]));assert forward or reverse
        for node in (a,b):
            coordinate=way['geometry'][ids.index(node)]
            assert network['nodes'][node]==[coordinate['lon'],coordinate['lat']]
        tags=way['tags'];direction=tags.get('oneway','yes' if tags.get('junction')=='roundabout' else 'no')
        assert direction not in ('yes','1','true') or forward
        assert direction!='-1' or reverse
        assert all(tags.get(k) not in ('no','private') for k in ('access','motor_vehicle','vehicle','motorcar'))
        speed_tag=tags.get('maxspeed','');speed=min(25,int(speed_tag)) if re.fullmatch(r'[0-9]+',speed_tag) and int(speed_tag)>0 else 25
        assert edge['speedKph']==speed
        assert abs(meters(network['nodes'][a],network['nodes'][b])-edge['meters'])<.0001
        assert abs(edge['seconds']-edge['meters']/edge['speedKph']*3.6)<.0001
        count+=1
for key,path in paths['paths'].items():
    assert path['coordinates']==[network['nodes'][n] for n in path['nodeIds']]
    total=seconds=0
    for a,b,way in zip(path['nodeIds'],path['nodeIds'][1:],path['wayIds']):
        edge=next(e for e in network['edges'][a] if e['to']==b and e['wayId']==way)
        total+=edge['meters'];seconds+=edge['seconds']
    assert round(total/1000,3)==path['distanceKm']
    assert round(seconds/60,2)==path['travelMinutes']
    assert abs(total-path['lengthMeters'])<.0001
    start,end=key.split('>');i,j=(task['routing']['nodeIds'].index(n) for n in (start,end))
    assert task['routing']['distanceMatrixKm'][i][j]==path['distanceKm']
    assert task['routing']['travelTimeMatrixMinutes'][i][j]==path['travelMinutes']
for location in paths['locations']:
    assert [location['lon'],location['lat']]==network['nodes'][location['roadNodeId']]
    stop=next(s for s in [task['warehouse'],*task['stops']] if s['stopId']==location['stopId'])
    assert [stop['x'],stop['y']]==[location['x'],location['y']]
print(f'PASS: {count} directed OSM edges, 100 road paths, 10 anchors, matrix distances and minute units.')
