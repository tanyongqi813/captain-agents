import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeepseekSettings } from '../../app/renderer/components/DeepseekSettings.tsx';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekEndpoint } from '../../src/core/deepseek-settings.ts';
import type { DeepseekEndpoint } from '../../src/core/deepseek-settings.ts';
afterEach(cleanup);
const value = (): DeepseekEndpoint => ({ ...defaultDeepseekEndpoint, proModel: 'relay/pro', flashModel: 'relay/flash',
  money: { ...defaultDeepseekMoney, enabled: true, pro: { input: 99, cached: 9, output: 99 }, flash: { input: 88, cached: 8, output: 88 },
    modelPrices: { 'relay/pro': { input: 2, cached: 0.5, output: 4 }, 'relay/flash': { input: 3, cached: 0, output: 5 }, other: { input: 7, cached: 1, output: 8 } } },
  moneyGroups: { accountB: { ...defaultDeepseekMoney } } });
const label = (slot = 'Pro', kind = '未缓存输入') => `${slot} ${kind}单价（元/百万 token）`;
const writeLabel = 'Pro 缓存写入单价（元/百万 token，可选）';
const change = (name: string, text: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: text } });

test('全局改模型时未选中的legacy组保留旧价绑定，切回显示未知并要求显式填新价', async () => {
 const original = value();
 original.moneyGroups!.legacy = { ...defaultDeepseekMoney, enabled: true,
  pro: { input: 11, cached: 1, output: 12 }, flash: { input: 13, cached: 1, output: 14 } };
 let saved: DeepseekEndpoint | undefined;
 const save = vi.fn(async (next: DeepseekEndpoint) => { saved = deepseekEndpoint(next); return true; });
 render(<DeepseekSettings value={original} close={() => {}} save={save} />);
 change('Pro 模型 ID', 'relay/new');
 fireEvent.change(screen.getByLabelText('费用预算组'), { target: { value: 'legacy' } });
 expect(screen.getByLabelText(label())).toHaveProperty('value', '');
 expect(screen.getByLabelText(label('Flash'))).toHaveProperty('value', '13');
 fireEvent.click(screen.getByRole('button', { name: '保存' }));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('不能沿用'));
 expect(save).not.toHaveBeenCalled();
 await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
 change(label(), '5'); change(label('Pro', '缓存命中'), '0'); change(label('Pro', '输出'), '6');
 fireEvent.click(screen.getByRole('button', { name: '保存' }));
 await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
 expect(saved?.moneyGroups?.legacy.legacyModels).toEqual({ pro: 'relay/new', flash: 'relay/flash' });
 expect(saved?.moneyGroups?.legacy.pro.input).toBe(5);
 expect(original.moneyGroups!.legacy.pro.input).toBe(11);
 expect(saved?.money?.modelPrices).toEqual(original.money?.modelPrices);
});

test('展示并保存实际ID价格而非legacy，0及其他模型/组保留，重挂载回显', async () => {
  let saved = value(); const original = structuredClone(saved);
  const save = vi.fn(async (next: DeepseekEndpoint) => { saved = deepseekEndpoint(next); return true; });
  const first = render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
  expect(screen.getByLabelText(label())).toHaveProperty('value', '2');
  expect(screen.getByLabelText(label('Flash'))).toHaveProperty('value', '3');
  change(label(), '6'); change(writeLabel, '0');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(saved.money?.modelPrices?.['relay/pro']).toMatchObject({ input: 6, cacheWrite: 0 });
  expect(saved.money?.pro).toEqual(original.money?.pro);
  expect(saved.money?.modelPrices?.other).toEqual(original.money?.modelPrices?.other);
  expect(saved.moneyGroups).toEqual(original.moneyGroups);
  first.unmount(); render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
  expect(screen.getByLabelText(label())).toHaveProperty('value', '6');
  expect(screen.getByLabelText(writeLabel)).toHaveProperty('value', '0');
  change(writeLabel, ''); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(saved.money?.modelPrices?.['relay/pro']).not.toHaveProperty('cacheWrite');
});

test('缺失ID空白不借旧价，启用保存拒绝；逐项补齐必填价才保存', async () => {
  const save = vi.fn(async (_next: DeepseekEndpoint) => true);
  render(<DeepseekSettings value={value()} close={() => {}} save={save} />);
  change('Pro 模型 ID', 'relay/new');
  expect(screen.getByText('Pro 当前模型尚未配置单价。')).toBeTruthy();
  expect(screen.getByLabelText(label())).toHaveProperty('value', '');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('尚未配置单价');
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
  change(label(), '2'); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByLabelText(label('Pro', '缓存命中'))).toHaveProperty('value', '');
  change(label('Pro', '缓存命中'), '0'); change(label('Pro', '输出'), '3');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const next = save.mock.calls[0][0];
  expect(next.money?.modelPrices?.['relay/new']).toEqual({ input: 2, cached: 0, output: 3 });
  expect(next.money?.modelPrices?.['relay/pro'].input).toBe(2);
});

test('切换已有ID读取目标价，同ID双槽编辑同项；取消不污染原值', () => {
  const original = value(), snapshot = structuredClone(original), save = vi.fn(async () => true), close = vi.fn();
  render(<DeepseekSettings value={original} close={close} save={save} />);
  change('Pro 模型 ID', 'relay/flash');
  expect(screen.getByLabelText(label())).toHaveProperty('value', '3');
  change(label(), '4');
  expect(screen.getByLabelText(label('Flash'))).toHaveProperty('value', '4');
  change('Pro 模型 ID', 'relay/missing');
  expect(screen.getByLabelText(label())).toHaveProperty('value', '');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(save).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1); expect(original).toEqual(snapshot);
});

test('清空必填或负价拒绝保留草稿，不将空白当0', async () => {
  const save = vi.fn(async () => true);
  render(<DeepseekSettings value={value()} close={() => {}} save={save} />);
  for (const text of ['', '-1']) {
    change(label(), text); fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('实际模型单价');
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
    expect(screen.getByLabelText(label())).toHaveProperty('value', text); expect(save).not.toHaveBeenCalled();
  }
});
