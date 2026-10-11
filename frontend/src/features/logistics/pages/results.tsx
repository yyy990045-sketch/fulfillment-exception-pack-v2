import { useState } from 'react';
import { ArrowLeft, BadgeCheck, BookOpen, FlaskConical, Info, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Panel, ActionButton, Status } from '../components/shared';
import { researchResults } from '../exception-fixtures';

const num = (value: number, digits: number) => value.toFixed(digits);

export default function ResultsPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { structured, language, downstream, oneLiner, criteria } = researchResults;

  return <div className="lg-results-shell">
    <Panel className="lg-results-hero" title="三类输入条件下的对照结果" subtitle="AI 到底在什么地方有价值 · 本地合成研究口径" icon={FlaskConical}>
      <p className="lg-results-lead">同一套确定性采购与计划系统，在三类输入条件下分别对照「不接入大模型」与「接入大模型并锁定约束」。</p>

      <div className="lg-results-blocks">
        <article className="lg-results-block">
          <header><Minus size={15} /><span>{structured.title}</span><em className="lg-results-tag">{structured.headline}</em></header>
          <dl className="lg-results-metric">
            <div><dt>{structured.metric.label}</dt><dd><b className="is-flat">{structured.metric.value}</b></dd></div>
          </dl>
          <p>{structured.finding}</p>
        </article>

        <article className="lg-results-block is-key">
          <header><TrendingUp size={15} /><span>{language.title}</span></header>
          <dl className="lg-results-metric">
            <div>
              <dt>{language.metric.label}</dt>
              <dd><span className="is-was">{num(language.metric.before, 2)}{language.metric.unit}</span><b className="is-good">{num(language.metric.after, 2)}{language.metric.unit}</b></dd>
            </div>
            <div>
              <dt>{language.recall.label}</dt>
              <dd><span className="is-was">{num(language.recall.before, 2)}{language.recall.unit}</span><b className="is-good">{num(language.recall.after, 2)}{language.recall.unit}</b></dd>
            </div>
          </dl>
          <p className="lg-results-arms">{language.arms.before} → {language.arms.after}</p>
          <p>{language.finding}</p>
        </article>

        <article className="lg-results-block">
          <header><TrendingDown size={15} /><span>{downstream.title}</span></header>
          <dl className="lg-results-metric">
            <div>
              <dt>{downstream.metric.label}<small>Lower is better</small></dt>
              <dd><span className="is-was">{num(downstream.metric.before, 4)}</span><b className="is-good">{num(downstream.metric.after, 4)}</b></dd>
            </div>
          </dl>
          <p>{downstream.finding}</p>
        </article>
      </div>

      <div className="lg-results-oneliner">
        <BadgeCheck size={17} />
        <strong>{oneLiner}</strong>
      </div>
    </Panel>

    <Panel className="lg-results-boundary" title="研究口径与边界" subtitle="哪些结论成立，哪些不成立" icon={BookOpen}>
      <div className="lg-results-criteria">
        {criteria.map((item) => <div key={item.id} className={`lg-criterion is-${item.tone}`}>
          <strong>{item.id}</strong>
          <Status tone={item.tone}>{item.verdict}</Status>
          <span className="lg-criterion-note">{item.note}</span>
        </div>)}
      </div>
      <ul className="lg-results-limits">
        <li>数据为本地合成研究数据集，不是客户生产数据；结论只在当前实验设定下成立。</li>
        <li>结构化输入条件下的增量 0 与恢复场景的 C2 未通过，均为如实保留的负面结果。</li>
        <li>本页面向研究复核，不进入 30 秒业务演示动线。</li>
      </ul>
      <div className="lg-results-actions">
        <ActionButton onClick={() => setOpen(true)}><Info size={15} />查看详情</ActionButton>
        <ActionButton variant="outline" onClick={() => navigate('/frontend/replan')}><ArrowLeft size={15} />返回重新规划</ActionButton>
      </div>
    </Panel>

    <footer className="lg-results-footnote">Synthetic Research · 本页为研究结论页，指标口径与判定规则随研究记录一并存档</footer>

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="logistics-theme lg-dialog">
        <DialogHeader>
          <DialogTitle>研究结论与判定详情</DialogTitle>
          <DialogDescription>本地合成研究口径，不含客户数据，也不构成对外承诺。</DialogDescription>
        </DialogHeader>
        <div className="lg-results-detail">
          <section>
            <h4>{structured.title}</h4>
            <p>{structured.detail}</p>
          </section>
          <section>
            <h4>{language.title}</h4>
            <p>对照组 {language.arms.before}：{language.metric.label} {num(language.metric.before, 2)}{language.metric.unit}，{language.recall.label} {num(language.recall.before, 2)}{language.recall.unit}。实验组 {language.arms.after}：{language.metric.label} {num(language.metric.after, 2)}{language.metric.unit}，{language.recall.label} {num(language.recall.after, 2)}{language.recall.unit}。</p>
          </section>
          <section>
            <h4>{downstream.title}</h4>
            <p>{downstream.metric.label} 由 {num(downstream.metric.before, 4)} 降至 {num(downstream.metric.after, 4)}；该指标越低越好。</p>
          </section>
          {criteria.map((item) => <section key={item.id}>
            <h4>{item.id} · {item.verdict}（{item.note}）</h4>
            <p>{item.detail}</p>
          </section>)}
        </div>
        <ActionButton onClick={() => setOpen(false)}>关闭</ActionButton>
      </DialogContent>
    </Dialog>
  </div>;
}
