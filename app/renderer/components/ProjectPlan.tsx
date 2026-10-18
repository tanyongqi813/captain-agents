import { useState } from 'react';
import type { View } from '../../../src/core/view-types.ts';
import type { PlanTask, TaskPlan } from '../../../src/core/task-plan.ts';
import type { Effort } from '../../../src/core/roster.ts';
import { effortNames } from '../../../src/core/policy.ts';
import { errorReason } from '../lib/errors.ts';
import { Button, CheckDot, Chip, EmptyState, Modal, SideNavLayout, WorkerIcon } from '../ui/index.ts';

// 规划页（docs/ui-spec.md 第 19 节，TASK-006）：按项目展示任务台账，只有真正可执行的 READY 任务能发起派发。
// 数据只来自 View.plans，界面不读文件、不解析 Markdown；推荐执行者只是淡字展示，绝不预选选手。
// 派发前主人必须分别显式选好：选手、每位选手的强度、读写权限——三样齐全才允许派发。

const PROJECT_KEY = 'xa.plan-project';
const readScope = (): string => { try { return window.localStorage.getItem(PROJECT_KEY) ?? ''; } catch { return ''; } };
const rememberScope = (name: string) => { try { window.localStorage.setItem(PROJECT_KEY, name); } catch { /* 记不住就算了 */ } };

// 当前可选选手：这台电脑名单里（View.roster）、主人设置里开着、且留有可用强度。
function candidates(view: View) {
  return view.roster.flatMap(row => {
    const policy = view.settings.workers[row.who];
    if (policy && !policy.enabled) return [];
    const efforts = row.efforts.filter(effort => !policy || policy.efforts.includes(effort));
    if (!efforts.length) return [];
    const meta = view.workers[row.who];
    return [{ who: row.who, name: meta?.name ?? row.who, model: row.model, icon: meta?.icon ?? 'codex',
      efforts, fast: row.fastSupported && (policy?.fast ?? false) }];
  });
}

// 每位选中的选手：强度和快速版都由主人逐项点，一开始都没有默认值。
type Pick = { effort: Effort | null; fast: boolean };
// 读写权限同样没有缺省：'' 表示还没选。
type Permission = '' | 'rw' | 'ro';

function DispatchDialog({ view, project, task, close, notify }: {
  view: View; project: string; task: PlanTask; close(): void; notify(text: string): void;
}) {
  const [picked, setPicked] = useState<Record<string, Pick>>({});
  const [permission, setPermission] = useState<Permission>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pool = candidates(view);
  const chosen = Object.keys(picked);
  const noEffort = chosen.filter(who => !picked[who].effort);
  const ready = chosen.length > 0 && !noEffort.length && permission !== '';
  // 还差什么，写在底栏：主人不用猜“派发”为什么灰着。
  const missing = !chosen.length ? '还要选至少一位选手'
    : noEffort.length ? `还要选 ${noEffort.map(who => pool.find(row => row.who === who)?.name ?? who).join('、')} 的强度`
    : permission === '' ? '还要选读写权限' : '';
  const toggle = (who: string) => setPicked(current => {
    if (current[who]) { const next = { ...current }; delete next[who]; return next; }
    return pool.some(row => row.who === who) ? { ...current, [who]: { effort: null, fast: false } } : current;
  });
  const setEffort = (who: string, effort: Effort) => setPicked(current => ({ ...current, [who]: { ...current[who], effort } }));
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const who = chosen.map(item => `${item}:${picked[item].effort}${picked[item].fast ? ':fast' : ''}`);
      await window.xa.planDispatch({ project, taskId: task.id, who, ...(permission === 'ro' ? { ro: true } : {}) });
      close();
      notify(`已派发 ${task.id} 给 ${who.length} 位选手`);
    } catch (e) { setError('没能派发：' + errorReason(e)); }
    finally { setBusy(false); }
  };
  return <Modal label={`派发 ${task.id}`} title={`派发 ${task.id}`} size="sm" onClose={() => { if (!busy) close(); }}
    footer={<><span className="faint">{missing || '派发后任务仍显示 READY，等负责人评审更新规划'}</span><span className="step">
      <Button size="sm" onClick={close} disabled={busy}>取消</Button>
      <Button size="sm" variant="primary" disabled={!ready || busy} onClick={() => void send()}>{busy ? '正在派发…' : '派发'}</Button>
    </span></>}>
    <div className="plan-form">
      <p className="plan-form-title">{task.title}</p>
      {task.goal && <p>{task.goal}</p>}
      {!!task.acceptance.length && <div className="plan-accept"><span className="muted">验收标准</span>{task.acceptance.map((item, i) => <p key={i}>{i + 1}. {item}</p>)}</div>}
      {task.spec && <p className="faint">来自 {task.spec}，内容已按长度截断。</p>}
      <div className="plan-pick">
        <span className="muted">选手（至少选一位）</span>
        {pool.length === 0 && <p className="faint">设置里没有开着且能用的选手，请先去“设置 → 选手与模型”打开一位。</p>}
        {pool.map(row => {
          const pick = picked[row.who];
          return <div key={row.who} className={'plan-pick-row' + (pick ? ' on' : '')}>
            <CheckDot label={`选择 ${row.name}`} checked={!!pick} onChange={() => toggle(row.who)} />
            <WorkerIcon name={row.icon} />
            <span className="plan-pick-name">{row.name}<span className="faint"> {row.model}</span></span>
            {pick && <span className="filters" role="group" aria-label={`${row.name} 的强度`}>
              {row.efforts.map(effort => <button key={effort} type="button" className={pick.effort === effort ? 'on' : ''} aria-pressed={pick.effort === effort}
                onClick={() => setEffort(row.who, effort)}>{effortNames[effort]}</button>)}
            </span>}
            {pick && row.fast && <span className="crow"><CheckDot label={`${row.name} 快速版`} checked={pick.fast} onChange={next => setPicked(current => ({ ...current, [row.who]: { ...current[row.who], fast: next } }))} /><span className="faint">快速版</span></span>}
          </div>;
        })}
      </div>
      <div className="plan-permission">
        <span className="muted">读写权限（必选）</span>
        <div className="filters" role="group" aria-label="读写权限">
          <button type="button" aria-pressed={permission === 'rw'} className={permission === 'rw' ? 'on' : ''}
            onClick={() => setPermission('rw')}>读写（副本可改）</button>
          <button type="button" aria-pressed={permission === 'ro'} className={permission === 'ro' ? 'on' : ''}
            onClick={() => setPermission('ro')}>只读（只看不改）</button>
        </div>
      </div>
      {error && <p role="alert" className="notice notice-bad">{error}</p>}
    </div>
  </Modal>;
}

function TaskRow({ plan, project, task, onDispatch }: { plan: TaskPlan; project: string; task: PlanTask; onDispatch(task: PlanTask): void }) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [specError, setSpecError] = useState('');
  const deps = task.deps.length ? task.deps.map(dep => {
    const target = plan.tasks.find(item => item.id === dep.id);
    const passed = target ? dep.accepted.includes(target.status) : false;
    return `${dep.id} ${passed ? '已通过' : target ? `未通过（${target.status}）` : '不在台账'}`;
  }).join(' · ') : '无前置';
  // 打开 Task Spec：只把项目名和规划里的仓库内相对路径交给桥，路径与文件由主进程按登记处解析（第 19 节）。
  const openSpec = async () => {
    if (!task.spec || opening) return;
    setOpening(true); setSpecError('');
    try { await window.xa.planOpenSpec({ project, spec: task.spec }); }
    catch (e) { setSpecError('没能打开 Task Spec：' + errorReason(e)); }
    finally { setOpening(false); }
  };
  return <div className="hrow">
    <button type="button" className="plan-sum" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="num plan-id">{task.id}</span>
      <span className="crow htitle"><span className="ellip">{task.title}</span></span>
      <span className="right">
        <Chip tone={task.known ? 'neutral' : 'bad'}>{task.status}</Chip>
        {task.ready ? <Chip tone="ok">可执行</Chip> : <span className="faint">{task.problems[0] ?? '不可派发'}</span>}
      </span>
    </button>
    <div className="plan-meta faint">前置：{deps}</div>
    {task.suggested && <div className="plan-meta faint">规划建议：{task.suggested}（工作台不会按此自动选选手）</div>}
    {open && <div className="plan-detail">
      {task.goal && <p>{task.goal}</p>}
      {!!task.acceptance.length && <div className="plan-accept">{task.acceptance.map((item, i) => <p key={i}>{i + 1}. {item}</p>)}</div>}
      {!task.ready && !!task.problems.length && <p className="notice notice-bad">{task.problems.join('；')}</p>}
      <div className="plan-actions">
        {task.spec && <Button size="sm" disabled={opening} onClick={() => void openSpec()}>{opening ? '正在打开…' : '打开 Task Spec'}</Button>}
        {task.ready && <Button size="sm" variant="primary" onClick={() => onDispatch(task)}>派发</Button>}
      </div>
      {task.spec && <p className="faint plan-spec-path">{task.spec}</p>}
      {specError && <p role="alert" className="notice notice-bad">{specError}</p>}
    </div>}
  </div>;
}

export function ProjectPlan({ view, notify }: { view: View; notify(text: string): void }) {
  const [scope, setScope] = useState(readScope);
  const [dispatching, setDispatching] = useState<PlanTask | null>(null);
  // 只列真的有任务台账（plan.present 为真，也就是仓库里确实有 docs/TASK_LIST.md）的已登记项目。
  const projects = view.projects.filter(project => view.plans[project.name]?.present === true);
  const current = projects.find(project => project.name === scope) ?? projects[0];
  const plan = current ? view.plans[current.name] : undefined;
  const choose = (name: string) => { setScope(name); rememberScope(name); };
  const items = projects.map(project => {
    const ready = view.plans[project.name]?.ready.length ?? 0, total = view.plans[project.name]?.tasks.length ?? 0;
    return { id: 'p:' + project.name, label: project.label, badge: ready,
      note: total ? (ready ? `${ready} 项可执行` : '没有可执行的') : '台账是空的' };
  });
  if (!projects.length) return <div className="page"><EmptyState>还没有带任务规划的项目</EmptyState>
    <p className="sub plan-empty-note">登记的项目里出现 docs/TASK_LIST.md 后会显示在这里。</p></div>;
  return <SideNavLayout className="plan-layout" label="项目" items={items} value={current ? 'p:' + current.name : ''} onChange={id => choose(id.slice(2))}>
    <div className="page"><h1>规划</h1>
      <p className="sub">{current?.label ?? ''} · 共 {plan?.tasks.length ?? 0} 项 · {plan?.ready.length ?? 0} 项可执行</p>
      {plan && plan.diagnostics.map((item, i) => <p key={i} role={item.level === 'error' ? 'alert' : 'status'}
        className={'notice ' + (item.level === 'error' ? 'notice-bad' : 'notice-warn')}>{item.message}</p>)}
      {plan && (plan.tasks.length
        ? <div className="panel hgroup">{plan.tasks.map(task => <TaskRow key={task.id} plan={plan} project={plan.project} task={task} onDispatch={setDispatching} />)}</div>
        : <EmptyState>任务台账里没有可识别的任务。</EmptyState>)}
      <p className="faint plan-foot">规划文档由负责人维护；任务做完后等待负责人评审、在文档里更新状态，工作台不会自动改。</p>
    </div>
    {dispatching && current && <DispatchDialog view={view} project={current.name} task={dispatching} close={() => setDispatching(null)} notify={notify} />}
  </SideNavLayout>;
}
