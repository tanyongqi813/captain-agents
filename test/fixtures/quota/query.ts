import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const [file, ...args] = process.argv.slice(2);
if (process.env.XA_QUERY_MARKER) appendFileSync(process.env.XA_QUERY_MARKER, JSON.stringify({ file, args }) + '\n');
// Kimi：非交互的 provider list 走结构化 JSON；交互 /usage 走 pty 桥（python3 且参数里有 kimi 路径）。
const sample = args[0] === 'provider' && args[1] === 'list' ? 'kimi-providers.json'
  : file === 'python3' ? (args.some(a => a.includes('kimi')) ? 'kimi-usage.txt' : 'cursor.txt') : file === 'grok' ? (args[0] === 'models' ? 'grok-models.txt' : 'grok.json') : file === 'cursor-agent' ? 'cursor-models.txt' : 'codex-models.json';
if (file === 'grok' && args[0] === 'agent') {
  let input = '';
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.includes('"id":2')) { process.stdout.write(readFileSync(join(import.meta.dirname, sample))); }
  });
} else {
  process.stdout.write(readFileSync(join(import.meta.dirname, sample)));
}
