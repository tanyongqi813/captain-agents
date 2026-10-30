import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialProgress, advanceProgress, progressEvidence, CursorProgressStream, cursorProgressEvent } from '../src/core/execution-progress.ts';
const salt = 'ab'.repeat(32), clock = (at: number, asleepMs = 0) => ({ at, asleepMs });

test('错误无限刷屏/未知与字节增长不代表实现进展，候选不授权停机', () => {
  let s = initialProgress(clock(0));
  for (let i = 1; i <= 1000; i++) s = advanceProgress(s, clock(i * 100), { kind: 'error' }, salt);
  assert.equal(s.errors, 1000); assert.equal(s.progressMs, null); assert.equal(s.active.length, 0);
  assert.equal(progressEvidence(s).stopAuthorized, false);
  s = advanceProgress(initialProgress(clock(0)), clock(90_000));
  assert.equal(progressEvidence(s).firstEventWaitCandidate, true);
  s = advanceProgress(s, clock(90_001), { kind: 'unknown' });
  assert.equal(s.firstEventMs, null);
});
test('并行读取按ID配对、重复事件不计数、五次同指纹仅提示且读完成不是实现', () => {
  let s = initialProgress(clock(0));
  for (let i = 0; i < 5; i++) {
    const e = { kind: 'start' as const, id: `read-${i}`, operation: 'read' as const, path: 'private/secret.txt' };
    s = advanceProgress(s, clock(i), e, salt); s = advanceProgress(s, clock(i), e, salt);
  }
  assert.equal(s.active.length, 5); assert.equal(progressEvidence(s).repeatedReadCandidates[0].count, 5);
  s = advanceProgress(s, clock(6), { kind: 'end', id: 'read-0', success: true }, salt);
  assert.equal(s.active.length, 4); assert.equal(s.progressMs, null);
  s = advanceProgress(s, clock(180_010));
  assert.equal(progressEvidence(s).unfinishedReadCandidates.length, 4);
  assert.ok(!JSON.stringify(s).includes('private')); assert.ok(!JSON.stringify(s).includes('read-0'));
  s = advanceProgress(s, clock(300_010)); assert.deepEqual(progressEvidence(s).repeatedReadCandidates, []);
});
test('只有成功编辑产生实现进展，长命令不冒充未结束读取，无ID不配对', () => {
  let s = initialProgress(clock(0));
  s = advanceProgress(s, clock(1), { kind: 'start', id: 'edit', operation: 'edit' }, salt);
  s = advanceProgress(s, clock(2), { kind: 'end', id: 'edit', success: true }, salt);
  s = advanceProgress(s, clock(3), { kind: 'start', id: 'cmd', operation: 'command' }, salt);
  s = advanceProgress(s, clock(4), { kind: 'end', id: '', success: true }, salt);
  s = advanceProgress(s, clock(500_000));
  assert.equal(s.progressMs, 2); assert.equal(s.active.length, 1);
  assert.deepEqual(progressEvidence(s).unfinishedReadCandidates, []);
  assert.equal(progressEvidence(s).sinceProgressMs, 499_998);
});
test('休眠扣除且回退拒绝；状态及返回不共享输入引用', () => {
  const original = initialProgress(clock(0));
  let s = advanceProgress(original, clock(200_000, 180_000));
  assert.equal(s.awakeMs, 20_000); assert.equal(progressEvidence(s).firstEventWaitCandidate, false);
  assert.equal(original.awakeMs, 0);
  assert.throws(() => advanceProgress(s, clock(199_999, 180_000)));
  assert.throws(() => advanceProgress(s, clock(200_001, 180_002)));
  s = advanceProgress(s, clock(270_000, 180_000)); assert.equal(progressEvidence(s).firstEventWaitCandidate, true);
});
test('缓存溢出有界并标不完整，不能靠丢失证据认定安全', () => {
  let s = initialProgress(clock(0));
  for (let i = 0; i < 1000; i++) s = advanceProgress(s, clock(i), { kind: 'start', id: `id-${i}`, operation: 'read', path: `p-${i}` }, salt);
  assert.equal(s.active.length, 128); assert.ok(s.seen.length <= 512 && s.reads.length <= 128); assert.equal(s.incomplete, true);
  assert.equal(progressEvidence(s).stopAuthorized, false);
});
test('真实离线流分块配对：成功edit有效，原路径正文不进入快照', async () => {
  const stream = new CursorProgressStream(clock(0), salt);
  const data = await readFile(new URL('./fixtures/streams/cursor-stream.jsonl', import.meta.url), 'utf8');
  for (let i = 0; i < data.length; i += 37) stream.feed(data.slice(i, i + 37), clock(i));
  const s = stream.snapshot(); assert.notEqual(s.progressMs, null); assert.equal(s.active.length, 0);
  assert.ok(!JSON.stringify(s).includes('m.py')); assert.ok(!JSON.stringify(s).includes('python3'));
  s.active.push({ id: 'mutate', from: 0, operation: 'unknown', fingerprint: null });
  assert.equal(stream.snapshot().active.length, 0);
});
test('超长行丢弃到换行后恢复，未知协议/缺ID不猜配对', () => {
  const stream = new CursorProgressStream(clock(0), salt);
  stream.feed('x'.repeat(100_000), clock(1)); assert.equal(stream.bufferedCharacters, 0);
  stream.feed('\n'+JSON.stringify({ type: 'tool_call', subtype: 'completed', tool_call: {} })+'\n', clock(2));
  assert.equal(stream.snapshot().incomplete, true); assert.equal(stream.snapshot().active.length, 0);
  stream.feed(JSON.stringify({ type: 'system', subtype: 'init' })+'\n', clock(3));
  assert.equal(stream.snapshot().firstEventMs, 3); assert.equal(stream.snapshot().progressMs, null);
});
test('成功结果需结构标记和唯一请求ID，重放不刷新；畸形成功不冒充edit成功', () => {
  let s = initialProgress(clock(0));
  s = advanceProgress(s, clock(1), { kind: 'start', id: '', operation: 'edit' }, salt);
  assert.equal(s.firstEventMs, null);
  const event = cursorProgressEvent({ type: 'result', subtype: 'success', is_error: false, request_id: 'r1' });
  s = advanceProgress(s, clock(2), event, salt); s = advanceProgress(s, clock(3), event, salt);
  assert.equal(s.progressMs, 2);
  assert.equal(cursorProgressEvent({ type: 'result', subtype: 'success', is_error: false }).kind, 'unknown');
  const malformed = cursorProgressEvent({ type: 'tool_call', subtype: 'completed', call_id: 'e', tool_call: { editToolCall: { result: { success: null } } } });
  assert.deepEqual(malformed, { kind: 'end', id: 'e', success: null });
});
