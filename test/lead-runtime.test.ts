import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until, upgradeAutopilotFixture } from './helpers.ts';
import { ensureHome } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import { aiAttempts, autopilotDir, createAutopilot, parseRun, readAutopilot, updateAutopilot } from '../src/core/autopilot.ts';
import { stepAutopilot, stopAutopilot } from '../src/core/autopilot-engine.ts';
import type { AutopilotDeps } from '../src/core/autopilot-engine.ts';
import { readJob, updateJob } from '../src/core/job.ts';
import { jobDir } from '../src/core/paths.ts';
import { capsuleFingerprint } from '../src/core/task-plan.ts';
import { LEAD_EVIDENCE_OPEN, LEAD_EVIDENCE_CLOSE } from '../src/core/lead-review.ts';
import { writeSettings } from '../src/core/settings.ts';

// 全流程真实子进程，唯一模型通道是临时文件中的离线假选手。
const worker = `import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const args=process.argv.slice(2), final=args[args.indexOf('-o')+1], dir=dirname(final);
const prompt=readFileSync(0,'utf8'), job=JSON.parse(readFileSync(join(dir,'job.json'),'utf8'));
writeFileSync(join(dir,'observed-prompt.md'),prompt);
let report='outcome: completed\\nverification: fake-only';
if(job.autopilotRole==='reviewer'){
 const data=JSON.parse(prompt.split('<<<XAGENTS-LEAD-EVIDENCE>>>')[1].split('<<<XAGENTS-LEAD-EVIDENCE-END>>>')[0]);
 const action=process.env.XA_LEAD_ACTION||'accept';
 const body={schema:1,action,reason:'离线替身复审结论',...data.binding};
 if(action==='correct')body.change={goal:'只修正 base.txt',acceptance:['定向验证通过']};
 if(action==='split')body.nodes=[{id:'one',title:'第一步',goal:'只改 base.txt',acceptance:'检查通过',deps:[]},{id:'two',title:'第二步',goal:'复核 base.txt',acceptance:'检查通过',deps:['one']}];
 if(action==='stale'){body.action='accept';body.candidate='b'.repeat(64);}
 report=action==='legacy'?'## 结论\\n通过':'<<<XAGENTS-LEAD-REVIEW>>>\\n'+JSON.stringify(body)+'\\n<<<XAGENTS-LEAD-END>>>';
}else{writeFileSync(join(process.cwd(),'base.txt'),'已完成本轮修改\\n');}
console.log(JSON.stringify({type:'thread.started',thread_id:'fake-lead-session'}));
writeFileSync(final,report);
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:12}}));
if(job.autopilotRole==='writer'&&process.env.XA_LEAD_WRITER_FAIL==='1')process.exitCode=1;
if(job.autopilotRole==='reviewer'&&process.env.XA_LEAD_REVIEW_FAIL==='1')process.exitCode=1;
`;
async function world(t: TestContext, options: { action?: string; writerFail?: boolean; reviewerFail?: boolean; verify?: string[]; lead?: boolean; policy?: string } = {}) {
  const c = await context(t), fake = join(c.temp, 'lead-worker.mjs'); await writeFile(fake, worker);
  const env: NodeJS.ProcessEnv = { ...c.env, XAGENTS_FAKE_WORKER: fake, XA_LEAD_ACTION: options.action ?? 'accept', XA_LEAD_WRITER_FAIL: options.writerFail ? '1' : '0', XA_LEAD_REVIEW_FAIL: options.reviewerFail ? '1' : '0' };
  const names = Object.keys(env).filter(k => process.env[k] !== env[k]);
  const saved = new Map(names.map(k => [k, process.env[k]]));
  for (const k of names) if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  t.after(() => { for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  await ensureHome(); await mkdir(join(c.repo, 'docs/tasks'), { recursive: true });
  await writeFile(join(c.repo, '.gitignore'), '.worktrees/\n');
  await writeFile(join(c.repo, 'docs/TASK_LIST.md'), '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |\n|---|---|---|---|---|---|\n| [TASK-001](tasks/TASK-001.md) | 实现 | READY | P1 | High | 无 |\n');
  await writeFile(join(c.repo, 'docs/tasks/TASK-001.md'), '# TASK-001：实现\n\n- 状态：`READY`\n- 优先级：`P1`\n- 难度等级：`High`\n- 前置任务：无\n\n## 业务结果\n\n完成本轮修改。\n\n## 验收标准\n\n1. 基线文件正确。\n\n## 架构设计\n\n不能下发的整份规划背景。\n');
  await upgradeAutopilotFixture(c.repo);
  const capsulePath = join(c.repo, 'docs/execution/TASK-001/attempt-01.md');
  const cap = (await readFile(capsulePath, 'utf8')).replace(/## 修改白名单\n[\s\S]*?(?=\n## )/, '## 修改白名单\n\n- `base.txt`\n- max_modified_files: `1`\n');
  await writeFile(capsulePath, cap);
  await c.git(['add', '.']); await c.git(['commit', '-m', 'offline lead fixture']);
  const head = await c.git(['rev-parse', 'HEAD']);
  await addProject('demo', c.repo, { worktreeRoot: '.worktrees', verify: options.verify ?? ['node -e "process.exit(0)"'] });
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high', leadReview: options.lead !== false, policy: options.policy ?? 'long' });
  return { ...c, env, run, cap, capsulePath, head };
}
async function next(id: string, deps: AutopilotDeps = {}) {
  await stepAutopilot(id, deps);
  const run = await readAutopilot(id);
  if (run.action?.jobs?.length) await until(async () => Promise.all(run.action!.jobs!.map(readJob)), jobs => jobs.every(j => !['queued', 'running'].includes(j.state)), 20_000);
  return readAutopilot(id);
}
async function finish(id: string, deps: AutopilotDeps = {}, limit = 12) {
  for (let i = 0; i < limit; i++) { const run = await next(id, deps); if (['completed', 'needs_owner', 'stopped'].includes(run.state)) return run; }
  return assert.fail('新负责人流程没有有界结束');
}
async function reviewerEvidence(id: string) {
  const run = await readAutopilot(id), job = run.flow!.reviews.at(-1)!.jobs![0];
  const prompt = await readFile(join(jobDir(job), 'observed-prompt.md'), 'utf8');
  return { prompt, data: JSON.parse(prompt.split(LEAD_EVIDENCE_OPEN)[1].split(LEAD_EVIDENCE_CLOSE)[0]) };
}

test('负责人运行：显式模式执行→真实只读负责人→登记验收，报告、身份与接受结果原子入账', async t => {
  const c = await world(t), done = await finish(c.run.id);
  assert.equal(done.state, 'completed', done.reason); assert.equal(done.flow!.version, 2);
  assert.equal(done.flow!.lead!.authority, 'codex-luna:high'); assert.equal(done.flow!.lead!.decisions.length, 1);
  assert.equal(done.flow!.lead!.decisions[0].reply.action, 'accept'); assert.equal(aiAttempts(done), 2);
  assert.equal(done.flow!.lead!.decisions[0].reply.binding.candidate, done.flow!.accepted);
  assert.equal(done.flow!.verification!.ok, true); assert.equal(done.action, undefined);
  const writerPrompt = await readFile(join(jobDir(done.attempts[0].jobs![0]), 'observed-prompt.md'), 'utf8');
  assert.equal(writerPrompt.slice(writerPrompt.indexOf('# Execution Capsule')), c.cap, '原样 Capsule 前只保留既有平台规则层');
  assert.ok(!writerPrompt.includes('不能下发的整份规划背景'));
  const { prompt, data } = await reviewerEvidence(done.id);
  assert.equal(data.event, 'completed'); assert.equal(data.capsule.text, c.cap.trim());
  assert.ok(!prompt.includes('不能下发的整份规划背景'));
  assert.equal(data.verification, null); assert.equal(data.budget.usage_tokens_left, null);
  assert.equal(await c.git(['rev-parse', 'HEAD']), c.head); assert.equal(await c.git(['status', '--porcelain']), '');
  assert.deepEqual(parseRun(JSON.parse(await readFile(join(autopilotDir(done.id), 'run.json'), 'utf8')), done.id), done);
});

for (const action of ['correct', 'split'] as const) test(`负责人运行：${action} 决定与整组增量胶囊原子保留，不自动提交或退回自由提示词`, async t => {
  const c = await world(t, { action }), done = await finish(c.run.id);
  assert.equal(done.state, 'needs_owner', done.reason); assert.match(done.reason!, /尚未提交/);
  assert.equal(done.flow!.lead!.decisions[0].reply.action, action);
  const compilation = done.flow!.lead!.decisions[0].compilation!;
  assert.equal(compilation.capsules.length, action === 'split' ? 2 : 1);
  assert.ok(compilation.capsules.every(cap => cap.fingerprint === capsuleFingerprint(cap.text)));
  assert.equal(done.nextPrompt, undefined); assert.equal(done.attempts.length, 1); assert.equal((await c.jobs()).length, 2);
  assert.equal(await c.git(['rev-parse', 'HEAD']), c.head); await assert.rejects(access(join(c.repo, compilation.capsules[0].rel)), /ENOENT/);
  const file = join(autopilotDir(done.id), 'run.json'), before = await readFile(file, 'utf8');
  await assert.rejects(updateAutopilot(done.id, run => {
    const artifact = run.flow!.lead!.decisions[0].compilation!.capsules[0];
    artifact.text = artifact.text.replace('max_modified_files: `1`', 'max_modified_files: `99`'); artifact.fingerprint = capsuleFingerprint(artifact.text);
  }), /负责人/);
  assert.equal(await readFile(file, 'utf8'), before, '无效制品不能半写入，也不能提前转状态');
  await assert.rejects(updateAutopilot(done.id, run => {
    const artifact = run.flow!.lead!.decisions[0].compilation!.capsules[0];
    artifact.text = artifact.text.replace(/> (只修正|只改) base.txt/, '> 与负责人决定不符的另一目标');
    artifact.fingerprint = capsuleFingerprint(artifact.text);
  }), /负责人/);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(await stepAutopilot(done.id), 'ended'); assert.equal((await c.jobs()).length, 2);
});

test('负责人运行：负责人不可用或执行失败均停止，不换其他 AI 冒充负责人', async t => {
  const c = await world(t, { reviewerFail: true });
  const done = await finish(c.run.id); assert.equal(done.state, 'needs_owner');
  assert.equal((await c.jobs()).length, 2); assert.equal(done.flow!.lead!.decisions.length, 0);
});

test('负责人运行：主人禁用负责人后不启动其任务，也不自动选择替代者', async t => {
  const c = await world(t); await next(c.run.id); await next(c.run.id);
  await writeSettings({ workers: { 'codex-luna': { enabled: false, efforts: ['high'], fast: false } } });
  const done = await finish(c.run.id); assert.equal(done.state, 'needs_owner'); assert.equal((await c.jobs()).length, 1);
});

test('负责人运行：验收反复失败仍受总 AI 尝试预算约束，最后一次审查可结算', async t => {
  const c = await world(t, { policy: 'short', verify: ['node -e "process.exit(1)"'] });
  const done = await finish(c.run.id, {}, 16); assert.equal(done.state, 'needs_owner');
  assert.equal(aiAttempts(done), 4); assert.equal((await c.jobs()).length, 4);
  assert.equal(done.flow!.lead!.decisions.length, 3); assert.equal(done.flow!.verification!.ok, false);
});

for (const action of ['handoff', 'owner', 'stale', 'legacy']) test(`负责人运行：${action} 有界交给主人，不自动换人或接受旧格式`, async t => {
  const c = await world(t, { action }), done = await finish(c.run.id);
  assert.equal(done.state, 'needs_owner'); assert.equal(done.nodes[0].state === 'passed', false);
  assert.equal((await c.jobs()).length, 2); assert.equal(done.flow!.accepted, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(done.flow!.lead!.decisions.length, ['stale', 'legacy'].includes(action) ? 0 : 1);
});

test('负责人运行：写手失败与自动中断均回到新负责人，旧诊断不再被启动', async t => {
  const c = await world(t, { action: 'owner', writerFail: true });
  await next(c.run.id);
  await updateJob((await readAutopilot(c.run.id)).action!.jobs![0], job => { job.termination = 'stalled'; });
  const done = await finish(c.run.id); assert.equal(done.state, 'needs_owner');
  assert.equal((await reviewerEvidence(done.id)).data.event, 'interrupted');
  assert.equal(done.diagnoses?.length ?? 0, 0); assert.equal(done.flow!.lead!.decisions.length, 1);
});

test('负责人运行：项目验收失败回到同一负责人，剩余预算不允许无限重试', async t => {
  const c = await world(t, { verify: ['node -e "process.exit(1)"'] });
  await next(c.run.id); await next(c.run.id); await next(c.run.id); await next(c.run.id);
  assert.equal((await readAutopilot(c.run.id)).state, 'verifying');
  process.env.XA_LEAD_ACTION = 'owner';
  const done = await finish(c.run.id); assert.equal(done.state, 'needs_owner');
  assert.equal((await reviewerEvidence(done.id)).data.event, 'verify_failed');
  assert.deepEqual(done.flow!.lead!.decisions.map(d => d.reply.action), ['accept', 'owner']);
  assert.equal(aiAttempts(done), 3); assert.equal(done.flow!.verification!.ok, false);
});

test('负责人运行：原胶囊改变时暂停，不把旧证据送入新轮次', async t => {
  const c = await world(t); await next(c.run.id); await next(c.run.id);
  await writeFile(c.capsulePath, c.cap + '\n主工作区发生变化\n');
  const done = await finish(c.run.id); assert.equal(done.state, 'needs_owner');
  assert.equal((await c.jobs()).length, 1); assert.equal(done.flow!.lead!.decisions.length, 0);
});

test('负责人运行：崩溃后按原审查令牌认领，不重派、不重复累计或写决定', async t => {
  const c = await world(t); await next(c.run.id); await next(c.run.id); await next(c.run.id);
  const pending = await readAutopilot(c.run.id), jobs = pending.action!.jobs!;
  await updateAutopilot(c.run.id, run => { delete run.action!.jobs; delete run.flow!.reviews[0].jobs; run.state = 'recovering'; });
  const done = await finish(c.run.id);
  assert.equal(done.state, 'completed'); assert.equal((await c.jobs()).length, 2);
  assert.deepEqual(done.flow!.reviews[0].jobs, jobs); assert.equal(done.flow!.lead!.decisions.length, 1); assert.equal(aiAttempts(done), 2);
});

test('负责人运行：只允许受信负责人；新记录拒绝身份、指纹、制品及自由续接篡改；旧模式不升级', async t => {
  const c = await world(t);
  for (const mutate of [
    (r: typeof c.run) => { r.flow!.lead!.authority = 'deepseek:high'; },
    (r: typeof c.run) => { r.flow!.lead!.origin.fingerprint = 'b'.repeat(64); },
    (r: typeof c.run) => { r.flow!.version = 1; },
    (r: typeof c.run) => { delete r.flow!.lead; },
    (r: typeof c.run) => { r.nextPrompt = { node: r.taskId, mode: 'continue', prompt: '自由续接' }; },
  ]) { const run = structuredClone(c.run); mutate(run); assert.throws(() => parseRun(run, run.id), /负责人|协议|旧闭环/); }
  await stopAutopilot(c.run.id);
  await assert.rejects(createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'deepseek:high', leadReview: true }), /受信/);
  const legacy = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high' });
  assert.equal(legacy.flow!.version, 1); assert.equal(legacy.flow!.lead, undefined);
});

test('负责人运行：未提交的 Capsule 在登记及创建副本之前拒绝', async t => {
  const c = await world(t); await stopAutopilot(c.run.id);
  await writeFile(c.capsulePath, c.cap + '\n未提交的本轮补充。\n');
  await assert.rejects(createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high', leadReview: true }), /对不上/);
  await assert.rejects(access(join(c.repo, '.worktrees')));
});

test('负责人运行 CLI：公开显式开关可启动完整离线闭环，缺少负责人不能启动', async t => {
  const c = await world(t); await stopAutopilot(c.run.id);
  const bad = await c.cli(['autopilot', 'start', 'TASK-001', '--project', 'demo', '--who', 'codex:high', '--lead-review'], c.env);
  assert.equal(bad.code, 1); assert.match(bad.stderr, /受信/);
  const result = await c.cli(['autopilot', 'start', 'TASK-001', '--project', 'demo', '--who', 'codex:high', '--reviewer', 'codex-luna:high', '--lead-review', '--policy', 'short'], c.env);
  assert.equal(result.code, 0, result.stderr);
  const id = /无人看守：([^\s]+)/.exec(result.stdout)![1];
  const done = await until(() => readAutopilot(id), run => ['completed', 'needs_owner'].includes(run.state), 30_000);
  assert.equal(done.state, 'completed', done.reason); assert.equal(done.flow!.version, 2);
});
