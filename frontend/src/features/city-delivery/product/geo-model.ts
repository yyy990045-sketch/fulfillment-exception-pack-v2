import type { FleetPlan, Scenario } from '../decisions';

export type Coordinate = [number, number];
export type Polygon = { type:'Polygon'; coordinates:Coordinate[][] };
export type MultiPolygon = { type:'MultiPolygon'; coordinates:Coordinate[][][] };
export type AreaGeometry = Polygon|MultiPolygon;
export interface AreaFeature { id:string; geometry:AreaGeometry; properties:{heightM?:number;heightSource?:string;name?:string;natural?:string;landuse?:string;leisure?:string} }
export interface RoadFeature { id:string; geometry:{type:'LineString';coordinates:Coordinate[]};properties:{wayId:number;highway:string;name?:string;lanes?:string;width?:string;driveAllowed:boolean} }
export interface GeoLocation { stopId:string; name:string;lon:number;lat:number;x?:number;y?:number;roadNodeId:string }
export interface RoadPath {coordinates:Coordinate[];nodeIds:string[];wayIds:number[];distanceKm:number;travelMinutes:number;lengthMeters:number}
export interface GeoData {
 metadata:{region:string;bbox:[number,number,number,number];origin:{lon:number;lat:number};buildingCount:number;roadCount:number;routableWayCount:number;heightSources:Record<string,number>;snapshotDate:string;buildingPolicy:string;roadModel:string;speedModel:string};
 buildings:{features:AreaFeature[]};roads:{features:RoadFeature[]};land:{features:AreaFeature[]};
 paths:{scenarioId:string;locations:GeoLocation[];paths:Record<string,RoadPath>;historicalIllustrationOnly?:boolean;routing?:Scenario['routing']};
}
export interface GeoRoute { vehicleId:string;stopOrder:string[];coordinates:Coordinate[];networkDistanceKm:number;networkTravelMinutes:number;planDistanceKm:number;active:boolean }
export const GEO_TASK_ID='city-geo-berlin-mitte-009';
export const GEO_BASE=`${import.meta.env.BASE_URL}demo/city-delivery/geo-city/v1/`;
export function geoRegion(mode:string,scenarioId:string){
 if(mode==='fleet'&&scenarioId==='city-delivery-multivehicle-synthetic-001')return 'hangzhou';
 if(mode==='standard'&&scenarioId===GEO_TASK_ID)return 'berlin';
 return null;
}
export function project(origin:{lon:number;lat:number},[lon,lat]:Coordinate){
 return {x:(lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180),z:-(lat-origin.lat)*111320};
}
export function polygonRings(geometry:AreaGeometry){return geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;}
export function matchesGeoInput(data:GeoData,scenario:Scenario){
 if(data.paths.historicalIllustrationOnly)return scenario.scenarioId===data.paths.scenarioId;
 if(scenario.scenarioId!==data.paths.scenarioId)return false;
 if(JSON.stringify(scenario.routing.nodeIds)!==JSON.stringify(data.paths.routing?.nodeIds)||JSON.stringify(scenario.routing.distanceMatrixKm)!==JSON.stringify(data.paths.routing?.distanceMatrixKm)||JSON.stringify(scenario.routing.travelTimeMatrixMinutes)!==JSON.stringify(data.paths.routing?.travelTimeMatrixMinutes))return false;
 const stops=[scenario.warehouse,...scenario.stops];
 return stops.length===data.paths.locations.length&&stops.every(s=>data.paths.locations.some(l=>l.stopId===s.stopId&&l.x===s.x&&l.y===s.y));
}
export function routesOnNetwork(data:GeoData,plan:FleetPlan):GeoRoute[]{
 return plan.routes.map(route=>{
  const ids=['DEPOT',...route.stopOrder,'DEPOT'];const coordinates:Coordinate[]=[];let km=0,minutes=0;
  if(route.active!==false&&route.stopOrder.length)for(let i=1;i<ids.length;i++){
   const leg=data.paths.paths[`${ids[i-1]}>${ids[i]}`];
   if(!leg)throw new Error(`当前路网缺少 ${ids[i-1]} → ${ids[i]} 的可核验路径。`);
   coordinates.push(...(i===1?leg.coordinates:leg.coordinates.slice(1)));km+=leg.distanceKm;minutes+=leg.travelMinutes;
  }
  if(!data.paths.historicalIllustrationOnly&&Math.abs(km-route.distanceKm)>.00001)throw new Error(`${route.vehicleId} 的路线与规划矩阵不一致，已停止道路叠加。`);
  return {vehicleId:route.vehicleId,stopOrder:route.stopOrder,coordinates,networkDistanceKm:Math.round(km*1000)/1000,networkTravelMinutes:Math.round(minutes*100)/100,planDistanceKm:route.distanceKm,active:route.active!==false};
 });
}
