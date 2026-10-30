import { useEffect, useState } from 'react';
import type { DeepseekCatalogConsent } from '../../../src/core/settings.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekMoney, deepseekModelPrice, deepseekEndpoint } from '../../../src/core/deepseek-settings.ts';
import type { DeepseekEndpoint, DeepseekPrice, DeepseekMoney } from '../../../src/core/deepseek-settings.ts';
import { errorReason } from '../lib/errors.ts';
import { Button, Modal, Select, Switch } from '../ui/index.ts';

export function DeepseekSettings({ value, close, save, moneyStatus, catalog }: {
  catalog?: { at: string | null; error: string | null };
  moneyStatus?: import('../../../src/core/money-budget.ts').MoneyStatus | null;
  value?: DeepseekEndpoint; close(): void; save(value: DeepseekEndpoint, key: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const }), [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [groupName, setGroupName] = useState('');
  const [models, setModels] = useState<string[] | null>(null), [loadingModels, setLoadingModels] = useState(false);
  const [consent, setConsent] = useState<DeepseekCatalogConsent | null>(null), [autoCatalog, setAutoCatalog] = useState(false);
  useEffect(() => {
    let closed = false;
    if (typeof window.xa?.deepseekCatalogConsent !== 'function') return;
    void window.xa.deepseekCatalogConsent().then(state => {
      if (!closed) { setConsent(state); setAutoCatalog(state.enabled); }
    }).catch(() => { if (!closed) setConsent(null); });
    return () => { closed = true; };
  }, []);
  const group = draft.budgetGroup ?? 'default', savedGroup = value?.budgetGroup ?? 'default';
  const money = (group === 'default' ? draft.money : draft.moneyGroups?.[group]) ?? defaultDeepseekMoney;
  const withMoney = (next: DeepseekMoney, endpoint = draft): DeepseekEndpoint => group === 'default'
    ? { ...endpoint, money: next } : { ...endpoint, moneyGroups: { ...endpoint.moneyGroups, [group]: next } };
  const shownStatus = group === savedGroup ? moneyStatus : null;
  const createGroup = () => {
    try {
      const name = groupName.trim();
      if (name === 'default' || Object.hasOwn(draft.moneyGroups ?? {}, name)) throw new Error('预算组已存在，不能覆盖。');
      const next = deepseekEndpoint({ ...draft, budgetGroup: name,
        moneyGroups: { ...draft.moneyGroups, [name]: deepseekMoney(defaultDeepseekMoney) } });
      setDraft(next); setGroupName(''); setError('');
    } catch (e) { setError('创建预算组失败：' + errorReason(e)); }
  };
  const sameConnection = draft.baseUrl === value?.baseUrl && draft.wireApi === value?.wireApi && !key.trim();
  const setField = (name: 'baseUrl' | 'proModel' | 'flashModel', text: string) => {
    const slot = name === 'proModel' ? 'pro' : name === 'flashModel' ? 'flash' : null;
    const next = { ...draft, [name]: text };
    if (slot && text !== draft[name]) {
      const bind = (config: DeepseekMoney): DeepseekMoney => config.modelPrices !== undefined || config.legacyModels ? config
        : { ...config, legacyModels: { pro: draft.proModel, flash: draft.flashModel } };
      setDraft({ ...next, ...(draft.money ? { money: bind(draft.money) } : {}),
        ...(draft.moneyGroups ? { moneyGroups: Object.fromEntries(Object.entries(draft.moneyGroups).map(([id, config]) => [id, bind(config)])) } : {}) });
    } else setDraft(next);
  };
  const modelId = (slot: 'pro' | 'flash') => slot === 'pro' ? draft.proModel : draft.flashModel;
  const reasoningField = (slot: 'pro' | 'flash') => {
    const name = slot === 'pro' ? 'Pro' : 'Flash', field = slot === 'pro' ? 'proReasoning' : 'flashReasoning';
    const mode = draft[field] ?? 'high', id = modelId(slot);
    let connection: DeepseekEndpoint | null = null;
    try { connection = deepseekEndpoint({ ...defaultDeepseekEndpoint, baseUrl: draft.baseUrl, wireApi: draft.wireApi, proModel: draft.proModel, flashModel: draft.flashModel }); } catch { /* 非法草稿不能确认。 */ }
    const declared = draft.reasoningCapabilities;
    const matches = !!connection && declared?.baseUrl === connection.baseUrl && declared.wireApi === connection.wireApi;
    const entry = matches && declared && Object.hasOwn(declared.models, id) ? declared.models[id] : undefined;
    const confirmed = entry?.high === true;
    return <>
      <label className="provider-field"><span>{name} 推理强度</span><Select label={`${name} 推理强度`}
        items={[{ id: 'default', label: '默认（不指定，推荐）' }, ...(confirmed || mode === 'high' ? [{ id: 'high', label: confirmed ? '高档（用户已确认）' : '高档（未确认，不能派活）' }] : [])]}
        value={mode} onChange={next => { if (next === 'default' || next === 'high' && confirmed) setDraft({ ...draft, [field]: next }); }} /></label>
      <label className="provider-field provider-toggle"><span><strong>{name} 高档能力确认</strong><small>仅在已查阅服务方说明并确认当前连接、协议和模型支持时开启；不发起推理探测。</small></span>
        <Switch label={`我已确认 ${name} 当前模型支持高档`} checked={confirmed} disabled={busy || !connection || ['constructor', 'prototype', '__proto__'].includes(id)} onChange={high => {
          if (!connection) return;
          setDraft({ ...draft, reasoningCapabilities: { baseUrl: connection.baseUrl, wireApi: connection.wireApi,
            models: { ...(matches ? declared?.models : {}), [id]: { high, source: 'user', updatedAt: new Date().toISOString() } } } });
        }} /></label>
      <p className="muted">{entry ? `${name} 来源：用户确认；更新时间：${new Date(entry.updatedAt).toLocaleString('zh-CN')}；${entry.high ? '已确认高档' : '未确认支持高档'}。` : `${name} 能力未知，模型目录不提供强度证明。`}</p>
      {mode === 'high' && !confirmed && <p className="notice notice-warn">{name} 旧高档尚未确认，不能派活；请选择默认，或确认当前模型能力。</p>}
      {declared && !matches && <p className="muted">确认当前新连接将替换原连接的能力声明，不会沿用原声明。</p>}
    </>;
  };
  const priceFor = (slot: 'pro' | 'flash'): DeepseekPrice | undefined => money.modelPrices === undefined ? (money.legacyModels && money.legacyModels[slot] !== modelId(slot) ? undefined : money[slot])
    : Object.hasOwn(money.modelPrices, modelId(slot)) ? money.modelPrices[modelId(slot)] : undefined;
  const priceField = (slot: 'pro' | 'flash', kind: keyof DeepseekPrice, label: string) => {
    const current = priceFor(slot), amount = current?.[kind];
    return <label className="provider-field" key={kind}><span>{label}</span><input className="field" type="number" min="0" step="0.000001" aria-label={label}
      placeholder={kind === 'cacheWrite' ? '留空按输入单价' : '尚未配置'} value={amount !== undefined && Number.isFinite(amount) ? amount : ''} onChange={e => {
        if (!current && kind === 'cacheWrite' && e.target.value === '') return;
        const price: DeepseekPrice = { ...(current ?? { input: NaN, cached: NaN, output: NaN }) };
        if (kind === 'cacheWrite' && e.target.value === '') delete price.cacheWrite;
        else price[kind] = e.target.value === '' ? NaN : Number(e.target.value);
        const next = money.modelPrices === undefined ? { ...money, [slot]: price,
          legacyModels: { ...(money.legacyModels ?? { pro: draft.proModel, flash: draft.flashModel }), [slot]: modelId(slot) } }
          : { ...money, modelPrices: { ...money.modelPrices, [modelId(slot)]: price } };
        setDraft(withMoney(next));
      }} /></label>;
  };
  const moneyField = (name: 'soft' | 'hard' | 'reserve' | 'unknownSeconds', label: string) => <label className="provider-field"><span>{label}</span><input className="field" type="number" min="0" step={name === 'unknownSeconds' ? '1' : '0.000001'} aria-label={label} value={money[name]} onChange={e => setDraft(withMoney({ ...money, [name]: e.target.value === '' ? NaN : Number(e.target.value) }))} /></label>;
  const field = (name: 'baseUrl' | 'proModel' | 'flashModel', label: string, placeholder?: string) => <label className="provider-field">
    <span>{label}</span><input className="field" aria-label={label} value={draft[name]} placeholder={placeholder}
      onChange={e => setField(name, e.target.value)} spellCheck={false} />
  </label>;
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    let saved = false;
    try {
      deepseekMoney(money);
      if (money.enabled) {
        deepseekModelPrice(money, draft.proModel, 'pro'); deepseekModelPrice(money, draft.flashModel, 'flash');
      }
      if (await save(draft, key)) {
        saved = true;
        if (sameConnection && consent && autoCatalog !== consent.enabled) {
          const state = await window.xa.setDeepseekCatalogConsent(autoCatalog, autoCatalog ? consent.binding ?? undefined : undefined);
          setConsent(state); setAutoCatalog(state.enabled);
        }
        close();
      }
    }
    catch (e) { setError((saved ? '连接已保存，目录自动获取授权未更新：' : '保存失败：') + errorReason(e)); }
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
    return <label className="provider-field"><span>{label}</span><Select label={label} items={items} value={draft[name]} onChange={id => setField(name, id)} /></label>;
  };
  const footer = <><Button disabled={busy} onClick={close}>取消</Button><Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? '正在保存…' : '保存'}</Button></>;
  return <Modal size="sm" label="编辑 DeepSeek" title="编辑 DeepSeek" onClose={close} footer={footer}>
    <p className="muted provider-intro">连接 DeepSeek 官方、中转站或兼容接口。请按服务方的说明填写 API 地址、协议和模型 ID。</p>
    {sameConnection ? <>
      <p className="muted">{catalog?.at ? `已保存连接上次成功获取：${new Date(catalog.at).toLocaleString('zh-CN')}` : '已保存连接尚无成功获取记录。'}</p>
      {catalog?.error && <p role="status" className="notice notice-warn">上次目录待刷新：{catalog.error}</p>}
    </> : <p className="muted">连接或密钥正在修改，不沿用已保存连接的目录状态。</p>}
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
      <label className="provider-field provider-toggle"><span><strong>自动获取模型目录</strong><small>保存后按已确认连接获取模型列表；不发推理请求、不更换模型或价格。取消不会修改授权。</small></span>
        <Switch label="自动获取模型目录" checked={autoCatalog} disabled={busy || !sameConnection || !consent?.binding} onChange={setAutoCatalog} /></label>
      {!sameConnection ? <p className="muted">先保存连接或密钥，再重新打开编辑确认自动获取；保存前原授权仍按已保存连接生效。</p>
        : !consent?.binding && <p className="muted">尚未确认保存的连接凭据或授权状态，请先保存连接后重新打开。</p>}
      {modelField('proModel', 'Pro 模型 ID', 'deepseek-chat')}
      {reasoningField('pro')}
      {modelField('flashModel', 'Flash 模型 ID', 'deepseek-flash')}
      {reasoningField('flash')}
      <p className="muted">默认表示不发送推理强度参数，由服务方处理。旧配置保留高档；若连接失败，可选择默认。模型目录不代表服务方支持的推理强度。</p>
      <div className="provider-divider" />
      <label className="provider-field"><span>费用预算组</span><Select label="费用预算组" value={group} items={['default', ...Object.keys(draft.moneyGroups ?? {})].map(id => ({ id, label: id === 'default' ? '默认预算组' : id }))} onChange={budgetGroup => setDraft({ ...draft, budgetGroup })} /></label>
      <label className="provider-field"><span>新预算组名称</span><input className="field" aria-label="新预算组名称" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="字母、数字、下划线或连字符" /></label>
      <Button disabled={busy} onClick={createGroup}>创建预算组</Button>
      <p className="muted">创建只修改草稿，保存后生效；新组预算默认关闭、价格为零，不复制旧账或旧价。请自行确认是否为独立账户，名称不证明账户归属。</p>
      <p className="muted">当前编辑预算组：{group}。所有项目共用该组；更换连接或模型不会清账，原任务仍使用冻结组。</p>
      {group !== savedGroup && <p className="muted">预算组尚未保存；保存后重新打开查看该组费用状态。</p>}
      <label className="provider-field provider-toggle"><span><strong>每日预估费用预算</strong><small>所有项目共用，北京时间零点换日。只统计工作台调用。</small></span><Switch label="每日预估费用预算" checked={money.enabled} onChange={enabled => setDraft(withMoney({ ...money, enabled }))} /></label>
      {shownStatus ? <p className="muted">今日预估 ¥{shownStatus.spent.toFixed(4)}，执行中预留 ¥{shownStatus.reserved.toFixed(4)}，用量待确认 {shownStatus.unknown} 件{shownStatus.stopped ? '；今日已停派' : ''}。</p> : <p className="muted">费用状态未能读取，启用预算后账本不可用会停止收费调用。</p>}
      {shownStatus && <p className="muted">距上限预估剩余{shownStatus.remaining == null ? '未知' : ` ¥${shownStatus.remaining.toFixed(4)}`}，距软预算预估剩余{shownStatus.softRemaining == null ? '未知' : ` ¥${shownStatus.softRemaining.toFixed(4)}`}（扣除运行预留）。按已保存配置计算，不是账户余额或派活许可，待确认用量仍可能影响费用。</p>}
      {moneyField('soft', '每日软预算（元）')}
      {moneyField('hard', '每日上限预算（元）')}
      {moneyField('reserve', '单任务预留（元）')}
      <label className="provider-field"><span>单任务安全余量（元，可选）</span><input className="field" type="number" min="0" step="0.000001" aria-label="单任务安全余量（元，可选）" value={money.safetyMargin ?? ''} onChange={e => {
        const next = { ...money };
        if (e.target.value === '') delete next.safetyMargin;
        else next.safetyMargin = Number(e.target.value);
        setDraft(withMoney(next));
      }} /></label>
      <p className="muted">安全余量空白按0；只占运行预留，不计入实际消费，任务结束释放。执行预留加余量仍须通过派活时的可用额度检查。</p>
      {moneyField('unknownSeconds', '无新增用量最长等待（秒）')}
      {money.modelPrices !== undefined && <p className="muted">按实际模型 ID 编辑单价；其他模型和预算组的价格保持不变。</p>}
      {(['pro', 'flash'] as const).map(slot => <div key={slot}><strong>{slot === 'pro' ? `Pro：${draft.proModel}` : `Flash：${draft.flashModel}`}</strong>
      {!priceFor(slot) && <p className="muted">{slot === 'pro' ? 'Pro' : 'Flash'} 当前模型尚未配置单价。</p>}{(['input', 'cached', 'output'] as const).map(kind => {
        const label = `${slot === 'pro' ? 'Pro' : 'Flash'} ${kind === 'input' ? '未缓存输入' : kind === 'cached' ? '缓存命中' : '输出'}单价（元/百万 token）`;
        return priceField(slot, kind, label);
      })}{priceField(slot, 'cacheWrite', `${slot === 'pro' ? 'Pro' : 'Flash'} 缓存写入单价（元/百万 token，可选）`)}</div>)}
      <p className="muted">缓存写入价留空按输入单价计费；独立写入价需要通道提供缓存写入用量，缺失时会停止收费调用。填写 0 表示缓存写入零价。</p>
      <p className="muted">软预算停止新派活；达到上限独立停止运行任务。调低上限可能立即停机。通道账单延迟可能导致超额；无用量时到时停止并保守计入预留，不能保证实际账单绝不超过上限。改模型后请核对对应单价。</p>
    </div>
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
  </Modal>;
}
