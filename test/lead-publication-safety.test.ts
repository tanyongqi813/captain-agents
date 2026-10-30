import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishLeadCorrection } from '../src/core/lead-capsule.ts';

const request = { taskId: 'TASK-040', currentAttempt: '01', candidate: 'a'.repeat(64), findingIds: ['F-01'], replyText: 'not executable' };
const refused = /完整规划事务、领取租约和执行基准/;

test('incomplete publication refuses without creating even an absent repository', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lead-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'absent');
  await assert.rejects(publishLeadCorrection(repo, request), refused);
  await assert.rejects(stat(repo), { code: 'ENOENT' });
});

test('incomplete publication preserves all existing planning bytes on repeated attempts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lead-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const docs = join(root, 'docs');
  await mkdir(docs);
  const original = Buffer.from('owner draft\r\nREADY is not authorization\n');
  await writeFile(join(docs, 'TASK_LIST.md'), original);
  for (let i = 0; i < 2; i++) await assert.rejects(publishLeadCorrection(root, request), refused);
  assert.deepEqual(await readdir(docs), ['TASK_LIST.md']);
  assert.deepEqual(await readFile(join(docs, 'TASK_LIST.md')), original);
});
