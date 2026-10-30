import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { alive } from '../src/core/platform.ts';
import { runChannelProbe } from '../src/core/channel-probe.ts';

const run = (code: string, timeoutMs = 1500) => runChannelProbe({ file: process.execPath, args: ['-e', code] }, { timeoutMs });
test('固定文件真实读取、阶段及结果，环境不继承密钥/原始内容不泄露', async () => {
  const previous = process.env.XAGENTS_PROBE_TEST_SECRET;
  process.env.XAGENTS_PROBE_TEST_SECRET = 'secret-parent-only';
  let r;
  try { r = await run(`if(process.env.XAGENTS_PROBE_TEST_SECRET)process.exit(9);
    const fs=require('node:fs'); console.log(JSON.stringify({type:'system',model:'secret-model'}));
    console.log(JSON.stringify({type:'tool_call',subtype:'started',args:'secret-password'}));
    const value=fs.readFileSync('probe-input.txt','utf8').trim();
    console.log(JSON.stringify({type:'tool_call',subtype:'completed',body:process.env}));
    console.log(JSON.stringify({type:'result',result:value}));`);
  } finally {
    if (previous === undefined) delete process.env.XAGENTS_PROBE_TEST_SECRET;
    else process.env.XAGENTS_PROBE_TEST_SECRET = previous;
  }
  assert.equal(r.outcome, 'success'); assert.equal(r.exitCode, 0); assert.equal(r.resultVerified, true);
  assert.ok(r.firstEventMs !== null && r.toolStartedMs !== null && r.toolCompletedMs !== null && r.resultMs !== null);
  assert.equal(r.model, null); assert.equal(r.usage, null); assert.equal(r.cleanupFailed, false);
  assert.ok(!JSON.stringify(r).includes('secret'));
});
test('无输出正常退出不是读取卡死或成功', async () => {
  const r = await run(''); assert.equal(r.outcome, 'failed'); assert.equal(r.firstEventMs, null); assert.equal(r.resultMs, null);
});
test('仅工具开始且不退出，总时限收回', async () => {
  const r = await run(`console.log(JSON.stringify({type:'tool_call',subtype:'started'})); setInterval(()=>{},1000);`, 350);
  assert.equal(r.outcome, 'timeout'); assert.ok(r.toolStartedMs !== null); assert.equal(r.toolCompletedMs, null); assert.equal(r.resultVerified, false);
});
test('结果正确但进程不退出仍超时，不重试', async () => {
  const r = await run(`console.log(JSON.stringify({type:'result',result:'probe-read-v1'})); setInterval(()=>{},1000);`, 350);
  assert.equal(r.outcome, 'timeout'); assert.equal(r.resultVerified, true);
});
test('stderr洪泛与无换行长行均有界且不留原文', async () => {
  for (const code of [`process.stderr.write('secret'.repeat(20000));setInterval(()=>{},1000);`, `console.log('x'.repeat(9000));`]) {
    const r = await run(code); assert.equal(r.outcome, 'output_limit'); assert.ok(r.bytes <= 65537); assert.ok(!JSON.stringify(r).includes('secret'));
  }
});
test('启动失败固定分类，不返回系统路径错误；非法预算拒绝', async () => {
  const r = await runChannelProbe({ file: join(tmpdir(), 'nonexistent-channel-probe-executable'), args: [] });
  assert.equal(r.outcome, 'launch_failed'); assert.equal(r.exitCode, null);
  await assert.rejects(runChannelProbe({ file: process.execPath, args: [] }, { timeoutMs: 90001 }), /参数/);
});

test('回收自己启动的子孙：超时和父进程先正常退出均不遗留', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'channel-probe-descendant-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const earlyExit of [false, true]) {
    const pidFile = join(dir, earlyExit ? 'early.pid' : 'timeout.pid');
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`;
    const r = await run(`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});
      ${earlyExit ? 'setTimeout(()=>process.exit(0),150);' : 'setInterval(()=>{},1000);'}`, 700);
    assert.equal(r.outcome, earlyExit ? 'failed' : 'timeout');
    const pid = Number(await readFile(pidFile, 'utf8'));
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    for (let n = 0; n < 40 && alive(pid); n++) await sleep(25);
    assert.equal(alive(pid), false, '仅检查本次子进程自己登记的PID');
    assert.equal(r.cleanupFailed, false);
  }
});
