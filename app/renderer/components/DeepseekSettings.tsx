import { useState } from 'react';
import { defaultDeepseekEndpoint } from '../../../src/core/deepseek-settings.ts';
import type { DeepseekEndpoint } from '../../../src/core/deepseek-settings.ts';
import { errorReason } from '../lib/errors.ts';
import { Button, Modal, Select, Switch } from '../ui/index.ts';

export function DeepseekSettings({ value, close, save }: {
  value?: DeepseekEndpoint; close(): void; save(value: DeepseekEndpoint, key: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? defaultDeepseekEndpoint), [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [models, setModels] = useState<string[] | null>(null), [loadingModels, setLoadingModels] = useState(false);
  const field = (name: 'baseUrl' | 'proModel' | 'flashModel', label: string, placeholder?: string) => <label className="provider-field">
    <span>{label}</span><input className="field" aria-label={label} value={draft[name]} placeholder={placeholder}
      onChange={e => setDraft({ ...draft, [name]: e.target.value })} spellCheck={false} />
  </label>;
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (await save(draft, key)) close(); }
    catch (e) { setError('保存失败：' + errorReason(e)); }
    finally { setBusy(false); }
  };
  const discover = async () => {
    if (loadingModels) return;
    setLoadingModels(true); setError('');
    try { setModels(await window.xa.deepseekModels(draft, key || undefined)); }
    catch (e) { setError('获取模型失败：' + errorReason(e)); }
    finally { setLoadingModels(false); }
  };
  const modelField = (name: 'proModel' | 'flashModel', label: string, placeholder: string) => {
    if (!models) return field(name, label, placeholder);
    const items = [...new Set([draft[name], ...models])].map(id => ({ id, label: id }));
    return <label className="provider-field"><span>{label}</span><Select label={label} items={items} value={draft[name]} onChange={id => setDraft({ ...draft, [name]: id })} /></label>;
  };
  const footer = <><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? '正在保存…' : '保存'}</Button></>;
  return <Modal size="sm" label="编辑 DeepSeek" title="编辑 DeepSeek" onClose={close} footer={footer}>
    <p className="muted provider-intro">连接 DeepSeek 官方、中转站或兼容接口。请按服务方的说明填写 API 地址、协议和模型 ID。</p>
    <div className="provider-form">
      <label className="provider-field provider-toggle"><span><strong>仅闲时派活</strong><small>开启后，工作日 09:00–12:00、14:00–18:00（北京时间）不会派给 DeepSeek；其余时间可派。中转站是否优惠以其自身规则为准。</small></span>
        <Switch label="仅闲时派活" checked={draft.offPeakOnly} onChange={offPeakOnly => setDraft({ ...draft, offPeakOnly })} /></label>
      {field('baseUrl', 'API 地址', 'https://gateway.example/v1')}
      <label className="provider-field"><span>API 协议</span><Select label="API 协议" items={[{ id: 'responses', label: 'OpenAI Responses' }, { id: 'chat', label: 'OpenAI Chat Completions' }]}
        value={draft.wireApi} onChange={wireApi => setDraft({ ...draft, wireApi: wireApi as DeepseekEndpoint['wireApi'] })} /></label>
      <label className="provider-field"><span>API 密钥</span><input className="field" type="password" aria-label="API 密钥" value={key} placeholder="留空表示不更新"
        onChange={e => setKey(e.target.value)} autoComplete="off" /><small>密钥只存入独立凭据目录，不保存在普通设置里。</small></label>
      <div className="provider-divider" />
      <div className="provider-catalog"><span><strong>模型目录</strong>{models && <small>已获取 {models.length} 个模型</small>}</span>
        <Button size="sm" disabled={loadingModels} onClick={() => void discover()}>{loadingModels ? '正在获取…' : '获取可用模型'}</Button></div>
      {modelField('proModel', 'Pro 模型 ID', 'deepseek-chat')}
      {modelField('flashModel', 'Flash 模型 ID', 'deepseek-flash')}
    </div>
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
  </Modal>;
}
