# Cursor 群聊续接探针（2026-10-17）

给 TASK-007 用。这一轮的结论是：当时的隔离放不开续接目录，群聊不能收 Cursor。2026-10-18 只放开那一个续接目录后又测过，结果见 [cursor-chat-resume-2026-10-18.md](cursor-chat-resume-2026-10-18.md)。下面是 10 月 17 日这次的记录，没有改。

## 环境

- 系统：macOS（darwin）。
- `cursor-agent`：`2026.10.14-0f9edde`（`cursor-agent --version`）。帮助里有 `--resume [chatId]`。
- 隔离：仓库里的 srt（`@anthropic-ai/sandbox-runtime` 0.0.77）和 `sandbox/cursor.json`，由 `src/core/sandbox.ts` 的 `sandbox()` 生成。网络仍只放行 Cursor 自家域名。
- 状态目录：和派活一样，`CURSOR_CONFIG_DIR` / `CURSOR_DATA_DIR` 指向登记处下 `cursor/<任务号哈希>/config` 和 `data`。这次数据目录 44 个字符，未超过 84 的上限。
- 登录：隔离外用现有钥匙串读取方式确认已登录，令牌只放进这一次进程的环境（`CURSOR_API_KEY`、`CURSOR_AUTH_TOKEN`，并设 `AGENT_CLI_CREDENTIAL_STORE=memory`）。本文不记录令牌。
- 模型：`grok-4.7-medium`（名单里 Cursor · Grok 的中档）。
- 工作区、状态目录都在临时目录，跑完已删除。没有改 `~/.cursor`，没有留下越界探针文件。

命令形状与派活一致（提示词是探针自己写的，不含私人内容，这里不照录）：

```text
node srt --settings <sandbox.json> cursor-agent -p --output-format stream-json \
  --model grok-4.7-medium --force --trust [--mode ask] [--resume <会话号>] \
  --workspace <工作区> <提示词>
```

## 做法

1. 可写成员：第一轮让它自己想一个四字词，写进工作区的 `probe-round1.txt`。隔离外删掉这个文件，第二轮用 `--resume <第一轮会话号>`，不许它再去翻文件，凭对话回忆这个词，并试着写 `/tmp`、家目录、`~/.cursor` 里的探针文件，以及读取 `~/.ssh` 的文件名。
2. 只读成员：`--mode ask`，加上沙箱不放开工作区写入。第一轮想一个四字词，并试着改 `keep.txt`。第二轮同样 `--resume`。
3. 两轮之间用同一套状态目录、同一个工作区，再生成一次沙箱设置，核对可写范围和网络限制没有变宽。

## 结果

| 轮次 | 退出码 | 用时 | 结果 |
|---|---|---|---|
| 可写第 1 轮 | 0 | 29 秒 | 会话号是 UUID。工作区文件内容与回答都是「藓径晚钟」。`keep.txt` 仍是 `unchanged`。三个越界探针文件都没有出现。 |
| 可写第 2 轮（`--resume`） | 1 | 1 秒 | 没有进入对话，没有新会话号，没有写下 `probe-round2.txt`。 |
| 只读第 1 轮 | 0 | 52 秒 | 回答了「镂月裁云」。`keep.txt` 仍是 `unchanged`。 |
| 只读第 2 轮（`--resume`） | 1 | 1 秒 | 与可写第 2 轮同一类失败。 |

两轮失败的标准错误相同（会话号从略）：

```text
Chat <uuid> may still be running, but Cursor could not verify its persistent session: EPERM: operation not permitted, mkdir '/tmp/cursor-agent-persist-<uid>'
```

隔离外核对：

- `~/.cursor/cli-config.json`、`hooks.json`、`mcp.json` 的文件编号、大小、修改时间都没变；探针期间 `~/.cursor` 下没有新的改动。
- `/tmp/xa-cursor-resume-probe.txt`、家目录下的 `xa-cursor-resume-outside.txt`、`~/.cursor/xa-cursor-resume-probe` 都不存在。
- 重新生成的沙箱设置与第一轮一致，网络限制还在。
- 临时登记处已删除。`/tmp/cursor-agent-persist-<uid>` 探针结束后不存在（隔离里创建失败，隔离外也没有补建）。

第 2 轮没有跑到越界动作，所以**不能**把「续接之后隔离仍然有效」记成已测到。只读第 1 轮说明首轮只读没有改文件；续接后的只读没有测成。

## 原因

`cursor-agent` 2026.10.14 的打包代码里，持久会话目录写死为 `/tmp/cursor-agent-persist-<uid>`，不看 `TMPDIR`，也不看 `CURSOR_CONFIG_DIR` / `CURSOR_DATA_DIR`。无界面的 `--resume <会话号>` 会先在这个目录下的 `claim-locks/` 里为这个会话建锁并写 `owner.json`。建不成就直接退出，不会去读任务状态目录里的聊天记录。

派活现在只放开三处可写：工作区（只读成员连这处也不放开）、每件活自己的 Cursor 状态目录、每件活自己的 `tmp/`。公用 `/tmp` 是故意关掉的（[design.md](../design.md) 第 7 节，[临时目录实测](tmp-writes-2026-09-30.md)）。所以现有状态目录不够用来续接。

## 还没做的架构决定

要让 Cursor 进群聊，得先另定一件事，不能在这个任务里顺手放宽：

- 是否允许选手写 `/tmp/cursor-agent-persist-<uid>`。这是本用户所有 `cursor-agent` 持久会话共用的目录，不是每件活一份。放开它等于在公用临时目录上开一道口，和现在的底线冲突，需要新的探针，不能靠「无上下文的新进程」假装续接。
- 或者等 `cursor-agent` 提供把这个目录搬进 `CURSOR_DATA_DIR`（或任务 `tmp/`）的办法。2026.10.14 这一版没有。

在此之前，`chatMember` 对 Cursor 的拒绝，以及新建群聊里不列出 Cursor，都保持原样。
