import { Box, Clock3, GitBranch, Route, ShieldCheck, TriangleAlert } from 'lucide-react';
import performance from '../../../../../artifacts/judge-evidence/performance.json';
import localRevision from '../../../../../artifacts/judge-evidence/integrity-and-local-revision.json';
import algorithmEvidence from '../../../../../artifacts/judge-evidence/phase-2f/COMPARISON-ABC.json';
import { money } from './components';
import { useCityProduct } from './state';

export function VerifiedComparison(){
 const p=useCityProduct();
 const records=['order-blocked','order-repair','order-reuse'].map(name=>performance.cases.find(c=>c.case===name)!);
 const moved=(record:typeof records[number])=>record.result.revision.changedCargoIds?.length??0;
 return <section className="p-verified-evidence"><header><div><span>已复核机制对照 · 四店16件</span><h2>同一顺序下，原货位与修订货位的差异</h2></div><ShieldCheck size={23}/></header>
  <p>前两列使用同一批订单、同一出发时间和 S01 → S02 → S04 → S03 顺序；第三列检验原顺序的布局复用。</p>
  <div className="p-table-scroll"><table><thead><tr><th>实际检查结果</th><th>只检查原货位</th><th>允许分区修订</th><th>原順序布局复用</th></tr></thead><tbody>
   <tr><th>可执行性</th>{records.map(r=><td key={r.case} className={r.result.executable?'is-good':'is-warn'}>{r.result.executable?'当前规则下可执行':'首站取货受阻'}</td>)}</tr>
   <tr><th>路线 / 计划费用</th>{records.map(r=><td key={r.case}>{r.result.routes[0].distanceKm} km / ¥{money(r.result.totals.totalCost)}{!r.result.executable&&<small>不可执行计划名义费用</small>}</td>)}</tr>
   <tr><th>实际改变货位</th>{records.map(r=><td key={r.case}>{moved(r)} 件</td>)}</tr>
   <tr><th>请求响应中位数</th>{records.map(r=><td key={r.case}>{r.medianMs.toFixed(2)} ms</td>)}</tr>
   <tr><th>未完成卸货门店</th>{records.map(r=><td key={r.case}>{r.result.executable?'0':'4'} 家<small>步骤重放结果，非现场配送</small></td>)}</tr>
  </tbody></table></div>
  <div className="p-evidence-boundary"><Clock3 size={17}/><span>2026-10-10 本机实测；每类5次顺序请求，包含请求传输和检查，不含三维绘图。</span></div>
  <details><summary>对照范围和未验证项</summary><p>货位修订仅搜索四个既有门店分区的24种排列，保持内部支撑、朝向和横向位置。已复核 {localRevision.orders.length} 种门店顺序；不表示全局最少搬动。</p><p>尚无独立的“普通路线规划”与“独立装箱修复”算法对照，不能据此宣称优于全部传统方法。资源占用仅观测计算服务，不证明生产规模。</p></details>
  {p.mode==='fleet'&&<small>这一组是四店机制对照，不是九店三车的算法降本证据。</small>}
 </section>;
}

export function CurrentDecisionComparison(){
 const p=useCityProduct();if(!p.revision)return null;
 const revision=p.revision;
 const original='submittedCheck' in revision?revision.submittedCheck:null;
 const before=original?.totals??('originalLayoutCheck' in revision?{distanceKm:revision.originalLayoutCheck.distanceKm,totalCost:revision.originalLayoutCheck.costs.totalCost,totalDurationMinutes:revision.originalLayoutCheck.totalDurationMinutes}:null);
 const result='submittedCheck' in revision?revision.result.totals:{distanceKm:revision.result.distanceKm,totalCost:revision.result.costs.totalCost,totalDurationMinutes:revision.result.totalDurationMinutes};
 if(!before)return null;
 return <section className="p-current-evidence"><header><div><span>本次实际提交与检查</span><h2>{revision.executable?'本次修订的业务影响':'当前条件仍需调整'}</h2></div>{revision.executable?<ShieldCheck size={21}/>:<TriangleAlert size={21}/>}</header><div>
  <span>路线<strong>{before.distanceKm} → {result.distanceKm} km</strong></span><span>计划费用<strong>¥{money(before.totalCost)} → ¥{money(result.totalCost)}</strong></span><span>最长计划时长<strong>{before.totalDurationMinutes} → {result.totalDurationMinutes} 分钟</strong></span>
  {'originalLayoutCheck' in revision&&<span>修订货物<strong>{revision.revision.changedCargoIds.length} 件</strong></span>}
 </div><p>原提交不可执行时，费用仅为名义推演。检查通过后仍须人工确认采用；实际重装工时费用未计入。</p></section>;
}

export function AlgorithmComparison(){
 const p=useCityProduct();
 const rows=(algorithmEvidence.rows as Array<any>);
 const scenarios=[...new Set(rows.map(row=>row.scenarioId))].map(id=>({id,rows:rows.filter(row=>row.scenarioId===id)}));
 return <section className="p-verified-evidence p-algorithm-evidence"><header><div><span>实际运行的算法策略对照</span><h2>路线、货位和车辆反馈是否改变可执行性</h2></div><ShieldCheck size={23}/></header><p>同一输入、同一费用口径、同一 2000 ms 预算。A/B/C 均由后端真实运行；失败方法不显示名义费用。</p><div className="p-table-scroll"><table><thead><tr><th>场景</th><th>A · 路线优先</th><th>B · 固定路线修货位</th><th>C · 联合反馈</th></tr></thead><tbody>{scenarios.map(s=>{const by=(name:string)=>s.rows.filter(r=>r.strategy===name);const cell=(name:string)=>{const group=by(name);const ok=group.filter(r=>r.feasible).length;const cost=group.find(r=>r.actualPlanCost!==null)?.actualPlanCost;const median=group.length?Math.round(group.reduce((n,r)=>n+r.functionWallMs,0)/group.length*100)/100:null;return <td className={ok?'is-good':'is-warn'}>{ok}/{group.length} 可执行{cost!==null&&cost!==undefined?<small>¥{money(cost)} · {median} ms</small>:<small>成本不可比较 · {median} ms</small>}</td>};return <tr key={s.id}><th>{s.id}<small>同输入重复 3 次</small></th>{cell('route-first')}{cell('layout-repair')}{cell('joint-feedback')}</tr>})}</tbody></table></div><div className="p-evidence-boundary"><Clock3 size={17}/><span>仅三个合成实例，每种方法三次；只说明当前有限搜索边界内的结果，不代表企业收益或全局最优。</span></div>{p.mode==='standard'&&p.standardResponse&&<div className="p-current-evidence"><header><div><span>当前导入场景</span><h2>{p.standardResponse.solverStatus==='FEASIBLE'?'已找到待确认计划':'当前请求未找到可执行计划'}</h2></div>{p.standardResponse.solverStatus==='FEASIBLE'?<ShieldCheck size={21}/>:<TriangleAlert size={21}/>}</header><div><span>策略<strong>{p.standardResponse.strategy}</strong></span><span>状态<strong>{p.standardResponse.solverStatus}</strong></span><span>计算<strong>{p.standardResponse.timing?.overallComputeMs??'—'} ms</strong></span><span>成本<strong>{p.standardResponse.actualExecutablePlanCost===null?'不可比较':`¥${money(p.standardResponse.actualExecutablePlanCost)}`}</strong></span></div><p>这是当前请求的结果，不是历史实验结果；确认后才能导出。</p></div>}</section>;
}

export function StrategyRibbon(){
 return <section className="p-strategy-ribbon" aria-label="三种规划策略">
  <div className="p-strategy-ribbon-head"><div><span>决策机制</span><h2>路线先定，还是让装载反过来改路线？</h2></div><small>同一订单 · 同一车辆 · 同一约束</small></div>
  <div className="p-strategy-ribbon-items">
   <article><span className="p-strategy-index">A</span><Route size={18}/><div><strong>路线优先</strong><p>先找访问顺序，再检查车厢。</p></div><small>快 · 可能装不下</small></article>
   <article><span className="p-strategy-index">B</span><Box size={18}/><div><strong>固定路线修货位</strong><p>路线不动，只尝试有限布局。</p></div><small>保守 · 不换车</small></article>
   <article className="is-featured"><span className="p-strategy-index">C</span><GitBranch size={18}/><div><strong>路线与装载联动</strong><p>冲突反馈到车辆和访问顺序。</p></div><small>当前主方法</small></article>
  </div>
 </section>;
}
