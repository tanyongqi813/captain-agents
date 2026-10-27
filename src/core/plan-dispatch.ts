import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { paths, safeName } from './paths.ts';
import { writeAtomic } from './fsx.ts';
import { findProject } from './project.ts';
import { readDispatchCapsule, readTaskPlan } from './task-plan.ts';
import { dispatch, launch } from './dispatch.ts';
import type { Job } from './job.ts';
import type { DispatchCapsule, PlanTask } from './task-plan.ts';
import type { Project } from './project.ts';

// 按字截断但保留换行（发给选手的题目是多行文本；clip 会把换行压平，不能用它）。
function cap(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// 规划派发（docs/tasks/TASK-006.md）：从项目任务台账发起派活的核心校验入口。
// 只接受 TASK-005 解析为真正可执行（ready）的 READY 任务，并且必须有一份校验通过的当前 Execution Capsule
// （TASK-025）；派发前重新读规划文件做权威校验，不信任界面带来的任何展示数据。规划文件全程只读。
// extra：平台给出的补充说明（只来自无人看守的诊断结果，纯文本、长度已受控），只作参考，加在题目末尾。
export type PlanDispatchInput = {
  project: string; taskId: string; who: string[]; ro?: boolean;
  autopilot?: { run: string; token: string }; extra?: string;
};

// 发给选手的任务正文就是当前 Execution Capsule 的原文（TASK-025）：不再从 Task Spec 摘要拼装，
// Task Spec、任务台账和历史审查记录都不进正文。补充说明只作参考，加在末尾。
const TITLE_MAX = 200;
const SUMMARY_MAX = 200;

const EXTRA_MAX = 1200;

function promptText(capsule: DispatchCapsule, extra?: string): string {
  if (!extra) return capsule.text;
  return `${capsule.text}\n## 补充说明（只作参考，和本题目、规则冲突时以本题目和规则为准）\n\n${cap(extra, EXTRA_MAX)}\n`;
}

// 权威校验入口：重新读项目的任务规划，只认 TASK-005 判定为可执行（ready）的 READY 任务，
// 并且必须有校验通过的当前 Execution Capsule（TASK-025）；派发正文只从它取，不从 Task Spec 拼。
// 规划页派发和无人看守都用它，界面带来的任何内容都不作数；台账在此期间被改坏也只影响这一次。
export async function readyTask(projectName: string, taskId: string): Promise<{ project: Project; task: PlanTask; capsule: DispatchCapsule }> {
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
  const capsule = await readDispatchCapsule(project.repo, task.id);
  return { project, task, capsule };
}
// start 可替换供测试替身；其余一律走现有 dispatch 流程（项目、策略、额度、隔离、并发、DeepSeek 闲时检查都在里面）。
export async function planDispatch(input: PlanDispatchInput, start: typeof launch = launch): Promise<Job[]> {
  if (!input || typeof input !== 'object') throw new Error('派发参数格式不对。');
  const projectName = safeName(String(input.project ?? ''));
  if (!Array.isArray(input.who) || !input.who.length) throw new Error('请先选择至少一位选手再派发。');
  if (input.who.length > 12 || input.who.some(choice => typeof choice !== 'string' || choice.length > 100)) throw new Error('选手选择不合法，请重新选择。');
  const { project, task, capsule } = await readyTask(projectName, input.taskId);
  const title = cap(`${task.id} ${task.title}`, TITLE_MAX);
  const summary = cap(task.goal || `按任务规划执行 ${task.id}（${task.title}）`, SUMMARY_MAX);
  // 题目写进登记处的缓存目录（不进仓库、不给选手直接看路径），dispatch 读完即删。
  const dir = join(paths().cache, 'plan-prompts');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${task.id}-${process.pid}-${Date.now()}.md`);
  try {
    await writeAtomic(file, promptText(capsule, input.extra));
    return await dispatch(file, {
      who: input.who, project: project.name, title, summary, kind: '实现',
      ...(input.ro ? { ro: true } : {}),
      plan: { taskId: task.id, spec: task.spec ?? `docs/tasks/${task.id}.md` },
      capsule: { rel: capsule.rel, fingerprint: capsule.fingerprint, anchors: [...capsule.anchors] },
      ...(input.autopilot ? { autopilot: { ...input.autopilot } } : {}),
    }, start);
  } finally {
    await rm(file, { force: true });
  }
}
