import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, root } from './helpers.ts';
import { CursorProgressObserver } from '../src/core/execution-progress.ts';
const clock = (at: number, asleepMs = 0) => ({ at, asleepMs });
const start = (id: string, path = '秘密文件') => JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: id, tool_call: { readToolCall: { args: { path } } } });
const end = (id: string) => JSON.stringify({ type: 'tool_call', subtype: 'completed', call_id: id, tool_call: { readToolCall: { result: { success: {} } } } });

test('磁盘UTF8跨采样分块及EOF无换行，不伪造工具完成，实例盐独立', async t => {
  const c = await context(t, false), file = join(c.temp, 'stream');
  const bytes = Buffer.from(start('r')+'\n'), boundary = bytes.indexOf(Buffer.from('秘')) + 1;
  const a = new CursorProgressObserver(clock(0), 'aa'.repeat(32)), b = new CursorProgressObserver(clock(0), 'bb'.repeat(32));
  await writeFile(file, bytes.subarray(0, boundary)); await a.sample(file, clock(1));
  assert.equal(a.snapshot().state.active.length, 0);
  await appendFile(file, bytes.subarray(boundary)); await a.sample(file, clock(2), true); await b.sample(file, clock(2), true);
  assert.equal(a.snapshot().state.active.length, 1); assert.equal(a.snapshot().ended, true);
  assert.notEqual(a.snapshot().state.active[0].fingerprint, b.snapshot().state.active[0].fingerprint);
  assert.ok(!JSON.stringify(a.snapshot()).includes('秘密'));
  const eof = new CursorProgressObserver(clock(0), 'cc'.repeat(32));
  await writeFile(file, start('r')+'\n'+end('r')); await eof.sample(file, clock(3), true);
  assert.equal(eof.snapshot().state.active.length, 0); assert.equal(eof.snapshot().state.progressMs, null);
});
test('读取预算/积压明确，坏EOF/截断/IO失败保守不可用，缺文件可稍后出现', async t => {
  const c = await context(t, false), file = join(c.temp, 'log');
  const o = new CursorProgressObserver(clock(0), 'aa'.repeat(32));
  await o.sample(file, clock(1)); assert.equal(o.snapshot().unavailable, false);
  await writeFile(file, 'x'.repeat(300_000)+'\n'+start('pending'));
  await o.sample(file, clock(2), true);
  assert.equal(o.snapshot().bytesObserved, 256 * 1024); assert.equal(o.snapshot().backlog, true); assert.equal(o.snapshot().ended, false);
  await o.sample(file, clock(3), true);
  assert.equal(o.snapshot().backlog, false); assert.equal(o.snapshot().ended, true); assert.equal(o.snapshot().state.active.length, 1);
  const truncated = new CursorProgressObserver(clock(0), 'bb'.repeat(32));
  await writeFile(file, start('r')+'\n'); await truncated.sample(file, clock(1));
  await writeFile(file, ''); await truncated.sample(file, clock(2)); assert.equal(truncated.snapshot().unavailable, true);
  const bad = new CursorProgressObserver(clock(0), 'cc'.repeat(32));
  await writeFile(file, '{partial'); await bad.sample(file, clock(1), true); assert.equal(bad.snapshot().state.incomplete, true);
  const dir = join(c.temp, 'directory'); await mkdir(dir);
  const io = new CursorProgressObserver(clock(0), 'dd'.repeat(32)); await io.sample(dir, clock(1));
  assert.equal(io.snapshot().unavailable, true);
});
test('LiveProgress真实采样从新任务sleep记录扣除休眠且旧EOF不替影子结束工具', async t => {
  const c = await context(t);
  const run = await exec(process.execPath, ['--input-type=module', '-e', `
import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {LiveProgress} from './src/core/live.ts';import {jobDir} from './src/core/paths.ts';
const at=n=>new Date(n).toISOString(), job={id:'shadow-sample',who:'cursor-sonnet',worktree:${JSON.stringify(c.repo)},sleeps:[]};
await mkdir(jobDir(job.id),{recursive:true});
await writeFile(join(jobDir(job.id),'job.json'),JSON.stringify({...job,sleeps:[{from:at(1000),to:at(181000)}]}));
await writeFile(join(jobDir(job.id),'run.log'),${JSON.stringify(start('r')+'\n')});
const p=new LiveProgress(job,1000);await p.sample(false,201000);
await p.sample(true,202000);console.log(JSON.stringify(p.observationSnapshot()));
const other=new LiveProgress({...job,who:'codex'},1000);if(other.observationSnapshot()!==null)process.exit(4);
`], root, c.env);
  assert.equal(run.code, 0, run.stderr);
  const s = JSON.parse(run.stdout); assert.equal(s.unavailable, false); assert.equal(s.state.awakeMs, 21_000); assert.equal(s.ended, true);
  assert.equal(s.state.active.length, 1); assert.equal(s.evidence.stopAuthorized, false);
});
