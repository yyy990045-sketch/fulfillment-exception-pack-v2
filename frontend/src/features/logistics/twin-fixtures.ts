import type { TwinVehicle, TwinZone } from './twin-types';

export const twinZones: TwinZone[] = [
  { id: 'inbound', label: '入库月台', x: -10, z: 6, width: 6, depth: 3, tone: 'cyan' },
  { id: 'a', label: 'A 区 · 货架', x: -5, z: 1, width: 7, depth: 10, tone: 'blue' },
  { id: 'b', label: 'B 区 · 拥堵', x: 4, z: 1, width: 7, depth: 10, tone: 'amber' },
  { id: 'c', label: 'C 区 · 质检', x: 10, z: -6, width: 6, depth: 4, tone: 'red' },
  { id: 'outbound', label: '出库月台', x: -8, z: -7, width: 7, depth: 3, tone: 'cyan' },
];

export const twinVehicles: TwinVehicle[] = [
  { id: 'R01', label: 'R01', x: -7, z: 4, status: 'moving', battery: 86, task: '入库 → A12', progress: 72, color: '#23c8ff' },
  { id: 'R02', label: 'R02', x: 1, z: 4, status: 'moving', battery: 64, task: 'B55 → 出库', progress: 48, color: '#5a9bff' },
  { id: 'R03', label: 'R03', x: 7, z: -4, status: 'alert', battery: 18, task: '等待充电', progress: 20, color: '#ff5964' },
  { id: 'R04', label: 'R04', x: -4, z: -5, status: 'charging', battery: 42, task: '充电站 02', progress: 34, color: '#ffb34a' },
  { id: 'R05', label: 'R05', x: 7, z: 4, status: 'idle', battery: 91, task: '空闲', progress: 100, color: '#63e6be' },
  { id: 'R06', label: 'R06', x: 4, z: -1, status: 'moving', battery: 73, task: '质检 → B 区', progress: 61, color: '#23c8ff' },
];
