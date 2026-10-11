import { ArrowRight, ArrowLeftRight, Check, CircleAlert, GitCompareArrows, Route, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Panel, ActionButton, Status } from '../components/shared';
import { LogisticsMap } from '../scene/logistics-map';
import { exceptionEvent, hubNetwork, replanCompare, replanRoutes } from '../exception-fixtures';

export default function ReplanPage() {
  const navigate = useNavigate();
  const { before, after, metrics, statement, boundary } = replanCompare;

  return <div className="lg-replan-shell">
    <Panel className="lg-replan-compare" title="方案对照" subtitle="原计划 → 中断事件 → 重新生成的计划" icon={ArrowLeftRight}>
      <div className="lg-replan-stages">
        <article className="lg-replan-stage is-old">
          <span className="lg-replan-stage-tag">OLD PLAN</span>
          <strong className="lg-replan-stage-route">{before.nodes.join(' → ')}</strong>
          <ul>
            <li>共 {before.legs} 段干线运输</li>
            <li>第 1 段由 {exceptionEvent.vehicle.plate} 承运</li>
            <li>状态：<b className="is-bad">已中断</b></li>
          </ul>
        </article>

        <span className="lg-replan-arrow" aria-hidden="true"><ArrowRight size={18} /></span>

        <article className="lg-replan-stage is-event">
          <span className="lg-replan-stage-tag">EVENT</span>
          <strong className="lg-replan-stage-route">{exceptionEvent.kind}</strong>
          <ul>
            <li>触发段：{exceptionEvent.affectedLeg.from} → {exceptionEvent.affectedLeg.to}</li>
            <li>{exceptionEvent.vehicle.fault}</li>
            <li>状态：<b className="is-bad">不可执行</b></li>
          </ul>
        </article>

        <span className="lg-replan-arrow" aria-hidden="true"><ArrowRight size={18} /></span>

        <article className="lg-replan-stage is-new">
          <span className="lg-replan-stage-tag">NEW PLAN</span>
          <strong className="lg-replan-stage-route">{after.nodes.join(' → ')}</strong>
          <ul>
            <li>共 {after.legs} 段干线运输</li>
            <li>中转枢纽由 丙 替换为 戊</li>
            <li>状态：<b className="is-good">可执行</b></li>
          </ul>
        </article>
      </div>
    </Panel>

    <div className="lg-replan-grid">
      <Panel title="新旧路线对照" subtitle="旧计划已弱化显示 · 故障段红色 · 新计划绿色" icon={Route} className="lg-replan-map">
        <LogisticsMap routes={replanRoutes} nodes={hubNetwork} view="compare" />
        <div className="lg-net-legend">
          <span><i className="lg-net-dot is-old" />原计划（已中断）</span>
          <span><i className="lg-net-dot is-fault" />故障段</span>
          <span><i className="lg-net-dot is-new" />新计划</span>
        </div>
      </Panel>

      <Panel title="重新规划结果" subtitle="以原计划为基线的新计划变化" icon={GitCompareArrows} className="lg-replan-metrics">
        <dl className="lg-replan-metric-list">
          {metrics.map((metric) => <div key={metric.key} className={`lg-replan-metric is-${metric.trend}`}>
            <dt>{metric.label}<small>{metric.note}</small></dt>
            <dd>{metric.delta}{metric.unit}</dd>
            <Status tone={metric.trend === 'hold' ? 'green' : 'amber'}>{metric.trend === 'hold' ? '未恶化' : '上升'}</Status>
          </div>)}
        </dl>

        <div className="lg-replan-statement">
          <ShieldAlert size={15} />
          <p>{statement}</p>
        </div>
        <p className="lg-replan-boundary"><CircleAlert size={13} />{boundary}</p>

        <div className="lg-replan-actions">
          <ActionButton onClick={() => navigate('/frontend/results')}>查看实验结果<ArrowRight size={15} /></ActionButton>
          <ActionButton variant="outline" onClick={() => navigate('/frontend/exceptions')}>返回异常事件</ActionButton>
        </div>
      </Panel>
    </div>

    <footer className="lg-replan-footnote">
      <Check size={13} />
      <span>Synthetic Mechanism Walkthrough · 枢纽编号为本地合成网络的匿名标识，仅用于演示异常恢复机制，不代表真实承运承诺。</span>
    </footer>
  </div>;
}
