export type Step = 'order' | 'analysis' | 'carriers' | 'negotiation' | 'solutions' | 'plan' | 'execution';
export type City = '嘉兴' | '武汉' | '长沙' | '郑州' | '成都' | '杭州';
export interface Order { id: string; origin: City; destination: City; weight: number; cargo: string; handling: string; qualification: string; urgent: boolean; maxTransfers: number; budget: number; loadAt: string; deliverAt: string; }
export interface Constraint { key: keyof Order; label: string; value: string; kind: 'hard' | 'soft'; source: string; }
export interface Carrier { id: string; name: string; region: string; from: City; to: City; category: string; capacity: number; totalCapacity: number; punctuality: number; years: number; rating: number; status: string; color: string; price: number; duration: number; fragile: boolean; }
export interface MapNode { id: string; label: string; x: number; z: number; role?: 'origin' | 'destination'; }
export interface MapRoute { id: string; nodes: string[]; color: string; dashed?: boolean; active?: boolean; vehicles?: number; opacity?: number; glow?: number; width?: number; stopped?: boolean; }
export interface Solution { id: string; name: string; emphasis: string; color: string; cost: number; hours: number; sla: number; capacity: number; nodes: City[]; carriers: string[]; distances: number[]; segmentHours: number[]; advantages: string[]; }
export interface Message { id: string; author: string; text: string; time: string; kind: 'platform' | 'carrier' | 'user'; }
export interface Vehicle { id: string; plate: string; carrier: string; city: City; progress: number; state: '运输中' | '已到达' | '异常'; driver: string; speed: number; }
export interface LogisticsState { version: 1; order: Order; rawText: string; parsed: boolean; confirmed: boolean; selectedCarrier: string; selectedSolution: string; negotiated: boolean; submitted: boolean; running: boolean; ticks: number; messages: Message[]; }
export type Action = { type: 'reset' } | { type: 'raw'; value: string } | { type: 'order'; order: Order; rawText?: string; parsed?: boolean } | { type: 'confirm' } | { type: 'carrier'; id: string } | { type: 'solution'; id: string } | { type: 'message'; message: Message } | { type: 'negotiate' } | { type: 'submit' } | { type: 'running'; value: boolean } | { type: 'tick' };
