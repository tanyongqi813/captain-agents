import { useState } from 'react';
import type { View, ViewProject } from '../../../src/core/view-types.ts';
import type { ProjectCheck } from '../../../src/core/project-check.ts';
import type { ProjectChoice, ProjectRegistration } from '../../shared/ipc.ts';
import { errorReason } from '../lib/errors.ts';
import { Button, Chip, ConfirmDialog, Modal, MoreMenu, SettingGroup, SettingRow } from '../ui/index.ts';

// 设置 → 项目（docs/ui-spec.md 第 10 节，TASK-002 登记、TASK-003 管理）：选文件夹登记 Git 仓库，
// 管理已登记项目（打开 / 编辑 / 体检 / 归档 / 移除）。界面不碰路径：选择走 projectChoose，登记只交回
// 一次性 selectionId 和 name / 可选 label；管理操作只交项目名，规则文件走 projectChooseRules 的选择令牌。
const NAME_OK = /^[\p{L}\p{N}_-]+$/u;
const nameHint = (name: string) => !name ? '请填写项目标识。'
  : name === '.' || name === '..' || !NAME_OK.test(name) ? '项目标识只能用字母、汉字、数字、下划线和连字符。'
  : [...name].length > 64 ? '项目标识最多 64 个字。' : '';
const labelHint = (label: string) => { const text = label.trim(); return text && [...text].length > 20 ? '显示名最多 20 个字。' : ''; };
const relHint = (path: string) => {
  const value = path.trim();
  if (!value) return '请填写副本目录。';
  if (value === '.' || value.split(/[\\/]/).includes('..') || value.startsWith('/') || /^[a-zA-Z]:[\\/]?/.test(value)) return '必须是仓库内的相对路径：不写绝对路径，不含 ..。';
  return '';
};
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);
const linesHint = (text: string) => text.split('\n').some(line => line && !line.trim()) ? '每一项一行，不能有空白行。' : '';

export function ProjectSettings({ projects, notify }: { projects: View['projects']; notify(text: string): void }) {
  const [picking, setPicking] = useState(false);            // 正在等原生选择器
  const [choice, setChoice] = useState<ProjectChoice | null>(null);   // 选好待确认
  const [name, setName] = useState(''), [label, setLabel] = useState('');
  const [error, setError] = useState('');                   // 选择失败 / 弹窗外的提示
  const [busy, setBusy] = useState(false);                  // 登记中
  const [formError, setFormError] = useState('');           // 弹窗内的登记失败
  const [done, setDone] = useState<ProjectRegistration | null>(null); // 刚登记完（快速体检结果随它显示）
  // TASK-003：管理状态。
  const [editing, setEditing] = useState<ViewProject | null>(null);   // 正在编辑的项目
  const [removing, setRemoving] = useState<ViewProject | null>(null); // 待确认的移除
  const [busyName, setBusyName] = useState('');             // 正在体检/编辑/移除的项目名（按钮不可点）
  const [checkResult, setCheckResult] = useState<{ project: string; kind: 'quick' | 'full'; check: ProjectCheck } | null>(null);

  // 取消选择返回 null，不是错误：页面原样，不提示。
  const add = async () => {
    if (picking) return;
    setPicking(true); setError(''); setDone(null);
    try {
      const picked = await window.xa.projectChoose();
      if (picked) { setChoice(picked); setName(picked.name ?? ''); setLabel(picked.label ?? ''); setFormError(''); }
    } catch (e) { setError('没能选择文件夹：' + errorReason(e)); }
    finally { setPicking(false); }
  };
  const closeDialog = () => { if (!busy) setChoice(null); };

  const register = async () => {
    if (!choice || busy) return;
    setBusy(true); setFormError('');
    try {
      const input = { name: name.trim(), ...(label.trim() ? { label: label.trim() } : {}) };
      const result = await window.xa.projectRegister(choice.selectionId, input);
      setChoice(null); setDone(result);
      notify(`已登记 ${result.project.label}`);
    } catch (e) { setFormError('没能登记：' + errorReason(e)); }
    finally { setBusy(false); }
  };

  // 管理：全部只交项目名，路径由后台按登记处解析。
  const openRepo = async (project: ViewProject) => {
    setError('');
    try { await window.xa.projectOpen(project.name); }
    catch (e) { setError('没能打开仓库：' + errorReason(e)); }
  };
  const runCheck = async (project: ViewProject, kind: 'quick' | 'full') => {
    if (busyName) return;
    setBusyName(project.name); setError(''); setCheckResult(null);
    try { setCheckResult({ project: project.name, kind, check: await window.xa.projectCheck(project.name, kind) }); }
    catch (e) { setError('没能体检：' + errorReason(e)); }
    finally { setBusyName(''); }
  };
  const setArchived = async (project: ViewProject, archived: boolean) => {
    setError('');
    const list = projects.filter(p => archived ? (p.archived || p.name === project.name) : (p.archived && p.name !== project.name)).map(p => p.name);
    try { await window.xa.setSettings({ archivedProjects: list }); }
    catch (e) { setError('保存失败：' + errorReason(e)); }
  };
  const remove = async () => {
    const project = removing;
    if (!project || busyName) return;
    setBusyName(project.name);
    try {
      await window.xa.projectRemove(project.name);
      setRemoving(null);
      notify(`已移除 ${project.label} 的登记`);
    // 后台在登记锁内重新检查：排队/运行的活、残留进程或开放群聊都会拒绝，原因写在面板上方。
    } catch (e) { setRemoving(null); setError('没能移除登记：' + errorReason(e)); }
    finally { setBusyName(''); }
  };

  const bad = nameHint(name), labelBad = labelHint(label);
  const failed = done?.check && !done.check.ok ? done.check.items.filter(item => item.status === 'fail') : [];
  const checked = checkResult ? checkResult.check : null;
  const checkedBad = checked ? checked.items.filter(item => item.status !== 'ok') : [];
  return <>
    <SettingGroup head="项目">
      <SettingRow title="添加项目" note="选一个 Git 仓库文件夹，登记后就能按项目派活、建群聊" group>
        <Button size="sm" variant="primary" disabled={picking} onClick={() => void add()}>{picking ? '正在打开选择器…' : '添加项目'}</Button>
      </SettingRow>
      {projects.length === 0 ? <p className="setting-row setting-foot">还没有登记项目。</p>
        : projects.map(project => <SettingRow key={project.name} title={project.label} dim={project.archived} group
            note={<><span>{'项目标识 ' + project.name}</span>{project.repo && <span className="ellip project-repo-line" title={project.repo}>{project.repo}</span>}</>}>
            {project.archived && <Chip title="这个项目已归档，不能派活">已归档</Chip>}
            {project.config && <MoreMenu label={`更多操作：${project.label}`} items={[
              { label: '打开仓库', onSelect: () => void openRepo(project) },
              { label: '编辑登记', onSelect: () => setEditing(project) },
              { label: '快速体检', onSelect: () => void runCheck(project, 'quick') },
              { label: '完整体检', onSelect: () => void runCheck(project, 'full') },
              project.archived
                ? { label: '取消归档', onSelect: () => void setArchived(project, false) }
                : { label: '归档', onSelect: () => void setArchived(project, true) },
              { label: '移除登记…', onSelect: () => setRemoving(project) },
            ]} />}
          </SettingRow>)}
    </SettingGroup>
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
    {checkResult && checked && checkedBad.length === 0 && <p role="status" className="notice">
      {checkResult.kind === 'quick' ? '快速体检' : '完整体检'}通过（{checked.seconds} 秒，{checked.items.length} 项都正常）。</p>}
    {checkResult && checked && checkedBad.length > 0 && <p role="status" className="notice notice-warn">
      {checkResult.kind === 'quick' ? '快速体检' : '完整体检'}没过：{checkedBad.map(item => `${item.title}（${item.detail}）`).join('；')}。</p>}
    {!!failed.length && <p role="status" className="notice notice-warn">
      项目已登记。快速体检没过：{failed.map(item => `${item.title}（${item.detail}）`).join('；')}。之后在终端运行 `xagents project check {done!.project.name}` 可以重新检查。</p>}
    {done && !done.check && done.checkError && <p role="status" className="notice notice-warn">项目已登记。快速体检没能跑成：{done.checkError}。</p>}
    {choice && <Modal label="添加项目" title="添加项目" size="sm" onClose={closeDialog}
      footer={<><span /><span className="step">
        <Button size="sm" onClick={closeDialog} disabled={busy}>取消</Button>
        <Button size="sm" variant="primary" disabled={busy || !!bad || !!labelBad} onClick={() => void register()}>{busy ? '正在登记…' : '登记'}</Button>
      </span></>}>
      <div className="project-form">
        <p className="project-repo" title={choice.repo}>{choice.repo}</p>
        <label className="provider-field">项目标识
          <input className="field" value={name} data-autofocus maxLength={64} aria-label="项目标识" aria-invalid={!!bad}
            onChange={e => setName(e.target.value)} />
          <small>用于命令和登记，登记后本阶段不支持修改。</small>
          {bad && <small role="alert" className="project-field-bad">{bad}</small>}
        </label>
        <label className="provider-field">显示名称
          <input className="field" value={label} maxLength={20} aria-label="显示名称" aria-invalid={!!labelBad}
            onChange={e => setLabel(e.target.value)} />
          <small>看板上显示的名字；不填就用项目标识。</small>
          {labelBad && <small role="alert" className="project-field-bad">{labelBad}</small>}
        </label>
        {formError && <p role="alert" className="notice notice-bad">{formError}</p>}
      </div>
    </Modal>}
    {editing && <EditDialog project={editing} busy={busyName === editing.name} notify={notify}
      onClose={() => { if (busyName !== editing.name) setEditing(null); }} onDone={() => setEditing(null)} />}
    {removing && <ConfirmDialog message={`移除 ${removing.label} 的登记？`}
      detail={<p className="confirm-detail">只移除工作台登记：删掉这份登记文件，不删仓库、任务、历史和任何 Git 数据。移除后这个项目从列表消失，想再用得重新登记。</p>}
      confirmLabel="移除登记" cancelLabel="先不移除" busy={busyName === removing.name}
      onConfirm={() => void remove()} onCancel={() => { if (busyName !== removing.name) setRemoving(null); }} />}
  </>;
}

// 编辑登记（docs/ui-spec.md 第 10 节，TASK-003）：当前值从 View.projects[].config 预填；保存只交项目名和
// 填了的字段，规则文件只交清除（null）或选择令牌——窗口永远交不进路径。
function EditDialog({ project, busy, notify, onClose, onDone }:
  { project: ViewProject; busy: boolean; notify(text: string): void; onClose(): void; onDone(): void }) {
  const config = project.config!;
  const [label, setLabel] = useState(project.label);
  const [worktreeRoot, setWorktreeRoot] = useState(config.worktreeRoot);
  const [setup, setSetup] = useState(config.setup.join('\n'));
  const [verify, setVerify] = useState(config.verify.join('\n'));
  const [deny, setDeny] = useState(config.denyReadExtra.join('\n'));
  const [rules, setRules] = useState<{ kind: 'unchanged' } | { kind: 'cleared' } | { kind: 'picked'; selectionId: string; path: string }>({ kind: 'unchanged' });
  const [pickingRules, setPickingRules] = useState(false);
  const [formError, setFormError] = useState('');

  const pickRules = async () => {
    if (pickingRules) return;
    setPickingRules(true); setFormError('');
    try {
      const picked = await window.xa.projectChooseRules();
      if (picked) setRules({ kind: 'picked', selectionId: picked.selectionId, path: picked.path });
    } catch (e) { setFormError('没能选择规则文件：' + errorReason(e)); }
    finally { setPickingRules(false); }
  };
  const save = async () => {
    if (busy) return;
    setFormError('');
    try {
      await window.xa.projectUpdate(project.name, {
        label: label.trim(),
        worktreeRoot: worktreeRoot.trim(),
        setup: lines(setup), verify: lines(verify), denyReadExtra: lines(deny),
        ...(rules.kind === 'cleared' ? { rules: null } : rules.kind === 'picked' ? { rules: rules.selectionId } : {}),
      });
      notify(`已保存 ${label.trim() || project.name}`);
      onDone();
    } catch (e) { setFormError('没能保存：' + errorReason(e)); }
  };

  const labelBad = labelHint(label), rootBad = relHint(worktreeRoot);
  const setupBad = linesHint(setup), verifyBad = linesHint(verify), denyBad = linesHint(deny);
  const dirty = rules.kind !== 'unchanged';
  return <Modal label={`编辑登记：${project.label}`} title={`编辑登记 · ${project.label}`} size="sm" onClose={onClose}
    footer={<><span /><span className="step">
      <Button size="sm" onClick={onClose} disabled={busy}>取消</Button>
      <Button size="sm" variant="primary" disabled={busy || !!labelBad || !!rootBad || !!setupBad || !!verifyBad || !!denyBad}
        onClick={() => void save()}>{busy ? '正在保存…' : '保存'}</Button>
    </span></>}>
    <div className="project-form">
      <label className="provider-field">显示名称
        <input className="field" value={label} maxLength={20} aria-label="显示名称" aria-invalid={!!labelBad}
          onChange={e => setLabel(e.target.value)} />
        {labelBad && <small role="alert" className="project-field-bad">{labelBad}</small>}
      </label>
      <label className="provider-field">副本目录
        <input className="field" value={worktreeRoot} aria-label="副本目录" aria-invalid={!!rootBad}
          onChange={e => setWorktreeRoot(e.target.value)} />
        <small>选手的副本开在仓库里的这个位置；必须是仓库内的相对路径。</small>
        {rootBad && <small role="alert" className="project-field-bad">{rootBad}</small>}
      </label>
      <label className="provider-field">装依赖命令
        <textarea className="field" rows={2} value={setup} aria-label="装依赖命令" onChange={e => setSetup(e.target.value)} />
        <small>派活时先在副本里跑，一行一条。</small>
        {setupBad && <small role="alert" className="project-field-bad">{setupBad}</small>}
      </label>
      <label className="provider-field">验收命令
        <textarea className="field" rows={2} value={verify} aria-label="验收命令" onChange={e => setVerify(e.target.value)} />
        <small>交回时负责人照这些命令验收，一行一条。</small>
        {verifyBad && <small role="alert" className="project-field-bad">{verifyBad}</small>}
      </label>
      <label className="provider-field">禁读路径
        <textarea className="field" rows={2} value={deny} aria-label="禁读路径" onChange={e => setDeny(e.target.value)} />
        <small>选手不许读这些仓库内路径，一行一条。</small>
        {denyBad && <small role="alert" className="project-field-bad">{denyBad}</small>}
      </label>
      <div className="provider-field">
        <span className="setting-note">规则文件</span>
        <p className="project-repo" title={rules.kind === 'picked' ? rules.path : config.rules ?? ''}>
          {rules.kind === 'cleared' ? '（已清除）' : rules.kind === 'picked' ? rules.path : config.rules ?? '没有登记规则文件。'}</p>
        <span className="step">
          <Button size="sm" disabled={pickingRules || busy} onClick={() => void pickRules()}>{pickingRules ? '正在打开选择器…' : '选择规则文件…'}</Button>
          {config.rules && rules.kind !== 'cleared' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRules({ kind: 'cleared' })}>清除</Button>}
          {dirty && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRules({ kind: 'unchanged' })}>还原</Button>}
        </span>
        <small>选手开工前要读的一份规矩文件；重新选择后主进程会核实它真实存在。</small>
      </div>
      {formError && <p role="alert" className="notice notice-bad">{formError}</p>}
    </div>
  </Modal>;
}
