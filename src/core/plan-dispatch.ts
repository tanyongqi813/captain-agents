import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { paths, safeName } from './paths.ts';
import { writeAtomic } from './fsx.ts';
import { findProject } from './project.ts';
import { readTaskPlan } from './task-plan.ts';
import { dispatch, launch } from './dispatch.ts';
import type { Job } from './job.ts';

// 按字截断但保留换行（发给选手的题目是多行文本；clip 会把换行压平，不能用它）。
function cap(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// 规划派发（docs/tasks/TASK-006.md）：从项目任务台账发起派活的核心校验入口。
// 只接受 TASK-005 解析为真正可执行（ready）的 READY 任务；派发前重新读规划文件做权威校验，
// 不信任界面带来的任何展示数据。规划文件全程只读。
export type PlanDispatchInput = { project: string; taskId: string; who: string[]; ro?: boolean };

// 发给选手的题目由受长度限制的纯文字字段拼成（长度边界在 TASK-005 的解析里已经卡好），
// 整份再卡一道上限；Markdown 内容一律当纯文本。
const PROMPT_MAX = 8000;
const TITLE_MAX = 200;
const SUMMARY_MAX = 200;

function promptText(project: string, task: { id: string; title: string; goal: string; acceptance: string[]; spec: string | null }): string {
  const lines = [`任务编号：${task.id}`, `任务题目：${task.title}`, ''];
  if (task.goal) lines.push('## 任务目标', '', task.goal, '');
  if (task.acceptance.length) lines.push('## 验收标准', '', ...task.acceptance.map((item, i) => `${i + 1}. ${item}`), '');
  lines.push(`——`, `来源：${project} 项目的任务规划${task.spec ? `（${task.spec}）` : ''}。`);
  return cap(lines.join('\n'), PROMPT_MAX);
}

// start 可替换供测试替身；其余一律走现有 dispatch 流程（项目、策略、额度、隔离、并发、DeepSeek 闲时检查都在里面）。
export async function planDispatch(input: PlanDispatchInput, start: typeof launch = launch): Promise<Job[]> {
  if (!input || typeof input !== 'object') throw new Error('派发参数格式不对。');
  const projectName = safeName(String(input.project ?? ''));
  if (typeof input.taskId !== 'string' || !/^TASK-\d{1,6}$/.test(input.taskId)) throw new Error('任务编号无效，请从规划里选择一项可执行的任务。');
  if (!Array.isArray(input.who) || !input.who.length) throw new Error('请先选择至少一位选手再派发。');
  if (input.who.length > 12 || input.who.some(choice => typeof choice !== 'string' || choice.length > 100)) throw new Error('选手选择不合法，请重新选择。');
  // 项目登记是派发的既有前提；未登记、已删仓库等按现有中文报错走。
  const project = await findProject(projectName);
  // 权威校验：重新读规划文件，只有 ready 的 READY 任务能派发；台账在此期间被改坏也只影响这一次派发。
  const plan = await readTaskPlan({ name: project.name, repo: project.repo });
  if (!plan.present) throw new Error(`项目 ${project.name} 没有任务规划（缺少 docs/TASK_LIST.md）。`);
  const task = plan.tasks.find(item => item.id === input.taskId);
  if (!task) throw new Error(`任务台账里没有 ${input.taskId}，请刷新规划后再试。`);
  if (!task.ready) {
    throw new Error(`任务 ${task.id} 现在不能派发：${task.problems.join('；') || '只有 READY 且所有前置任务都通过的任务才能派发。'}`);
  }
  const title = cap(`${task.id} ${task.title}`, TITLE_MAX);
  const summary = cap(task.goal || `按任务规划执行 ${task.id}（${task.title}）`, SUMMARY_MAX);
  // 题目写进登记处的缓存目录（不进仓库、不给选手直接看路径），dispatch 读完即删。
  const dir = join(paths().cache, 'plan-prompts');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${task.id}-${process.pid}-${Date.now()}.md`);
  try {
    await writeAtomic(file, promptText(project.name, task));
    return await dispatch(file, {
      who: input.who, project: project.name, title, summary, kind: '实现',
      ...(input.ro ? { ro: true } : {}),
      plan: { taskId: task.id, spec: task.spec ?? `docs/tasks/${task.id}.md` },
    }, start);
  } finally {
    await rm(file, { force: true });
  }
}
