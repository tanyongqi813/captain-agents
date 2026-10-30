import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeepseekSettings } from '../../app/renderer/components/DeepseekSettings.tsx';
import { defaultDeepseekEndpoint, deepseekEndpoint } from '../../src/core/deepseek-settings.ts';
import type { DeepseekEndpoint } from '../../src/core/deepseek-settings.ts';
afterEach(cleanup);
const check = () => screen.getByRole('switch', { name: '我已确认 Pro 当前模型支持高档' });
const input = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
test('新配置默认不确认，旧high保留警告；切默认后不能新选未确认high', () => {
  const save = vi.fn(async () => true);
  const r = render(<DeepseekSettings save={save} close={() => {}} />);
  expect(screen.getByLabelText('Pro 推理强度')).toHaveProperty('value', 'default');
  expect(within(screen.getByLabelText('Pro 推理强度')).queryByRole('option', { name: /高档/ })).toBeNull();
  r.unmount(); render(<DeepseekSettings value={defaultDeepseekEndpoint} save={save} close={() => {}} />);
  expect(screen.getByLabelText('Pro 推理强度')).toHaveProperty('value', 'high');
  expect(screen.getByText(/Pro 旧高档尚未确认/)).toBeTruthy();
  input('Pro 推理强度', 'default');
  expect(within(screen.getByLabelText('Pro 推理强度')).queryByRole('option', { name: /高档/ })).toBeNull();
  expect(check().getAttribute('aria-checked')).toBe('false'); expect(save).not.toHaveBeenCalled();
});
test('主动确认才记录绑定来源时间，保存保留其他模型；取消不写，重开回显', async () => {
  const initial: DeepseekEndpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default',
    reasoningCapabilities: { baseUrl: defaultDeepseekEndpoint.baseUrl, wireApi: 'responses', models: { other: { high: true, source: 'user', updatedAt: '2026-10-28T00:00:00.000Z' } } } };
  let saved = initial; const save = vi.fn(async (next: DeepseekEndpoint) => { saved = deepseekEndpoint(next); return true; });
  const r = render(<DeepseekSettings value={initial} save={save} close={() => {}} />);
  fireEvent.click(check()); expect(save).not.toHaveBeenCalled(); input('Pro 推理强度', 'high');
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(saved.reasoningCapabilities?.models.other).toEqual(initial.reasoningCapabilities?.models.other);
  const entry = saved.reasoningCapabilities!.models[saved.proModel]; expect(entry.high).toBe(true); expect(entry.source).toBe('user'); expect(new Date(entry.updatedAt).toISOString()).toBe(entry.updatedAt);
  r.unmount(); render(<DeepseekSettings value={saved} save={save} close={() => {}} />);
  expect(check().getAttribute('aria-checked')).toBe('true'); expect(screen.getByText(/Pro 来源：用户确认/)).toBeTruthy();
});
test('模型/地址/协议变化不借旧声明，取消和普通保存不生成新确认', async () => {
  const initial: DeepseekEndpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default',
    reasoningCapabilities: { baseUrl: defaultDeepseekEndpoint.baseUrl, wireApi: 'responses', models: { [defaultDeepseekEndpoint.proModel]: { high: true, source: 'user', updatedAt: '2026-10-28T00:00:00.000Z' } } } };
  const save = vi.fn(async (_next: DeepseekEndpoint) => true);
  render(<DeepseekSettings value={initial} save={save} close={() => {}} />);
  input('Pro 模型 ID', 'new-model'); expect(check().getAttribute('aria-checked')).toBe('false');
  input('Pro 模型 ID', initial.proModel); input('API 协议', 'chat'); expect(check().getAttribute('aria-checked')).toBe('false');
  input('API 协议', initial.wireApi); input('API 地址', 'https://other.invalid/v1/'); expect(check().getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].reasoningCapabilities).toEqual(initial.reasoningCapabilities);
  expect(initial.reasoningCapabilities?.models[initial.proModel].updatedAt).toBe('2026-10-28T00:00:00.000Z');
});
test('同模型共用确认，撤销不自动改模式，非法连接不能确认', () => {
  render(<DeepseekSettings value={{ ...defaultDeepseekEndpoint, flashModel: defaultDeepseekEndpoint.proModel }} save={vi.fn(async () => true)} close={() => {}} />);
  fireEvent.click(check()); expect(screen.getByRole('switch', { name: '我已确认 Flash 当前模型支持高档' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(check()); expect(screen.getByLabelText('Pro 推理强度')).toHaveProperty('value', 'high');
  input('API 地址', 'not-a-url'); expect(check()).toHaveProperty('disabled', true);
});
