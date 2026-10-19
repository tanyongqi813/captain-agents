import type { AutopilotState } from './autopilot.ts';
// 纯展示词典，可供渲染窗口使用；不引入任何文件或进程能力。
export const stateNames: Record<AutopilotState, string> = {
  planning: '准备中', executing: '在干', reviewing: '等审查', verifying: '等验收',
  diagnosing: '在诊断', recovering: '等恢复', completed: '已完成', needs_owner: '等主人', stopped: '已停止',
};
