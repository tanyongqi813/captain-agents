import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FeishuSettings } from '../../app/renderer/components/FeishuSettings.tsx';
import { Settings } from '../../app/renderer/components/Settings.tsx';
import type { FeishuStatus } from '../../app/shared/ipc.ts';
import { fixtureBridge } from './fixtures.tsx';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const state = (extra: Partial<FeishuStatus> = {}): FeishuStatus => ({ connected: false, protected: true, pending: 0, lastSuccess: null, deliveryIssue: null, ...extra });
const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-token-only';
async function edit() { fireEvent.click(await screen.findByRole('button', { name: '连接机器人' })); return screen.getByRole('dialog', { name: '连接飞书机器人' }); }
function fill() {
  fireEvent.change(screen.getByLabelText('Webhook 地址'), { target: { value: webhook } });
  fireEvent.change(screen.getByLabelText('签名密钥'), { target: { value: 'fixture-secret-only' } });
}

test('通知分页同时提供系统通知和飞书入口，不暗中发送测试', async () => {
  const bridge = fixtureBridge(); window.xa = bridge;
  render(<Settings close={() => {}} />);
  await screen.findByLabelText('系统通知'); fireEvent.click(screen.getByRole('tab', { name: '通知' }));
  await screen.findByRole('button', { name: '连接机器人' });
  expect(screen.getByRole('switch', { name: '系统通知' })).toBeTruthy();
  expect(bridge.feishuTest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: '系统通知' }));
  await waitFor(() => expect(bridge.setSettings).toHaveBeenCalledWith({ notifications: false }));
});

test('仅写新凭据，成功后清空，替换连接不读回旧值', async () => {
  const connect = vi.fn(async () => state({ connected: true })); window.xa = fixtureBridge({ feishuConnect: connect });
  render(<FeishuSettings />); await edit(); fill();
  expect((screen.getByLabelText('Webhook 地址') as HTMLInputElement).type).toBe('password');
  expect((screen.getByLabelText('签名密钥') as HTMLInputElement).type).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
  await screen.findByRole('button', { name: '替换连接' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(connect).toHaveBeenCalledWith({ webhook, secret: 'fixture-secret-only' });
  expect(document.body.innerHTML).not.toContain('fixture-token-only'); expect(document.body.innerHTML).not.toContain('fixture-secret-only');
  fireEvent.click(screen.getByRole('button', { name: '替换连接' }));
  expect((screen.getByLabelText('Webhook 地址') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('签名密钥') as HTMLInputElement).value).toBe('');
});

test('取消丢弃未保存值；失败只显示固定提示，原始异常不得回显', async () => {
  window.xa = fixtureBridge({ feishuConnect: vi.fn(async () => { throw new Error(webhook + 'fixture-secret-only'); }) });
  render(<FeishuSettings />); await edit(); fill(); fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await edit(); expect((screen.getByLabelText('Webhook 地址') as HTMLInputElement).value).toBe('');
  fill(); fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
  expect((await screen.findByRole('alert')).textContent).toContain('原连接没有改变');
  expect(screen.getByRole('alert').textContent).not.toContain('fixture-secret');
});

test('保存中防重复操作，网络请求结束前不能关闭输入弹窗', async () => {
  let release: (s: FeishuStatus) => void = () => {};
  const connect = vi.fn(() => new Promise<FeishuStatus>(r => { release = r; })); window.xa = fixtureBridge({ feishuConnect: connect });
  render(<FeishuSettings />); const dialog = await edit(); fill();
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
  expect((screen.getByRole('button', { name: '正在保存…' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' })); expect(screen.getByRole('dialog')).toBeTruthy();
  expect(connect).toHaveBeenCalledTimes(1); release(state({ connected: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('测试只发无参数专用操作，展示服务端固定失败与待发事实', async () => {
  const tested = state({ connected: true, pending: 2, lastTest: { at: '2026-10-19T01:00:00Z', ok: false, error: '需要检查飞书机器人连接。' }, deliveryIssue: '网络暂时不可用，稍后重试。' });
  const send = vi.fn(async () => tested); window.xa = fixtureBridge({ feishuStatus: vi.fn(async () => state({ connected: true })), feishuTest: send });
  render(<FeishuSettings />); fireEvent.click(await screen.findByRole('button', { name: '发送测试通知' }));
  await screen.findByText(/测试未送达/); expect(send).toHaveBeenCalledWith();
  expect(screen.getByText('2 条')).toBeTruthy(); expect(screen.getByText('网络暂时不可用，稍后重试。')).toBeTruthy();
});

test('断开需二次确认，返回不发请求，确认后保留待发数量', async () => {
  const disconnect = vi.fn(async () => state({ pending: 3 })); window.xa = fixtureBridge({ feishuStatus: vi.fn(async () => state({ connected: true, pending: 3 })), feishuDisconnect: disconnect });
  render(<FeishuSettings />); fireEvent.click(await screen.findByRole('button', { name: '断开连接' }));
  expect(screen.getByRole('alertdialog').textContent).toContain('不删除任务'); expect(disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '先不改' })); expect(disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '断开连接' })); fireEvent.click(screen.getByRole('button', { name: '确认断开' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(disconnect).toHaveBeenCalledWith();
  expect(screen.getByText('3 条')).toBeTruthy(); expect(screen.getByRole('button', { name: '连接机器人' })).toBeTruthy();
});

test('安全存储不可用时禁连接；读取失败不回显后台错误，也不假装已连接', async () => {
  window.xa = fixtureBridge({ feishuStatus: vi.fn(async () => state({ protected: false, issue: '系统安全存储不可用，未读取或保存凭据。' })) });
  const component = render(<FeishuSettings />);
  await screen.findByRole('alert'); expect((screen.getByRole('button', { name: '连接机器人' }) as HTMLButtonElement).disabled).toBe(true);
  component.unmount(); window.xa = fixtureBridge({ feishuStatus: vi.fn(async () => { throw new Error(webhook); }) }); render(<FeishuSettings />);
  const alert = await screen.findByRole('alert'); expect(alert.textContent).toContain('暂时无法读取'); expect(alert.textContent).not.toContain('fixture-token');
});
