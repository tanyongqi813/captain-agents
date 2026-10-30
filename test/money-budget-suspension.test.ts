import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { context, until } from './helpers.ts';
import { reserveMoney, observeMoney } from '../src/core/money-budget.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { alive } from '../src/core/platform.ts';
const money = { ...defaultDeepseekMoney, enabled: true, soft: 4, hard: 5, reserve: 1, unknownSeconds: 30,
 pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };

test('长观测间隔的新累计量补账但停止锁不被刷新，冷读仍拒绝；坏锁拒绝', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const at = Date.parse('2026-10-29T01:00:00Z');
  await reserveMoney('gap', money, money.pro, at);
  await observeMoney('gap', money, { read: 100000, cached: 0, out: 0 }, false, at + 1000);
  assert.match((await observeMoney('gap', money, { read: 200000, cached: 0, out: 0 }, false, at + 32000))!, /无观测时限/);
  const file = join(c.home, 'money-budget', 'deepseek.json'), book = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(book.entries.gap.charged, 200000); assert.equal(book.entries.gap.observationStopped, true);
  assert.match((await observeMoney('gap', money, { read: 300000, cached: 0, out: 0 }, false, at + 33000))!, /无观测时限/);
  book.entries.gap.observationStopped = 'bad'; await writeFile(file, JSON.stringify(book));
  const broken = await readFile(file, 'utf8');
  await assert.rejects(observeMoney('gap', money, undefined), /不合法/);
  assert.equal(await readFile(file, 'utf8'), broken);
});

test('暂停自己的看管进程后恢复：新增用量不掩盖间隔，及时停止并保存金额时间证据', {
  timeout: 60000, skip: process.platform === 'win32' ? 'POSIX SIGSTOP/SIGCONT；不冒充Windows或整机休眠' : false,
}, async t => {
  const c = await context(t); assert.equal((await c.add()).code, 0);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ keepAwake: false,
    deepseek: { ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default', money } }));
  const gate = join(c.temp, 'late-usage'), marker = join(c.temp, 'late-emitted'), fake = join(c.temp, 'suspended-worker.mjs');
  await writeFile(fake, "import {existsSync,writeFileSync} from 'node:fs'; const at=process.argv.indexOf('-o'); writeFileSync(process.argv[at+1],'暂停恢复前报告'); writeFileSync('proof.txt','保留改动'); console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100000,cached_input_tokens:0,output_tokens:0}})); let sent=false; setInterval(()=>{if(!sent&&existsSync(" + JSON.stringify(gate) + ")){sent=true; console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:200000,cached_input_tokens:0,output_tokens:0}})); writeFileSync(" + JSON.stringify(marker) + ",'yes');}},100);");
  const run = await c.cli(['run', c.task, '--summary', '暂停看管恢复验收', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(run.code, 0, run.stderr);
  const file = join(c.home, 'money-budget', 'deepseek.json');
  const book = () => readFile(file, 'utf8').then(JSON.parse);
  await until(book, b => Object.values<{ charged: number }>(b.entries).some(e => e.charged === 100000), 10000);
  const job = (await c.jobs())[0];
  assert.ok(job.pid && job.workerPid && job.pid !== job.workerPid && job.pid !== process.pid);
  assert.ok(alive(job.pid, job.pidSince));
  let paused = false;
  try {
    process.kill(job.pid, 'SIGSTOP'); paused = true;
    await writeFile(gate, 'emit');
    await until(() => readFile(marker, 'utf8').catch(() => ''), value => value === 'yes');
    await sleep(32000);
    assert.ok(alive(job.pid, job.pidSince));
    process.kill(job.pid, 'SIGCONT'); paused = false;
    const resumedAt = Date.now();
    const ended = await until(async () => (await c.jobs()).find(j => j.id === job.id)!, j => ['stopped','failed','done'].includes(j.state), 10000);
    assert.equal(ended.state, 'stopped', ended.error); assert.match(ended.error ?? '', /无观测时限/);
    assert.ok(Date.now() - resumedAt < 10000);
    const dir = join(c.home, 'jobs', job.id), evidence = JSON.parse(await readFile(join(dir, 'money-stop-1.json'), 'utf8'));
    assert.equal(evidence.group, 'default'); assert.equal(evidence.status.spent, 0.2);
    assert.equal(evidence.hard, 5); assert.ok(Number.isFinite(Date.parse(evidence.at)));
    assert.match(evidence.reason, /无观测时限/);
    assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /暂停恢复前报告/);
    assert.match(await readFile(join(dir, 'diff.patch'), 'utf8'), /proof.txt/);
    const entry = (await book()).entries[job.id];
    assert.equal(entry.active, false); assert.equal(entry.charged, 1000000); assert.equal(entry.source, 'reservation_fallback');
  } finally { if (paused && alive(job.pid, job.pidSince)) process.kill(job.pid, 'SIGCONT'); }
});

