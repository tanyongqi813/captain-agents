import { assembleHandoff, capsuleFingerprint, contractMetadata, parseTaskList, sourceAnchors } from './task-plan.ts';
import type { HandoffFiles } from './task-plan.ts';
import { buildLeadReviewPacket, parseLeadReview } from './lead-review.ts';
import type { LeadReviewBinding } from './lead-review.ts';

export type LeadCapsuleInput = {
  files: HandoffFiles;
  taskId: string;
  currentAttempt: string;
  candidate: string;
  replyText: string;
  // 由负责人记录层分配并保留稳定编号，不接受模型自选 finding 或 attempt。
  findingIds: string[];
};
export type LeadCapsuleArtifact = {
  rel: string; attempt: string; text: string; fingerprint: string;
  node: string | null; dependsOn: string[];
};
export type LeadCapsuleCompilation = {
  kind: 'uncommitted-capsule-proposals';
  action: 'correct' | 'split';
  source: LeadReviewBinding;
  findingIds: string[];
  capsules: LeadCapsuleArtifact[];
};
const normalized = (text: string) => text.replace(/\r\n?/g, '\n');
const quote = (text: string) => text.split(/\r\n?|\n|\u2028|\u2029/).map(line => `> ${line}`).join('\n');
const capPath = (taskId: string, attempt: string) => `docs/execution/${taskId}/attempt-${attempt}.md`;

function editMetadata(text: string, values: Record<string, string>): string {
  const start = /^##[ \t]+/m.exec(text)?.index;
  if (start === undefined) throw new Error('胶囊或任务文档缺少规范章节。');
  let header = text.slice(0, start);
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^- ${key}:[ \\t]*.+$`, 'gm');
    if ([...header.matchAll(pattern)].length !== 1) throw new Error('胶囊编译需要唯一的契约英文元数据。');
    header = header.replace(pattern, () => `- ${key}: \`${value}\``);
  }
  return header + text.slice(start);
}
function section(text: string, name: string): { start: number; end: number; body: string } {
  const matches = [...text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  const indices = matches.map((m, i) => m[1] === name ? i : -1).filter(i => i >= 0);
  if (indices.length !== 1) throw new Error('胶囊编译需要唯一且完整的契约章节。');
  const index = indices[0], heading = matches[index];
  const end = matches[index + 1]?.index ?? text.length;
  return { start: heading.index!, end, body: text.slice(heading.index! + heading[0].length, end) };
}
function editSection(text: string, name: string, content: string): string {
  const range = section(text, name);
  return text.slice(0, range.start) + `## ${name}\n\n${content}\n\n` + text.slice(range.end);
}
function editIndex(list: string, taskId: string, attempt: string): string {
  let count = 0;
  const result = normalized(list).split('\n').map(line => {
    if (/^\s*\|\s*\[(TASK-\d+)\]/.exec(line)?.[1] !== taskId) return line;
    count++;
    const cells = line.trim().split('|');
    if (cells.length !== 9) throw new Error('胶囊编译需要七列契约台账。');
    cells[3] = ' READY '; cells[7] = ` attempt-${attempt} `;
    return cells.join('|');
  }).join('\n');
  if (count !== 1) throw new Error('胶囊编译找不到唯一的任务台账行。');
  return result;
}
function noErrors(files: HandoffFiles, taskId: string, requireDispatchable: boolean): void {
  const report = assembleHandoff(files);
  if (report.diagnostics.some(d => d.severity === 'error' && (d.taskId === null || d.taskId === taskId))
    || requireDispatchable && !report.dispatchable.includes(taskId)) throw new Error('胶囊编译的共享契约或前置条件校验未通过。');
}

// 只验证内存投影，不写 Task Spec / TASK_LIST，也不把模型文字当命令或派活依据。
// 每个结果均待后续事务原子持久化和真实起点/副本校验；返回前任一失败都会抛错，不能留下半组结果。
export function compileLeadCapsules(input: LeadCapsuleInput): LeadCapsuleCompilation {
  const { files, taskId, currentAttempt } = input;
  if (!/^TASK-\d{1,30}$/.test(taskId) || !/^\d{2,4}$/.test(currentAttempt) || Number(currentAttempt) < 1
    || !/^[a-f0-9]{64}$/.test(input.candidate)) throw new Error('增量胶囊的任务、当前轮次或候选版本不合法。');
  if (!Array.isArray(input.findingIds) || !input.findingIds.length || input.findingIds.length > 12
    || input.findingIds.some(v => typeof v !== 'string' || !/^F-\d{2,30}$/.test(v))
    || new Set(input.findingIds).size !== input.findingIds.length) throw new Error('增量胶囊缺少稳定且唯一的当前 finding 编号。');
  noErrors(files, taskId, false);
  const specRel = `docs/tasks/${taskId}.md`, currentRel = capPath(taskId, currentAttempt);
  const specs = files.specs.filter(f => f.rel === specRel), caps = files.capsules.filter(f => f.rel === currentRel);
  if (specs.length !== 1 || caps.length !== 1 || files.listText === null) throw new Error('找不到唯一的当前任务或执行胶囊。');
  const meta = contractMetadata(specs[0].text), rows = parseTaskList(files.listText).filter(row => row.id === taskId);
  if (!['READY', 'IN_PROGRESS', 'CHANGES_REQUESTED'].includes(meta.status)
    || meta.current_attempt !== currentAttempt || rows.length !== 1 || rows[0].attempt !== currentAttempt) {
    throw new Error('当前任务状态或执行指针已变化，不编译旧轮次提案。');
  }
  const currentText = normalized(caps[0].text);
  const currentMeta = contractMetadata(currentText);
  if (currentMeta.priority !== meta.priority || currentMeta.difficulty !== meta.difficulty) throw new Error('当前胶囊的优先级或难度与任务不一致。');
  // 共用负责人底座检查完整胶囊，不额外读取整份规划或历史给模型。
  const source = buildLeadReviewPacket({ event: 'completed', capsule: { taskId, attempt: currentAttempt, text: currentText },
    candidate: input.candidate, report: null, diffSummary: null, activity: null, verification: null,
    budget: { minutesLeft: 0, attemptsLeft: 0, nodesLeft: 0, usageTokensLeft: null } }).binding;
  const parsed = parseLeadReview(input.replyText, source);
  if (!parsed.ok) throw new Error('增量胶囊的负责人回包不合法或版本已过期。');
  const reply = parsed.reply;
  if (reply.action !== 'correct' && reply.action !== 'split') throw new Error('只有修正或拆分提案可以编译增量胶囊。');
  const readySpec = (attempt: string) => editMetadata(normalized(specs[0].text), { status: 'READY', current_attempt: attempt });
  const project = (attempt: string, capsules: HandoffFiles['capsules']): HandoffFiles => ({ ...files,
    listText: editIndex(files.listText!, taskId, attempt),
    specs: files.specs.map(file => file.rel === specRel ? { ...file, text: readySpec(attempt) } : file), capsules });
  // 只能把当前运行状态投影成 READY 以重用资格规则；依赖状态来自真实快照，绝不伪造通过。
  noErrors(project(currentAttempt, files.capsules.map(file => file.rel === currentRel
    ? { ...file, text: editMetadata(currentText, { dispatch_state: 'READY' }) } : file)), taskId, true);
  const proposals = reply.action === 'correct'
    ? [{ node: null, goal: reply.proposal.goal, acceptance: reply.proposal.acceptance, deps: [] as string[] }]
    : reply.proposal.nodes.map(node => ({ node: node.id, goal: node.goal, acceptance: [node.acceptance], deps: [...node.deps] }));
  const capsules: LeadCapsuleArtifact[] = proposals.map((proposal, offset) => {
    const number = Number(currentAttempt) + offset + 1;
    if (number > 9999) throw new Error('增量胶囊轮次超过支持上限。');
    const attempt = String(number).padStart(2, '0'), rel = capPath(taskId, attempt);
    const occupied = [...files.capsules, ...files.reviews].some(file => {
      const match = /^docs\/(?:execution|reviews)\/(TASK-\d+)\/attempt-(\d+)\.md$/.exec(file.rel);
      return match?.[1] === taskId && Number(match[2]) === number;
    });
    if (occupied) {
      throw new Error('增量胶囊的轮次已有历史记录，不允许覆盖或复用。');
    }
    let text = editMetadata(currentText, { attempt, dispatch_state: 'READY', revision_reason: 'changes_requested' });
    text = text.replace(/^# [^\n]+/, () => `# Execution Capsule — ${taskId} / attempt-${attempt}`);
    text = editSection(text, '本轮唯一目标', quote(proposal.goal));
    text = editSection(text, '本轮验收切片', proposal.acceptance.map((item, i) => quote(`${i + 1}. ${item}`)).join('\n'));
    const findingLines = input.findingIds.map(id => `- \`${id}\``).join('\n');
    text = editSection(text, 'Active findings', `${findingLines}\n\n${quote(reply.reason)}`);
    const facts = section(currentText, '已确认事实（禁止重新推导）').body.trim();
    text = editSection(text, '已确认事实（禁止重新推导）', `${facts}\n\n- 本轮只处理当前 findings，原执行边界及已接受成果保持不变。`
      + (proposal.node ? `\n- 平台子节点：${proposal.node}；前置子节点：${proposal.deps.join(', ') || 'none'}；必须由运行侧核对已接受依赖后才可启动。` : ''));
    return { rel, attempt, text, fingerprint: capsuleFingerprint(text), node: proposal.node, dependsOn: [...proposal.deps] };
  });
  // 验证整组后才返回；投影保留所有旧制品，不把当前胶囊或历史 Review 拼入执行正文。
  const combined = [...files.capsules, ...capsules.map(c => ({ rel: c.rel, text: c.text }))];
  for (const artifact of capsules) {
    sourceAnchors(artifact.text);
    buildLeadReviewPacket({ event: 'completed', capsule: { taskId, attempt: artifact.attempt, text: artifact.text },
      candidate: input.candidate, report: null, diffSummary: null, activity: null, verification: null,
      budget: { minutesLeft: 0, attemptsLeft: 0, nodesLeft: 0, usageTokensLeft: null } });
    noErrors(project(artifact.attempt, combined), taskId, true);
  }
  return { kind: 'uncommitted-capsule-proposals', action: reply.action, source: { ...source }, findingIds: [...input.findingIds], capsules };
}

// 持锁依次写文件不是规划事务。事务恢复、唯一领取和执行基准尚未接齐时，
// 必须在零IO处拒绝，不能返回让调用方自动续跑的结果。纯编译仍可用于人工审查。
export async function publishLeadCorrection(_repo: string, _input: Omit<LeadCapsuleInput, 'files'>): Promise<LeadCapsuleCompilation> {
  throw new Error('自动发布尚未具备完整规划事务、领取租约和执行基准；未写入规划，请负责人保留现场处理。');
}
