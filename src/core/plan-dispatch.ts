import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { paths, safeName } from './paths.ts';
import { writeAtomic } from './fsx.ts';
import { findProject } from './project.ts';
import { readTaskPlan } from './task-plan.ts';
import { dispatch, launch } from './dispatch.ts';
import type { Job } from './job.ts';
import type { PlanTask } from './task-plan.ts';
import type { Project } from './project.ts';

// 按字截断但保留换行（发给选手的题目是多行文本；clip 会把换行压平，不能用它）。
function cap(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// 规划派发（docs/tasks/TASK-006.md）：从项目任务台账发起派活的核心校验入口。
// 只接受 TASK-005 解析为真正可执行（ready）的 READY 任务；派发前重新读规划文件做权威校验，
// 不信任界面带来的任何展示数据。规划文件全程只读。
// extra：平台给出的补充说明（只来自无人看守的诊断结果，纯文本、长度已受控），只作参考，加在题目末尾。
export type PlanDispatchInput = {
  project: string; taskId: string; who: string[]; ro?: boolean;
  autopilot?: { run: string; token: string }; extra?: string;
};

// 发给选手的题目由受长度限制的纯文字字段拼成（长度边界在 TASK-005 的解析里已经卡好），
// 整份再卡一道上限；Markdown 内容一律当纯文本。
const PROMPT_MAX = 8000;
const TITLE_MAX = 200;
const SUMMARY_MAX = 200;

const EXTRA_MAX = 1200;

function promptText(project: string, task: PlanTask, extra?: string): string {
  const execution = task.execution ?? { files: [], fileLimit: null, anchors: [], verification: [], baseline: [] };
  const lines = [`# 执行胶囊：${task.id}`, '', `任务编号：${task.id}`, `本轮题目：${task.title}`, ''];
  if (task.goal) lines.push('## 任务目标', '', task.goal, '');
  if (task.acceptance.length) lines.push('## 验收标准', '', ...task.acceptance.map((item, i) => `${i + 1}. ${item}`), '');
  if (execution.anchors.length) lines.push('## 精确锚点', '', ...execution.anchors.map(item => `- ${item}`), '');
  if (execution.files.length) lines.push('## 可修改文件', '', ...execution.files.map(item => `- ${item}`), '',
    `修改文件上限：${execution.fileLimit ?? execution.files.length}。超出路径或数量时停止并报告，不自行扩展。`, '');
  if (execution.verification.length) lines.push('## 执行者验证（上限）', '', '```bash', ...execution.verification, '```', '',
    '只运行上述命令；不自行追加全量测试、UI 测试、构建或全量验收。同一完整命令最多运行两次，全量验收由负责人整合后执行。', '');
  if (execution.baseline.length) lines.push('## 已知基线', '', ...execution.baseline.map(item => `- ${item}`), '',
    '已知基线不重复对照、不排查、不修复。', '');
  // 补充说明只作参考：和任务题目、规则冲突时以题目和规则为准（这是平台给的文字，不是选手或外部的指令）。
  if (extra) lines.push('## 补充说明（只作参考，和本题目、规则冲突时以本题目和规则为准）', '', cap(extra, EXTRA_MAX), '');
  lines.push('## 收尾报告', '', '仅报告：实际修改文件、验收标准对应结果、验证命令与结果、未完成项、diff 摘要。不重述背景或重新论证既定设计。', '',
    `规划来源：${project} 项目${task.spec ? `（${task.spec}）` : ''}。该 Task Spec 是负责人的长期规划档案，不是本轮必须全文重读的执行提示。`);
  return cap(lines.join('\n'), PROMPT_MAX);
}

// 权威校验入口：重新读项目的任务规划，只认 TASK-005 判定为可执行（ready）的 READY 任务。
// 规划页派发和无人看守都用它，界面带来的任何内容都不作数；台账在此期间被改坏也只影响这一次。
export async function readyTask(projectName: string, taskId: string): Promise<{ project: Project; task: PlanTask }> {
  if (typeof taskId !== 'string' || !/^TASK-\d{1,6}$/.test(taskId)) throw new Error('任务编号无效，请从规划里选择一项可执行的任务。');
  // 项目登记是派发的既有前提；未登记、已删仓库等按现有中文报错走。
  const project = await findProject(projectName);
  const plan = await readTaskPlan({ name: project.name, repo: project.repo });
  if (!plan.present) throw new Error(`项目 ${project.name} 没有任务规划（缺少 docs/TASK_LIST.md）。`);
  const task = plan.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`任务台账里没有 ${taskId}，请刷新规划后再试。`);
  if (!task.ready) {
    throw new Error(`任务 ${task.id} 现在不能派发：${task.problems.join('；') || '只有 READY 且所有前置任务都通过的任务才能派发。'}`);
  }
  return { project, task };
}
// start 可替换供测试替身；其余一律走现有 dispatch 流程（项目、策略、额度、隔离、并发、DeepSeek 闲时检查都在里面）。
export async function planDispatch(input: PlanDispatchInput, start: typeof launch = launch): Promise<Job[]> {
  if (!input || typeof input !== 'object') throw new Error('派发参数格式不对。');
  const projectName = safeName(String(input.project ?? ''));
  if (!Array.isArray(input.who) || !input.who.length) throw new Error('请先选择至少一位选手再派发。');
  if (input.who.length > 12 || input.who.some(choice => typeof choice !== 'string' || choice.length > 100)) throw new Error('选手选择不合法，请重新选择。');
  const { project, task } = await readyTask(projectName, input.taskId);
  const title = cap(`${task.id} ${task.title}`, TITLE_MAX);
  const summary = cap(task.goal || `按任务规划执行 ${task.id}（${task.title}）`, SUMMARY_MAX);
  // 题目写进登记处的缓存目录（不进仓库、不给选手直接看路径），dispatch 读完即删。
  const dir = join(paths().cache, 'plan-prompts');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${task.id}-${process.pid}-${Date.now()}.md`);
  try {
    await writeAtomic(file, promptText(project.name, task, input.extra));
    return await dispatch(file, {
      who: input.who, project: project.name, title, summary, kind: '实现',
      ...(input.ro ? { ro: true } : {}),
      plan: { taskId: task.id, spec: task.spec ?? `docs/tasks/${task.id}.md` },
      ...(input.autopilot ? { autopilot: { ...input.autopilot } } : {}),
    }, start);
  } finally {
    await rm(file, { force: true });
  }
}
