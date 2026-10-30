import type { View } from '../../../src/core/view-types.ts';
import type { QuotaStop } from '../../../src/core/settings.ts';
import { fmtTime } from './board.ts';

export type Quota = View['quota'][number];
export type QuotaBar = Quota['bars'][number];
// 到了设置里的停派线（缺省 80%）起琥珀，95% 起红；停派线以下灰色，平时安静；不设限时没有琥珀档。
export const quotaLevel = (used: number | null, stop: QuotaStop = 80): '' | 'warn' | 'bad' => used == null ? '' : used >= 95 ? 'bad' : stop !== null && used >= stop ? 'warn' : '';
// 一家有多个池（Cursor 三个池、Codex 两个窗口）时，取用得最多的那个；一个都没查到时是 undefined。
export const topBar = (q: Quota) => q.bars.reduce<QuotaBar | undefined>((a, b) => (b.used ?? -1) > (a?.used ?? -1) ? b : a, undefined);
// 顶栏的 Cursor 表示套餐整体消耗；子池可能已满，但不能代替总额度。
export const headerQuotaBar = (q: Quota) => q.icon === 'cursor' ? q.bars.find(b => b.label === '总额度') : topBar(q);
const barText = (b: QuotaBar) => b.used == null ? '查不到' : (b.approx ? '不到 ' : '') + b.used + '%';
export const dataTime = (q: Quota) => q.at ? `数据时间 ${fmtTime(q.at, true)}` : '还没有查到过';
export const quotaFailure = (q: Quota) => q.at && q.bars.some(b => b.used !== null)
  ? `本次刷新失败，显示 ${fmtTime(q.at, true)} 的数据` : '本次刷新失败，暂无可用数据';
// 加油包（Extra Usage）元数据：独立付费，只作文字展示——不画百分比、不进额度环、不影响派发检查。
export const extraUsageLine = (e: NonNullable<Quota['extraUsage']>) => {
  const parts = [e.enabled === null ? '状态未知' : e.enabled ? '已开启' : '未开启'];
  if (e.balance !== null) parts.push(`余额 ${e.currency ?? ''}${e.balance}`);
  if (e.spent !== null) parts.push(`本月已用 ${e.currency ?? ''}${e.spent}`);
  if (e.monthlyLimit !== null) parts.push(`月上限 ${e.currency ?? ''}${e.monthlyLimit}`);
  return `加油包（Extra Usage）：${parts.join('，')}`;
};
export const extraUsageWarning = '服务方已开启额外付费，套餐用尽后可能继续计费。工作台不会替你开启或购买。';
// 悬停提示：每个池一行，加油包单独一行（不与套餐窗口混排），再写数据时间（提示是纯文字，提醒色只用在各家表现页的卡片上）。
export const quotaTip = (q: Quota) => [...q.bars.map(b => `${b.label}：${barText(b)}`), ...(q.extraUsage ? [extraUsageLine(q.extraUsage), ...(q.extraUsage.enabled ? [extraUsageWarning] : [])] : []), ...(q.failed ? [quotaFailure(q)] : []), dataTime(q)].join('\n');
