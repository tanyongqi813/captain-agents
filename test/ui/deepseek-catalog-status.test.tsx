import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeepseekSettings } from '../../app/renderer/components/DeepseekSettings.tsx';
import { defaultDeepseekEndpoint } from '../../src/core/deepseek-settings.ts';

afterEach(cleanup);
const at = '2026-10-27T10:00:00.000Z';
const setup = (catalog?: { at: string | null; error: string | null }) => {
  const save = vi.fn(async () => true);
  render(<DeepseekSettings value={defaultDeepseekEndpoint} catalog={catalog} close={() => {}} save={save} />);
  return save;
};

test('目录时间只读显示保存连接最后成功值，陈旧不刷新时间或触发保存', () => {
  const save = setup({ at, error: '目录已过期，请在编辑中重新获取模型。' });
  expect(screen.getByText(`已保存连接上次成功获取：${new Date(at).toLocaleString('zh-CN')}`)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('上次目录待刷新：目录已过期');
  expect(save).not.toHaveBeenCalled();
});

test('没有目录不编成功时间', () => {
  setup({ at: null, error: null });
  expect(screen.getByText('已保存连接尚无成功获取记录。')).toBeTruthy();
  expect(screen.queryByText(/上次成功获取：/)).toBeNull();
});

test('修改地址不沿用旧目录状态，恢复原地址才恢复原快照', () => {
  setup({ at, error: '旧目录错误' });
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://other.example/v1/' } });
  expect(screen.getByText('连接或密钥正在修改，不沿用已保存连接的目录状态。')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(/上次成功获取：/)).toBeNull();
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: defaultDeepseekEndpoint.baseUrl } });
  expect(screen.getByRole('status').textContent).toContain('旧目录错误');
});
