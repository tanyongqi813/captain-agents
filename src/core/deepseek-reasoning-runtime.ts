import { assertDeepseekReasoning, deepseekEndpoint } from './deepseek-settings.ts';
import type { Job, Command } from './job.ts';

// 验证即将启动的保存命令，不改写参数，也不借当前连接修补旧任务身份。
export function assertDeepseekRuntimeReasoning(job: Job, command: Command): void {
  if (job.who !== 'deepseek' && job.who !== 'deepseek-flash') return;
  if (!job.deepseekConnection) throw new Error('旧任务缺少冻结的DeepSeek连接，请重新派活。');
  const endpoint = deepseekEndpoint(job.deepseekConnection);
  const model = job.who === 'deepseek-flash' ? endpoint.flashModel : endpoint.proModel;
  if (job.model !== model) throw new Error('任务实际模型与冻结连接不一致，请重新派活。');
  const mode = (job.who === 'deepseek-flash' ? endpoint.flashReasoning : endpoint.proReasoning) ?? 'high';
  assertDeepseekReasoning(endpoint, model, mode);
  const args = command.args;
  const models = args.flatMap((arg, i) => arg === '-m' || arg === '--model' ? [args[i + 1]]
    : arg.startsWith('--model=') ? [arg.slice('--model='.length)] : []);
  if (models.length !== 1 || models[0] !== model) throw new Error('保存命令的模型与冻结模型不一致或有歧义，请重新派活。');
  const overrides = args.map((arg, i) => ({ arg, i })).filter(({ arg }) => arg.includes('model_reasoning_effort'));
  if (mode === 'default') {
    if (overrides.length) throw new Error('冻结默认强度但保存命令仍含强度覆盖，请重新派活。');
  } else if (job.effort !== 'high' || overrides.length !== 1 || overrides[0].arg !== 'model_reasoning_effort="high"'
    || !['-c', '--config'].includes(args[overrides[0].i - 1])) {
    throw new Error('保存命令的推理强度与已确认高档不一致或有歧义，请重新派活。');
  }
}
