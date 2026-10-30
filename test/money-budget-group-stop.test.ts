import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { writeSettings } from '../src/core/settings.ts';
const dispatchUrl = new URL('../src/core/dispatch.ts', import.meta.url).href;

test('B组实现与审查均停止、force无法绕过，C组继续并独立结算', { timeout: 45_000 }, async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  const money = { ...defaultDeepseekMoney, enabled: true, soft: 4, hard: 5, reserve: 1,
    pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
  const endpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const, money, moneyGroups: { accountB: money, accountC: money } };
  await writeSettings({ keepAwake: false, deepseek: endpoint });
  const fake = join(c.temp, 'group-stop-worker.mjs'), release = join(c.temp, 'release');
  await writeFile(fake, `import {existsSync,writeFileSync} from 'node:fs';
    writeFileSync('proof.txt','组停机成果');
    const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
    writeFileSync(process.argv[at+1],'组停机报告');
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:200000,cached_input_tokens:0,output_tokens:0}})+String.fromCharCode(10));
    setInterval(()=>{ writeFileSync('tick.txt',String(Date.now())); if(existsSync(${JSON.stringify(release)})) process.exit(0); },100);`);
  const launch = (group: string, kind: string, force = false) => exec(process.execPath, ['--input-type=module', '-e',
    `import {dispatch} from ${JSON.stringify(dispatchUrl)}; await dispatch(${JSON.stringify(c.task)},${JSON.stringify({ who: ['deepseek:high'], summary: '组停机验证', moneyGroup: group, kind, force })});`],
    c.repo, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  for (const [group, kind] of [['accountB', '实现'], ['accountB', '审查'], ['accountC', '实现']]) {
    const result = await launch(group, kind); assert.equal(result.code, 0, result.stderr);
  }
  const jobs = await until(c.jobs, rows => rows.length === 3 && rows.every(j => j.state === 'running'), 15_000);
  const bJobs = jobs.filter(j => j.deepseekBudgetGroup === 'accountB'), cJob = jobs.find(j => j.deepseekBudgetGroup === 'accountC')!;
  assert.equal(bJobs.length, 2); assert.deepEqual(new Set(bJobs.map(j => j.kind)), new Set(['实现', '审查']));
  const bookPath = join(c.home, 'money-budget', 'deepseek.json');
  const book = () => readFile(bookPath, 'utf8').then(text => JSON.parse(text));
  await until(book, b => jobs.every(j => b.entries[j.id]?.charged === 200_000), 12_000);
  const triggerAt = Date.now();
  await writeSettings({ deepseek: { ...endpoint, moneyGroups: { accountB: { ...money, soft: 0.4, hard: 0.4, reserve: 0.1 }, accountC: money } } });
  const stopped = await until(c.jobs, rows => bJobs.every(j => rows.find(row => row.id === j.id)?.state === 'stopped'), 15_000);
  for (const job of bJobs) {
    const ended = stopped.find(row => row.id === job.id)!;
    assert.match(ended.error ?? '', /费用上限/);
    assert.ok(Date.parse(ended.ended!) >= triggerAt);
    assert.match(await readFile(join(c.home, 'jobs', job.id, 'report.md'), 'utf8'), /组停机报告/);
    assert.match(await readFile(join(c.home, 'jobs', job.id, 'diff.patch'), 'utf8'), /proof.txt/);
  }
  const tickBefore = Number(await readFile(join(cJob.worktree, 'tick.txt'), 'utf8'));
  await until(async () => Number(await readFile(join(cJob.worktree, 'tick.txt'), 'utf8')), tick => tick - tickBefore > 2200, 8000);
  assert.equal((await c.jobs()).find(j => j.id === cJob.id)?.state, 'running');
  const blocked = await launch('accountB', '实现', true);
  assert.notEqual(blocked.code, 0); assert.match(blocked.stderr, /预算/);
  const extra = (await c.jobs()).filter(j => !jobs.some(old => old.id === j.id));
  assert.equal(extra.length, 1); assert.equal(extra[0].state, 'failed'); assert.equal(extra[0].workerPid, undefined);
  const afterStop = await book();
  assert.ok(!afterStop.entries[extra[0].id]?.active);
  assert.equal(afterStop.groups.accountB.stopped.length, 1); assert.deepEqual(afterStop.groups.accountC.stopped, []);
  assert.equal(Object.values<number>(afterStop.groups.accountB.days).reduce((sum, n) => sum + n, 0), 2_000_000);
  for (const j of bJobs) assert.equal(afterStop.entries[j.id].active, false);
  assert.equal(afterStop.entries[cJob.id].active, true);
  await writeFile(release, 'done');
  const done = await until(async () => (await c.jobs()).find(j => j.id === cJob.id)!, j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 15_000);
  assert.equal(done.state, 'done', done.error);
  const final = await book();
  assert.equal(Object.values<number>(final.groups.accountC.days).reduce((sum, n) => sum + n, 0), 200_000);
  assert.equal(final.entries[cJob.id].active, false);
  assert.deepEqual(final.days, {}); assert.deepEqual(final.stopped, []);
});
