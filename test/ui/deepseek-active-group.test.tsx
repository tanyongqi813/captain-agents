import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeepseekSettings } from '../../app/renderer/components/DeepseekSettings.tsx';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekEndpoint } from '../../src/core/deepseek-settings.ts';
afterEach(cleanup);
const money = { ...defaultDeepseekMoney, enabled: true, pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
const value = { ...defaultDeepseekEndpoint, money, moneyGroups: { accountB: { ...money, hard: 12, pro: { input: 2, cached: 0, output: 1 } } } };
function selectB() {
  fireEvent.change(screen.getByRole('combobox', { name: '费用预算组' }), { target: { value: 'accountB' } });
}

test('新组显式草稿从关闭/零价开始，保存不改其他组，取消不写', async () => {
  let saved = deepseekEndpoint(value);
  const save = vi.fn(async (next: typeof saved) => { saved = deepseekEndpoint(next); return true; });
  const mounted = render(<DeepseekSettings value={value} close={() => {}} save={save} />);
  fireEvent.change(screen.getByLabelText('新预算组名称'), { target: { value: 'accountNew' } });
  fireEvent.click(screen.getByRole('button', { name: '创建预算组' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByLabelText('费用预算组')).toHaveProperty('value', 'accountNew');
  expect(screen.getByRole('switch', { name: '每日预估费用预算' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByLabelText('Pro 未缓存输入单价（元/百万 token）')).toHaveProperty('value', '0');
  fireEvent.change(screen.getByLabelText('每日上限预算（元）'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(saved.budgetGroup).toBe('accountNew');
  expect(saved.moneyGroups?.accountNew.enabled).toBe(false);
  expect(saved.moneyGroups?.accountNew.hard).toBe(20);
  expect(saved.money).toEqual(value.money); expect(saved.moneyGroups?.accountB).toEqual(value.moneyGroups.accountB);
  mounted.unmount(); const cancel = vi.fn();
  render(<DeepseekSettings value={value} close={cancel} save={save} />);
  fireEvent.change(screen.getByLabelText('新预算组名称'), { target: { value: 'unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: '创建预算组' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(cancel).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledTimes(1);
});

test('重复default/已有/非法组及超32组拒绝，不覆盖价格', () => {
  const save = vi.fn(async () => true);
  const mounted = render(<DeepseekSettings value={value} close={() => {}} save={save} />);
  for (const name of ['default', 'accountB', '../bad', '', '__proto__']) {
    fireEvent.change(screen.getByLabelText('新预算组名称'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: '创建预算组' }));
    expect(screen.getByRole('alert').textContent).toMatch(/创建预算组失败/);
    expect(screen.getByLabelText('费用预算组')).toHaveProperty('value', 'default');
  }
  expect(value.moneyGroups.accountB.pro.input).toBe(2); expect(save).not.toHaveBeenCalled();
  mounted.unmount();
  render(<DeepseekSettings value={{ ...value, moneyGroups: Object.fromEntries(Array.from({ length: 32 }, (_, n) => ['group' + n, money])) }} close={() => {}} save={save} />);
  fireEvent.change(screen.getByLabelText('新预算组名称'), { target: { value: 'overflow' } });
  fireEvent.click(screen.getByRole('button', { name: '创建预算组' }));
  expect(screen.getByRole('alert').textContent).toMatch(/最多32/);
  expect(screen.getByLabelText('费用预算组')).toHaveProperty('value', 'default');
});
test('显式选择组只编辑该组，隐藏旧费用，保存重开保持；default与其他组不改', async () => {
  let saved = deepseekEndpoint(value);
  const save = vi.fn(async (next: typeof saved) => { saved = deepseekEndpoint(next); return true; });
  const mount = render(<DeepseekSettings value={value} close={() => {}} save={save}
    moneyStatus={{ day: '2026-10-29', spent: 7, reserved: 0, unknown: 0, stopped: false }} />);
  selectB();
  expect(screen.queryByText(/今日预估 ¥7/)).toBeNull();
  expect(screen.getByText(/预算组尚未保存/)).toBeTruthy();
  expect(screen.getByLabelText('每日上限预算（元）')).toHaveProperty('value', '12');
  fireEvent.change(screen.getByLabelText('每日上限预算（元）'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(saved.budgetGroup).toBe('accountB');
  expect(saved.moneyGroups?.accountB.hard).toBe(15); expect(saved.money).toEqual(money);
  mount.unmount();
  render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
  expect(screen.getByLabelText('每日上限预算（元）')).toHaveProperty('value', '15');
});
test('换组选项和费用取消不写原配置', () => {
  const save = vi.fn(async () => true), close = vi.fn();
  render(<DeepseekSettings value={value} close={close} save={save} />);
  selectB(); fireEvent.change(screen.getByLabelText('每日软预算（元）'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(save).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  expect(value.moneyGroups.accountB.soft).toBe(8);
});
