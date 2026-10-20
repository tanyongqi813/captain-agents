import { budgetNames, isEndedState, listAutopilots, readAutopilot, stateNames } from '../core/autopilot.ts';
import type { AutopilotRun } from '../core/autopilot.ts';
import { reconcileAutopilot, resumeAutopilot, startAutopilot, stopAutopilot } from '../core/autopilot-engine.ts';
import { alive } from '../core/fsx.ts';
import { localTime, table } from './format.ts';

// 无人看守的命令行骨架（docs/tasks/TASK-009.md）。这一版只做启动、看状态、列出来、停止四件事。
// 失败之后会派一位只读故障诊断 AI（docs/tasks/TASK-010.md），但当前状态、停在哪、为什么停都写在 reason 里，
// 所以这里不用多一个参数：自动审查、验收、细拆的执行和桌面界面都还是后续任务的事。

function stateText(run: AutopilotRun): string {
  const head = stateNames[run.state];
  const limit = run.limit ? `（${budgetNames[run.limit]}用完）` : '';
  return `${head}${limit}${run.reason ? `：${run.reason}` : ''}`;
}
function usedText(run: AutopilotRun): string {
  const minutes = Math.floor(run.elapsedSeconds / 60);
  return `${minutes}/${run.policy.minutes} 分 · ${run.attemptCount}/${run.policy.attempts} 次 · ${run.nodeCount}/${run.policy.nodes} 节点`;
}
function progress(run: AutopilotRun): string {
  if (isEndedState(run.state)) return '—';
  if (!Number.isInteger(run.pid) || !alive(run.pid, run.pidSince)) return `推进进程不在，运行 xagents autopilot resume ${run.id} 接着走`;
  return `推进进程 ${run.pid}`;
}

export async function autopilotStart(options: { project: string; taskId: string; who: string[]; policy?: string; ro?: boolean; reviewer?: string }) {
  const run = await startAutopilot(options);
  console.log(`无人看守：${run.id}`);
  console.log(`项目：${run.project}；任务：${run.taskId}（${run.spec}）`);
  console.log(`选手：${run.who.join('、')}；策略：${run.policy.id}（${run.policy.minutes} 分钟 / ${run.policy.attempts} 次尝试 / ${run.policy.nodes} 个节点）；${run.ro ? '只读' : '可改副本'}；${run.network ? '联网开着' : '不联网'}`);
  console.log(`用 xagents autopilot status ${run.id} 看进展，xagents autopilot stop ${run.id} 收手。`);
  console.log(`推进器要是没能起来，登记会留着，用 xagents autopilot resume ${run.id} 接着起来。`);
}

export async function autopilotList() {
  const { runs, broken } = await listAutopilots();
  if (!runs.length) { console.log('没有无人看守。'); }
  else {
    const rows: string[][] = [];
    for (const raw of runs) {
      const run = await reconcileAutopilot(raw);
      rows.push([run.id, run.project, run.taskId, stateText(run), usedText(run), progress(run)]);
    }
    console.log(table(['编号', '项目', '任务', '状态', '用量', '推进'], rows));
  }
  // 登记文件损坏的条目要报出来，不能悄悄当成"没有"。
  if (broken.length) console.log(`有 ${broken.length} 条登记文件读不出来（${broken.join('、')}），已跳过。`);
}

export async function autopilotStatus(id?: string) {
  const { runs } = await listAutopilots();
  const chosen = id ? runs.filter(run => run.id === id) : runs;
  if (id && !chosen.length) {
    // 编号在、但读不出来时给准确的说法，别让人以为没建过。
    try { await readAutopilot(id); } catch (e) { throw e; }
    throw new Error(`找不到无人看守 ${id}。请先运行 xagents autopilot list。`);
  }
  if (!chosen.length) { console.log('没有无人看守。'); return; }
  const rows: string[][] = [];
  for (const raw of chosen) {
    const run = await reconcileAutopilot(raw);
    rows.push([run.id, run.project, run.taskId, stateText(run), usedText(run), progress(run)]);
  }
  console.log(table(['编号', '项目', '任务', '状态', '用量', '推进'], rows));
  for (const raw of chosen) {
    const run = await reconcileAutopilot(raw);
    const tries = run.attempts.slice(-5).map(item => `${item.node}#${item.attempt}${item.outcome ? ` ${item.outcome === 'done' ? '成' : item.outcome === 'failed' ? '败' : '拦'}` : ' 待定'}${item.jobs?.length ? `（${item.jobs.join('、')}）` : ''}`);
    console.log(`${run.id} 建于 ${localTime(run.created)}；起点 ${run.base.slice(0, 10)}；节点 ${run.nodes.map(node => `${node.id} ${node.state}`).join('、')}`);
    if (tries.length) console.log(`  最近尝试：${tries.join('；')}`);
  }
}

// 受控恢复：只接编号。原任务、选手、权限、预算和动作令牌都照旧，不新建登记、不另起一台。
export async function autopilotResume(id: string) {
  const run = await resumeAutopilot(id);
  console.log(`无人看守 ${run.id} 已恢复：推进进程 ${String(run.pid)} 接着走。`);
  console.log(`项目 ${run.project}；任务 ${run.taskId}（${run.spec}）；选手 ${run.who.join('、')}；策略 ${run.policy.id}（${run.policy.minutes} 分钟 / ${run.policy.attempts} 次尝试 / ${run.policy.nodes} 个节点）；${run.ro ? '只读' : '可改副本'}；${run.network ? '联网开着' : '不联网'}；用量 ${usedText(run)}`);
  console.log(run.action ? `原来的动作令牌照旧（${run.action.token}），不会重复派活。` : '还没有待确认的动作。');
  console.log(`用 xagents autopilot status ${run.id} 看进展，xagents autopilot stop ${run.id} 收手。`);
}

export async function autopilotStop(id: string) {
  const run = await stopAutopilot(id);
  console.log(`无人看守 ${run.id} 已停止：${run.reason ?? '主人收手了。'}`);
}
