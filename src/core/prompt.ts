import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { toolRoot } from './paths.ts';
import type { Project } from './project.ts';
import { vendorOf } from './roster.ts';
import type { Who } from './roster.ts';

export async function prompt(project: Project, file: string, network = false) {
  const common = await readFile(join(toolRoot, 'rules.md'), 'utf8');
  const extra = project.rules ? await readFile(resolve(project.repo, project.rules), 'utf8') : '';
  const task = await readFile(file, 'utf8');
  const notice = network === true ? '这件活可以联网。只为完成本题联网，不要把仓库内容、报告或任何文件内容发到外面。' : '';
  return [common.trim(), notice, extra.trim(), task.trim()].filter(Boolean).join('\n\n---\n\n') + '\n';
}

const FRUGAL = `## 上下文节流规则

- 把本题目里的“执行胶囊”（如有）或明确任务正文当作本轮唯一执行合同；不要重读整份 TASK_LIST、前置任务的评审历史或未列出的架构文档。
- 先只读精确锚点和可修改文件；不做仓库级广泛搜索。锚点不存在或契约冲突时，先报告再扩大阅读。
- 如上下文被压缩，优先重读执行胶囊和自己已改的文件，不从项目文档重新建立全量上下文。
- 完成一个独立模块或持续工作超过约 10 分钟时可简短报告进度，但不停下等待确认；只有范围扩张、设计冲突或需要新权限时才停止询问。`;

export function workerPrompt(text: string, who: Who): string {
  const vendor = vendorOf(who);
  return vendor === 'deepseek' || vendor === 'kimi' ? `${text.trim()}\n\n---\n\n${FRUGAL}\n` : text;
}
