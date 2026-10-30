import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { writeSettings } from '../src/core/settings.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { buildView } from '../src/core/view.ts';
import { notices, notificationTracker } from '../app/main/notifications.ts';
import type { Notice } from '../app/main/notifications.ts';
const at = '2026-10-29T01:00:01.000Z';
const job = { id: 'money-notice', batch: '', project: '测试', repo: '/repo', worktree: '/repo', base: 'abc', branch: 'test',
 who: 'deepseek', model: 'saved', effort: 'high', kind: '实现', mode: 'read-only', title: '预算测试', state: 'stopped',
 created: '2026-10-29T01:00:00.000Z', started: '2026-10-29T01:00:00.000Z', ended: '2026-10-29T01:00:02.000Z',
 termination: 'manual', deepseekBudgetGroup: 'accountB' };
const evidence = { at, group: 'accountB', hard: 5, soft: 4, reason: 'raw-secret-never-display', status: { spent: 0.2, reserved: 0.8 } };

test('真实CLI达到B组上限→runner首停证据→安全视图→通知替身只发一次', { timeout: 20000 }, async t => {
 const c = await context(t); process.env.XAGENTS_HOME = c.home;
 assert.equal((await c.add()).code, 0);
 const money = { ...defaultDeepseekMoney, enabled: true, soft: 0.1, hard: 0.2, reserve: 0.2,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
 await writeSettings({ keepAwake: false, deepseek: { ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default',
  budgetGroup: 'accountB', moneyGroups: { accountB: money } } });
 const options = { found: async () => true, windows: false }, sent: Notice[] = [];
 const track = await notificationTracker(join(c.home, 'notify-real'), notice => sent.push(notice));
 await track(await buildView(options));
 const fake = join(c.temp, 'budget-notice-worker.mjs');
 await writeFile(fake, "import {writeFileSync} from 'node:fs'; const at=process.argv.indexOf('-o'); writeFileSync(process.argv[at+1],'金额停止前报告'); console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:200000,cached_input_tokens:0,output_tokens:0}})); setInterval(()=>{},1000);");
 const run = await c.cli(['run', c.task, '--summary', '金额停止通知验收', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
 assert.equal(run.code, 0, run.stderr);
 const ended = await until(async () => (await c.jobs())[0], j => !!j && ['stopped','done','failed'].includes(j.state), 12000);
 assert.equal(ended.state, 'stopped', ended.error); assert.match(ended.error ?? '', /费用上限/);
 const view = await buildView(options), row = view.jobs.find(j => j.id === ended.id)!;
 assert.ok(row.moneyStopAt); assert.equal(view.moneyBudget?.stopped, true); assert.equal(view.moneyBudget?.spent, 0.2);
 await track(view); await track(view);
 assert.equal(sent.length, 1); assert.deepEqual(sent[0].target, { kind: 'job', id: ended.id });
});
test('有效费用首停投影安全标记，固定本机通知去重/重启/关闭保持，无证据普通停止不通知', async t => {
 const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
 const options = { found: async () => true, windows: false };
 const sent: Notice[] = [], track = await notificationTracker(join(c.home, 'notify'), notice => sent.push(notice));
 await track(await buildView(options));
 const dir = join(c.home, 'jobs', job.id); await mkdir(dir, { recursive: true });
 await writeFile(join(dir, 'job.json'), JSON.stringify(job));
 assert.equal(notices(await buildView(options)).length, 0);
 const file = join(dir, 'money-stop-1.json');
 for (const bad of ['{broken', JSON.stringify({ ...evidence, group: 'other' }), JSON.stringify({ ...evidence, at: 'bad' }),
   JSON.stringify({ ...evidence, status: { spent: -1, reserved: 0 } })]) {
  await writeFile(file, bad);
  assert.equal(notices(await buildView(options)).length, 0);
 }
 await writeFile(file, JSON.stringify(evidence));
 const view = await buildView(options); assert.equal(view.jobs[0].moneyStopAt, at);
 assert.equal(JSON.stringify(view).includes('raw-secret'), false);
 assert.equal(notices(view)[0].body, '费用看管已停止任务，请检查预算及费用。');
 await track(view); await track(view); assert.equal(sent.length, 1);
 assert.deepEqual(sent[0].target, { kind: 'job', id: job.id });
 const restarted = await notificationTracker(join(c.home, 'notify'), notice => sent.push(notice));
 await restarted(view); await restarted(view); assert.equal(sent.length, 1);
 const later = { ...view, jobs: view.jobs.map(j => ({ ...j, moneyStopAt: '2026-10-29T01:00:01.500Z' })), settings: { ...view.settings, notifications: false } };
 await track(later); later.settings.notifications = true; await track(later); assert.equal(sent.length, 1);
 await writeFile(join(dir, 'job.json'), JSON.stringify({ ...job, state: 'running' }));
 assert.equal(notices(await buildView(options)).length, 0);
 await writeFile(join(dir, 'job.json'), JSON.stringify({ ...job, resume: { round: 2 } }));
 assert.equal(notices(await buildView(options)).length, 0, '旧轮证据不套新轮');
});

