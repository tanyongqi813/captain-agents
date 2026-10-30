import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { writeSettings } from '../src/core/settings.ts';

test('真实派发冻结实际模型ID及价；换地址模型仍共享今日默认账', { timeout: 30_000 }, async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  const fake = join(c.temp, 'identity-worker.mjs');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';
    const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
    writeFileSync(process.argv[at+1],'身份替身完成');
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:100000,cached_input_tokens:0,output_tokens:0}})+String.fromCharCode(10));`);
  const initial = { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const, flashModel: 'relay/flash-one', money: { ...defaultDeepseekMoney, enabled: true,
    pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } } };
  await writeSettings({ keepAwake: false, deepseek: initial });
  const first = await c.cli(['run', c.task, '--summary', '冻结第一个实际模型', '--who', 'deepseek-flash:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(first.code, 0, first.stderr);
  const old = await until(async () => (await c.jobs())[0], j => ['done', 'failed', 'stopped'].includes(j.state), 15_000);
  assert.equal(old.state, 'done', old.error);
  const bookPath = join(c.home, 'money-budget', 'deepseek.json');
  const before = JSON.parse(await readFile(bookPath, 'utf8'));
  assert.deepEqual(before.entries[old.id].identity, { budgetGroup: 'default', model: 'relay/flash-one' });
  assert.equal(old.model, 'relay/flash-one');
  const changed = { ...initial, baseUrl: 'https://different.example/v1/', flashModel: 'relay/flash-two',
    money: { ...initial.money, flash: { input: 2, cached: 0, output: 1 } } };
  await writeSettings({ deepseek: changed });
  const second = await c.cli(['run', c.task, '--summary', '更换地址和实际模型', '--who', 'deepseek-flash:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(second.code, 0, second.stderr);
  const next = await until(async () => (await c.jobs()).find(j => j.id !== old.id)!, j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 15_000);
  assert.equal(next.state, 'done', next.error);
  const after = JSON.parse(await readFile(bookPath, 'utf8'));
  assert.deepEqual(after.entries[old.id], before.entries[old.id]);
  assert.deepEqual(after.entries[next.id].identity, { budgetGroup: 'default', model: 'relay/flash-two' });
  assert.equal(after.entries[next.id].price.input, 2);
  assert.equal(next.model, 'relay/flash-two');
  assert.equal(Object.values<number>(after.days).reduce((sum, n) => sum + n, 0), 300_000);
});
