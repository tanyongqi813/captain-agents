# Cursor 群聊续接探针（2026-10-18）

给 TASK-007 用。接 [2026-10-17 那次](cursor-chat-resume-2026-10-17.md)：当时续接死在建不了 `/tmp/cursor-agent-persist-<uid>`。这次只把这一个目录（以及 macOS 上它的真实路径 `/private/tmp/cursor-agent-persist-<uid>`）加进 Cursor 的可写名单，不放开 `/tmp` 本身，再用同一套 `sandbox()` 重测。

结论：**可写和只读都能用原来的会话号续上，越界文件没有出现。** 群聊可以收 Cursor 成员。小队搭档仍不收 Cursor。Windows 上仍然不派 Cursor。

## 环境

- 系统：macOS（darwin）。`/tmp` 是指向 `/private/tmp` 的链接，所以两处路径都要放开，才是同一个目录。
- `cursor-agent`：`2026.10.14-0f9edde`。
- 隔离：仓库里的 srt（`@anthropic-ai/sandbox-runtime` 0.0.77），由 `src/core/sandbox.ts` 的 `sandbox()` 展开 `sandbox/cursor.json`。网络仍只放行 Cursor 自家域名。
- 续接目录在派活前检查：必须是本人的普通文件夹、权限 `0700`，不能是链接。缺了就按这个权限建上。不删除这个目录，里面是本用户所有 `cursor-agent` 会话共用的锁。
- 状态目录仍是登记处下 `cursor/<任务号哈希>/config` 和 `data`。登录在隔离外读取，只放进这一次进程的环境。本文不记录令牌。
- 模型：`grok-4.7-medium`。
- 工作区和登记处都在临时目录，跑完已删除。

命令形状与派活一致（提示词是探针自己写的，不含私人内容，这里不照录）：

```text
node srt --settings <sandbox.json> cursor-agent -p --output-format stream-json \
  --model grok-4.7-medium --force --trust [--mode ask] [--resume <会话号>] \
  --workspace <工作区> <提示词>
```

## 做法

1. 可写：第一轮自己想一个四字词，写进 `probe-round1.txt`。隔离外删掉这个文件。第二轮 `--resume`，不许再去翻文件，凭对话回忆，并试着写 `/tmp`、家目录、`~/.cursor` 里的探针文件，以及读取 `~/.ssh` 的文件名。
2. 只读：`--mode ask`，沙箱不放开工作区。第一轮想一个四字词，并试着改 `keep.txt`。第二轮同样 `--resume`，再试上面那些越界写。
3. 两轮用同一套状态目录、同一个工作区，再生成一次沙箱，核对可写范围和网络没有变宽。
4. 只读第一轮曾有一次在建立加密连接时被中断（约 2 秒，没有会话号，也没有改文件）。同一条探针又跑了一次，下面的只读结果是这次成功的。

## 结果

| 轮次 | 退出码 | 用时 | 结果 |
|---|---|---|---|
| 可写第 1 轮 | 0 | 26 秒 | 会话号是 UUID。工作区文件和回答都是「暮潮拾贝」。`keep.txt` 仍是 `unchanged`。 |
| 可写第 2 轮（`--resume`） | 0 | 40 秒 | 同一个会话号。删掉第一轮文件后，`probe-round2.txt` 和回答仍是「暮潮拾贝」。第二轮提示词里没有这个词。 |
| 只读第 1 轮 | 0 | 19 秒 | `--mode ask`。回答了「霜桥夜读」。工作区不在可写名单里。`keep.txt` 仍是 `unchanged`。 |
| 只读第 2 轮（`--resume`） | 0 | 25 秒 | 同一个会话号，`--mode ask` 还在。回答里有「霜桥夜读」。`keep.txt` 仍是 `unchanged`。 |

隔离外核对（可写、只读两次都做了）：

- `~/.cursor/cli-config.json`、`hooks.json`、`mcp.json` 的文件编号、大小、修改时间都没变。
- `/tmp/xa-cursor-resume-probe.txt`、家目录下的 `xa-cursor-resume-outside.txt`、`~/.cursor/xa-cursor-resume-probe` 都不存在。
- 同一模式下两轮沙箱设置一致。可写名单里有工作区（只读没有）、任务状态目录、任务 `tmp/`，以及 `/tmp/cursor-agent-persist-<uid>` 和 `/private/tmp/cursor-agent-persist-<uid>`。没有 `/tmp` 或 `/private/tmp` 本身。
- 网络仍只放行 `cursor.sh`、`cursor.com`、`cursorapi.com` 和它们的子域。
- 临时登记处已删除。探针自己的会话锁已从续接目录里去掉；这个共用目录本身没有删。

## 还留着的口子

续接目录是本用户所有 `cursor-agent` 会话共用的，不是每件活一份。选手写得了这个目录里别的会话的锁，写不了 `/tmp` 里的其他东西。`cursor-agent` 2026.10.14 没有把这个目录搬进 `CURSOR_DATA_DIR` 的办法。小队搭档仍不使用这条续接。

这次探针为了确认续接，两轮沙箱都带了这个目录。产品按 [ADR-002](../decisions/ADR-002-cursor-shared-resume-lock.md) 收窄：通用模板和首轮、普通派活、非群聊任务都不带它，只有 macOS 上 Cursor 项目群聊的续接轮才加上。首轮在 10 月 17 日没有这个目录时已经能跑完。
