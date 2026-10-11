import type { Carrier, Constraint, LogisticsState, MapNode, MapRoute, Order, Solution, Vehicle } from './types';

// Synthetic fixtures only. No real carrier, quote, GPS or road-condition feed.
export const cities = ['嘉兴', '武汉', '长沙', '郑州', '成都', '杭州'] as const;
export const sampleText = `叮——临时来了一票加急单，麻烦尽快安排。
货是嘉兴这边发出的，最终要送到成都的仓库。
这边装车时间是 2026-10-06 08:00。
客户要求 2026-10-08 08:00 前必须送到。
大概 6.956 吨，按这个吨位给运力。
里面是易碎品，装卸要轻拿轻放，别磕着。
承运资质按普通承运资质就行。
时效算紧时效，加急。
路上最多换装 1 次。
这单我最多出 15920.7 元。`;
export const initialOrder: Order = { id: 'DEMO-2026-001', origin: '嘉兴', destination: '成都', weight: 6.956, cargo: '易碎品', handling: '轻拿轻放', qualification: '普通承运', urgent: true, maxTransfers: 1, budget: 15920.7, loadAt: '2026-10-06T08:00', deliverAt: '2026-10-08T08:00' };
export const carriers: Carrier[] = [
 {id:'A', name:'嘉兴-武汉专线', region:'长三角 → 华中',from:'嘉兴',to:'武汉',category:'干线专线',capacity:2.5,totalCapacity:10,punctuality:98.2,years:6,rating:4.6,status:'已认证',color:'#008cff',price:2800,duration:18,fragile:true},
 {id:'B', name:'武汉-成都专线', region:'华中 → 西南',from:'武汉',to:'成都',category:'干线专线',capacity:3,totalCapacity:10,punctuality:97.6,years:8,rating:4.8,status:'报价中',color:'#0788ff',price:3200,duration:28,fragile:true},
 {id:'C', name:'嘉兴-长沙专线', region:'长三角 → 华中',from:'嘉兴',to:'长沙',category:'区域专线',capacity:4,totalCapacity:10,punctuality:96.8,years:5,rating:4.5,status:'已接受',color:'#9366ff',price:2600,duration:18,fragile:true},
 {id:'D', name:'长沙-成都专线', region:'华中 → 西南',from:'长沙',to:'成都',category:'区域专线',capacity:2.8,totalCapacity:10,punctuality:97.1,years:7,rating:4.7,status:'协商中',color:'#ffa53c',price:2800,duration:30,fragile:true},
 {id:'E', name:'嘉兴-郑州专线', region:'长三角 → 华北',from:'嘉兴',to:'郑州',category:'回程车',capacity:3.5,totalCapacity:10,punctuality:95.9,years:4,rating:4.3,status:'待接洽',color:'#c381f7',price:2450,duration:20,fragile:false},
 {id:'F', name:'郑州-成都专线', region:'华北 → 西南',from:'郑州',to:'成都',category:'其他',capacity:3.2,totalCapacity:10,punctuality:96.4,years:5,rating:4.4,status:'待接洽',color:'#009cff',price:2700,duration:24,fragile:true},
];
export const mapNodes: MapNode[] = [
 {id:'嘉兴',label:'嘉兴',x:-9,z:1.4,role:'origin'}, {id:'武汉',label:'武汉',x:-2.2,z:-.6},
 {id:'长沙',label:'长沙',x:0,z:4.6}, {id:'郑州',label:'郑州',x:2,z:-5.4},
 {id:'成都',label:'成都',x:9,z:1.2,role:'destination'}, {id:'杭州',label:'杭州',x:-7,z:-4.5},
];
export const solutions: Solution[] = [
 {id:'A',name:'方案 A',emphasis:'综合最优',color:'#00dfdb',cost:12400,hours:46,sla:98,capacity:10,nodes:['嘉兴','武汉','成都'],carriers:['A','B'],distances:[920,1000],segmentHours:[18,28],advantages:['成本与时效平衡','承运商信誉良好','演示联合运力 10 吨']},
 {id:'B',name:'方案 B',emphasis:'备选联运',color:'#ffaf40',cost:13200,hours:52,sla:96,capacity:10,nodes:['嘉兴','长沙','郑州','成都'],carriers:['C','E','F'],distances:[920,780,1100],segmentHours:[14,20,18],advantages:['联合运力充足','覆盖更多中转节点','需放宽时窗和中转限制']},
 {id:'C',name:'方案 C',emphasis:'稳定专线',color:'#bc82ff',cost:12800,hours:48,sla:97,capacity:8,nodes:['嘉兴','长沙','成都'],carriers:['C','D'],distances:[920,1100],segmentHours:[18,30],advantages:['线路稳定','报价结构透明','48 小时演示到达']},
];
export const baseRoutes: MapRoute[] = carriers.map(c=>({id:c.id,nodes:[c.from,c.to],color:'#41617d',dashed:true,vehicles:0}));
export function solutionRoutes(selected = 'A', comparison = false): MapRoute[] {
 return solutions.filter(s=>comparison || s.id===selected).map(s=>({id:s.id,nodes:s.nodes,color:s.id==='A'?'#008cff':s.color,active:s.id===selected,vehicles:comparison?2:3}));
}
export const vehicles: Vehicle[] = [
 {id:'v1',plate:'鄂A·FZ3521',carrier:'A',city:'武汉',progress:68,state:'运输中',driver:'张师傅',speed:82},
 {id:'v2',plate:'浙B·8K729',carrier:'B',city:'武汉',progress:52,state:'运输中',driver:'陈师傅',speed:76},
 {id:'v3',plate:'川A·D9012',carrier:'C',city:'长沙',progress:35,state:'运输中',driver:'李师傅',speed:71},
 {id:'v4',plate:'苏E·3321K',carrier:'D',city:'成都',progress:82,state:'运输中',driver:'赵师傅',speed:79},
 {id:'v5',plate:'粤B·97D3Z',carrier:'E',city:'长沙',progress:18,state:'异常',driver:'周师傅',speed:0},
 {id:'v6',plate:'鲁Q·K8123',carrier:'F',city:'成都',progress:100,state:'已到达',driver:'吴师傅',speed:0},
 {id:'v7',plate:'京A·7765',carrier:'A',city:'成都',progress:100,state:'已到达',driver:'郑师傅',speed:0},
 {id:'v8',plate:'浙F·2389A',carrier:'B',city:'武汉',progress:44,state:'运输中',driver:'王师傅',speed:80},
 {id:'v9',plate:'皖A·6628B',carrier:'C',city:'郑州',progress:57,state:'运输中',driver:'刘师傅',speed:74},
 {id:'v10',plate:'鄂B·6619C',carrier:'D',city:'长沙',progress:23,state:'运输中',driver:'孙师傅',speed:78},
 {id:'v11',plate:'苏A·7208D',carrier:'E',city:'嘉兴',progress:12,state:'运输中',driver:'黄师傅',speed:65},
 {id:'v12',plate:'川B·9518E',carrier:'F',city:'郑州',progress:76,state:'运输中',driver:'何师傅',speed:72},
];
export const initialState: LogisticsState = {version:1,order:initialOrder,rawText:sampleText,parsed:true,confirmed:false,selectedCarrier:'A',selectedSolution:'A',negotiated:false,submitted:false,running:false,ticks:0,messages:[
 {id:'m1',author:'平台',kind:'platform',time:'14:05',text:'基于当前需求，建议比较 A + B 联营方案。请各承运商确认可用运力与报价。（模拟）'},
 {id:'m2',author:'承运商 A',kind:'carrier',time:'14:06',text:'当前可用 2.5 吨，基础报价 ¥2,800 / 吨，可协调演示联合运力。'},
 {id:'m3',author:'承运商 B',kind:'carrier',time:'14:08',text:'可提供武汉至成都专线，需联合调度满足整票吨位。'},
 {id:'m4',author:'承运商 D',kind:'carrier',time:'14:10',text:'长沙中转方案可作为备选，需要确认中转时间。'},
]};
export const money = (n:number) => '¥' + n.toLocaleString('zh-CN',{maximumFractionDigits:1});
export function constraints(o:Order):Constraint[] {
 return [
 {key:'origin',label:'起点',value:o.origin,kind:'hard',source:'原文 第2句'},
 {key:'destination',label:'终点',value:o.destination,kind:'hard',source:'原文 第2句'},
 {key:'loadAt',label:'装车时间',value:o.loadAt.replace('T',' '),kind:'hard',source:'原文 第3句'},
 {key:'deliverAt',label:'送达时间',value:o.deliverAt.replace('T',' '),kind:'hard',source:'原文 第4句'},
 {key:'weight',label:'货物重量',value:`${o.weight} 吨`,kind:'hard',source:'原文 第5句'},
 {key:'cargo',label:'货物类型',value:o.cargo,kind:'hard',source:'原文 第6句'},
 {key:'handling',label:'装卸要求',value:o.handling,kind:'hard',source:'原文 第6句'},
 {key:'qualification',label:'承运资质',value:o.qualification,kind:'hard',source:'原文 第7句'},
 {key:'urgent',label:'时效等级',value:o.urgent?'加急':'标准',kind:'soft',source:'原文 第8句'},
 {key:'maxTransfers',label:'中转上限',value:`${o.maxTransfers} 次`,kind:'soft',source:'原文 第9句'},
 {key:'budget',label:'预算上限',value:money(o.budget),kind:'soft',source:'原文 第10句'},
 ];
}
export function carrierChecks(c:Carrier,o:Order) {
 return [
 {label:`货物重量（${o.weight} 吨）`,ok:c.capacity>=o.weight,reason:c.capacity>=o.weight?'满足吨位要求':'超过可用舱位上限'},
 {label:'线路覆盖',ok:c.from===o.origin&&c.to===o.destination,reason:c.from===o.origin&&c.to===o.destination?'直达目的地':'无法独立覆盖完整线路'},
 {label:'货物类型',ok:o.cargo!=='易碎品'||c.fragile,reason:o.cargo!=='易碎品'||c.fragile?'适运货品资质':'不接受易碎品'},
 {label:'送达时窗',ok:c.duration<=(Date.parse(o.deliverAt)-Date.parse(o.loadAt))/3600000,reason:'按演示线路时长核验'},
 {label:'预算上限',ok:c.price*o.weight<=o.budget,reason:'基础吨价 × 订单重量'},
 ];
}
export function solutionIssues(s:Solution,o:Order):string[] {
 return [s.nodes[0]!==o.origin||s.nodes.at(-1)!==o.destination?'线路不匹配':null,s.capacity<o.weight?'联合吨位不足':null,s.nodes.length-2>o.maxTransfers?'超过中转上限':null,s.cost>o.budget?'超过预算':null,s.hours>(Date.parse(o.deliverAt)-Date.parse(o.loadAt))/3600000?'超过送达时窗':null].filter((x):x is string=>Boolean(x));
}
