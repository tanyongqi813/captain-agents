import { chmod, copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deepseekHome } from './sandbox.ts';
import { readDeepseekRuntimeSettings } from './settings.ts';
import type { DeepseekEndpoint } from './deepseek-settings.ts';

// 只记录文件版本元数据，不计算密钥指纹、不把密钥写到任务或日志。
export async function deepseekCredentialVersion(): Promise<string> {
  try {
    const info = await lstat(join(deepseekHome(), 'auth.json'));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
  } catch { throw new Error('DeepSeek 凭据不存在或不安全，请重新登录后派活。'); }
}

export async function prepareDeepseekCredentials(jobId: string, connection: DeepseekEndpoint, version: string | undefined): Promise<{ home: string; release(): Promise<void> }> {
  const current = await readDeepseekRuntimeSettings();
  if (current.baseUrl !== connection.baseUrl || current.wireApi !== connection.wireApi) throw new Error('DeepSeek 连接已改变，旧任务未启动，请重新派活。');
  if (!version || version !== await deepseekCredentialVersion()) throw new Error('DeepSeek 凭据已改变或旧任务没有凭据版本，未启动，请重新派活。');
  // 认证文件在私有目录中复制，CLI 不再延迟读取可被后续登录替换的共享文件。
  // 会话目录按任务稳定，续接可保留会话；收尾仅删除本轮认证文件。
  const home = join(deepseekHome(), 'runs', createHash('sha256').update(jobId).digest('hex'));
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const auth = join(home, 'auth.json');
  const release = () => rm(auth, { force: true });
  try {
    await copyFile(join(deepseekHome(), 'auth.json'), auth);
    await chmod(auth, 0o600);
    if (version !== await deepseekCredentialVersion()) throw new Error('DeepSeek 凭据在准备期间改变，请重新派活。');
    const latest = await readDeepseekRuntimeSettings();
    if (latest.baseUrl !== connection.baseUrl || latest.wireApi !== connection.wireApi) throw new Error('DeepSeek 连接在准备期间改变，请重新派活。');
    return { home, release };
  } catch (error) { await release(); throw error; }
}
