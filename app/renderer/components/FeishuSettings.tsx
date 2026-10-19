import { useEffect, useRef, useState } from 'react';
import type { FeishuStatus } from '../../shared/ipc.ts';
import { Button, ConfirmDialog, Modal, SettingGroup, SettingRow } from '../ui/index.ts';
import { fmtTime } from '../lib/board.ts';

function Connection({ close, connected }: { close(): void; connected(status: FeishuStatus): void }) {
  const [webhook, setWebhook] = useState(''), [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (busy || !webhook) return;
    setBusy(true); setError('');
    try {
      const status = await window.xa.feishuConnect({ webhook, ...(secret ? { secret } : {}) });
      setWebhook(''); setSecret(''); connected(status); close();
    } catch { setError('连接未保存，请检查官方 Webhook、签名密钥和系统安全存储；原连接没有改变。'); }
    finally { setBusy(false); }
  };
  return <Modal label="连接飞书机器人" title="连接飞书机器人" size="sm" onClose={() => { if (!busy) close(); }}
    footer={<><Button size="sm" disabled={busy} onClick={close}>取消</Button><Button size="sm" variant="primary" disabled={busy || !webhook} onClick={() => void save()}>{busy ? '正在保存…' : '保存连接'}</Button></>}>
    <p className="sub">填写飞书群自定义机器人的官方 Webhook，可选开启签名验证。旧凭据不会读回；保存成功后再发送测试通知。</p>
    <fieldset disabled={busy} className="settings provider-form">
      <label className="provider-field"><span>Webhook 地址</span><input className="field" type="password" aria-label="Webhook 地址" value={webhook} maxLength={256}
        autoComplete="off" spellCheck={false} onChange={e => setWebhook(e.target.value)} /></label>
      <label className="provider-field"><span>签名密钥（可选）</span><input className="field" type="password" aria-label="签名密钥" value={secret} maxLength={256}
        autoComplete="off" spellCheck={false} onChange={e => setSecret(e.target.value)} /></label>
      <p className="faint">仅接受 https://open.feishu.cn 的群机器人接口；凭据经操作系统保护，不写入普通设置或任务记录。</p>
    </fieldset>
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
  </Modal>;
}

export function FeishuSettings() {
  const [status, setStatus] = useState<FeishuStatus | null>(null), [error, setError] = useState('');
  const [editing, setEditing] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const refresh = async () => {
      if (pending.current) return; pending.current = true;
      try { const next = await window.xa.feishuStatus(); if (mounted.current) { setStatus(next); setError(''); } }
      catch { if (mounted.current) setError('暂时无法读取飞书连接，请稍后刷新。'); }
      finally { pending.current = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 15_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  const act = async (kind: 'test' | 'disconnect') => {
    if (busy) return; setBusy(true); setError('');
    try {
      const next = await (kind === 'test' ? window.xa.feishuTest() : window.xa.feishuDisconnect());
      if (mounted.current) { setStatus(next); setConfirm(false); }
    } catch { if (mounted.current) setError(kind === 'test' ? '测试未能完成，请检查连接与系统安全存储。' : '断开失败，请稍后重试；已有任务和通知历史不会删除。'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <>
    <SettingGroup head="飞书机器人">
      <SettingRow group title={status?.connected ? '已连接飞书群机器人' : '未连接飞书机器人'} note="发送到机器人所在群；如只想自己接收，可建专用通知群。">
        <Button size="sm" disabled={busy || !status?.protected} onClick={() => setEditing(true)}>{status?.connected ? '替换连接' : '连接机器人'}</Button>
      </SettingRow>
      <SettingRow title="最近成功" note="包含测试与任务通知送达时间"><span>{status?.lastSuccess ? fmtTime(status.lastSuccess, true) : '暂无记录'}</span></SettingRow>
      <SettingRow title="待发通知"><span>{status ? status.pending === null ? '暂时无法确认' : `${status.pending} 条` : '正在读取…'}</span></SettingRow>
      <SettingRow group title="测试连接" note={status?.lastTest ? <span role="status">{status.lastTest.ok ? '测试通知已送达' : `测试未送达：${status.lastTest.error ?? '请检查连接。'}`} · {fmtTime(status.lastTest.at, true)}</span> : '固定测试消息，不调用 AI，也不产生求助事件。'}><Button size="sm" disabled={busy || !status?.connected} onClick={() => void act('test')}>{busy ? '正在处理…' : '发送测试通知'}</Button></SettingRow>
      {status?.connected && <SettingRow group title="断开连接" note="保留任务、历史与待发通知。"><Button size="sm" disabled={busy} onClick={() => setConfirm(true)}>断开连接</Button></SettingRow>}
    </SettingGroup>
    <p className="sub">需要工作台在线、网络可用才会送达；电脑离线时先保留事件。飞书通知不受选手联网开关控制，也不依赖负责人 AI 的额度。</p>
    {status?.issue && <p role="alert" className="notice notice-warn">{status.issue}</p>}
    {status?.deliveryIssue && <p role="status" className="notice notice-warn">{status.deliveryIssue}</p>}
    {error && <p role="alert" className="notice notice-bad">{error}</p>}
    {editing && <Connection close={() => setEditing(false)} connected={next => { setStatus(next); setError(''); }} />}
    {confirm && <ConfirmDialog message="断开飞书机器人？" detail={<p>只删除连接凭据，不删除任务、通知历史或待发事件。重新连接后仍有效且未处理的通知会按剩余重试预算补发。</p>}
      confirmLabel="确认断开" busy={busy} onCancel={() => { if (!busy) setConfirm(false); }} onConfirm={() => void act('disconnect')} />}
  </>;
}
