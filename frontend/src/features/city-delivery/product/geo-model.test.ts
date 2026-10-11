import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import type {FleetPlan,Scenario} from '../decisions';
import {matchesGeoInput,routesOnNetwork,type GeoData} from './geo-model';
import {buildCity,buildingGeometry,disposeGroup} from './geo-scene';
const read=(name:string)=>JSON.parse(readFileSync(`frontend/public/demo/city-delivery/geo-city/v1/berlin/${name}`,'utf8'));
const data:GeoData={metadata:read('metadata.json'),buildings:read('buildings.geojson'),roads:read('roads.geojson'),land:read('land.geojson'),paths:read('paths.json')};
const task=read('task.json') as Scenario;
describe('地理数据与业务计划隔离',()=>{
 it('改变车辆或时间窗仍可用路网，改变坐标或矩阵停止叠加',()=>{
  expect(matchesGeoInput(data,task)).toBe(true);const changed=structuredClone(task);changed.vehicles.pop();changed.stops[0].timeWindow.end='09:00';expect(matchesGeoInput(data,changed)).toBe(true);
  changed.stops[0].x+=.01;expect(matchesGeoInput(data,changed)).toBe(false);const matrix=structuredClone(task);matrix.routing.distanceMatrixKm[0][1]+=.001;expect(matchesGeoInput(data,matrix)).toBe(false);
 });
 it('由实际停靠顺序生成道路，分钟不放大60倍，拒绝不一致的业务里程',()=>{
  const plan={routes:[{vehicleId:'V01',stopOrder:['S02','S01'],distanceKm:2.05,active:true}]} as FleetPlan;
  const route=routesOnNetwork(data,plan)[0];expect(route.networkDistanceKm).toBe(2.05);expect(route.networkTravelMinutes).toBe(4.92);expect(route.coordinates.length).toBe(211);
  expect(route.coordinates[0]).toEqual(data.paths.paths['DEPOT>S02'].coordinates[0]);
  plan.routes[0].stopOrder.reverse();plan.routes[0].distanceKm=['DEPOT>S01','S01>S02','S02>DEPOT'].reduce((sum,key)=>sum+data.paths.paths[key].distanceKm,0);
  expect(routesOnNetwork(data,plan)[0].coordinates).not.toEqual(route.coordinates);plan.routes[0].distanceKm=38;expect(()=>routesOnNetwork(data,plan)).toThrow('矩阵不一致');
 });
 it('未知配送点不能借用历史固定道路路线',()=>{
  expect(()=>routesOnNetwork(data,{routes:[{vehicleId:'V01',stopOrder:['OTHER'],distanceKm:0,active:true}]} as FleetPlan)).toThrow('缺少');
 });
});
describe('建筑与街道几何',()=>{
 it('北侧建筑保持在北侧，楼高用米，真实足迹可保留内院',()=>{
  const geometry=buildingGeometry({type:'Polygon',coordinates:[[[13,52.001],[13.002,52.001],[13.002,52.003],[13,52.003],[13,52.001]],[[13.0005,52.0015],[13.0005,52.0025],[13.0015,52.0025],[13.0015,52.0015],[13.0005,52.0015]]]},{lon:13,lat:52},19.2);
  geometry.computeBoundingBox();expect(geometry.boundingBox!.max.z).toBeCloseTo(-111.32,2);expect(geometry.boundingBox!.max.y).toBeCloseTo(19.2,3);expect(geometry.boundingBox!.min.y).toBeCloseTo(0,3);
  const vertices=geometry.getAttribute('position');let roofArea=0;
  for(let i=0;i<vertices.count;i+=3)if([i,i+1,i+2].every(j=>Math.abs(vertices.getY(j)-19.2)<.00001)){
   roofArea+=Math.abs((vertices.getX(i+1)-vertices.getX(i))*(vertices.getZ(i+2)-vertices.getZ(i))-(vertices.getZ(i+1)-vertices.getZ(i))*(vertices.getX(i+2)-vertices.getX(i)))/2;
  }
  // Outer 0.002° square minus 0.001° courtyard; a filled courtyard must fail.
  expect(roofArea).toBeCloseTo(3e-6*111320**2*Math.cos(52*Math.PI/180),0);geometry.dispose();
 });
 it('完整833栋建筑、路面与路口能够合并，无WebGL细线替代街道',()=>{
  const city=buildCity(data);expect(city.children.length).toBeGreaterThan(10);expect(city.children.length).toBeLessThan(25);const meshes=city.children.filter(o=>o.type==='Mesh');expect(meshes.length).toBeGreaterThan(10);expect(data.metadata.buildingCount).toBe(833);disposeGroup(city);
 });
});
