import { AlertTriangle, ArrowRight, Clock3, FileText, Gauge, Route, Truck, Wallet, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Panel, ActionButton, Status } from '../components/shared';
import { LogisticsMap } from '../scene/logistics-map';
import { exceptionEvent, exceptionRoutes, hubNetwork } from '../exception-fixtures';
import { useLogistics } from '../logistics-provider';

export default function ExceptionsPage() {
  const navigate = useNavigate();
  const { state } = useLogistics();
  const event = exceptionEvent;

  return <div className="lg-exception-grid">
    <Panel
      title="运输网络当前状态"
      subtitle={`原计划 ${event.planId} · 丁 → 丙 → 乙 · 第 1 段已中断`}
      icon={Route}
      className="lg-exception-map"
    >
      <LogisticsMap routes={exceptionRoutes} nodes={hubNetwork} />
      <div className="lg-net-legend">
        <span><i className="lg-net-dot is-normal" />可继续执行</span>
        <span><i className="lg-net-dot is-fault" />故障段 · 不能继续</span>
        <span><i className="lg-net-dot is-stop" />故障车辆已停驻</span>
      </div>
    </Panel>

    <Panel title="异常摘要" subtitle={`事件 ${event.id}`} icon={AlertTriangle} className="lg-exception-side">
      <div className="lg-exception-head">
        <span className="lg-exception-mark"><AlertTriangle size={17} /></span>
        <div>
          <h3>{event.kind} · {event.title}</h3>
          <p>{event.summary}</p>
        </div>
        <Status tone="red">待处置</Status>
      </div>

      <dl className="lg-exception-facts">
        <div><dt>关联订单</dt><dd>{state.order.id}</dd></div>
        <div><dt>运输计划</dt><dd>{event.planId}</dd></div>
        <div><dt>上报时间</dt><dd>{event.reportedAt}</dd></div>
        <div><dt>异常编号</dt><dd>{event.id}</dd></div>
      </dl>

      <section className="lg-exception-block">
        <h4><Wrench size={13} />车辆故障</h4>
        <dl className="lg-exception-list">
          <div><dt>车辆</dt><dd>{event.vehicle.plate}</dd></div>
          <div><dt>司机</dt><dd>{event.vehicle.driver}</dd></div>
          <div><dt>故障</dt><dd>{event.vehicle.fault}</dd></div>
          <div><dt>位置</dt><dd>{event.vehicle.position}</dd></div>
          <div><dt>当前状态</dt><dd>{event.vehicle.status}</dd></div>
        </dl>
      </section>

      <section className="lg-exception-block">
        <h4><Route size={13} />影响运输段</h4>
        <div className="lg-leg-list">
          <div className="is-fault">
            <strong>丁 → 丙</strong>
            <small>第 {event.affectedLeg.index} 段 · 共 {event.affectedLeg.total} 段</small>
            <Status tone="red">不能继续执行</Status>
          </div>
          <div>
            <strong>丙 → 乙</strong>
            <small>第 2 段 · 共 {event.affectedLeg.total} 段</small>
            <Status tone="amber">等待前序恢复</Status>
          </div>
        </div>
      </section>

      <section className="lg-exception-block">
        <h4><Clock3 size={13} />SLA 风险</h4>
        <div className="lg-exception-line">
          <Clock3 size={14} />
          <span className="lg-line-text">原定送达窗口 {event.sla.window}</span>
          <Status tone="red">风险 {event.sla.level}</Status>
        </div>
        <p className="lg-exception-note">{event.sla.risk}</p>
      </section>

      <section className="lg-exception-block">
        <h4><Wallet size={13} />成本影响</h4>
        <div className="lg-exception-line">
          <Gauge size={14} />
          <span className="lg-line-text">{event.cost.note}</span>
        </div>
        <p className="lg-exception-note">具体增量：{event.cost.range}</p>
      </section>

      <section className="lg-exception-block">
        <h4><FileText size={13} />事件原文</h4>
        <blockquote className="lg-exception-quote">{event.rawText}</blockquote>
      </section>

      <div className="lg-exception-actions">
        <ActionButton onClick={() => navigate('/frontend/replan')}>重新规划<ArrowRight size={15} /></ActionButton>
        <ActionButton variant="outline" onClick={() => navigate('/frontend/execution')}><Truck size={15} />返回执行监控</ActionButton>
      </div>
    </Panel>
  </div>;
}
