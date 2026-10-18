import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../app/renderer/App.tsx';
import type { View } from '../../src/core/view-types.ts';
import type { PlanTask, TaskPlan } from '../../src/core/task-plan.ts';
import type { XaBridge } from '../../app/shared/ipc.ts';
import { fixtureBridge, fixtureView } from './fixtures.tsx';

// 规划页（docs/ui-spec.md 第 19 节，docs/tasks/TASK-006.md）：只读展示任务台账，只有真正可执行的 READY 任务能派发。
// 派发前主人必须分别显式选好选手、每位选手的强度、读写权限——三样齐全之前“派发”都不能点。
// 推荐执行者只是淡字，绝不预选；Task Spec 只能走 planOpenSpec 这个受控入口打开。

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const task = (extra: Partial<PlanTask> = {}): PlanTask => ({
  id: 'TASK-002', title: '实现规划派发', status: 'READY', known: true, deps: [], goal: '让规划页能发起派活。',
  acceptance: ['只有可执行任务能派发。', '任务记录带 Task ID。'], spec: 'docs/tasks/TASK-002.md', suggested: null,
  ready: true, problems: [], ...extra,
});
const planFor = (tasks: PlanTask[], extra: Partial<TaskPlan> = {}): TaskPlan => ({
  present: true, project: 'alpha', tasks, ready: tasks.filter(item => item.ready).map(item => item.id), diagnostics: [], ...extra,
});
const absentPlan = (project: string): TaskPlan => ({ present: false, project, tasks: [], ready: [], diagnostics: [] });

function planView(plans: View['plans']): View {
  const view = fixtureView();
  view.projects = [
    { name: 'alpha', label: '甲项目', repo: '/repo/alpha', archived: false },
    { name: 'bare', label: '乙项目', repo: '/repo/bare', archived: false },
  ];
  view.plans = plans;
  return view;
}
async function openPlan(view: View, extra: Partial<XaBridge> = {}) {
  window.xa = fixtureBridge({ getView: vi.fn(async () => view), ...extra });
  render(<App />);
  fireEvent.click(await screen.findByRole('tab', { name: '规划' }));
}
// 一行任务：summary 本身是按钮（名字里有任务号、标题和状态），展开后的按钮和详情是它的兄弟，都在 .hrow 里。
const summary = async (id: string) => screen.findByRole('button', { name: new RegExp(id) });
const row = async (id: string) => (await summary(id)).closest('.hrow') as HTMLElement;
async function expand(id: string) { fireEvent.click(await summary(id)); }

test('一个带任务台账的项目都没有：整页一句空状态，说明文档放哪', async () => {
  await openPlan(planView({ bare: absentPlan('bare') }));
  expect(await screen.findByText('还没有带任务规划的项目')).toBeTruthy();
  expect(screen.getByText('登记的项目里出现 docs/TASK_LIST.md 后会显示在这里。')).toBeTruthy();
  expect(screen.queryByRole('tablist', { name: '项目' })).toBeNull();
});

test('左栏只列真的有任务台账的项目：登记了但没有 docs/TASK_LIST.md 的不进这一页', async () => {
  await openPlan(planView({ alpha: planFor([task()]), bare: absentPlan('bare') }));
  const nav = await screen.findByRole('tablist', { name: '项目' });
  expect(within(nav).getByText('甲项目')).toBeTruthy();
  expect(within(nav).queryByText('乙项目')).toBeNull();
  expect(within(nav).getByRole('tab').getAttribute('aria-selected')).toBe('true');
  expect(within(nav).getByText('1 项可执行')).toBeTruthy();
  // 右栏标题、件数和规划文件由负责人维护的那句提示。
  expect(screen.getByRole('heading', { name: '规划', level: 1 })).toBeTruthy();
  expect(screen.getByText('甲项目 · 共 1 项 · 1 项可执行')).toBeTruthy();
  expect(screen.getByText(/规划文档由负责人维护/)).toBeTruthy();
});

test('诊断照原样列在任务列表上方：error 是 alert、warn 是 status', async () => {
  await openPlan(planView({ alpha: planFor([task()], { diagnostics: [
    { level: 'error', message: 'TASK-002：Task Spec 缺少或无法解析“状态”字段，无法进入可执行队列。' },
    { level: 'warn', message: 'TASK-002：台账状态（READY）与 Task Spec 状态（PASSED）不一致，以 Task Spec 为准。' },
  ] }) }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('缺少或无法解析“状态”字段');
  expect(alert.className).toContain('notice-bad');
  const status = screen.getByRole('status');
  expect(status.textContent).toContain('以 Task Spec 为准');
  expect(status.className).toContain('notice-warn');
});

test('依赖写成“已通过 / 未通过 / 不在台账”；规划建议只是淡字，并明说不会按它选选手', async () => {
  await openPlan(planView({ alpha: planFor([
    task({ id: 'TASK-001', title: '底层任务', status: 'PASSED' }),
    task({ id: 'TASK-002', title: '还没通过的', status: 'READY' }),
    task({ id: 'TASK-003', title: '等前两个', deps: [{ id: 'TASK-001', accepted: ['PASSED'] }, { id: 'TASK-002', accepted: ['PASSED'] }, { id: 'TASK-009', accepted: ['PASSED'] }], ready: false, problems: ['TASK-003：前置任务 TASK-002 当前状态是 READY，尚未通过。'] }),
    task({ id: 'TASK-004', title: '有建议的', suggested: 'Kimi/Cursor' }),
  ]) }));
  expect(screen.getAllByText('前置：无前置').length).toBe(3);
  const deps = screen.getByText(/^前置：TASK-001 已通过/);
  expect(deps.textContent).toContain('TASK-001 已通过');
  expect(deps.textContent).toContain('TASK-002 未通过（READY）');
  expect(deps.textContent).toContain('TASK-009 不在台账');
  expect(screen.getByText('规划建议：Kimi/Cursor（工作台不会按此自动选选手）')).toBeTruthy();
});

test('不可派发的任务没有派发按钮；问题清单在展开后照实写出来', async () => {
  await openPlan(planView({ alpha: planFor([
    task({ id: 'TASK-001', title: '草稿任务', status: 'DRAFT', spec: null, ready: false, problems: ['TASK-001：DRAFT 不是 READY，无法进入可执行队列。'] }),
    task({ id: 'TASK-002', title: '格式坏掉的', status: '', known: false, spec: null, ready: false, problems: ['TASK-002：缺少 Task Spec（tasks/TASK-002.md），无法确认状态与依赖。'] }),
  ]) }));
  await expand('TASK-001');
  await expand('TASK-002');
  // 两个都不可派发：整页一个“派发”按钮也没有。
  expect(screen.queryByRole('button', { name: '派发' })).toBeNull();
  expect(screen.getAllByText('DRAFT 不是 READY，无法进入可执行队列。', { exact: false }).length).toBeGreaterThan(0);
  expect(screen.getAllByText('缺少 Task Spec（tasks/TASK-002.md），无法确认状态与依赖。', { exact: false }).length).toBeGreaterThan(0);
  // 没有 spec 可打开：连“打开 Task Spec”按钮都不出现。
  expect(screen.queryByRole('button', { name: '打开 Task Spec' })).toBeNull();
});

test('派发弹窗：选手、每位选手的强度、读写权限都从“没选”开始，选全之前派发不可点', async () => {
  const dispatch = vi.fn(async () => ['job-1']);
  await openPlan(planView({ alpha: planFor([task({ suggested: 'Kimi/Cursor' })]) }), { planDispatch: dispatch });
  await expand('TASK-002');
  fireEvent.click(within(await row('TASK-002')).getByRole('button', { name: '派发' }));
  const dialog = await screen.findByRole('dialog', { name: '派发 TASK-002' });
  const send = () => within(dialog).getByRole('button', { name: '派发' }) as HTMLButtonElement;

  // 一进来：没选手、没强度、没权限，派发灰着，并写清还差什么。
  expect(send().disabled).toBe(true);
  expect(within(dialog).getByText('还要选至少一位选手')).toBeTruthy();
  // 推荐执行者不预选：Kimi 的勾没打上，谁都没选中。
  expect(within(dialog).getAllByRole('checkbox').every(box => box.getAttribute('aria-checked') === 'false')).toBe(true);
  // 权限两项一开始都没选中。
  const permission = within(dialog).getByRole('group', { name: '读写权限' });
  expect(within(permission).getAllByRole('button').map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);

  // 只勾选手还不够：强度没选。
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '选择 Codex' }));
  expect(within(dialog).getByText('还要选 Codex 的强度')).toBeTruthy();
  const efforts = within(dialog).getByRole('group', { name: 'Codex 的强度' });
  expect(within(efforts).getAllByRole('button').map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
  expect(send().disabled).toBe(true);

  // 选了强度还不够：权限没选。
  fireEvent.click(within(efforts).getByRole('button', { name: '高档' }));
  expect(within(dialog).getByText('还要选读写权限')).toBeTruthy();
  expect(send().disabled).toBe(true);

  // 三样齐全才放行；这时底栏换成那句“等负责人评审”。
  fireEvent.click(within(permission).getByRole('button', { name: '读写（副本可改）' }));
  expect(send().disabled).toBe(false);
  expect(within(dialog).getByText('派发后任务仍显示 READY，等负责人评审更新规划')).toBeTruthy();
  expect(dispatch).not.toHaveBeenCalled();
});

test('派发成功：交出选手、强度、只读开关和显式选择的结果，关弹窗并提示；界面不改任务状态', async () => {
  const dispatch = vi.fn(async () => ['job-1', 'job-2']);
  await openPlan(planView({ alpha: planFor([task()]) }), { planDispatch: dispatch });
  await expand('TASK-002');
  fireEvent.click(within(await row('TASK-002')).getByRole('button', { name: '派发' }));
  const dialog = await screen.findByRole('dialog', { name: '派发 TASK-002' });
  // 两位选手，各自点不同的强度；权限选只读。
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '选择 Codex' }));
  fireEvent.click(within(within(dialog).getByRole('group', { name: 'Codex 的强度' })).getByRole('button', { name: '超高档' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '选择 Grok' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Grok 快速版' }));
  fireEvent.click(within(within(dialog).getByRole('group', { name: 'Grok 的强度' })).getByRole('button', { name: '中档' }));
  fireEvent.click(within(within(dialog).getByRole('group', { name: '读写权限' })).getByRole('button', { name: '只读（只看不改）' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '派发' }));
  await screen.findByText('已派发 TASK-002 给 2 位选手');
  expect(dispatch).toHaveBeenCalledWith({ project: 'alpha', taskId: 'TASK-002', who: ['codex:xhigh', 'grok:medium:fast'], ro: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  // 派发后任务仍显示 READY：界面自己不改状态，等后台发布的新 View。
  expect(screen.getAllByText('可执行').length).toBe(1);
});

test('派发失败：弹窗留着，照实写后台给的中文原因', async () => {
  const dispatch = vi.fn(async () => { throw new Error('隔离自检没过，不能派活：codex 未能自检。'); });
  await openPlan(planView({ alpha: planFor([task()]) }), { planDispatch: dispatch });
  await expand('TASK-002');
  fireEvent.click(within(await row('TASK-002')).getByRole('button', { name: '派发' }));
  const dialog = await screen.findByRole('dialog', { name: '派发 TASK-002' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '选择 Codex' }));
  fireEvent.click(within(within(dialog).getByRole('group', { name: 'Codex 的强度' })).getByRole('button', { name: '高档' }));
  fireEvent.click(within(within(dialog).getByRole('group', { name: '读写权限' })).getByRole('button', { name: '读写（副本可改）' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '派发' }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).toBe('没能派发：隔离自检没过，不能派活：codex 未能自检。');
  expect(screen.getByRole('dialog', { name: '派发 TASK-002' })).toBeTruthy();
});

test('打开 Task Spec：只交项目名和规划里的仓库内相对路径，绝不交绝对路径', async () => {
  const open = vi.fn(async () => {});
  await openPlan(planView({ alpha: planFor([task()]) }), { planOpenSpec: open });
  await expand('TASK-002');
  fireEvent.click(screen.getByRole('button', { name: '打开 Task Spec' }));
  expect(open).toHaveBeenCalledWith({ project: 'alpha', spec: 'docs/tasks/TASK-002.md' });
  const payload = (open.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(['project', 'spec']);
  expect(String(payload.spec).startsWith('/')).toBe(false);
});

test('打开 Task Spec 失败：详情里照实写原因，不打开别的东西', async () => {
  const open = vi.fn(async () => { throw new Error('Task Spec 路径不合法（路径包含 ..），只能打开仓库里的 docs/tasks/TASK-数字.md。'); });
  await openPlan(planView({ alpha: planFor([task()]) }), { planOpenSpec: open });
  await expand('TASK-002');
  fireEvent.click(screen.getByRole('button', { name: '打开 Task Spec' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('没能打开 Task Spec：Task Spec 路径不合法（路径包含 ..），只能打开仓库里的 docs/tasks/TASK-数字.md。');
  expect(open).toHaveBeenCalledTimes(1);
});

test('一个可派发的任务都没有时，勾了选手也点不动派发（选手池里没有可用的人）', async () => {
  const view = planView({ alpha: planFor([task()]) });
  // 主人把选手全关了：弹窗里明确说没人可用，派发一直灰着。
  for (const who of Object.keys(view.settings.workers)) view.settings.workers[who as keyof typeof view.settings.workers] = { enabled: false, efforts: ['high'], fast: false };
  await openPlan(view);
  await expand('TASK-002');
  fireEvent.click(within(await row('TASK-002')).getByRole('button', { name: '派发' }));
  const dialog = await screen.findByRole('dialog', { name: '派发 TASK-002' });
  expect(within(dialog).getByText('设置里没有开着且能用的选手，请先去“设置 → 选手与模型”打开一位。')).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: '派发' }) as HTMLButtonElement).disabled).toBe(true);
});
