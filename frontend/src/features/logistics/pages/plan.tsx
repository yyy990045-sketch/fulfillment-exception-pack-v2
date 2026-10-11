import { useState } from 'react';
import { Bell, CalendarDays, Check, Download, FileText, MapPinned, Pencil, Printer, Upload } from 'lucide-react';
import { Panel, ActionButton, Status } from '../components/shared';
import { LogisticsMap } from '../scene/logistics-map';
import { solutions, money } from '../fixtures';
import { useLogistics } from '../logistics-provider';

const events = [
  ['10-05 08:00', '成都 装货完成', '已确认'],
  ['10-05 14:00', '成都 出发', '已确认'],
  ['10-06 14:00', '长沙 到达', '待执行'],
  ['10-06 16:00', '长沙 中转发车', '待执行'],
  ['10-06 22:00', '武汉 到达', '待执行'],
  ['10-07 02:00', '武汉 中转发车', '待执行'],
  ['10-07 06:00', '嘉兴 预计到达', '待执行'],
] as const;

export default function PlanPage() {
  const { state, dispatch, notify } = useLogistics();
  const solution = solutions.find((item) => item.id === state.selectedSolution) ?? solutions[0]!;
  const [edit, setEdit] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="lg-plan-shell">
      <Panel className="lg-plan-hero">
        <div className="lg-plan-order">
          <h2># {state.order.id} <Status tone={state.submitted ? 'green' : 'amber'}>{state.submitted ? '执行中' : '待下单'}</Status></h2>
          <p>从 {state.order.origin} 发往 {state.order.destination} · 方案 {solution.id}</p>
        </div>
        <div className="lg-plan-stat"><dt>运输模式</dt><dd>公路 + 中转</dd></div>
        <div className="lg-plan-stat"><dt>计划总里程</dt><dd>1,920 km</dd></div>
        <div className="lg-plan-stat"><dt>预计时效</dt><dd>{solution.hours} 小时</dd></div>
        <div className="lg-plan-stat"><dt>总成本</dt><dd>{money(solution.cost)}</dd></div>
        <div className="lg-plan-stat"><dt>当前方案</dt><dd>{solution.name} <Status tone="green">推荐</Status></dd></div>
      </Panel>
      <div className="lg-plan-actions">
        <ActionButton variant="outline" onClick={() => window.print()}><Printer size={15}/>打印计划单</ActionButton>
        <ActionButton variant="outline" onClick={() => notify('浏览器将打开打印对话框，可选择另存为 PDF')}><Download size={15}/>下载 PDF</ActionButton>
        <ActionButton
          onClick={() => { dispatch({ type: 'confirm' }); dispatch({ type: 'submit' }); notify('演示计划已确认，执行监控已启动。'); }}
          disabled={state.submitted || !state.negotiated}
        ><Check size={15}/>确认下单并执行 <span>→</span></ActionButton>
      </div>
      <div className="lg-plan-grid">
        <Panel title="运输路线与节点" subtitle="地图视图 · 本地合成路径" icon={MapPinned} className="lg-plan-map">
          <LogisticsMap routes={[{ id: solution.id, nodes: solution.nodes, color: '#008cff', active: true, vehicles: 3 }]} />
        </Panel>
        <Panel title="计划时间线" subtitle="各节点预计执行时间" icon={CalendarDays}>
          <div className="lg-timeline">
            {events.map(([time, label, status], index) => (
              <div className={`lg-timeline-item ${index < 2 ? 'is-done' : ''}`} key={label}>
                <span className="lg-timeline-dot">{index < 2 ? <Check size={12}/> : index + 1}</span>
                <div><strong>{label}</strong><p>{status === '已确认' ? '计划已确认' : status}</p></div>
                <time>{time}</time>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="计划详情" icon={FileText} actions={<ActionButton variant="outline" size="sm" onClick={() => setEdit(true)}><Pencil size={14}/>编辑计划</ActionButton>}>
          <div className="lg-plan-detail">
            <h3>基础信息</h3>
            <dl className="lg-detail-list">
              <div><dt>订单编号</dt><dd>{state.order.id}</dd></div><div><dt>客户</dt><dd>嘉兴-成都</dd></div>
              <div><dt>货物类型</dt><dd>{state.order.cargo}</dd></div><div><dt>重量</dt><dd>{state.order.weight} 吨</dd></div>
              <div><dt>中转要求</dt><dd>最多 {state.order.maxTransfers} 次</dd></div><div><dt>特殊要求</dt><dd>{state.order.handling}</dd></div>
            </dl>
            <h3>承运信息</h3>
            <p className="lg-detail-copy">嘉兴-武汉专线（承运商 A）<br/>联系人：王经理　138 **** 8877<br/>车辆：厢式货车 · 司机张师傅</p>
            <h3>费用明细</h3>
            <dl className="lg-cost-list"><div><dt>运输费用</dt><dd>{money(10800)}</dd></div><div><dt>中转费用</dt><dd>{money(1200)}</dd></div><div><dt>其他费用</dt><dd>{money(400)}</dd></div><div><dt>总计</dt><dd>{money(solution.cost)}</dd></div></dl>
          </div>
        </Panel>
      </div>
      <Panel title="相关单据" subtitle="本地选择与预览，不会上传到服务器" icon={FileText} actions={<label className="lg-upload-button"><Upload size={14}/>上传文件<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label>}>
        <div className="lg-docs">
          {['运输合同.pdf', '报价单.pdf', '运输计划单.pdf', '承运商资质.pdf', '货物信息.pdf'].map((name) => <div className="lg-doc" key={name}><FileText size={21}/><strong>{name}</strong><small>{name === '报价单.pdf' ? '1.8 MB' : '2.4 MB'}</small><Status tone="green">已生成</Status></div>)}
          <div className="lg-doc lg-doc-upload">{file ? <><Check size={24}/><strong>{file.name}</strong><small>仅本地已选择</small></> : <><Upload size={24}/><strong>上传文件</strong><small>支持 PDF / Word / Excel</small></>}</div>
        </div>
      </Panel>
      <Panel title="协同通知" icon={Bell}><div className="lg-notifications"><p><Status tone="green">已通知</Status> 承运商 A · 运输计划已发送，承运商已确认接单</p><p><Status tone="green">已通知</Status> 中转仓 · 武汉中转计划已同步</p><p><Status tone="amber">待通知</Status> 保险公司 · 下单后自动发送</p></div></Panel>
      {edit && <div className="lg-inline-note"><Pencil size={14}/>编辑模式仅展示入口，演示计划确认后请重新从订单约束计算方案。<button type="button" onClick={() => setEdit(false)}>关闭</button></div>}
    </div>
  );
}
