import {expect,test} from 'vitest';
import type {Reason} from '../decisions';
import {failureMessages} from './planning-failure';
const response=(reasons:unknown[]):Parameters<typeof failureMessages>[0]=>({scenario:{departureTime:'14:00',stops:[{stopId:'S01',name:'东城店',timeWindow:{end:'13:00'}}]},result:null,initialCheck:null,search:{failureEvidence:reasons as Reason[]}});
test('空结果仍展示时间窗证据，并优先保留有具体到店时间的重复原因',()=>{
 const output=failureMessages(response([{type:'time_window',stopId:'S01',message:'出发时间已超过门店时间窗'},{type:'time_window',stopId:'S01',arrivalTime:'18:10',latestServiceStart:'13:00',lateMinutes:310},{type:'time_window',stopId:'S01',arrivalTime:'18:10',latestServiceStart:'13:00',lateMinutes:310}]));
 expect(output).toEqual(['东城店：预计 18:10 到店，最晚服务开始 13:00，超过 310 分钟。']);
});
test('时长和卸货阻挡引用实际车辆、限额和阻挡编号',()=>{
 const output=failureMessages(response([{type:'max_route_duration',vehicleId:'V01',actualDurationMinutes:500,maxRouteDurationMinutes:480,excessMinutes:20},{type:'unloading_blocked',stopId:'S01',blockingCargoIds:['C02'],reason:'停止取货。'}]));
 expect(output[0]).toContain('V01：行驶、等待、服务和返仓共 500 分钟');expect(output[0]).toContain('480 分钟上限 20 分钟');expect(output[1]).toContain('阻挡货物 C02');
});
test('未知原因不推测业务原因；有限搜索不声称全局无解',()=>{
 expect(failureMessages(response([]))).toEqual([]);
 expect(failureMessages(response([{type:'service_other',message:'仅提供此条证据'}]))).toEqual(['仅提供此条证据']);
 expect(failureMessages(response([{type:'no_supported_layout',stopId:'S01',message:'本次未找到受支持的车辆布局'}]))[0]).toContain('仅表示当前有限搜索');
});
test('有具体计划失败时，不把无关车辆的候选失败混为本计划原因',()=>{
 const input=response([{type:'no_supported_layout',stopId:'S01',message:'另一候选车辆未找到布局'}]);
 input.result={feasibility:{executable:false,reasons:[{type:'time_window',stopId:'S01',arrivalTime:'18:10'}]}} as NonNullable<typeof input.result>;
 const output=failureMessages(input);expect(output).toHaveLength(1);expect(output[0]).toContain('18:10');expect(output[0]).not.toContain('另一候选');
 input.initialCheck=input.result;input.result={...input.result,feasibility:{executable:false,reasons:[]}};
 expect(failureMessages(input)).toEqual(output);
});
