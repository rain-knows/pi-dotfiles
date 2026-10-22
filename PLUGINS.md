# 插件清单

我实际在用的 pi 扩展，版本取自 `~/.pi/agent/npm/node_modules` 的实际安装状态。
按 `settings.json` 的 `packages` 数组顺序排列。

pi 安装扩展的方式是在 `settings.json` 里声明 `npm:<包名>`，启动时自动拉取。

## npm 扩展

| 包 | 版本 | 作用 | 解锁的工具 / 命令 |
|---|---|---|---|
| `pi-goal-x` | 0.32.3 | 持久化目标：对话式目标规划、有序步骤、进度留存、独立完成度审计 | `/goal`、`create_goal`、`get_goal` |
| `pi-subagents` | 0.80.0 | 单 agent 委派与脚本化多 agent 工作流 | `subagent`、`subagent_supervisor` |
| `@quintinshaw/pi-dynamic-workflows` | 3.13.1 | Claude-Code 风格动态工作流：上百子 agent 扇出、模型路由、token/成本核算、断点续跑、git worktree 隔离 | `workflow`、`workflow_control`、`/workflows`、`/deep-research` |
| `@juicesharp/rpiv-advisor` | 2.13.9 | 动手前向更强模型要第二意见 | `advisor` |
| `@juicesharp/rpiv-ask-user-question` | 2.13.9 | 结构化问卷：该猜的时候改成给你选项 | `ask_user_question` |
| `pi-rewind` | 0.5.0 | 逐工具快照、回滚、重做栈 | `/rewind`、Esc+Esc |
| `pi-web-access` | 0.44.0 | 联网检索、URL 抓取、GitHub 仓库克隆、PDF 提取、YouTube/本地视频理解。支持 30+ 搜索后端 | `web_search`、`fetch_content`、`get_search_content`、`source_check` |
| `pi-working-activity` | 1.9.0 | Working 行动画：实时工具进度、俏皮短语、设置面板、自检 | 状态栏行 |
| `pi-btw` | 0.8.0 | 并行侧聊，不打断主任务 | `/btw` |
| `pi-cc-extensions` | 1.0.8 | Claude Code 风格 TUI 输出 + 一堆实用小工具（diff 卡片、footer、别名、session 引用） | 渲染层增强 |
| `billion-context-pi` | 0.1.83 | 模型驱动的上下文管理（压缩/解压/检索） | `compress`、`decompress`、`search_context`、`acp_status`、`acp_cache` |
| `@juicesharp/rpiv-todo` | 2.13.9 | 待办列表，存活于 `/reload` 与压缩之后 | `todo` |
| `@ff-labs/pi-fff` | 0.11.0 | Rust 预索引的模糊文件/内容检索，无子进程 | `grep`、`find`（**替换掉 pi 内置同名工具，参数语义不同**） |

`@juicesharp/rpiv-config` 2.13.9 是 rpiv 系列的共享依赖，不单独声明。

## 本地扩展

| 来源 | 作用 |
|---|---|
| `agent/extensions/prompt-architect/` | **自研**，就在本仓库里。能力门控的提示词分层，见 [README](README.md#prompt-architect能力门控的提示词分层) |
| `%LOCALAPPDATA%\Programs\pi-orb\resources\pi-plugin` | pi-orb 桌面端配套插件，本地路径依赖，不在 npm 上 |
| `agent/extensions/herdr-agent-state.ts` | herdr 自动装管，`HERDR_ENV=1` 时才激活。reinstall 会覆盖，**不要手改** |

## 为什么这份清单重要

它不是装饰。`prompt-architect` 的核心机制就是**按激活工具门控规则**：

```js
// composer.mjs
const SPECIALIZED_TOOL_POLICY = [
  { tool: "grep", text: "- Regex search → `{{name}}`, not shell `grep`." },
  // ...
];
```

`grep` 没装，这行规则就不渲染。所以这份清单一变，系统提示词的实际内容跟着变。
反过来说：**上面任何一行被删掉，`prompt-architect` 会立刻停止为它生成规则，而不是留下一条指向不存在的工具的废话。**

想看当前真实渲染结果：

```
/prompt-audit
```

它会列出激活的工具和四个策略块的字节数。

## 装齐这套

`install.ps1` 会从 `agent/settings.example.json` 铺出 `settings.json`，里面的 `packages` 数组就是上面这张表。
pi 启动时按需拉取。

想精简的话直接删数组里的行——不要有心理负担，这正是设计意图：装了才有规则。

## 版本漂移

这张表会过时。核对真实情况：

```powershell
Get-ChildItem "$env:USERPROFILE\.pi\agent\npm\node_modules" -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName "package.json") } |
  ForEach-Object {
    $j = Get-Content (Join-Path $_.FullName "package.json") -Raw | ConvertFrom-Json
    "{0}@{1}" -f $j.name, $j.version
  }
```

`~/.pi/agent/npm/` 已在 `.gitignore` 里排除，本仓库不复制 node_modules。
