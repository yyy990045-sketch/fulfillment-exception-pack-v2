import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Maximize, Minus, Plus, RotateCcw, TriangleAlert, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCityProduct } from './state';

type GeoPoint = [number, number];
type GeoScenario = { scenarioId: string; geo: { origin: { lat: number; lon: number }; region: string }; warehouse: { stopId: string; name: string; color?: string; geo: { lat: number; lon: number } }; stops: Array<{ stopId: string; name: string; color: string; geo: { lat: number; lon: number } }> };
type GeoPlan = { planId: string; routes: Array<{ vehicleId: string; routeGeometryId: string; roadDistanceKm: number; roadTravelMinutes: number; roadSegmentIds: number[]; stopOrder: string[]; active: boolean }> };
type GeoPackage = { scenario: GeoScenario; roads: any; buildings: any; stores: any; plans: { plans: GeoPlan[] }; geometries: any };

const BASE = `${import.meta.env.BASE_URL}demo/city-delivery/geo-hangzhou-xixi/v1/`;

function localPoint(origin: { lat: number; lon: number }, coord: GeoPoint) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(origin.lat * Math.PI / 180);
  return new THREE.Vector3((coord[0] - origin.lon) * lonScale * .055, 0, -(coord[1] - origin.lat) * latScale * .055);
}

function routeColor(vehicleId: string) { return new THREE.Color(colorForVehicle(vehicleId)); }
function colorForVehicle(id: string) { return ({ V01: '#82c7b3', V02: '#86adeb', V03: '#c6a3df' } as Record<string, string>)[id] ?? '#d7a66f'; }

export function GeoCityMap({ overview = false, simulation = false }: { overview?: boolean; simulation?: boolean }) {
  const p = useCityProduct();
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ dispose: () => void } | null>(null);
  const mapApi = useRef<{ zoom: (factor: number) => void; reset: () => void } | null>(null);
  const [data, setData] = useState<GeoPackage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all(['scenario.json', 'roads.geojson', 'buildings.geojson', 'stores.geojson', 'plans.json', 'route-geometries.json'].map(name => fetch(BASE + name, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('杭州城西地理数据读取失败。'); return r.json(); })))
      .then(([scenario, roads, buildings, stores, plans, geometries]) => setData({ scenario, roads, buildings, stores, plans, geometries }))
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '地理数据暂时不可用。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!host.current || !data) return;
    const element = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.setClearColor('#12232d'); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; element.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#12232d'); scene.fog = new THREE.Fog('#12232d', 180, 420);
    scene.add(new THREE.HemisphereLight('#e1edf1', '#1a3441', 1.35)); const key = new THREE.DirectionalLight('#ffffff', 3.4); key.position.set(45, 90, 35); key.castShadow = true; scene.add(key);
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 500); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = Math.PI * .48; controls.minDistance = 20; controls.maxDistance = 260;
    const root = new THREE.Group(); scene.add(root); const origin = data.scenario.geo.origin;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 360), new THREE.MeshStandardMaterial({ color: '#18313c', roughness: .92, metalness: .05 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; root.add(ground);
    const roads = new THREE.Group(); root.add(roads);
    for (const feature of data.roads.features ?? []) { const coords = feature.geometry?.coordinates ?? []; if (coords.length < 2) continue; const points = coords.map((c: GeoPoint) => localPoint(origin, c).setY(.18)); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: feature.properties?.highway === 'primary' ? '#b8c9cf' : '#7898a3', transparent: true, opacity: feature.properties?.highway === 'primary' ? .98 : .84, linewidth: 2 })); roads.add(line); }
    const buildings = new THREE.Group(); root.add(buildings);
    for (const feature of (data.buildings.features ?? []) as any[]) { const polygon = feature.geometry?.coordinates?.[0]; if (!polygon || polygon.length < 3) continue; const shape = new THREE.Shape(); polygon.forEach((coord: GeoPoint, i: number) => { const pt = localPoint(origin, coord); if (i === 0) shape.moveTo(pt.x, pt.z); else shape.lineTo(pt.x, pt.z); }); const height = Math.max(.8, Number(feature.properties?.heightM ?? 6) * .055); const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }); geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, 0); const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#4e7180', roughness: .72, metalness: .12, emissive: '#132b36', emissiveIntensity: .24 })); mesh.position.y = 0; mesh.castShadow = true; mesh.receiveShadow = true; buildings.add(mesh); }
    const markerGroup = new THREE.Group(); root.add(markerGroup); const pointByStop = new Map<string, THREE.Vector3>();
    const addMarker = (stop: { stopId: string; name: string; color?: string; geo: { lat: number; lon: number } }, warehouse = false) => { const point = localPoint(origin, [stop.geo.lon, stop.geo.lat]); point.y = warehouse ? 1.8 : 1.1; pointByStop.set(stop.stopId, point.clone()); const markerColor = stop.color ?? '#f4b56e'; const marker = new THREE.Mesh(new THREE.CylinderGeometry(warehouse ? 2.2 : 1.2, warehouse ? 2.2 : 1.2, warehouse ? 1.2 : .7, 24), new THREE.MeshStandardMaterial({ color: warehouse ? '#f4b56e' : markerColor, emissive: warehouse ? '#6b3c16' : markerColor, emissiveIntensity: warehouse ? .8 : .35, metalness: .25, roughness: .3 })); marker.position.copy(point); marker.userData = { kind: 'stop', id: stop.stopId }; marker.castShadow = true; markerGroup.add(marker); }
    addMarker(data.scenario.warehouse, true); data.scenario.stops.forEach(stop => addMarker(stop));
    const routeGroup = new THREE.Group(); root.add(routeGroup); const geometryById = new Map((data.geometries.features ?? []).map((feature: any) => [feature.id, feature]));
    const plan = data.plans.plans.find(item => item.planId === p.current.planId) ?? data.plans.plans[0]; const activeRoute = p.current.routes.find(r => r.vehicleId === p.vehicleId);
    for (const route of plan?.routes ?? []) { const feature: any = geometryById.get(route.routeGeometryId); if (!feature) continue; const coords = feature.geometry.coordinates as GeoPoint[]; const points = coords.map(c => localPoint(origin, c).setY(.5)); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: routeColor(route.vehicleId), transparent: true, opacity: route.vehicleId === activeRoute?.vehicleId ? 1 : .25 })); routeGroup.add(line); }
    const spatialBounds = new THREE.Box3().setFromObject(roads); spatialBounds.expandByObject(buildings); spatialBounds.expandByObject(markerGroup); spatialBounds.expandByObject(routeGroup); const center = spatialBounds.getCenter(new THREE.Vector3()); const size = spatialBounds.getSize(new THREE.Vector3()); const distance = Math.max(size.x, size.z, 18) * .78; const reset = () => { camera.position.set(center.x + distance * .55, distance * .7, center.z + distance * .7); controls.target.set(center.x, .5, center.z); controls.update(); }; reset(); mapApi.current = { zoom: (factor) => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); }, reset };
    let frame = 0; let alive = true; const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const onPointer = (event: PointerEvent) => { const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1)); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(markerGroup.children, true)[0]?.object; const id = hit?.userData?.id; if (id && id !== 'DEPOT') p.selectStop(id); }; renderer.domElement.addEventListener('pointerup', onPointer); const resize = () => { const width = Math.max(1, element.clientWidth); const height = Math.max(1, element.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }; const observer = new ResizeObserver(resize); observer.observe(element); resize(); const render = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render); }; frame = requestAnimationFrame(render);
    sceneRef.current = { dispose: () => { alive = false; cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener('pointerup', onPointer); controls.dispose(); renderer.dispose(); scene.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); const mat = Array.isArray(obj.material) ? obj.material : [obj.material]; mat.forEach(m => m.dispose()); } }); renderer.domElement.remove(); } };
    return () => { sceneRef.current?.dispose(); sceneRef.current = null; };
  }, [data, p.current.planId, p.vehicleId, p.scenario.stops.length]);

  return <div className={`p-map p-geo-city-map ${overview ? 'p-map-overview' : ''}`}><div ref={host} className="p-geo-city-host"/><div className="p-map-title"><span><Warehouse size={15}/>杭州城西配送空间</span><small>{data?.scenario.geo.region ?? '正在读取本地 OSM 数据'} · {p.scenario.stops.length} 家门店</small></div><div className="p-geo-source">道路与建筑：OSM 派生离线快照 · 非实时导航</div><div className="p-map-legend">{p.current.routes.map(route => <button key={route.vehicleId} onClick={() => p.selectVehicle(route.vehicleId)}><i style={{ background: colorForVehicle(route.vehicleId) }}/>{route.vehicleId}<span>{route.active === false ? '空闲' : `${route.stopOrder.length} 店`}</span></button>)}</div>{loading && <div className="p-geo-loading">正在加载杭州城西道路与建筑</div>}{error && <div className="p-geo-loading is-error"><TriangleAlert size={18}/>{error}</div>}<div className="p-map-tools"><Button aria-label="复位城市地图" onClick={() => mapApi.current?.reset()}><RotateCcw size={16}/></Button><Button aria-label="放大城市地图" onClick={() => mapApi.current?.zoom(.8)}><Plus size={16}/></Button><Button aria-label="缩小城市地图" onClick={() => mapApi.current?.zoom(1.25)}><Minus size={16}/></Button><Button aria-label="全局城市地图" onClick={() => mapApi.current?.reset()}><Maximize size={16}/></Button></div></div>;
}
