import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectChoice, ProjectRegisterInput, ProjectRegistration, XaBridge } from '../../app/shared/ipc.ts';
import type { View } from '../../src/core/view-types.ts';
import { Settings } from '../../app/renderer/components/Settings.tsx';
import { fixtureBridge, fixtureView } from './fixtures.tsx';

afterEach(() => { cleanup(); localStorage.clear(); });

const CHOICE: ProjectChoice = { selectionId: '令牌-1', repo: '/Users/me/work/记账应用', name: '记账应用', label: '记账应用' };
const REGISTRATION = (extra: Partial<ProjectRegistration> = {}): ProjectRegistration => ({
  project: { name: '记账应用', label: '记账应用', repo: CHOICE.repo },
  check: { at: '2026-10-17T00:00:00.000Z', seconds: 0.5, ok: true, items: [{ id: 'git', title: '是 git 仓库并且有提交', status: 'ok', detail: '当前分支 main' }] },
  checkError: null,
  ...extra,
});

// 打开设置并切到“项目”页；projects 是这一版 View 里的项目名单。
async function setup({ projects = [] as View['projects'], projectChoose = vi.fn(async () => null) as unknown as XaBridge['projectChoose'],
  projectRegister = vi.fn(async () => REGISTRATION()) as unknown as XaBridge['projectRegister'], notify = vi.fn(), more = {} as Partial<XaBridge> }: {
  projects?: View['projects']; projectChoose?: XaBridge['projectChoose']; projectRegister?: XaBridge['projectRegister']; notify?: (text: string) => void;
  more?: Partial<XaBridge>;
} = {}) {
  const view = fixtureView();
  view.projects = projects;
  window.xa = fixtureBridge({ projectChoose, projectRegister, ...more });
  render(<Settings close={() => {}} view={view} notify={notify} />);
  fireEvent.click(screen.getByRole('tab', { name: '项目' }));
  await screen.findByRole('button', { name: '添加项目' });   // 内容区要等读取设置完成
  return { view, projectChoose, projectRegister, notify };
}
const addButton = () => screen.getByRole('button', { name: '添加项目' });
const dialog = () => screen.getByRole('dialog', { name: '添加项目' });

test('侧栏有“项目”分页：空状态说明尚未登记，列表显示显示名、标识、路径和归档状态', async () => {
  await setup();
  expect(await screen.findByText('还没有登记项目。')).toBeTruthy();
  expect(screen.getByText('选一个 Git 仓库文件夹，登记后就能按项目派活、建群聊')).toBeTruthy();
  cleanup(); localStorage.clear();
  await setup({ projects: [
    { name: 'ledger', label: '记账应用', archived: false, repo: '/Users/me/work/ledger',
      config: { worktreeRoot: '.claude/worktrees', setup: [], verify: [], denyReadExtra: [], rules: null } },
    { name: 'old-site', label: '旧官网', archived: true, repo: '/Users/me/work/very/deep/old-website-folder-with-a-long-name',
      config: { worktreeRoot: '.claude/worktrees', setup: [], verify: [], denyReadExtra: [], rules: null } },
  ] });
  expect(screen.queryByText('还没有登记项目。')).toBeNull();
  const active = screen.getByText('记账应用').closest('.setting-row')!;
  expect(active.textContent).toContain('项目标识 ledger');
  expect(active.textContent).toContain('/Users/me/work/ledger');
  const archived = screen.getByText('旧官网').closest('.setting-row')!;
  expect(archived.textContent).toContain('项目标识 old-site');
  expect(archived.textContent).toContain('已归档');
  expect(archived.className).toContain('setting-row-dim');
  // 长路径截断显示、悬停有完整 title
  const path = archived.querySelector('.project-repo-line')!;
  expect(path.textContent).toContain('very/deep/old-website');
  expect(path.getAttribute('title')).toBe('/Users/me/work/very/deep/old-website-folder-with-a-long-name');
});

test('取消选择不是错误：页面原样，没有任何提示', async () => {
  const { projectChoose } = await setup();
  fireEvent.click(addButton());
  await waitFor(() => expect(projectChoose).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('dialog', { name: '添加项目' })).toBeNull();
  expect(screen.getByText('还没有登记项目。')).toBeTruthy();
});

test('选择失败（不是 Git 仓库等）用中文写原因，不打开确认弹窗', async () => {
  const { projectChoose } = await setup({ projectChoose: vi.fn(async () => { throw new Error('这个文件夹不是 Git 仓库，请选择 Git 仓库所在的文件夹。'); }) });
  fireEvent.click(addButton());
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('没能选择文件夹：这个文件夹不是 Git 仓库，请选择 Git 仓库所在的文件夹。');
  expect(screen.queryByRole('dialog', { name: '添加项目' })).toBeNull();
  expect(projectChoose).toHaveBeenCalledTimes(1);
});

test('选择成功打开窄确认弹窗：路径只读，标识和显示名可编辑；登记只交 selectionId 和 name/label', async () => {
  const projectChoose = vi.fn(async () => CHOICE);
  const projectRegister = vi.fn(async () => REGISTRATION());
  await setup({ projectChoose, projectRegister });
  fireEvent.click(addButton());
  // 弹窗里仓库路径是纯文字（没有任何输入框带着它），建议和缺省值来自后台
  const box = await screen.findByRole('dialog', { name: '添加项目' });
  expect(box.getAttribute('class')).toContain('sheet-sm');
  expect(box.textContent).toContain('/Users/me/work/记账应用');
  expect(within(box).queryByDisplayValue('/Users/me/work/记账应用')).toBeNull();
  expect(within(box).getAllByDisplayValue('记账应用')).toHaveLength(2);   // 标识和显示名的缺省值都来自后台建议
  expect(within(box).getByText('用于命令和登记，登记后本阶段不支持修改。')).toBeTruthy();
  expect(within(box).getByText('看板上显示的名字；不填就用项目标识。')).toBeTruthy();
  // 建议是 null 时留空要主人自己填
  cleanup(); localStorage.clear();
  const chooseBlank = vi.fn(async (): Promise<ProjectChoice> => ({ ...CHOICE, name: null, label: null }));
  await setup({ projectChoose: chooseBlank });
  fireEvent.click(addButton());
  const blank = await screen.findByRole('dialog', { name: '添加项目' });
  expect((within(blank).getByLabelText('项目标识') as HTMLInputElement).value).toBe('');
  expect((within(blank).getByLabelText('显示名称') as HTMLInputElement).value).toBe('');
  fireEvent.change(within(blank).getByLabelText('项目标识'), { target: { value: '记账应用' } });
  // 标识不合法时写原因、登记不可点
  fireEvent.change(within(blank).getByLabelText('项目标识'), { target: { value: 'bad name!' } });
  expect(within(blank).getByRole('alert').textContent).toBe('项目标识只能用字母、汉字、数字、下划线和连字符。');
  expect((within(blank).getByRole('button', { name: '登记' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(blank).getByLabelText('项目标识'), { target: { value: '记账应用' } });
  fireEvent.change(within(blank).getByLabelText('显示名称'), { target: { value: '账本' } });
  const register = vi.fn(async (_id: string, _input: ProjectRegisterInput) => REGISTRATION());
  window.xa.projectRegister = register;
  fireEvent.click(within(blank).getByRole('button', { name: '登记' }));
  await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  expect(register).toHaveBeenCalledWith('令牌-1', { name: '记账应用', label: '账本' });
  // 不显示名称时只交 name，不带 label
  cleanup(); localStorage.clear();
  const noLabel = vi.fn(async (_id: string, _input: ProjectRegisterInput) => REGISTRATION());
  await setup({ projectChoose: vi.fn(async () => CHOICE), projectRegister: noLabel });
  fireEvent.click(addButton());
  const again = await screen.findByRole('dialog', { name: '添加项目' });
  fireEvent.change(within(again).getByLabelText('显示名称'), { target: { value: '' } });
  fireEvent.click(within(again).getByRole('button', { name: '登记' }));
  await waitFor(() => expect(noLabel).toHaveBeenCalledTimes(1));
  expect(noLabel).toHaveBeenCalledWith('令牌-1', { name: '记账应用' });
});

test('登记失败（重名、不合法）：弹窗不关，里面用中文写后台原因', async () => {
  await setup({ projectChoose: vi.fn(async () => CHOICE), projectRegister: vi.fn(async () => { throw new Error('已经登记过同名的项目。'); }) });
  fireEvent.click(addButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: '添加项目' })).getByRole('button', { name: '登记' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('没能登记：已经登记过同名的项目。');
  expect(alert.closest('.sheet')!.getAttribute('aria-label')).toBe('添加项目');   // 提示在弹窗里，弹窗没关
});

test('登记成功：关弹窗、底部提示条，只交 name 和 label；等待新 View 更新列表，不自动建群', async () => {
  const projectRegister = vi.fn(async (_id: string, _input: ProjectRegisterInput) => REGISTRATION());
  const { notify } = await setup({ projects: [{ name: '别的', label: '别的项目', archived: false, repo: '/tmp/other',
    config: { worktreeRoot: '.claude/worktrees', setup: [], verify: [], denyReadExtra: [], rules: null } }], projectChoose: vi.fn(async () => CHOICE), projectRegister });
  fireEvent.click(addButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: '添加项目' })).getByRole('button', { name: '登记' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加项目' })).toBeNull());
  expect(notify).toHaveBeenCalledWith('已登记 记账应用');
  for (const call of projectRegister.mock.calls) expect(Object.keys(call[1])).toEqual(['name', 'label']);   // 交不进路径和高级配置
  // 列表等后台发布的新 View：这一版 View 还没更新，旧列表不自己插新行
  expect(screen.queryByText('记账应用')).toBeNull();
  expect(screen.getByText('别的项目')).toBeTruthy();
});

test('快速体检没过：明确写“项目已登记”，给出没过项和重新检查的说明', async () => {
  const check = { at: '2026-10-17T00:00:00.000Z', seconds: 0.5, ok: false, items: [
    { id: 'git', title: '是 git 仓库并且有提交', status: 'ok' as const, detail: '当前分支 main' },
    { id: 'clean', title: '工作区有没提交的改动', status: 'fail' as const, detail: '有 3 个文件没提交，选手的副本看不到这些改动', fix: '先提交或自己收好再派活' },
  ] };
  await setup({ projectChoose: vi.fn(async () => CHOICE), projectRegister: vi.fn(async () => REGISTRATION({ check })) });
  fireEvent.click(addButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: '添加项目' })).getByRole('button', { name: '登记' }));
  const warn = await screen.findByRole('status');
  expect(warn.textContent).toContain('项目已登记。');
  expect(warn.textContent).toContain('工作区有没提交的改动');
  expect(warn.textContent).toContain('xagents project check 记账应用');
  expect(screen.queryByRole('alert')).toBeNull();   // 不当作登记失败
});

test('体检没跑成：也明确写“项目已登记”和原因', async () => {
  await setup({ projectChoose: vi.fn(async () => CHOICE), projectRegister: vi.fn(async () => REGISTRATION({ check: null, checkError: '磁盘满了' })) });
  fireEvent.click(addButton());
  fireEvent.click(within(await screen.findByRole('dialog', { name: '添加项目' })).getByRole('button', { name: '登记' }));
  const warn = await screen.findByRole('status');
  expect(warn.textContent).toBe('项目已登记。快速体检没能跑成：磁盘满了。');
});

// —— TASK-003 项目管理 ——
const CONFIG: NonNullable<View['projects'][number]['config']> = {
  worktreeRoot: '.worktrees', setup: ['npm ci'], verify: ['npm test'], denyReadExtra: ['secrets.txt'], rules: '/Users/me/work/ledger/RULES.md',
};
const LEDGER: View['projects'][number] = { name: 'ledger', label: '记账应用', archived: false, repo: '/Users/me/work/ledger', config: CONFIG };
const menu = () => screen.getByRole('button', { name: '更多操作：记账应用' });
const menuItem = async (name: string) => within(await screen.findByRole('menu')).getByRole('menuitem', { name });

test('项目行“…”菜单：打开仓库只交项目名；打不开在面板上方写原因', async () => {
  const projectOpen = vi.fn(async () => {});
  await setup({ projects: [LEDGER], more: { projectOpen } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('打开仓库'));
  await waitFor(() => expect(projectOpen).toHaveBeenCalledWith('ledger'));
  cleanup(); localStorage.clear();
  const fail = vi.fn(async () => { throw new Error('仓库搬家了。'); });
  await setup({ projects: [LEDGER], more: { projectOpen: fail } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('打开仓库'));
  expect((await screen.findByRole('alert')).textContent).toContain('没能打开仓库：仓库搬家了。');
});

test('编辑登记：按 View 的 config 预填，保存只交填的字段；规则文件只交令牌或清除', async () => {
  const projectUpdate = vi.fn(async () => {});
  const projectChooseRules = vi.fn(async () => ({ selectionId: '令牌-r', path: '/Users/me/work/ledger/新规矩.md' }));
  const { notify } = await setup({ projects: [LEDGER], more: { projectUpdate, projectChooseRules } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('编辑登记'));
  const dialog = await screen.findByRole('dialog', { name: '编辑登记：记账应用' });
  const scope = within(dialog);
  expect((scope.getByLabelText('副本目录') as HTMLInputElement).value).toBe('.worktrees');
  expect((scope.getByLabelText('验收命令') as HTMLTextAreaElement).value).toBe('npm test');
  expect((scope.getByLabelText('禁读路径') as HTMLTextAreaElement).value).toBe('secrets.txt');
  expect(dialog.textContent).toContain('/Users/me/work/ledger/RULES.md');
  // 改掉显示名和副本目录；rules 不动就不交。
  fireEvent.change(scope.getByLabelText('显示名称'), { target: { value: '账本' } });
  fireEvent.change(scope.getByLabelText('副本目录'), { target: { value: '.copies' } });
  fireEvent.click(scope.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(projectUpdate).toHaveBeenCalledWith('ledger', { label: '账本', worktreeRoot: '.copies', setup: ['npm ci'], verify: ['npm test'], denyReadExtra: ['secrets.txt'] }));
  expect(notify).toHaveBeenCalledWith('已保存 账本');
  expect(screen.queryByRole('dialog', { name: '编辑登记：记账应用' })).toBeNull();
  cleanup(); localStorage.clear();
  // 规则文件：选择只交一次性令牌；清除只交 null。窗口拿不到真实路径。
  const update2 = vi.fn(async (_name: string, _patch: Record<string, unknown>) => {});
  await setup({ projects: [LEDGER], more: { projectUpdate: update2, projectChooseRules } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('编辑登记'));
  const scope2 = within(await screen.findByRole('dialog', { name: '编辑登记：记账应用' }));
  fireEvent.click(scope2.getByRole('button', { name: '选择规则文件…' }));
  await waitFor(() => expect(projectChooseRules).toHaveBeenCalled());
  expect(await scope2.findByText('/Users/me/work/ledger/新规矩.md')).toBeTruthy();
  fireEvent.click(scope2.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(update2).toHaveBeenCalledWith('ledger', expect.objectContaining({ rules: '令牌-r' })));
  expect(update2.mock.calls[0][1].rules).not.toContain('新规矩');
});

test('编辑登记：绝对路径界面就存不了；后台拒绝时弹窗里写原因', async () => {
  const calls: unknown[] = [];
  const projectUpdate = vi.fn(async (_name: string, patch: Record<string, unknown>) => { calls.push(patch); throw new Error('显示名请写 1–20 字，不能含控制字符。'); });
  await setup({ projects: [LEDGER], more: { projectUpdate } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('编辑登记'));
  const scope = within(await screen.findByRole('dialog', { name: '编辑登记：记账应用' }));
  // 界面先拦一道：副本目录写成绝对路径，“保存”不可点，不发请求。
  fireEvent.change(scope.getByLabelText('副本目录'), { target: { value: '/tmp/outside' } });
  expect((scope.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  expect(scope.getByRole('alert').textContent).toContain('相对路径');
  // 通过界面校验但被核心拒绝（显示名带控制字符）：弹窗不关，写后台给的中文原因。
  fireEvent.change(scope.getByLabelText('副本目录'), { target: { value: '.worktrees' } });
  fireEvent.change(scope.getByLabelText('显示名称'), { target: { value: '坏\n名字' } });
  fireEvent.click(scope.getByRole('button', { name: '保存' }));
  await screen.findByText('没能保存：显示名请写 1–20 字，不能含控制字符。');
  expect(screen.getByRole('dialog', { name: '编辑登记：记账应用' })).toBeTruthy();
  expect(calls.length).toBe(1);
});

test('体检：结果显示通过或问题清单；被拒绝时照实写原因', async () => {
  const ok = { at: '', seconds: 0.5, ok: true, items: [{ id: 'git', title: '是 git 仓库并且有提交', status: 'ok' as const, detail: '当前分支 main' }] };
  const projectCheck = vi.fn(async () => ok);
  await setup({ projects: [LEDGER], more: { projectCheck } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('快速体检'));
  expect((await screen.findByRole('status')).textContent).toContain('快速体检通过（0.5 秒，1 项都正常）。');
  expect(projectCheck).toHaveBeenCalledWith('ledger', 'quick');
  cleanup(); localStorage.clear();
  const warn = { at: '', seconds: 1, ok: false, items: [{ id: 'verify', title: '没有验收命令', status: 'warn' as const, detail: '交回的活只能靠人看' }] };
  await setup({ projects: [LEDGER], more: { projectCheck: vi.fn(async () => warn) } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('完整体检'));
  expect((await screen.findByRole('status')).textContent).toContain('完整体检没过：没有验收命令（交回的活只能靠人看）。');
  cleanup(); localStorage.clear();
  await setup({ projects: [LEDGER], more: { projectCheck: vi.fn(async () => { throw new Error('项目 ledger 正在体检，等这一轮跑完再试。'); }) } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('快速体检'));
  expect((await screen.findAllByRole('alert')).at(-1)!.textContent!).toContain('没能体检：项目 ledger 正在体检');
});

test('归档与移除：归档走整份名单；移除先二次确认，写明不删仓库任务历史', async () => {
  const projectRemove = vi.fn(async () => {});
  const archived: View['projects'][number] = { ...LEDGER, archived: true };
  const setSettings = vi.fn(async (patch: unknown) => patch);
  await setup({ projects: [archived], more: { projectRemove, setSettings: setSettings as unknown as XaBridge['setSettings'] } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('取消归档'));
  await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ archivedProjects: [] }));
  cleanup(); localStorage.clear();
  const { notify } = await setup({ projects: [LEDGER], more: { projectRemove, setSettings: setSettings as unknown as XaBridge['setSettings'] } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('归档'));
  await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ archivedProjects: ['ledger'] }));
  // 移除：先确认，说清只删登记；取消不移除。
  fireEvent.click(menu());
  fireEvent.click(await menuItem('移除登记…'));
  const confirm = await screen.findByRole('alertdialog');
  expect(confirm.textContent).toContain('不删仓库、任务、历史和任何 Git 数据');
  fireEvent.click(within(confirm).getByRole('button', { name: '先不移除' }));
  expect(projectRemove).not.toHaveBeenCalled();
  // 确认才移除。
  fireEvent.click(menu());
  fireEvent.click(await menuItem('移除登记…'));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '移除登记' }));
  await waitFor(() => expect(projectRemove).toHaveBeenCalledWith('ledger'));
  expect(notify).toHaveBeenCalledWith('已移除 记账应用 的登记');
  cleanup(); localStorage.clear();
  // 后台拒绝（比如还有开放群聊）：面板上方写原因。
  const fail = vi.fn(async () => { throw new Error('这个项目还有 1 个开放的群聊（测试群），先关闭群聊，再移除登记。'); });
  await setup({ projects: [LEDGER], more: { projectRemove: fail } });
  fireEvent.click(menu());
  fireEvent.click(await menuItem('移除登记…'));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '移除登记' }));
  expect((await screen.findByRole('alert')).textContent).toContain('没能移除登记：这个项目还有 1 个开放的群聊');
});
