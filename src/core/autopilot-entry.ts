import { loadConfiguredRoster } from './settings.ts';
import { runAutopilot } from './autopilot-engine.ts';

// 无人看守的推进进程入口（隔离外，detached）。只接一个登记编号，别的参数一概不认：
// 项目、任务、选手、预算全在登记文件里，启动之后不能再由外面改。
const id = process.argv[2];
if (!id) {
  console.error('缺少无人看守的编号。请用 xagents autopilot start 启动。');
  process.exit(1);
}
await loadConfiguredRoster();
await runAutopilot(id);
