import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeepseekSettings } from '../../app/renderer/components/DeepseekSettings.tsx';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekEndpoint } from '../../src/core/deepseek-settings.ts';
afterEach(cleanup);

test('安全余量保存重开保留0与合法值，清空省略字段', async () => {
  let saved = { ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney } };
  const save = vi.fn(async (value: typeof saved) => { saved = deepseekEndpoint(value) as typeof saved; return true; });
  let mounted = render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
  const label = '单任务安全余量（元，可选）';
  expect(screen.getByLabelText(label)).toHaveProperty('value', '');
  expect(screen.getByText(/只占运行预留，不计入实际消费/)).toBeTruthy();
  for (const [index, value] of ['0', '2', ''].entries()) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(index + 1));
    if (value === '') expect(saved.money).not.toHaveProperty('safetyMargin');
    else expect(saved.money.safetyMargin).toBe(Number(value));
    mounted.unmount();
    mounted = render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
    expect(screen.getByLabelText(label)).toHaveProperty('value', value);
  }
});

test('非法安全余量拒绝保留草稿，取消不写入且原配置不变', async () => {
  const save = vi.fn(async () => true), close = vi.fn();
  const value = { ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney, safetyMargin: 1 } };
  render(<DeepseekSettings value={value} close={close} save={save} />);
  const field = screen.getByLabelText('单任务安全余量（元，可选）');
  for (const amount of ['-1', '11']) {
    fireEvent.change(field, { target: { value: amount } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败：安全余量须为非负金额，且不能超过上限预算。');
    expect(save).not.toHaveBeenCalled(); expect(field).toHaveProperty('value', amount);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
  }
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledTimes(1); expect(value.money.safetyMargin).toBe(1);
  expect(save).not.toHaveBeenCalled();
});

test('剩余预算显示核心快照，不随未保存阈值变化，不冒充派活许可', () => {
  render(<DeepseekSettings value={{ ...defaultDeepseekEndpoint, money: defaultDeepseekMoney }} close={() => {}} save={async () => true}
    moneyStatus={{ day: '2026-10-28', spent: 2, reserved: 1, unknown: 1, stopped: true, remaining: 5, softRemaining: 2 }} />);
  expect(screen.getByText(/距上限预估剩余 ¥5.0000，距软预算预估剩余 ¥2.0000/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('每日上限预算（元）'), { target: { value: '100' } });
  expect(screen.getByText(/距上限预估剩余 ¥5.0000/)).toBeTruthy();
  expect(screen.getByText(/不是账户余额或派活许可/)).toBeTruthy();
  expect(screen.getByText(/今日已停派/)).toBeTruthy();
});

test('旧快照缺剩余字段保持未知，不补零', () => {
  render(<DeepseekSettings close={() => {}} save={async () => true}
    moneyStatus={{ day: '2026-10-28', spent: 0, reserved: 0, unknown: 0, stopped: false }} />);
  expect(screen.getByText(/距上限预估剩余未知，距软预算预估剩余未知/)).toBeTruthy();
});

test('编辑连接展示每日双预算与真实价格单位，保存交给核心校验', async () => {
  const save = vi.fn(async (_value: import('../../src/core/deepseek-settings.ts').DeepseekEndpoint, _key: string) => true);
  render(<DeepseekSettings value={{ ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney } }} close={() => {}} save={save}
    moneyStatus={{ day: '2026-10-26', spent: 2, reserved: 1, unknown: 1, stopped: false }} />);
  expect(screen.getByText(/今日预估 ¥2.0000/)).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: '每日预估费用预算' }));
  fireEvent.change(screen.getByLabelText('每日软预算（元）'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('每日上限预算（元）'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Pro 未缓存输入单价（元/百万 token）'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Flash 未缓存输入单价（元/百万 token）'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0]).toMatchObject({ money: { enabled: true, soft: 5, hard: 8, pro: { input: 2 } } });
});

test('可选写入价保存并重开：空值省略、0 不丢失，两个槽位隔离', async () => {
  let saved = { ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney } };
  const save = vi.fn(async (value: typeof saved) => { saved = deepseekEndpoint(value) as typeof saved; return true; });
  const first = render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
  const label = (slot: string) => `${slot} 缓存写入单价（元/百万 token，可选）`;
  expect(screen.getByLabelText(label('Pro'))).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText(label('Pro')), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText(label('Flash')), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(saved.money.pro).toMatchObject({ cacheWrite: 0 });
  expect(saved.money.flash).toMatchObject({ cacheWrite: 8 });
  first.unmount();
  render(<DeepseekSettings value={saved} close={() => {}} save={save} />);
  expect(screen.getByLabelText(label('Pro'))).toHaveProperty('value', '0');
  expect(screen.getByLabelText(label('Flash'))).toHaveProperty('value', '8');
  fireEvent.change(screen.getByLabelText(label('Pro')), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(saved.money.pro).not.toHaveProperty('cacheWrite');
  expect(saved.money.flash.cacheWrite).toBe(8);
});

test('非法写入价保存前拒绝并保留草稿；改正后可保存', async () => {
  const save = vi.fn(async () => true);
  render(<DeepseekSettings value={{ ...defaultDeepseekEndpoint, money: defaultDeepseekMoney }} close={() => {}} save={save} />);
  const field = screen.getByLabelText('Pro 缓存写入单价（元/百万 token，可选）');
  for (const value of ['-1', '1000001']) {
    fireEvent.change(field, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败：缓存写入单价须为 0～100 万元/百万 token。');
    expect(save).not.toHaveBeenCalled();
    expect(field).toHaveProperty('value', value);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
  }
  fireEvent.change(field, { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
});

test('换模型清除写入价，取消不提交，原配置不被编辑污染', () => {
  const value = { ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney,
    pro: { ...defaultDeepseekMoney.pro, cacheWrite: 5 }, flash: { ...defaultDeepseekMoney.flash, cacheWrite: 6 } } };
  const save = vi.fn(async () => true), close = vi.fn();
  render(<DeepseekSettings value={value} close={close} save={save} />);
  fireEvent.change(screen.getByLabelText('Pro 模型 ID'), { target: { value: 'another-pro' } });
  expect(screen.getByLabelText('Pro 缓存写入单价（元/百万 token，可选）')).toHaveProperty('value', '');
  expect(screen.getByLabelText('Flash 缓存写入单价（元/百万 token，可选）')).toHaveProperty('value', '6');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
  expect(value.money.pro.cacheWrite).toBe(5);
});

test('取消不保存；更换模型不沿用旧模型价格', () => {
  const save = vi.fn(async () => true), close = vi.fn();
  render(<DeepseekSettings value={{ ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney, pro: { input: 3, cached: 1, output: 4 } } }} close={close} save={save} />);
  fireEvent.change(screen.getByLabelText('Pro 模型 ID'), { target: { value: 'new-model' } });
  expect((screen.getByLabelText('Pro 未缓存输入单价（元/百万 token）') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
});
