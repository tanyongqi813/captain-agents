import { startAutopilot, stopAutopilot } from '../../src/core/autopilot-engine.ts';
import { safeName } from '../../src/core/paths.ts';
import type { AutopilotInput } from '../shared/ipc.ts';
import { redactText } from '../../src/core/autopilot-diagnosis.ts';
import { trustedLead } from '../../src/core/lead-runtime.ts';

const fields = ['project', 'taskId', 'writer', 'reviewer', 'policy', 'permission', 'network'];
export function autopilotActions(refresh: () => Promise<void>, deps = { start: startAutopilot, stop: stopAutopilot }) {
  const pending = new Set<string>();
  return {
    async start(args: unknown[]) {
      const value = args[0];
      if (args.length !== 1 || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无人看守参数不对。');
      const input = value as AutopilotInput;
      if (fields.some(k => !Object.hasOwn(input, k)) || Object.keys(input).some(k => !fields.includes(k) && k !== 'leadReview')
        || Object.hasOwn(input, 'leadReview') && typeof input.leadReview !== 'boolean'
        || typeof input.project !== 'string' || input.project.length > 200 || typeof input.taskId !== 'string' || !/^TASK-\d{1,6}$/.test(input.taskId)
        || typeof input.writer !== 'string' || !/^[^\s:]{1,64}:(?:medium|high|xhigh)(?::fast)?$/.test(input.writer)
        || typeof input.reviewer !== 'string' || !/^[^\s:]{1,64}:(?:medium|high|xhigh)(?::fast)?$/.test(input.reviewer)
        || !['short', 'standard', 'long'].includes(input.policy) || input.permission !== 'workspace-write' || typeof input.network !== 'boolean') throw new Error('请明确选择执行者、独立审查者、强度、权限、联网确认和预设预算。');
      safeName(input.project);
      if (input.leadReview && !trustedLead(input.reviewer)) throw new Error('负责人复审流程必须选择受信的 Codex 负责人，不能由其他执行者代替。');
      const key = `${input.project}:${input.taskId}`;
      if (pending.has(key)) throw new Error('这项任务正在启动无人看守，请稍等。');
      pending.add(key);
      try {
        const run = await deps.start({ project: input.project, taskId: input.taskId, who: [input.writer], reviewer: input.reviewer,
          policy: input.policy, ro: false, expectedNetwork: input.network,
          ...(Object.hasOwn(input, 'leadReview') ? { leadReview: input.leadReview } : {}) });
        await refresh().catch(() => {}); return run.id;
      } catch (error) { throw new Error(redactText(error instanceof Error ? error.message : '启动失败，请检查任务规划和选手设置。', 300));
      } finally { pending.delete(key); }
    },
    async stop(args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'string' || !/^\d{4}-\d{4}-auto(?:-\d+)?$/.test(args[0])) throw new Error('无人看守编号不对。');
      try { await deps.stop(args[0]); await refresh().catch(() => {}); }
      catch (error) { throw new Error(redactText(error instanceof Error ? error.message : '停止失败，请检查执行证据。', 300)); }
    },
  };
}
