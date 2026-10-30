import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { context, exec, root, until } from './helpers.ts';
import { alive } from '../src/core/platform.ts';

test('组回收失败时保留现场和本地恢复记录，不误删仍活跃上下文', { skip: process.platform === 'win32' ? '只模拟POSIX组kill失败；不冒充Windows系统接口故障' : false }, async t => {
  const c = await context(t, false), marker = join(c.temp, 'owned-processes.json'), fake = join(c.temp, 'hang.mjs'), store = join(c.temp, 'approval');
  await mkdir(join(c.home, 'cache'), { recursive: true });
  await writeFile(join(c.home, 'cache', 'quota.json'), JSON.stringify({ queriedAt: new Date().toISOString(), providers: [] }));
  await writeFile(fake, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});grand.unref();
writeFileSync(${JSON.stringify(marker)},JSON.stringify({group:process.ppid,pid:process.pid,grandchild:grand.pid}));setInterval(()=>{},1000);`);
  let retainedRoot: string | undefined, ownedProcesses: { group: number; pid: number; grandchild: number } | undefined;
  const cleanup = async () => {
    try {
      const p = ownedProcesses;
      if (!p) return;
      // 只回收本测试假选手记录的自身helper组，不找其他进程，也不按宽泛目录删除。
      if (Number.isInteger(p.group) && p.group > 0 && p.group !== process.pid) try { process.kill(-p.group, 'SIGKILL'); } catch {}
      await until(async () => !alive(p.pid) && !alive(p.grandchild), Boolean, 4000);
    } finally {
      if (retainedRoot && basename(retainedRoot).startsWith('xagents-probe-envelope-')) await rm(retainedRoot, { recursive: true, force: true });
    }
  };
  t.after(cleanup);
  const r = await exec(process.execPath, ['--input-type=module', '-e', `
import {issueProbeApproval} from './src/core/channel-probe-consent.ts';
import {workerProbeFixtureIntent} from './src/core/channel-probe-worker-fixture.ts';
import {runBoundedWorkerProbeFixture} from './src/core/channel-probe-bounded-fixture.ts';
const choice='cursor-sonnet:high',store=${JSON.stringify(store)},native=process.kill.bind(process);
const token=await issueProbeApproval(store,workerProbeFixtureIntent(choice),{actor:'owner',trigger:'manual'});
process.kill=(pid,...args)=>{if(pid<0)throw Object.assign(Error('fixture only'),{code:'EPERM'});return native(pid,...args);};
try{console.log(JSON.stringify(await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs:1400})));}finally{process.kill=native;}
`], root, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  // 保存拥有身份到内存；context的清理钩子会先删除测试登记处/marker。
  ownedProcesses = JSON.parse(await readFile(marker, 'utf8'));
  assert.equal(r.code, 0, r.stderr); const result = JSON.parse(r.stdout);
  assert.equal(result.report.cleanupFailed, true); assert.match(result.cleanupCheckpoint, /^[0-9a-f-]{36}$/);
  const recovery = JSON.parse(await readFile(join(store, `probe-cleanup-${result.cleanupCheckpoint}.json`), 'utf8'));
  retainedRoot = recovery.root; assert.equal(recovery.reason, 'tree_cleanup_failed'); assert.ok(retainedRoot);
  assert.ok(basename(retainedRoot!).startsWith('xagents-probe-envelope-')); await access(retainedRoot!);
  const helper = JSON.parse(await readFile(join(retainedRoot!, '.probe-helper.json'), 'utf8'));
  const own = JSON.parse(await readFile(marker, 'utf8')); assert.equal(helper.pid, own.group);
  assert.ok(alive(own.pid) || alive(own.grandchild));
  assert.ok(!JSON.stringify(recovery).includes('CURSOR_AUTH_TOKEN'));
  await cleanup();
});
