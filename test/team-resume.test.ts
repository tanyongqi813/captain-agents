import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resumeCommand } from '../src/core/workers.ts';
import { sessionFromOutput } from '../src/core/wake.ts';
import { jobDir } from '../src/core/paths.ts';
import type { Command, Job } from '../src/core/job.ts';

const SESSION = '0f0e0d0c-0b0a-4908-8706-050403020100';
const codex: Command = { file: '/x/codex', args: ['exec', '--ignore-user-config', '--disable', 'hooks', '-c', 'default_permissions="xa"', '-c', 'permissions.xa={…}', '-C', '/repo/wt', '--json', '-o', '/h/jobs/j/final.md', '-'], env: { TMPDIR: '/h/jobs/j/tmp' }, unset: ['OPENAI_API_KEY'], stdin: 'prompt', output: 'run.log' };
const grok: Command = { file: '/node', args: ['/srt.js', '--settings', '/h/jobs/j/sandbox.json', 'grok', '--prompt-file', '/h/jobs/j/prompt.md', '--cwd', '/repo/wt', '-m', 'grok-4.7', '--sandbox', 'off', '--output-format', 'streaming-json'], env: { CLAUDE_CODE_TMPDIR: '/h/jobs/j/tmp' }, stdin: 'ignore', output: 'run.log' };
const job = (who: Job['who'], command: Command, extra: Partial<Job> = {}) =>
  ({ id: '1010-0300-test', who, command, session: SESSION, resume: { round: 2, prompt: 'prompt-r2.md' }, ...extra }) as Pick<Job, 'id' | 'who' | 'command' | 'session' | 'resume'>;

test('Codex 在本轮新生成的命令上续接：保留本轮权限，去掉 -C，会话号放在最后的 - 前面', () => {
  const r = resumeCommand(job('deepseek-flash', codex));
  assert.deepEqual(r.args, ['exec', 'resume', '--ignore-user-config', '--disable', 'hooks', '-c', 'default_permissions="xa"', '-c', 'permissions.xa={…}', '--json', '-o', '/h/jobs/j/final.md', SESSION, '-']);
  assert.deepEqual(r.env, codex.env); assert.deepEqual(r.unset, codex.unset); assert.equal(r.file, codex.file); assert.equal(r.stdin, 'prompt');
  // 本轮的基础命令不被改动；实际续接命令另行留痕。
  assert.ok(codex.args.includes('-C'));
});
test('替身前缀保留：Codex 命令前面有替身脚本时，从 exec 开始改', () => {
  const fake = { ...codex, args: ['/fake.ts', ...codex.args] };
  const r = resumeCommand(job('codex', fake));
  assert.deepEqual(r.args.slice(0, 3), ['/fake.ts', 'exec', 'resume']);
});
test('Grok 在本轮新生成的 srt 命令上续接：加 --resume，提示词换成这一轮的文件', () => {
  const r = resumeCommand(job('grok', grok));
  assert.deepEqual(r.args.slice(0, 4), ['/srt.js', '--settings', '/h/jobs/j/sandbox.json', 'grok']);
  const i = r.args.indexOf('--resume');
  assert.equal(r.args[i + 1], SESSION);
  assert.equal(r.args[r.args.indexOf('--prompt-file') + 1], join(jobDir('1010-0300-test'), 'prompt-r2.md'));
  assert.deepEqual(r.env, grok.env);
});
test('Kimi 在本轮新命令上续接：保留新提示词并加入会话号', () => {
  const kimi: Command = { file: '/node', args: ['/srt.js', '--settings', '/h/jobs/j/sandbox.json', '/x/kimi', '--prompt', '第二轮题目', '--output-format', 'stream-json'], env: {}, stdin: 'ignore', output: 'run.log' };
  const session = 'session_0e6ba15b-b4ad-4e5f-94ed-5d516df1d4ee';
  const r = resumeCommand(job('kimi', kimi, { session }));
  assert.deepEqual(r.args, ['/srt.js', '--settings', '/h/jobs/j/sandbox.json', '/x/kimi', '--session', session, '--prompt', '第二轮题目', '--output-format', 'stream-json']);
});
test('Cursor 在本轮新命令上续接：保留新提示词，并在它前面插入 --resume', () => {
  const prompt = '第二轮题目';
  const cursor: Command = { file: '/node', args: ['/srt.js', '--settings', '/h/jobs/j/sandbox.json', 'cursor-agent', '-p', '--output-format', 'stream-json', '--model', 'grok-4.7-high', '--force', '--trust', '--workspace', '/repo/wt', prompt], env: {}, stdin: 'ignore', output: 'run.log' };
  const r = resumeCommand(job('cursor-grok', cursor));
  assert.equal(r.args.at(-1), prompt);
  assert.equal(r.args.at(-2), SESSION);
  assert.equal(r.args.at(-3), '--resume');
  assert.ok(r.args.includes('--workspace'));
  assert.throws(() => resumeCommand(job('cursor-grok', { ...cursor, args: [...cursor.args.slice(0, -1), '--resume', SESSION, prompt] })), /不是预期/);
});
test('Cursor 的会话号取 stream-json 里的 session_id', () => {
  const id = '22d5dc0c-3028-4bc9-8c44-e889620291f6';
  assert.equal(sessionFromOutput('cursor-grok', `{"type":"system","subtype":"init","session_id":"${id}"}\n{"type":"result","session_id":"${id}"}\n`), id);
  assert.equal(sessionFromOutput('cursor-grok', '{"session_id":"not-a-session"}\n'), undefined);
});
test('拿不准就不续接：没会话号、会话号不像样、提示词文件名不对、命令不像预期', () => {
  assert.throws(() => resumeCommand(job('grok', grok, { session: undefined })), /会话号/);
  assert.throws(() => resumeCommand(job('grok', grok, { session: '../../etc' })), /会话号/);
  assert.throws(() => resumeCommand(job('grok', grok, { session: '--sandbox' })), /会话号/);
  assert.throws(() => resumeCommand(job('grok', grok, { resume: { round: 2, prompt: '../prompt.md' } })), /文件名/);
  assert.throws(() => resumeCommand(job('grok', grok, { resume: { round: 1, prompt: 'prompt-r1.md' } })), /文件名/);
  assert.throws(() => resumeCommand(job('grok', { ...grok, args: [...grok.args, '--resume', 'x'] })), /不是预期/);
  assert.throws(() => resumeCommand(job('codex', { ...codex, args: codex.args.slice(0, -1) })), /不是预期/);
  assert.throws(() => resumeCommand(job('grok', grok, { command: undefined })), /第 1 轮/);
});
