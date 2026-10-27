import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import { context, until, upgradeAutopilotFixture } from '../helpers.ts';
import { writeJson } from '../../src/core/fsx.ts';
import { parseRun } from '../../src/core/autopilot.ts';
import { loadHandoffFiles } from '../../src/core/task-plan.ts';
import { compileLeadCapsules } from '../../src/core/lead-capsule.ts';
import { LEAD_REVIEW_OPEN, LEAD_REVIEW_CLOSE, parseLeadReview } from '../../src/core/lead-review.ts';

test('真实窗口：显式负责人流程保存新协议记录，浅深窄截图并可整单停止', { timeout: 90_000 }, async t => {
  const c = await context(t);
  await mkdir(join(c.repo, 'docs/tasks'), { recursive: true });
  await writeFile(join(c.repo, '.gitignore'), '.worktrees/\n');
  await writeFile(join(c.repo, 'docs/TASK_LIST.md'), '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |\n|---|---|---|---|---|---|\n| [TASK-001](tasks/TASK-001.md) | 负责人窗口验收 | READY | P1 | High | 无 |\n');
  await writeFile(join(c.repo, 'docs/tasks/TASK-001.md'), '# TASK-001\n\n- 状态：`READY`\n- 优先级：`P1`\n- 难度等级：`High`\n- 前置任务：无\n\n## 业务结果\n\n只运行离线假选手。\n\n## 验收标准\n\n1. 保存新协议记录。\n');
  await upgradeAutopilotFixture(c.repo);
  await c.git(['add', '.']); await c.git(['commit', '-m', 'offline desktop lead fixture']);
  const added = await c.add(); assert.equal(added.code, 0, added.stderr);
  const before = await c.git(['rev-parse', 'HEAD']);
  const env = Object.fromEntries(Object.entries(c.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const app = await _electron.launch({ args: [resolve('out/main/index.js')], env: {
    ...env, XAGENTS_E2E: '1', XAGENTS_USER_DATA: join(c.temp, 'electron'), XA_TEST_MODE: 'hold',
  } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('tab', { name: '规划', exact: true }).click();
    await page.getByRole('button', { name: /TASK-001 负责人窗口验收/ }).click();
    await page.getByRole('button', { name: '无人看守', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '无人看守 TASK-001', exact: true });
    const mode = dialog.getByRole('checkbox', { name: '使用负责人复审流程', exact: true });
    assert.equal(await mode.isChecked(), false); await mode.click();
    assert.match(await dialog.textContent() ?? '', /不会自动提交或继续派发/);
    await dialog.getByLabel('执行者', { exact: true }).selectOption('codex');
    await dialog.getByLabel('执行强度', { exact: true }).selectOption('high');
    await dialog.getByLabel('独立审查者', { exact: true }).selectOption('codex-luna');
    await dialog.getByLabel('审查强度', { exact: true }).selectOption('high');
    await dialog.getByLabel('总预算', { exact: true }).selectOption('short');
    await dialog.getByRole('checkbox', { name: '允许修改专用副本', exact: true }).click();
    await dialog.getByRole('checkbox', { name: '确认联网快照', exact: true }).click();
    await mkdir(resolve('output/playwright'), { recursive: true });
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.emulateMedia({ colorScheme: variant.scheme });
      assert.equal(await dialog.getByRole('button', { name: '启动无人看守', exact: true }).isEnabled(), true);
      await page.screenshot({ animations: 'disabled', path: resolve(`output/playwright/lead-review-${variant.name}.png`) });
    }
    await dialog.getByRole('button', { name: '启动无人看守', exact: true }).click();
    const detail = page.getByRole('dialog', { name: /^无人看守详情/ }); await detail.waitFor();
    const view = await page.evaluate(() => window.xa.getView()), id = view.autopilots![0].id;
    const record = JSON.parse(await readFile(join(c.home, 'autopilots', id, 'run.json'), 'utf8'));
    assert.equal(record.flow.version, 2);
    assert.equal(record.flow.lead.authority, 'codex-luna:high');
    assert.equal(record.flow.lead.origin.taskId, 'TASK-001');
    await until(() => c.jobs(), jobs => jobs.some(j => j.state === 'running'), 20_000);
    await detail.getByRole('button', { name: '停止无人看守', exact: true }).click();
    await detail.getByRole('button', { name: '确认停止', exact: true }).click();
    await until(async () => JSON.parse(await readFile(join(c.home, 'autopilots', id, 'run.json'), 'utf8')), r => r.state === 'stopped', 10_000);
    assert.equal(await c.git(['rev-parse', 'HEAD']), before);
    // 已停止的临时运行追加经过核心校验的替身复审结果；不启动任何模型，也不改项目文档。
    const file = join(c.home, 'autopilots', id, 'run.json'), saved = JSON.parse(await readFile(file, 'utf8'));
    const origin = saved.flow.lead.origin, candidate = saved.flow.accepted, token = 'fixture-review', at = new Date().toISOString();
    const binding = { candidate, capsule: origin.fingerprint };
    const replyText = LEAD_REVIEW_OPEN + '\n' + JSON.stringify({ schema: 1, action: 'correct', reason: '只修正本轮问题。',
      ...binding, change: { goal: '保留成果并修正', acceptance: ['定向验证通过'] } }) + '\n' + LEAD_REVIEW_CLOSE;
    const parsed = parseLeadReview(replyText, binding); assert.ok(parsed.ok);
    const compilation = compileLeadCapsules({ files: await loadHandoffFiles(c.repo), taskId: saved.taskId,
      currentAttempt: origin.attempt, candidate, replyText, findingIds: ['F-01'] });
    saved.flow.reviews.push({ token, node: saved.taskId, at, candidate, jobs: ['fixture-review'], verdict: 'changes' });
    saved.flow.lead.decisions.push({ token, node: saved.taskId, at, jobs: ['fixture-review'], reply: parsed.reply, compilation });
    saved.state = 'needs_owner'; saved.ownerCode = 'owner_requested'; saved.reason = '负责人已保存增量胶囊，等待主人核对。';
    await writeJson(file, parseRun(saved, id));
    const review = page.getByRole('region', { name: '负责人复审', exact: true });
    await review.getByText(/已保存 1 份增量执行胶囊/).waitFor();
    assert.match(await review.textContent() ?? '', /负责人决定：要求修正/);
    assert.match(await review.textContent() ?? '', /尚未授权续跑/);
    assert.equal(await review.getByRole('button').count(), 0);
    const summary = (await page.evaluate(() => window.xa.getView())).autopilots!.find(r => r.id === id)!.leadReview;
    assert.equal(summary?.decision?.capsuleCount, 1);
    assert.doesNotMatch(JSON.stringify(summary), /"origin"|"token"|"compilation"/);
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 }); await page.emulateMedia({ colorScheme: variant.scheme });
      await review.scrollIntoViewIfNeeded();
      await page.screenshot({ animations: 'disabled', path: resolve(`output/playwright/lead-decision-${variant.name}.png`) });
    }
    assert.equal(await c.git(['rev-parse', 'HEAD']), before);
  } finally { await app.close(); }
});
