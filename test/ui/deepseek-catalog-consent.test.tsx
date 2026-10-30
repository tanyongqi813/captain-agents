import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeepseekSettings } from '../../app/renderer/components/DeepseekSettings.tsx';
import { defaultDeepseekEndpoint } from '../../src/core/deepseek-settings.ts';
import { fixtureBridge } from './fixtures.tsx';
afterEach(cleanup);
const binding = 'a'.repeat(64);
function setup(enabled = false, failing = false) {
  const set = vi.fn(async (on: boolean) => { if (failing) throw new Error('身份已变'); return { enabled: on, binding, grant: on ? 'new' : null }; });
  window.xa = fixtureBridge({ deepseekCatalogConsent: vi.fn(async () => ({ enabled, binding, grant: enabled ? 'old' : null })), setDeepseekCatalogConsent: set });
  const save = vi.fn(async () => true), close = vi.fn();
  render(<DeepseekSettings value={defaultDeepseekEndpoint} save={save} close={close} />);
  return { set, save, close };
}
test('开关读取默认关闭，草稿切换取消不写，保存后显式绑定', async () => {
  const c = setup(); const toggle = screen.getByRole('switch', { name: '自动获取模型目录' });
  await waitFor(() => expect(toggle).not.toHaveProperty('disabled', true));
  expect(toggle.getAttribute('aria-checked')).toBe('false'); fireEvent.click(toggle);
  expect(c.set).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(c.set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(c.set).toHaveBeenCalledWith(true, binding)); expect(c.save).toHaveBeenCalledTimes(1);
});
test('新地址或新密钥草稿不能授权，普通保存不隐式开启', async () => {
  const c = setup(); const toggle = screen.getByRole('switch', { name: '自动获取模型目录' });
  await waitFor(() => expect(toggle).not.toHaveProperty('disabled', true));
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'https://other.example/' } }); expect(toggle).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: defaultDeepseekEndpoint.baseUrl } });
  fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'fake-new-key' } }); expect(toggle).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(c.save).toHaveBeenCalledTimes(1)); expect(c.set).not.toHaveBeenCalled();
});
test('关闭不带binding，授权失败明确连接已保存并保留弹窗', async () => {
  const c = setup(true, true); const toggle = screen.getByRole('switch', { name: '自动获取模型目录' });
  await waitFor(() => expect(toggle).not.toHaveProperty('disabled', true)); fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('连接已保存，目录自动获取授权未更新'));
  expect(c.set).toHaveBeenCalledWith(false, undefined); expect(c.close).not.toHaveBeenCalled();
});
