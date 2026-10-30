import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { context, until } from './helpers.ts';
import { treeSpawn, killTree } from '../src/core/platform.ts';

test('仅自有POSIX父退子孙：回收前后组身份与两次kill结果诊断', { skip: process.platform === 'win32' ? 'POSIX进程组诊断，不代表Windows' : false }, async t => {
  const c = await context(t, false), nonce = randomUUID(), childFile = join(c.temp, 'owned-child.mjs');
  const marker = join(c.temp, 'child.json'), parentFile = join(c.temp, 'owned-parent.mjs'), manifest = join(c.temp, 'manifest.json');
  await writeFile(childFile, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({nonce:${JSON.stringify(nonce)},pid:process.pid}));setInterval(()=>{},50);setTimeout(()=>process.exit(0),5000);`);
  await writeFile(parentFile, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,[${JSON.stringify(childFile)}],{stdio:'ignore'});writeFileSync(${JSON.stringify(manifest)},JSON.stringify({nonce:${JSON.stringify(nonce)},parent:process.pid,child:child.pid}));child.unref();`);
  const parent = spawn(process.execPath, [parentFile], { ...treeSpawn(), cwd: c.temp, env: { HOME: c.temp }, stdio: 'ignore' });
  let owned: { nonce: string; parent: number; child: number } | undefined;
  t.after(async () => {
    // 自有子进程自带5秒硬退出；不保存旧PID，也不对任何外部进程操作。
    if (owned) { try { killTree(owned.parent, 'SIGKILL'); } catch {} }
    await sleep(50);
  });
  await new Promise<void>((resolve, reject) => { parent.once('error', reject); parent.once('exit', () => resolve()); });
  owned = JSON.parse(await readFile(manifest, 'utf8'));
  assert.equal(owned!.nonce, nonce); assert.equal(owned!.parent, parent.pid);
  const child = await until(async () => readFile(marker, 'utf8').then(JSON.parse).catch(() => null), Boolean, 2000);
  assert.equal(child.nonce, nonce); assert.equal(child.pid, owned!.child);
  const rows = () => {
    const p = spawnSync('ps', ['-p', `${owned!.parent},${owned!.child}`, '-o', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8', timeout: 2000, maxBuffer: 8192 });
    if (p.error || (p.status !== 0 && p.status !== 1)) throw new Error(`自有进程只读核验失败：${p.error?.message ?? p.stderr.trim()}`);
    return p.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [pid, ppid, pgid, state] = line.trim().split(/\s+/); return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), state };
    });
  };
  const before = rows(); assert.equal(before.find(r => r.pid === owned!.child)?.pgid, owned!.parent);
  const signal = () => { try { killTree(owned!.parent, 'SIGKILL'); return 'OK'; } catch (e) { return (e as NodeJS.ErrnoException).code ?? 'UNKNOWN'; } };
  const first = signal(); await sleep(150); const afterFirst = rows(); const second = signal(); const afterSecond = rows();
  t.diagnostic(JSON.stringify({ owned, before, first, afterFirst, second, afterSecond }));
  assert.ok(['OK', 'EPERM'].includes(first)); assert.ok(['OK', 'EPERM'].includes(second));
  // 诊断不是生产通过：若仍在运行，保留失败；僵尸与已消失明确区分，不用心跳推断。
  assert.ok(afterFirst.every(r => r.pid !== owned!.child || r.state.startsWith('Z')), '自有子孙仍在运行，不能宣称回收');
});
