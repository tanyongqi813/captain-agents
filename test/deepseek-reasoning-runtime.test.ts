import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec } from './helpers.ts';
import { defaultDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { assertDeepseekRuntimeReasoning } from '../src/core/deepseek-reasoning-runtime.ts';
import { createJob, readJob } from '../src/core/job.ts';
import type { Job } from '../src/core/job.ts';

function make(repo: string, id: string, high: boolean): Job {
  const endpoint = { ...defaultDeepseekEndpoint, proReasoning: high ? 'high' as const : 'default' as const,
    reasoningCapabilities: { baseUrl: defaultDeepseekEndpoint.baseUrl, wireApi: defaultDeepseekEndpoint.wireApi,
      models: { [defaultDeepseekEndpoint.proModel]: { high: true, source: 'user' as const, updatedAt: '2026-10-29T00:00:00.000Z' } } } };
  return { id, batch: 'test', who: 'deepseek', effort: 'high', model: endpoint.proModel, deepseekConnection: endpoint,
    repo, worktree: repo, branch: 'main', base: 'unused', project: '测试', title: '能力验收', kind: '实现', mode: 'read-only', state: 'queued', created: new Date().toISOString(),
    command: { file: process.execPath, args: ['exec', '-m', endpoint.proModel, ...(high ? ['-c', 'model_reasoning_effort="high"'] : []), '-'], env: {}, stdin: 'ignore', output: 'run.log' } };
}

test('冻结能力与实际命令严格一致，歧义/额外覆盖/缺快照拒绝，非DeepSeek不变', () => {
  const job = make('/unused', 'test', true), cmd = job.command!;
  assert.doesNotThrow(() => assertDeepseekRuntimeReasoning(job, cmd));
  for (const args of [cmd.args.map(arg => arg === job.model ? 'other' : arg), [...cmd.args, '--model=other'],
    [...cmd.args, '-c', 'model_reasoning_effort="xhigh"'], cmd.args.map(arg => arg === 'model_reasoning_effort="high"' ? 'model_reasoning_effort="max"' : arg)]) {
    assert.throws(() => assertDeepseekRuntimeReasoning(job, { ...cmd, args }), /命令/);
  }
  assert.throws(() => assertDeepseekRuntimeReasoning({ ...job, deepseekConnection: undefined }, cmd), /冻结/);
  const noCapability = structuredClone(job); delete noCapability.deepseekConnection!.reasoningCapabilities;
  assert.throws(() => assertDeepseekRuntimeReasoning(noCapability, cmd), /高档推理能力/);
  const defaultJob = make('/unused', 'default', false);
  assert.doesNotThrow(() => assertDeepseekRuntimeReasoning(defaultJob, defaultJob.command!));
  assert.throws(() => assertDeepseekRuntimeReasoning(defaultJob, cmd), /默认强度/);
  assert.doesNotThrow(() => assertDeepseekRuntimeReasoning({ ...job, who: 'codex' }, { ...cmd, args: [] }));
});

for (const kind of ['unknown', 'contradiction', 'default', 'high', 'resume'] as const) test(`runner真实末端门槛：${kind}`, async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  const id = `reason-${kind}`, job = make(c.repo, id, ['unknown', 'high', 'resume'].includes(kind));
  const fake = join(c.temp, 'reason-worker.mjs'), marker = join(c.temp, 'launches');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'started');writeFileSync(${JSON.stringify(join(c.home, 'jobs', id, 'final.md'))},'离线能力报告');`);
  job.command!.args.unshift(fake);
  if (kind === 'unknown') delete job.deepseekConnection!.reasoningCapabilities;
  if (kind === 'contradiction') job.command!.args.splice(2, 0, '-c', 'model_reasoning_effort="high"');
  if (kind === 'resume') { job.session = '12345678-1234-1234-1234-123456789abc'; job.resume = { round: 2, prompt: 'prompt-r2.md' }; }
  await createJob(job);
  // 当前保存连接刻意不同且有声明，不能给旧冻结未知能力补授权。
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ keepAwake: false, deepseek: { ...make(c.repo, 'other', true).deepseekConnection, baseUrl: 'https://other.invalid/' } }));
  const result = await exec(process.execPath, ['--input-type=module', '-e', `import {runWorker} from ${JSON.stringify(new URL('../src/core/runner.ts', import.meta.url).href)};await runWorker(${JSON.stringify(id)});`], c.repo, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  assert.equal(result.code, 0, result.stderr); const ended = await readJob(id);
  if (kind === 'unknown' || kind === 'contradiction') {
    assert.equal(ended.state, 'failed'); assert.equal(ended.workerPid, undefined);
    assert.match(ended.error ?? '', kind === 'unknown' ? /高档推理能力/ : /默认强度/);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
    assert.equal(await readFile(join(c.home, 'jobs', id, 'report.md'), 'utf8'), '');
  } else {
    assert.equal(ended.state, 'done', ended.error); assert.equal(await readFile(marker, 'utf8'), 'started');
    assert.match(await readFile(join(c.home, 'jobs', id, 'report.md'), 'utf8'), /离线能力报告/);
  }
});
