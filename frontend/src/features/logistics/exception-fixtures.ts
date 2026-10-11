import type { MapNode, MapRoute } from './types';

/* 09 异常事件 / 10 重新规划 / 11 实验结果 的本地合成数据。
   全部为合成演示数据：不连接真实承运商、GPS、路况或交易系统。 */

/* 异常场景使用的枢纽网络。四个枢纽的坐标与执行监控页（08）使用的
   武汉 / 长沙 / 成都 / 嘉兴 完全一致，因此 08 → 09 → 10 是同一张网络换了呈现状态，
   不出现镜头或拓扑跳变。枢纽编号为本地合成网络的匿名标识。 */
export const hubNetwork: MapNode[] = [
  { id: '丁', label: '丁', x: -9, z: 1.4, role: 'origin' },
  { id: '丙', label: '丙', x: -2.2, z: -.6 },
  { id: '戊', label: '戊', x: 0, z: 4.6 },
  { id: '乙', label: '乙', x: 9, z: 1.2, role: 'destination' },
];

export const HUB_ROLE: Record<string, string> = { 丁: '起运枢纽', 丙: '中转枢纽', 戊: '替换中转枢纽', 乙: '到货枢纽' };

export const hubLabel = (id: string) => `${HUB_ROLE[id] ?? '枢纽'} ${id}`;

/* ---------- 09 异常事件 ---------- */

export const exceptionEvent = {
  id: 'EX-2026-1007-01',
  planId: 'TR-2026-1007-A',
  kind: '车辆故障',
  title: '干线运输段车辆故障',
  reportedAt: '10-07 09:42',
  summary: '执行中的第 1 段干线运输发生车辆故障，车辆已无法继续行驶，该段不能按原计划执行。',
  vehicle: {
    plate: '浙F·4K917',
    trailer: '挂车 浙F·4K917 挂',
    driver: '王师傅',
    fault: '动力系统故障，发动机故障灯持续报警',
    position: '丁 → 丙 途中，距丙枢纽约 68 km',
    status: '车辆已靠边停靠，等待处置',
  },
  affectedLeg: { from: '丁', to: '丙', index: 1, total: 2 },
  sla: { window: '10-08 08:00', risk: '按原计划继续等待将超出送达窗口', level: '高' },
  cost: { note: '需要临时调派替代运力并重新安排中转，成本会上升', range: '待重新规划后确定' },
  rawText: '车在丁到丙这段动不了了，发动机故障灯一直亮，司机不敢硬开，人车都在路边停着。这票是加急的，明天早上八点前必须到乙仓，晚点客户要罚款。麻烦赶紧给个能走的新线路，费用尽量别超太多。',
};

/* 09 的 3D 状态：原计划正常段压暗、故障段红色并停驻一辆车 */
export const exceptionRoutes: MapRoute[] = [
  { id: 'leg-2', nodes: ['丙', '乙'], color: '#2c5d80', glow: .5, opacity: .55, vehicles: 0 },
  { id: 'leg-1', nodes: ['丁', '丙'], color: '#ff3d52', glow: 2.6, width: .052, vehicles: 1, stopped: true },
];

/* ---------- 10 重新规划 ---------- */

export const replanCompare = {
  before: { nodes: ['丁', '丙', '乙'], legs: 2 },
  after: { nodes: ['丁', '戊', '乙'], legs: 2 },
  metrics: [
    { key: 'cost', label: '总成本', delta: '+0.7572', unit: '', trend: 'up' as const, note: '标准化成本指数' },
    { key: 'eta', label: '预计时效', delta: '+0.644', unit: ' 小时', trend: 'up' as const, note: '到达时间后移' },
    { key: 'sla', label: 'SLA 达成', delta: '达成 → 达成', unit: '', trend: 'hold' as const, note: '送达窗口未被突破' },
  ],
  statement: '系统根据更新后的状态重新生成了一条可执行方案。这不代表结果优于原计划，只代表原计划已不可执行。',
  boundary: '本页不构成「AI 恢复优于人工恢复」的证据；恢复质量在实验结果页单独判定。',
};

/* 10 的 3D 状态：旧计划 25% 透明度、故障段红色、新计划绿色 */
export const replanRoutes: MapRoute[] = [
  { id: 'old-1', nodes: ['丁', '丙'], color: '#ff3d52', glow: 2.4, width: .05, vehicles: 1, stopped: true },
  { id: 'old-2', nodes: ['丙', '乙'], color: '#7d8896', glow: .35, opacity: .25, vehicles: 0 },
  { id: 'new-1', nodes: ['丁', '戊'], color: '#28d17c', glow: 2.2, width: .05, vehicles: 1 },
  { id: 'new-2', nodes: ['戊', '乙'], color: '#28d17c', glow: 2.2, width: .05, vehicles: 1 },
];

/* ---------- 11 实验结果 ---------- */

export const researchResults = {
  structured: {
    title: '约束已经结构化时',
    headline: '增量 0',
    metric: { label: '采购收益增量', value: '0.0000' },
    finding: '当约束已经结构化时，大模型没有产生额外采购收益。',
    detail: '在结构化输入条件下，是否接入大模型对最终采购结果没有影响。这说明模型的价值不来自"再算一遍已经算清楚的东西"。',
  },
  language: {
    title: '约束来自自由业务语言时',
    metric: { label: '约束满足率', before: 82.05, after: 99.93, unit: '%' },
    recall: { label: '硬约束召回率', before: 80.0, after: 99.93, unit: '%' },
    arms: { before: 'Strong No-LLM', after: 'Locked LLM' },
    finding: '同一批自由业务语言订单，先经过语言层锁定约束再交给确定性系统，硬约束漏读基本消失。',
  },
  downstream: {
    title: '下游计划质量',
    metric: { label: 'Downstream J', before: 20.0, after: 17.5547, lowerIsBetter: true },
    finding: '下游计划代价同步下降；该指标越低越好。',
  },
  oneLiner: 'AI 的主要价值发生在非结构化业务语言进入确定性系统之前。',
  criteria: [
    { id: 'B2', verdict: 'PASS', note: '采用修订后的判定标准（Amended Criterion）', tone: 'green' as const, detail: '在语言层锁定约束的条件下，硬约束召回从 80.00% 提升到 99.93%，该判定按修订后的标准成立。' },
    { id: 'C2', verdict: 'FAIL', note: 'AI 恢复方案未优于人工恢复方案', tone: 'amber' as const, detail: '在异常恢复场景中，AI 生成的恢复方案没有表现出相对人工恢复方案的优势（成本 +0.7572、时效 +0.644 小时）。该结论如实保留，不用"降本增效"式表述替代。' },
  ],
};
