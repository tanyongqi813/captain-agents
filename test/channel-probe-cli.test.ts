import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { exec } from './helpers.ts';

const run = (args: string[]) => exec(process.execPath, [resolve('scripts/channel-probe-offline.ts'), ...args], resolve('.'));
test('离线脚本无参数/真实模式/额外命令拒绝，不开放任意执行入口', async () => {
  for (const args of [[], ['--real', 'success'], ['--offline', 'success', 'anything'], ['--offline', '__proto__']]) {
    const r = await run(args); assert.equal(r.code, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, /不提供真实通道/);
  }
});
test('独立CLI固定场景产生安全报告，未知用量/金额限额不补值', async () => {
  for (const scenario of ['success', 'silent', 'started', 'hang', 'flood']) {
    const r = await run(['--offline', scenario]), parsed = JSON.parse(r.stdout);
    assert.equal(r.code, scenario === 'success' ? 0 : 1);
    assert.equal(parsed.mode, 'offline_fixture'); assert.equal(parsed.realModelCalled, false); assert.equal(parsed.amountHardLimit, null);
    assert.equal(parsed.report.usage, null); assert.equal(parsed.report.model, null);
    assert.equal(parsed.report.outcome, ({ success: 'success', silent: 'failed', started: 'timeout', hang: 'timeout', flood: 'output_limit' })[scenario]);
  }
});
