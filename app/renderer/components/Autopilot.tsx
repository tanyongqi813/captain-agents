import { useState } from 'react';
import type { View, ViewAutopilot } from '../../../src/core/view-types.ts';
import type { Effort } from '../../../src/core/roster.ts';
import { isWho, vendorOf } from '../../../src/core/roster.ts';
import { effortNames } from '../../../src/core/policy.ts';
import { stateNames } from '../../../src/core/autopilot-state.ts';
import { Button, CheckDot, Chip, EmptyState, Modal, Select, SettingGroup, SettingRow } from '../ui/index.ts';
import { errorReason } from '../lib/errors.ts';
import { fmtTime } from '../lib/board.ts';
import type { AutopilotInput } from '../../shared/ipc.ts';

type Candidate = { who: string; name: string; model: string; efforts: Effort[]; fast: boolean };
const presets = [
  { id: '', label: '请选择预算' }, { id: 'short', label: '短任务：60 分钟 / 4 次调用 / 3 节点' },
  { id: 'standard', label: '标准：240 分钟 / 10 次调用 / 6 节点' }, { id: 'long', label: '长任务：480 分钟 / 16 次调用 / 10 节点' },
];
const notificationNames = { pending: '已排队（需连接飞书且应用在线）', delivered: '已送达', handled: '已处理', expired: '事件已过期',
  retry: '发送失败，待重试', paused: '连接需检查', exhausted: '自动重试已用完，请检查连接', unknown: '通知状态未知' };
const nodeNames: Record<string, string> = { pending: '待执行', running: '执行中', passed: '已通过', failed: '未通过', split: '已细拆' };
const outcomeNames: Record<string, string> = { done: '执行结束', failed: '未完成', blocked: '被拦下', pass: '通过', changes: '要求修改', unclear: '结论不明确' };
const actionNames: Record<string, string> = { continue: '保留成果续做', retry: '从已确认起点重试', split: '细拆子任务', verify: '转验收', owner: '请主人决定' };

export function AutopilotStartDialog({ view, pool, project, taskId, close, started }: {
  view: View; pool: Candidate[]; project: string; taskId: string; close(): void; started(id: string): void;
}) {
  const [writer, setWriter] = useState(''), [reviewer, setReviewer] = useState('');
  const [we, setWe] = useState(''), [re, setRe] = useState('');
  const [wf, setWf] = useState(false), [rf, setRf] = useState(false);
  const [leadReview, setLeadReview] = useState(false);
  const [permission, setPermission] = useState(false), [network, setNetwork] = useState(false), [policy, setPolicy] = useState('');
  const [networkSnapshot] = useState(view.settings.networkAllowed);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writerRow = pool.find(p => p.who === writer), reviewRow = pool.find(p => p.who === reviewer);
  const trusted = (who: string) => {
    // 动态模型身份来自后台当前目录；旧 View 没有该条目时仅兼容内置名单，不能按名字猜通道。
    const channel = view.models?.channels.find(c => c.models.some(m => m.who === who));
    if (channel) return channel.channel === 'codex' && channel.models.some(m => m.who === who && m.kept);
    return isWho(who) && vendorOf(who) === 'codex';
  };
  const reviewerPool = pool.filter(p => p.who !== writer && (!leadReview || trusted(p.who)));
  const knownNetwork = typeof networkSnapshot === 'boolean';
  const networkChanged = networkSnapshot !== view.settings.networkAllowed;
  const ready = !!writerRow && !!reviewRow && writer !== reviewer && writerRow.efforts.includes(we as Effort)
    && reviewRow.efforts.includes(re as Effort) && !!policy && permission && network && knownNetwork && !networkChanged
    && (!wf || writerRow.fast) && (!rf || reviewRow.fast) && (!leadReview || trusted(reviewer));
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const id = await window.xa.autopilotStart({ project, taskId, writer: `${writer}:${we}${wf ? ':fast' : ''}`,
        reviewer: `${reviewer}:${re}${rf ? ':fast' : ''}`, policy: policy as AutopilotInput['policy'],
        permission: 'workspace-write', network: networkSnapshot!, ...(leadReview ? { leadReview: true } : {}) });
      started(id);
    } catch (e) { setError('没能启动：' + errorReason(e)); }
    finally { setBusy(false); }
  };
  const choices = [{ id: '', label: '请选择选手' }, ...pool.map(p => ({ id: p.who, label: `${p.name} · ${p.model}` }))];
  const strengths = (row: Candidate | undefined) => [{ id: '', label: '请选择强度' }, ...(row?.efforts ?? []).map(id => ({ id, label: effortNames[id] }))];
  return <Modal label={`无人看守 ${taskId}`} title={`无人看守 ${taskId}`} size="sm" onClose={() => { if (!busy) close(); }}
    footer={<><span className="faint">所有选项都需明确确认</span><span className="step"><Button size="sm" disabled={busy} onClick={close}>取消</Button>
      <Button size="sm" variant="primary" disabled={!ready || busy} onClick={() => void send()}>{busy ? '正在启动…' : '启动无人看守'}</Button></span></>}>
    <p className="sub">{leadReview
      ? '执行者按当前执行胶囊工作，由 Codex 负责人复审后验收。返工或拆分会保存增量胶囊并暂停，不会自动提交或继续派发。执行和复审共用总预算。'
      : '执行、诊断和独立审查共用总预算。通过后仍需负责人采用补丁，不自动改主分支或规划文档。'}</p>
    <fieldset disabled={busy} className="settings">
      <p className="crow"><CheckDot label="使用负责人复审流程" checked={leadReview} onChange={value => {
        setLeadReview(value); setReviewer(''); setRe(''); setRf(false); setPermission(false); setNetwork(false); setError('');
      }} />使用负责人复审流程（试用，默认关闭）</p>
      <SettingGroup>
        <SettingRow title="执行者"><Select label="执行者" value={writer} items={choices} onChange={v => { setWriter(v); setWe(''); setWf(false); }} /></SettingRow>
        <SettingRow title="执行强度"><Select label="执行强度" value={we} items={strengths(writerRow)} onChange={setWe} disabled={!writerRow} /></SettingRow>
        {writerRow?.fast && <SettingRow title="执行者快速版"><CheckDot label="执行者快速版" checked={wf} onChange={setWf} /></SettingRow>}
        <SettingRow title="独立审查者"><Select label="独立审查者" value={reviewer} items={[{ id: '', label: leadReview ? '请选择受信负责人' : '请选择选手' }, ...reviewerPool.map(p => ({ id: p.who, label: `${p.name} · ${p.model}` }))]} onChange={v => { setReviewer(v); setRe(''); setRf(false); }} /></SettingRow>
        <SettingRow title="审查强度"><Select label="审查强度" value={re} items={strengths(reviewRow)} onChange={setRe} disabled={!reviewRow} /></SettingRow>
        {reviewRow?.fast && <SettingRow title="审查者快速版"><CheckDot label="审查者快速版" checked={rf} onChange={setRf} /></SettingRow>}
        <SettingRow title="总预算"><Select label="总预算" value={policy} items={presets} onChange={setPolicy} /></SettingRow>
      </SettingGroup>
      <p className="crow"><CheckDot label="允许修改专用副本" checked={permission} onChange={setPermission} />允许执行者修改专用副本；审查者始终只读</p>
      <p className="crow"><CheckDot label="确认联网快照" checked={network} onChange={setNetwork} />确认本次按当前设置：{knownNetwork ? networkSnapshot ? '允许联网' : '不联网' : '联网设置尚未读取，请关闭后刷新'}</p>
    </fieldset>
    {writer && reviewer === writer && <p role="alert">执行者和审查者必须是不同选手。</p>}
    {pool.length < 2 && <p className="notice notice-warn">请先在设置中启用至少两位可用选手，才能进行独立审查。</p>}
    {leadReview && !reviewerPool.length && <p role="alert" className="notice notice-warn">当前没有独立且受信的 Codex 负责人，请先在设置中启用；不会自动更换通道。</p>}
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
    {networkChanged && <p role="alert" className="notice notice-warn">联网设置已经变化，请关闭后重新确认。</p>}
  </Modal>;
}

export function AutopilotCard({ run, open }: { run: ViewAutopilot; open(id: string): void }) {
  return <button type="button" className="panel autopilot-card" onClick={() => open(run.id)} aria-label={`${run.taskId} ${stateNames[run.state]} 无人看守详情`}>
    <span className="crow"><b>{run.taskId} · 无人看守</b><Chip tone={run.state === 'needs_owner' ? 'warn' : 'neutral'}>{run.state === 'needs_owner' ? '需要主人处理' : stateNames[run.state]}</Chip></span>
    <span className="muted">{run.project} · {run.id}</span>
    {run.reason && <span className="muted">{run.reason}</span>}
    <span className="faint">剩余 {run.budget.minutesLeft} 分钟 / {run.budget.attemptsLeft} 次调用</span>
  </button>;
}
export function AutopilotList({ runs, open }: { runs: ViewAutopilot[]; open(id: string): void }) {
  return <section><h2>无人看守记录</h2>{runs.length ? <div className="hgroup">{[...runs].sort((a, b) => Number(b.state === 'needs_owner') - Number(a.state === 'needs_owner') || Number(b.active) - Number(a.active) || b.created.localeCompare(a.created)).map(run => <AutopilotCard key={run.id} run={run} open={open} />)}</div>
    : <EmptyState>还没有无人看守记录。</EmptyState>}</section>;
}

export function AutopilotDetail({ run, close, notify, openJob }: { run: ViewAutopilot; close(): void; notify(text: string): void; openJob?(id: string): void }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const stop = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await window.xa.autopilotStop(run.id); setConfirm(false); notify('无人看守已停止，成果和证据已保留'); }
    catch (e) { setError('没能停止：' + errorReason(e)); }
    finally { setBusy(false); }
  };
  const jobs = (ids: string[]) => ids.map(id => openJob ? <Button key={id} size="sm" onClick={() => { close(); openJob(id); }}>任务证据 {id}</Button> : <span key={id} className="num">{id}</span>);
  const timeline = [...run.attempts.map(a => ({ at: a.at, key: `a:${a.node}:${a.attempt}`, text: `${a.node} 第 ${a.attempt} 次：${outcomeNames[a.outcome ?? ''] ?? '等待结果'}`, jobs: a.jobs })),
    ...run.diagnoses.map((d, i) => ({ at: d.at, key: `d:${i}`, text: `${d.node} 诊断：${actionNames[d.action ?? ''] ?? '等待结果'}${d.note ? ` · ${d.note}` : ''}`, jobs: [] as string[] })),
    ...run.reviews.map((r, i) => ({ at: r.at, key: `r:${i}`, text: `${r.node} 独立审查：${outcomeNames[r.verdict ?? ''] ?? '等待结果'}`, jobs: r.jobs }))].sort((a, b) => a.at.localeCompare(b.at));
  return <Modal label={`无人看守详情 ${run.id}`} title={`${run.taskId} · ${stateNames[run.state]}`} onClose={() => { if (!busy) close(); }} footer={<>
    <span className="faint">完成不等于合并，负责人仍需采用成果</span><span className="step"><Button size="sm" onClick={close} disabled={busy}>关闭</Button>
      {run.active && <Button size="sm" onClick={() => setConfirm(true)} disabled={busy}>停止无人看守</Button>}</span></>}>
    <p className="muted">{run.project} · {run.id} · {fmtTime(run.created, true)}</p>
    {run.state === 'needs_owner' && <p role="alert" className="notice notice-warn">需要主人处理：{run.reason ?? '请检查执行证据。'}</p>}
    {run.reason && run.state !== 'needs_owner' && <p role="status">{run.reason}</p>}
    <p>执行者：{run.writer} · 审查者：{run.reviewer ?? '旧记录未选择'} · {run.network ? '允许联网' : '不联网'}</p>
    <p>剩余预算：{run.budget.minutesLeft} 分钟 / {run.budget.attemptsLeft} 次 AI 调用 / {run.budget.nodesLeft} 个新节点</p>
    {run.notification && <p role="status">飞书通知：{notificationNames[run.notification]}</p>}
    <h3>步骤与依赖</h3><ul>{run.nodes.map(node => <li key={node.id}>{node.id}{node.title ? ` · ${node.title}` : ''}：{nodeNames[node.state] ?? node.state}
      {node.parent ? `（拆自 ${node.parent}）` : ''}{node.deps.length ? ` · 前置 ${node.deps.join('、')}` : ''}</li>)}</ul>
    <h3>执行证据</h3>{timeline.length ? <ol>{timeline.map(event => <li key={event.key}><span className="faint">{fmtTime(event.at, true)} </span>{event.text}<div className="step">{jobs(event.jobs)}</div></li>)}</ol> : <p className="faint">暂无尝试记录。</p>}
    <h3>最终验收</h3>{run.verification ? <><p>{run.verification.ok ? '验收通过' : '验收未通过'} · {fmtTime(run.verification.at, true)}</p><ul>{run.verification.steps.map((step, i) => <li key={i}>{step.ok ? '通过' : '未通过'}：{step.summary}</li>)}</ul></> : <p className="faint">尚未完成登记验收。</p>}
    {run.patch && <p className="faint">已接受补丁快照：<span className="num">{run.patch.slice(0, 16)}</span></p>}
    {confirm && <div role="group" aria-label="停止确认" className="notice notice-warn"><p>停止推进器和当前选手？现有成果和证据会保留，不会清空主工作区。</p><div className="step"><Button size="sm" disabled={busy} onClick={() => setConfirm(false)}>返回</Button>
      <Button size="sm" disabled={busy} onClick={() => void stop()}>{busy ? '正在停止…' : '确认停止'}</Button></div></div>}
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
  </Modal>;
}
