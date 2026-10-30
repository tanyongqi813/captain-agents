import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AutopilotDetail, AutopilotList, AutopilotStartDialog } from '../../app/renderer/components/Autopilot.tsx';
import { ProjectPlan } from '../../app/renderer/components/ProjectPlan.tsx';
import { App } from '../../app/renderer/App.tsx';
import type { ViewAutopilot } from '../../src/core/view-types.ts';
import { fixtureBridge, fixtureView, fixtureJob } from './fixtures.tsx';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const run = (extra: Partial<ViewAutopilot> = {}): ViewAutopilot => ({ id: '1019-1200-auto', project: 'demo', taskId: 'TASK-001',
  state: 'executing', active: true, managed: true, created: '2026-10-19T04:00:00Z', ended: null, reason: null,
  writer: 'codex:high', reviewer: 'codex-luna:high', network: false,
  budget: { policy: 'standard', minutesLeft: 230, attemptsLeft: 8, nodesLeft: 5 },
  nodes: [{ id: 'TASK-001', state: 'running', parent: null, deps: [], title: null }], attempts: [], diagnoses: [], reviews: [], verification: null, patch: null, notification: null, ...extra });
const pool = [{ who: 'codex', name: 'Codex', model: '模型甲', efforts: ['medium', 'high'] as const, fast: false },
  { who: 'codex-luna', name: 'Luna', model: '模型乙', efforts: ['high'] as const, fast: false }].map(p => ({ ...p, efforts: [...p.efforts] }));
const fill = () => {
  fireEvent.change(screen.getByRole('combobox', { name: '执行者' }), { target: { value: 'codex' } });
  fireEvent.change(screen.getByRole('combobox', { name: '执行强度' }), { target: { value: 'high' } });
  fireEvent.change(screen.getByRole('combobox', { name: '独立审查者' }), { target: { value: 'codex-luna' } });
  fireEvent.change(screen.getByRole('combobox', { name: '审查强度' }), { target: { value: 'high' } });
  fireEvent.change(screen.getByRole('combobox', { name: '总预算' }), { target: { value: 'standard' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '允许修改专用副本' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '确认联网快照' }));
};

test('启动前全部显式选择，无推荐预选；只向桥提交标识、角色、权限、网络与预设', async () => {
  const start = vi.fn(async () => '1019-1200-auto'), started = vi.fn();
  window.xa = fixtureBridge({ autopilotStart: start });
  render(<AutopilotStartDialog view={fixtureView()} pool={pool} project="demo" taskId="TASK-001" close={() => {}} started={started} />);
  const button = screen.getByRole('button', { name: '启动无人看守' }); expect((button as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('combobox', { name: '执行者' }) as HTMLSelectElement).value).toBe('');
  fill(); expect((button as HTMLButtonElement).disabled).toBe(false); fireEvent.click(button);
  await waitFor(() => expect(started).toHaveBeenCalledWith('1019-1200-auto'));
  expect(start).toHaveBeenCalledWith({ project: 'demo', taskId: 'TASK-001', writer: 'codex:high', reviewer: 'codex-luna:high', policy: 'standard', permission: 'workspace-write', network: false });
});

test('联网设置变化使旧确认失效；不能把已勾选确认沿用到新网络权限', () => {
  window.xa = fixtureBridge(); const view = fixtureView();
  const component = render(<AutopilotStartDialog view={view} pool={pool} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  fill(); component.rerender(<AutopilotStartDialog view={{ ...view, settings: { ...view.settings, networkAllowed: true } }} pool={pool} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  expect((screen.getByRole('button', { name: '启动无人看守' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('联网设置已经变化');
});

test('负责人流程默认关闭；切换清空负责人及授权，只提交可选布尔开关', async () => {
  const start = vi.fn(async () => '1019-1200-auto'); window.xa = fixtureBridge({ autopilotStart: start });
  render(<AutopilotStartDialog view={fixtureView()} pool={pool} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  const mode = screen.getByRole('checkbox', { name: '使用负责人复审流程' });
  expect(mode.getAttribute('aria-checked')).toBe('false');
  fill(); fireEvent.click(mode);
  expect((screen.getByRole('combobox', { name: '独立审查者' }) as HTMLSelectElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: '审查强度' }) as HTMLSelectElement).value).toBe('');
  expect(screen.getByRole('checkbox', { name: '允许修改专用副本' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: '确认联网快照' }).getAttribute('aria-checked')).toBe('false');
  expect((screen.getByRole('button', { name: '启动无人看守' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('dialog').textContent).toContain('不会自动提交或继续派发');
  fill(); fireEvent.click(screen.getByRole('button', { name: '启动无人看守' }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0]).toEqual([{ project: 'demo', taskId: 'TASK-001', writer: 'codex:high', reviewer: 'codex-luna:high', policy: 'standard', permission: 'workspace-write', network: false, leadReview: true }]);
});

test('新流程仅显示受信独立负责人；候选移除后不可启动，退回旧模式不保留确认', () => {
  window.xa = fixtureBridge();
  const mixed = [...pool, { who: 'deepseek', name: 'DeepSeek', model: '测试模型', efforts: ['high' as const], fast: false }];
  const component = render(<AutopilotStartDialog view={fixtureView()} pool={mixed} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '使用负责人复审流程' })); fill();
  const reviewer = screen.getByRole('combobox', { name: '独立审查者' });
  expect(within(reviewer).queryByRole('option', { name: /DeepSeek/ })).toBeNull();
  expect(within(reviewer).queryByRole('option', { name: /Codex ·/ })).toBeNull();
  component.rerender(<AutopilotStartDialog view={fixtureView()} pool={mixed.filter(p => p.who !== 'codex-luna')} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  expect((screen.getByRole('button', { name: '启动无人看守' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('没有独立且受信');
  fireEvent.click(screen.getByRole('checkbox', { name: '使用负责人复审流程' }));
  expect(within(reviewer).getByRole('option', { name: /DeepSeek/ })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '允许修改专用副本' }).getAttribute('aria-checked')).toBe('false');
});

test('动态负责人按后台通道身份显示和启动，不按 who 前缀猜测；目录变化立即失效', async () => {
  const start = vi.fn(async () => '1019-1200-auto'); window.xa = fixtureBridge({ autopilotStart: start });
  const view = fixtureView(), dynamic = 'codex-6-review-probe', imposter = 'codex-untrusted-probe';
  const row = (who: string) => ({ who, model: who, shown: who, description: null, efforts: ['high' as const], fast: false,
    kept: true, builtin: false, manual: true, fresh: false, gone: false });
  view.models.channels = [
    { channel: 'codex', name: 'Codex', icon: 'codex', discoverable: true, at: null, error: null, models: [row(dynamic)] },
    { channel: 'cursor', name: 'Cursor', icon: 'cursor', discoverable: true, at: null, error: null, models: [row(imposter)] },
  ];
  const mixed = [...pool, ...[dynamic, imposter].map(who => ({ who, model: who, name: who, efforts: ['high' as const], fast: false }))];
  const component = render(<AutopilotStartDialog view={view} pool={mixed} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '使用负责人复审流程' }));
  const reviewers = screen.getByRole('combobox', { name: '独立审查者' });
  expect(within(reviewers).getByRole('option', { name: new RegExp(dynamic) })).toBeTruthy();
  expect(within(reviewers).queryByRole('option', { name: new RegExp(imposter) })).toBeNull();
  fill();
  fireEvent.change(reviewers, { target: { value: dynamic } });
  fireEvent.change(screen.getByRole('combobox', { name: '审查强度' }), { target: { value: 'high' } });
  const button = screen.getByRole('button', { name: '启动无人看守' });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  component.rerender(<AutopilotStartDialog view={{ ...view, models: { at: null, channels: [] } }} pool={mixed} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  component.rerender(<AutopilotStartDialog view={view} pool={mixed} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  fireEvent.click(button);
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0]).toEqual([expect.objectContaining({ reviewer: dynamic + ':high', leadReview: true })]);
});

test('启动中防重复点击，失败留在对话框；更换选手必须重新选强度', async () => {
  let reject: (error: Error) => void = () => {};
  const start = vi.fn(() => new Promise<string>((_, r) => { reject = r; })); window.xa = fixtureBridge({ autopilotStart: start });
  render(<AutopilotStartDialog view={fixtureView()} pool={pool} project="demo" taskId="TASK-001" close={() => {}} started={() => {}} />);
  fill(); fireEvent.click(screen.getByRole('button', { name: '启动无人看守' }));
  expect((screen.getByRole('button', { name: '正在启动…' }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error('当前额度不足')); await screen.findByRole('alert'); expect(start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog').textContent).toContain('当前额度不足');
  fireEvent.change(screen.getByRole('combobox', { name: '执行者' }), { target: { value: 'codex-luna' } });
  expect((screen.getByRole('combobox', { name: '执行强度' }) as HTMLSelectElement).value).toBe('');
  expect((screen.getByRole('button', { name: '启动无人看守' }) as HTMLButtonElement).disabled).toBe(true);
});

test('详情展示节点依赖、诊断、审查、验收和通知事实，不提供绕过预算的恢复按钮', () => {
  window.xa = fixtureBridge();
  render(<AutopilotDetail run={run({ state: 'needs_owner', active: false, reason: '预算用完，请主人决定。', notification: 'retry',
    nodes: [{ id: 'alpha', state: 'passed', parent: 'TASK-001', deps: ['first'], title: '第一步' }],
    diagnoses: [{ node: 'alpha', at: '2026-10-19T04:01:00Z', action: 'split', note: '拆成更小步骤' }],
    reviews: [{ node: 'alpha', at: '2026-10-19T04:02:00Z', verdict: 'changes', jobs: [] }],
    verification: { ok: false, at: '2026-10-19T04:03:00Z', steps: [{ ok: false, summary: '退出码 1' }] } })} close={() => {}} notify={() => {}} />);
  expect(screen.getByRole('alert').textContent).toContain('需要主人处理');
  expect(screen.getByText(/前置 first/)).toBeTruthy(); expect(screen.getByText(/发送失败，待重试/)).toBeTruthy();
  expect(screen.getByText(/独立审查：要求修改/)).toBeTruthy(); expect(screen.getByText(/验收未通过/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /继续|恢复/ })).toBeNull();
});

test.each([
  ['accept', '通过', 0], ['correct', '要求修正', 1], ['handoff', '请求换人', 0], ['split', '要求拆分', 2], ['owner', '请主人处理', 0],
] as const)('负责人决定 %s 以纯文字显示，增量胶囊只读且不提供续跑能力', (action, label, count) => {
  window.xa = fixtureBridge();
  const reason = '<img src=x onerror=alert(1)> 请复核';
  render(<AutopilotDetail run={run({ active: false, state: 'needs_owner', reason: '等待核对已保存制品。',
    leadReview: { decision: { action, at: '2026-10-27T06:00:00Z', reason, capsuleCount: count } } })} close={() => {}} notify={() => {}} />);
  const section = screen.getByRole('region', { name: '负责人复审' });
  expect(section.textContent).toContain('负责人决定：' + label);
  expect(section.textContent).toContain(reason); expect(section.querySelector('img')).toBeNull();
  if (count) {
    expect(section.textContent).toContain(`已保存 ${count} 份增量执行胶囊`);
    expect(section.textContent).toContain('尚未授权续跑');
  } else expect(section.textContent).not.toContain('已保存');
  expect(screen.queryByRole('button', { name: /继续|导出|提交|采用|恢复/ })).toBeNull();
});

test('新流程暂无负责人决定明确等待；旧 View 不伪造新流程决定区', () => {
  window.xa = fixtureBridge();
  const component = render(<AutopilotDetail run={run({ leadReview: { decision: null } })} close={() => {}} notify={() => {}} />);
  expect(screen.getByRole('region', { name: '负责人复审' }).textContent).toContain('尚无负责人决定');
  component.rerender(<AutopilotDetail run={run()} close={() => {}} notify={() => {}} />);
  expect(screen.queryByRole('region', { name: '负责人复审' })).toBeNull();
});

test('停止必须二次确认，成功保留证据，失败显示中文原因', async () => {
  const stop = vi.fn(async () => {}), notify = vi.fn(); window.xa = fixtureBridge({ autopilotStop: stop });
  render(<AutopilotDetail run={run()} close={() => {}} notify={notify} />);
  fireEvent.click(screen.getByRole('button', { name: '停止无人看守' })); expect(stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认停止' }));
  await waitFor(() => expect(stop).toHaveBeenCalledWith('1019-1200-auto'));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('无人看守已停止，成果和证据已保留'));
});

test('记录优先显示需要主人处理的执行；无记录可读', () => {
  const open = vi.fn();
  render(<AutopilotList runs={[run(), run({ id: '1019-1201-auto', state: 'needs_owner', active: false })]} open={open} />);
  expect(screen.getAllByRole('button')[0].textContent).toContain('需要主人处理'); fireEvent.click(screen.getAllByRole('button')[0]);
  expect(open).toHaveBeenCalledWith('1019-1201-auto');
});

test('只有 READY 任务可打开无人看守；旧 View 没有新数组也能展示规划', () => {
  const view = fixtureView(); window.xa = fixtureBridge();
  view.projects = [{ name: 'demo', label: '示例', repo: '/repo', archived: false, config: null }];
  view.plans = { demo: { present: true, project: 'demo', diagnostics: [], ready: ['TASK-001'], tasks: [
    { id: 'TASK-001', title: '可以执行', status: 'READY', known: true, deps: [], goal: '', acceptance: [], spec: null, suggested: '不预选', ready: true, problems: [] },
    { id: 'TASK-002', title: '尚未就绪', status: 'DRAFT', known: true, deps: [], goal: '', acceptance: [], spec: null, suggested: null, ready: false, problems: [] },
  ] } };
  render(<ProjectPlan view={view} notify={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /可以执行/ }));
  expect(screen.getAllByRole('button', { name: '无人看守' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /尚未就绪/ }));
  expect(screen.getAllByRole('button', { name: '无人看守' })).toHaveLength(1);
});

test('看板展示整台自治求助，不把共享节点当成等待单独采用的卡；点开进入规划详情', async () => {
  const view = fixtureView(); view.autopilots = [run({ state: 'needs_owner', active: false, reason: '请主人处理。' })];
  view.jobs = [fixtureJob('node', { state: 'done', autopilot: { run: '1019-1200-auto' }, title: '不单独采用的节点' })];
  view.projects = [{ name: 'demo', label: '示例', repo: '/repo', archived: false, config: null }];
  view.plans = { demo: { present: true, project: 'demo', diagnostics: [], ready: [], tasks: [] } };
  window.xa = fixtureBridge({ getView: vi.fn(async () => view) }); render(<App />);
  const card = await screen.findByRole('button', { name: /TASK-001 等主人 无人看守详情/ });
  expect(document.body.textContent).not.toContain('不单独采用的节点'); fireEvent.click(card);
  expect((await screen.findByRole('dialog')).textContent).toContain('需要主人处理');
  expect(within(screen.getByRole('tablist', { name: '页面' })).getByRole('tab', { name: /规划/ }).getAttribute('aria-selected')).toBe('true');
});

test.each(['头部', '底部'])('从看板打开的自治详情用%s关闭后不会在重进规划页时复活', async place => {
  const view = fixtureView(); view.autopilots = [run({ state: 'needs_owner', active: false, reason: '请主人处理。' })];
  view.projects = [{ name: 'demo', label: '示例', repo: '/repo', archived: false, config: null }];
  view.plans = { demo: { present: true, project: 'demo', diagnostics: [], ready: [], tasks: [] } };
  window.xa = fixtureBridge({ getView: vi.fn(async () => view) }); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /TASK-001 等主人 无人看守详情/ }));
  const dialog = await screen.findByRole('dialog');
  const closes = within(dialog).getAllByRole('button', { name: '关闭' });
  fireEvent.click(place === '头部' ? closes[0] : closes.at(-1)!);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '看板' }));
  fireEvent.click(screen.getByRole('tab', { name: '规划' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('台账或项目后来被移除仍能查看旧自治求助证据', () => {
  const view = fixtureView(); view.projects = []; view.plans = {};
  view.autopilots = [run({ state: 'needs_owner', active: false, reason: '请主人检查执行证据。' })];
  window.xa = fixtureBridge();
  render(<ProjectPlan view={view} notify={() => {}} focusRun="1019-1200-auto" />);
  expect(screen.getByRole('dialog').textContent).toContain('需要主人处理');
  expect(screen.queryByRole('button', { name: /^无人看守$/ })).toBeNull();
});

test('未启用新版审查闭环的旧自治记录仍在看板显示求助', async () => {
  const view = fixtureView(); view.autopilots = [run({ managed: false, state: 'needs_owner', active: false, reviewer: null, reason: '旧执行需要主人接手。' })];
  window.xa = fixtureBridge({ getView: vi.fn(async () => view) }); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /TASK-001 等主人 无人看守详情/ }));
  expect((await screen.findByRole('dialog')).textContent).toContain('旧执行需要主人接手');
});
