import { budgetUsed, isActiveState, listAutopilots } from './autopilot.ts';
import { readOwnerNoticesReadonly } from './owner-notifications.ts';
import { ownerReasons, redactText } from './autopilot-diagnosis.ts';
import { alive } from './platform.ts';
import type { ViewAutopilot } from './view-types.ts';

export async function autopilotView(): Promise<{ autopilots: ViewAutopilot[]; autopilotProblem: string | null }> {
  const list = await listAutopilots();
  const notices = await readOwnerNoticesReadonly().catch(() => null);
  return { autopilotProblem: list.broken.length ? `有 ${list.broken.length} 条无人看守记录无法读取，请负责人检查登记。` : null,
    autopilots: list.runs.map(run => {
      const used = budgetUsed(run), active = isActiveState(run.state);
      const clean = (value: unknown, max = 300) => redactText(value, max, 'head', { repo: run.repo })
        .replace(/〈(?:仓库|副本)〉(?:[\\/][^\s，。；）)\]}]+)+/g, '〈路径已隐去〉');
      const event = notices?.find(n => n.id === run.ownerEvent);
      return { id: run.id, project: run.project, taskId: run.taskId, state: active && !alive(run.pid, run.pidSince) ? 'recovering' : run.state,
        active, managed: !!run.flow, created: run.created, ended: run.ended ?? null,
        reason: run.ownerCode ? ownerReasons[run.ownerCode] : run.reason ? clean(run.reason) : null,
        writer: run.who[0], reviewer: run.flow?.reviewer ?? null, network: run.network,
        budget: { policy: run.policy.id, minutesLeft: Math.max(0, Math.floor(run.policy.minutes - used.minutes)),
          attemptsLeft: Math.max(0, run.policy.attempts - used.attempts), nodesLeft: Math.max(0, run.policy.nodes - used.nodes) },
        nodes: run.nodes.map(n => ({ id: n.id, state: n.state, parent: n.parent ?? null, deps: n.task?.deps ?? [], title: n.task ? clean(n.task.title, 80) : null })),
        attempts: run.attempts.map(a => ({ node: a.node, attempt: a.attempt, at: a.at, outcome: a.outcome ?? null, jobs: a.jobs ?? [], patch: a.patch ?? null })),
        diagnoses: (run.diagnoses ?? []).map(d => ({ node: d.node, at: d.at, action: d.action ?? null, note: d.code ? ownerReasons[d.code] : d.note ? clean(d.note, 200) : null })),
        reviews: (run.flow?.reviews ?? []).map(r => ({ node: r.node, at: r.at, verdict: r.verdict ?? null, jobs: r.jobs ?? [] })),
        verification: run.flow?.verification ? { ok: run.flow.verification.ok, at: run.flow.verification.at,
          steps: run.flow.verification.steps.map(s => ({ ok: s.ok, summary: clean(s.summary) })) } : null,
        patch: run.flow?.reviews.some(r => r.verdict === 'pass') ? run.flow.accepted : null,
        notification: run.ownerEvent ? notices === null ? 'unknown' : event?.state === 'pending' && event.error ? 'retry' : event?.state ?? 'pending' : null,
      };
    }) };
}
