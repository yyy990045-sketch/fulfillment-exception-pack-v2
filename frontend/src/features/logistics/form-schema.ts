import { z } from 'zod';
import { cities, initialOrder, sampleText } from './fixtures';
import type { Order } from './types';
export const orderSchema = z.object({
 id:z.string().min(1), origin:z.enum(cities), destination:z.enum(cities),
 weight:z.coerce.number().positive('重量必须大于 0').max(100,'演示上限为 100 吨'),
 cargo:z.string().min(1,'请填写货物类型'), handling:z.string().min(1), qualification:z.string().min(1),
 urgent:z.boolean(), maxTransfers:z.coerce.number().int().min(0).max(5),
 budget:z.coerce.number().positive('预算必须大于 0'), loadAt:z.string().min(1), deliverAt:z.string().min(1),
}).refine(o=>o.origin!==o.destination,{message:'起点与终点不能相同',path:['destination']})
.refine(o=>Number.isFinite(Date.parse(o.loadAt))&&Date.parse(o.deliverAt)>Date.parse(o.loadAt),{message:'送达时间必须晚于装车时间',path:['deliverAt']});
export function parseSample(text:string):{order:Order;complete:boolean;notice:string} {
 if(text.trim()===sampleText.trim()) return {order:{...initialOrder},complete:true,notice:'预置样例已提取；规则演示，非 AI 置信度判断。'};
 // Unknown prose must be confirmed manually; never claim a generic extraction succeeded.
 return {order:{...initialOrder},complete:false,notice:'这段文本不属于预置样例，暂不能自动提取。请人工填写并确认所有约束；表单值只是演示默认值。'};
}
