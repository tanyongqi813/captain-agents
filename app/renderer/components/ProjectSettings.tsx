import { useState } from 'react';
import type { View } from '../../../src/core/view-types.ts';
import type { ProjectChoice, ProjectRegistration } from '../../shared/ipc.ts';
import { errorReason } from '../lib/errors.ts';
import { Button, Chip, Modal, SettingGroup, SettingRow } from '../ui/index.ts';

// 设置 → 项目（docs/ui-spec.md 第 10 节，TASK-002）：选文件夹登记 Git 仓库。
// 界面不碰路径：选择走 projectChoose，登记只交回一次性 selectionId 和 name / 可选 label。
const NAME_OK = /^[\p{L}\p{N}_-]+$/u;
const nameHint = (name: string) => !name ? '请填写项目标识。'
  : name === '.' || name === '..' || !NAME_OK.test(name) ? '项目标识只能用字母、汉字、数字、下划线和连字符。'
  : [...name].length > 64 ? '项目标识最多 64 个字。' : '';
const labelHint = (label: string) => { const text = label.trim(); return text && [...text].length > 20 ? '显示名最多 20 个字。' : ''; };

export function ProjectSettings({ projects, notify }: { projects: View['projects']; notify(text: string): void }) {
  const [picking, setPicking] = useState(false);            // 正在等原生选择器
  const [choice, setChoice] = useState<ProjectChoice | null>(null);   // 选好待确认
  const [name, setName] = useState(''), [label, setLabel] = useState('');
  const [error, setError] = useState('');                   // 选择失败 / 弹窗外的提示
  const [busy, setBusy] = useState(false);                  // 登记中
  const [formError, setFormError] = useState('');           // 弹窗内的登记失败
  const [done, setDone] = useState<ProjectRegistration | null>(null); // 刚登记完（快速体检结果随它显示）

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

  const bad = nameHint(name), labelBad = labelHint(label);
  const failed = done?.check && !done.check.ok ? done.check.items.filter(item => item.status === 'fail') : [];
  return <>
    <SettingGroup head="项目">
      <SettingRow title="添加项目" note="选一个 Git 仓库文件夹，登记后就能按项目派活、建群聊" group>
        <Button size="sm" variant="primary" disabled={picking} onClick={() => void add()}>{picking ? '正在打开选择器…' : '添加项目'}</Button>
      </SettingRow>
      {projects.length === 0 ? <p className="setting-row setting-foot">还没有登记项目。</p>
        : projects.map(project => <SettingRow key={project.name} title={project.label} dim={project.archived}
            note={<><span>{'项目标识 ' + project.name}</span>{project.repo && <span className="ellip project-repo-line" title={project.repo}>{project.repo}</span>}</>}>
            {project.archived && <Chip title="这个项目已归档，不能派活">已归档</Chip>}
          </SettingRow>)}
    </SettingGroup>
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
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
  </>;
}
