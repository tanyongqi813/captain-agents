// 只运行受控Node替身，不接受真实命令/模型或凭据参数。
import { runChannelProbe } from '../src/core/channel-probe.ts';

const cases: Record<string, string> = {
  success: `const value=require('node:fs').readFileSync('probe-input.txt','utf8').trim();console.log(JSON.stringify({type:'result',result:value}));`,
  silent: '',
  started: `console.log(JSON.stringify({type:'tool_call',subtype:'started'}));setInterval(()=>{},1000);`,
  hang: `setInterval(()=>{},1000);`,
  flood: `process.stderr.write('x'.repeat(70000));setInterval(()=>{},1000);`,
};
const args = process.argv.slice(2), scenario = args[1];
if (args.length !== 2 || args[0] !== '--offline' || !Object.hasOwn(cases, scenario ?? '')) {
  console.error('仅支持 --offline success|silent|started|hang|flood；不提供真实通道入口。');
  process.exitCode = 2;
} else {
  const report = await runChannelProbe({ file: process.execPath, args: ['-e', cases[scenario]!] }, { timeoutMs: 1000 });
  console.log(JSON.stringify({ mode: 'offline_fixture', scenario, realModelCalled: false, amountHardLimit: null, report }));
  process.exitCode = report.outcome === 'success' ? 0 : 1;
}
