import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';

for (const kind of ['ledger', 'settings'] as const) test(`收尾隔离：${kind} 损坏仍保存报告与补丁`, { timeout: 30_000 }, async t => {
  const c = await context(t);
  assert.equal((await c.add()).code, 0);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ keepAwake: false, deepseek: { ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default',
    money: { ...defaultDeepseekMoney, enabled: true, pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } } } }));
  const fake = join(c.temp, `corrupt-${kind}.mjs`);
  const target = kind === 'ledger' ? join(c.home, 'money-budget/deepseek.json') : join(c.home, 'config.json');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';
    writeFileSync('proof.txt','保留成果');
    const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
    writeFileSync(process.argv[at+1],'已完成故障回归');
    writeFileSync(${JSON.stringify(target)},'{broken');`);
  const run = await c.cli(['run', c.task, '--summary', '验证账本异常保留成果', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(run.code, 0, run.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 20_000);
  assert.equal(job.state, 'failed', job.error);
  assert.match(job.error ?? '', /费用结算失败/);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'report.md'), 'utf8'), /已完成故障回归/);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'diff.patch'), 'utf8'), /proof.txt/);
});

test('真实看管替身：达到金额上限后停止进程，后续派活被拒，日志和费用保留', { timeout: 30_000 }, async t => {
  const c = await context(t);
  assert.equal((await c.add()).code, 0);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ keepAwake: false, deepseek: {
    ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default', money: { ...defaultDeepseekMoney, enabled: true, soft: 0.5, hard: 1, reserve: 1,
      pro: { input: 1, cached: 0.1, output: 2 }, flash: { input: 1, cached: 0.1, output: 2 } },
  } }));
  const fake = join(c.temp, 'money-worker.mjs');
  await writeFile(fake, `process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n');
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:2000000,cached_input_tokens:0,output_tokens:0}})+'\\n');
    setInterval(()=>{},1000);`.replaceAll("+'\\n'", "+'\\n'"));
  const run = await c.cli(['run', c.task, '--summary', '验证金额看管', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(run.code, 0, run.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && ['stopped', 'failed', 'done'].includes(j.state), 20_000);
  assert.equal(job.state, 'stopped', job.error);
  assert.match(job.error ?? '', /费用上限/);
  const raw = await readFile(join(c.home, 'money-budget/deepseek.json'), 'utf8');
  const book = JSON.parse(raw);
  assert.equal(book.entries[job.id].active, false);
  assert.ok(Object.values<number>(book.days).some(v => v >= 2_000_000));
  const next = await c.cli(['run', c.task, '--summary', '不应继续收费', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal((await c.jobs()).filter(j => j.state === 'running').length, 0);
  assert.ok(next.stderr.includes('预算') || (await c.jobs()).some(j => /预算/.test(j.error ?? '')));
});
