import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGuard, guardTick } from '../src/core/execution-guard.ts';
import type { GuardPolicy, GuardState } from '../src/core/execution-guard.ts';
import { initialProgress, advanceProgress } from '../src/core/execution-progress.ts';
import type { ProgressState, ProgressEvent } from '../src/core/execution-progress.ts';
const salt = 'ab'.repeat(32), policy: GuardPolicy = { firstEventMs: 100, unfinishedReadMs: 200, graceMs: 50, calibration: 'offline-fixture-v1' };
const c = (at: number, asleepMs = 0) => ({ at, asleepMs });
function input(p: ProgressState, extras: Partial<{ unavailable: boolean; backlog: boolean; ended: boolean }> = {}, exited = false) {
  return { jobId: 'job-A', round: 1, observation: { state: p, unavailable: false, backlog: false, ended: false, ...extras }, exited };
}
test('默认关闭/无校准只预警，候选不自动成为停止权限', () => {
  const p = advanceProgress(initialProgress(c(0)), c(1000));
  assert.deepEqual(guardTick(null, initialGuard('job-A', 1, null), input(p)).events, []);
  const noCalibration = { ...policy, calibration: null };
  let s = initialGuard('job-A', 1, noCalibration);
  const first = guardTick(noCalibration, s, input(p)); assert.equal(first.events[0].type, 'warning'); s = first.state;
  assert.equal(guardTick(noCalibration, s, input(advanceProgress(p, c(2000)))).state.plan, null);
});
test('首事件固定宽限且重复tick只生成一次任务绑定计划，已退出不再动作', () => {
  let p = advanceProgress(initialProgress(c(0)), c(100));
  let r = guardTick(policy, initialGuard('job-A', 1, policy), input(p)); assert.equal(r.events[0].type, 'warning');
  p = advanceProgress(p, c(149)); r = guardTick(policy, r.state, input(p)); assert.equal(r.events.length, 0);
  p = advanceProgress(p, c(150)); r = guardTick(policy, r.state, input(p));
  assert.equal(r.events[0].type, 'stop-plan'); assert.equal(r.state.plan?.jobId, 'job-A');
  assert.equal(guardTick(policy, r.state, input(p)).events.length, 0);
  assert.equal(guardTick(policy, initialGuard('job-A', 1, policy), input(p, {}, true)).events.length, 0);
  assert.throws(() => guardTick(policy, r.state, { ...input(p), jobId: 'job-B' }));
  assert.throws(() => guardTick(policy, r.state, { ...input(p), round: 2 }));
});
test('错误持续增长不解除读未完预警，成功编辑才清，长命令不被当读取', () => {
  let p = initialProgress(c(0)), s = initialGuard('job-A', 1, policy);
  const step = (at: number, e?: ProgressEvent) => { p = advanceProgress(p, c(at), e, salt); const r = guardTick(policy, s, input(p)); s = r.state; return r; };
  step(1, { kind: 'start', id: 'read', operation: 'read', path: 'private' });
  assert.equal(step(201).events[0].type, 'warning');
  for (let i = 202; i < 251; i++) assert.equal(step(i, { kind: 'error' }).events.length, 0);
  assert.equal(step(251, { kind: 'error' }).state.plan?.reason, 'unfinished-read');
  p = initialProgress(c(0)); s = initialGuard('job-A', 1, policy);
  step(1, { kind: 'start', id: 'edit', operation: 'edit' }); step(2, { kind: 'start', id: 'read', operation: 'read' });
  step(202); assert.equal(step(203, { kind: 'end', id: 'edit', success: true }).events[0].type, 'cleared');
  p = initialProgress(c(0)); s = initialGuard('job-A', 1, policy);
  step(1, { kind: 'start', id: 'long', operation: 'command' }); assert.equal(step(10000).events.length, 0);
});
test('重复读只预警不停止；正常并行读完成不会被误停', () => {
  let p = initialProgress(c(0)), s = initialGuard('job-A', 1, policy);
  for (let i = 1; i <= 5; i++) {
    p = advanceProgress(p, c(i), { kind: 'start', id: `r${i}`, operation: 'read', path: 'same' }, salt);
    p = advanceProgress(p, c(i), { kind: 'end', id: `r${i}`, success: true }, salt);
  }
  let r = guardTick(policy, s, input(p)); assert.equal(r.events[0].type, 'warning'); assert.equal(r.state.warnings[0].reason, 'repeated-read');
  p = advanceProgress(p, c(10000)); r = guardTick(policy, r.state, input(p)); assert.equal(r.state.plan, null);
});
test('睡眠扣宽限、丢失观察不能累计连续宽限，输入状态不被修改', () => {
  let p = advanceProgress(initialProgress(c(0)), c(100));
  const old = initialGuard('job-A', 1, policy); let r = guardTick(policy, old, input(p));
  assert.equal(old.warnings.length, 0);
  p = advanceProgress(p, c(1000, 900)); r = guardTick(policy, r.state, input(p)); assert.equal(r.state.plan, null);
  p = advanceProgress(p, c(1100, 900)); r = guardTick(policy, r.state, input(p, { backlog: true })); assert.equal(r.state.plan, null);
  p = advanceProgress(p, c(1200, 900)); r = guardTick(policy, r.state, input(p)); assert.equal(r.state.plan, null);
  p = advanceProgress(p, c(1249, 900)); r = guardTick(policy, r.state, input(p)); assert.equal(r.state.plan, null);
  p = advanceProgress(p, c(1250, 900)); r = guardTick(policy, r.state, input(p)); assert.equal(r.state.plan?.reason, 'first-event-wait');
});
test('重建有界状态保留预警及单次计划；策略变化/时钟回退拒绝', () => {
  let p = advanceProgress(initialProgress(c(0)), c(100));
  let r = guardTick(policy, initialGuard('job-A', 1, policy), input(p));
  const saved: GuardState = JSON.parse(JSON.stringify(r.state));
  p = advanceProgress(p, c(150)); r = guardTick(policy, saved, input(p)); assert.equal(r.events[0].type, 'stop-plan');
  const done: GuardState = JSON.parse(JSON.stringify(r.state)); assert.equal(guardTick(policy, done, input(p)).events.length, 0);
  assert.throws(() => guardTick({ ...policy, graceMs: 51 }, done, input(p)));
  assert.throws(() => guardTick(policy, done, input(initialProgress(c(0)))));
  assert.throws(() => initialGuard('job-A', 1, { ...policy, graceMs: 0 }));
});
