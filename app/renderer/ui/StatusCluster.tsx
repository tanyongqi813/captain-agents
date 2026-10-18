import type { QuotaStop } from '../../../src/core/settings.ts';
import type { View } from '../../../src/core/view-types.ts';
import { quotaLevel, quotaTip, topBar } from '../lib/quota.ts';
import { QuotaRing } from './QuotaRing.tsx';
import { WorkerIcon } from './WorkerIdentity.tsx';
import { isWindows } from './platform.ts';

const CHECK = { true: ['隔离正常', 'done'], false: ['隔离自检没过', 'failed'], null: ['还没自检', 'queued'] } as const;
// 顶栏右边的状态块：看板数据里有几家额度就画几个环（中心是厂家图标，旁边写百分比；一家都没有时不画）+ 隔离自检小圆点。整块是一个按钮，点一下去“各家表现”；
// 悬停整块看各家详情（厂家、各池百分比、数据时间）和自检原文；圆点上单独写自检原文。
export function StatusCluster({ quota, connected = [], selfcheck, onOpen, stop }: { quota: View['quota']; connected?: { name: string; icon: string }[]; selfcheck: View['selfcheck']; onOpen: () => void; stop?: QuotaStop }) {
  // Windows 上加固是可选的：没装、没过都照样能派活，小圆点不报警，只说明现在用的是哪一种保护。
  const [text, tone] = isWindows && selfcheck.ok !== true ? ['用的是 Codex 自带的保护，没装加固', 'queued'] as const : CHECK[String(selfcheck.ok) as keyof typeof CHECK];
  const tip = [...quota.map(q => `${q.name}${q.plan ? `（${q.plan}）` : ''}\n${quotaTip(q)}`), ...connected.map(p => `${p.name}\n已接入，暂无可查询额度`), `${text}\n${selfcheck.note}`].join('\n\n');
  return <button type="button" className="status" aria-label="各家额度、已接入 AI 和隔离自检，点开看各家表现" title={tip} onClick={onOpen}>
    {quota.map(q => {
      const top = topBar(q), used = top?.used ?? null;
      // 环旁写百分比，一眼能读；快用完时数字和环一起变色。
      return <span className="quota-item" key={q.name} data-level={quotaLevel(used, stop) || undefined}>
        <QuotaRing used={used} stop={stop} label={`${q.name}：${top && used != null ? `${top.label}已用 ${top.approx ? '不到 ' : ''}${used}%` : '查不到额度'}`}><WorkerIcon name={q.icon} size="sm" /></QuotaRing>
        <span className="quota-pct" aria-hidden="true">{used == null ? '—' : `${top?.approx ? '<' : ''}${used}%`}</span>
      </span>;
    })}
    {connected.map(p => <span className="connected-item" key={p.icon} title={`${p.name}：已接入，暂无可查询额度`}><WorkerIcon name={p.icon} size="sm" label={`${p.name}：已接入，暂无可查询额度`} /></span>)}
    <span className={'dot dot-' + tone} role="img" aria-label={text} title={selfcheck.note} />
  </button>;
}
