import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';

for (const mode of ['default', 'high'] as const) test(`真实CLI派发${mode}：参数/冻结能力/报告/费用兼容且未知high不注册`, { timeout: 20_000 }, async t => {
  const c = await context(t); assert.equal((await c.add()).code, 0);
  const file = join(c.home, 'config.json'), model = 'relay/pro';
  const endpoint = { ...defaultDeepseekEndpoint, proModel: model, proReasoning: mode,
    money: { ...defaultDeepseekMoney, enabled: true, pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } } };
  await writeFile(file, JSON.stringify({ keepAwake: false, deepseek: { ...endpoint, proReasoning: 'high' } }));
  const rejected = await c.cli(['run', c.task, '--summary', '未知能力拒绝', '--who', 'deepseek:high']);
  assert.notEqual(rejected.code, 0); assert.match(rejected.stderr, /高档推理能力/); assert.equal((await c.jobs()).length, 0);
  const confirmed = { ...endpoint, ...(mode === 'high' ? { reasoningCapabilities: { baseUrl: endpoint.baseUrl, wireApi: endpoint.wireApi,
    models: { [model]: { high: true, source: 'user', updatedAt: '2026-10-29T00:00:00.000Z' } } } } : {}) };
  await writeFile(file, JSON.stringify({ keepAwake: false, deepseek: confirmed }));
  const fake = join(c.temp, 'reason-dispatch.mjs'), argvPath = join(c.temp, 'argv.json');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';
    writeFileSync(${JSON.stringify(argvPath)},JSON.stringify(process.argv.slice(2)));
    writeFileSync(process.argv[process.argv.indexOf('-o')+1],'推理模式兼容报告');
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:100000,cached_input_tokens:0,output_tokens:0}})+String.fromCharCode(10));`);
  const result = await c.cli(['run', c.task, '--summary', '推理模式兼容', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(result.code, 0, result.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && ['done', 'failed', 'stopped'].includes(j.state));
  assert.equal(job.state, 'done', job.error); assert.equal(job.model, model); assert.equal(job.deepseekConnection?.proReasoning, mode);
  assert.deepEqual(job.deepseekConnection?.reasoningCapabilities, mode === 'high' ? confirmed.reasoningCapabilities : undefined);
  const args: string[] = JSON.parse(await readFile(argvPath, 'utf8'));
  assert.equal(args[args.indexOf('-m') + 1], model);
  assert.deepEqual(args.filter(arg => arg.includes('model_reasoning_effort')), mode === 'high' ? ['model_reasoning_effort="high"'] : []);
  const book = JSON.parse(await readFile(join(c.home, 'money-budget/deepseek.json'), 'utf8'));
  assert.equal(book.entries[job.id].charged, 100_000); assert.equal(book.entries[job.id].active, false);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'report.md'), 'utf8'), /推理模式兼容报告/);
});
