# pi-dotfiles

我的 [pi coding agent](https://github.com/earendil-works/pi) 配置与实践沉淀。
一部分是能直接装的东西（`prompt-architect` 扩展），一部分是我自己的配置模板。

**这个仓库不含密钥、会话记录或私有项目路径。** 凭据只以 `.example` 模板形式存在。

---

## 安装

两条路径，装的东西不一样，别混。

### A. 完整配置（clone + 脚本）

适合想连配置模板、`APPEND_SYSTEM.md`、workflows 一起拿走的人。

```powershell
git clone https://github.com/rain-knows/pi-dotfiles.git; cd pi-dotfiles; .\install.ps1
```

脚本会把可移植内容铺到 `~/.pi/agent`，并只在文件不存在时铺模板：

- **真实内容**（`APPEND_SYSTEM.md`、`prompt-architect`、`workflows/`）— 复制，已存在则跳过，`-Force` 才覆盖
- **模板**（`*.example.json`）— 仅在目标文件缺失时落盘。`models.json` / `mcp.json` / `settings.json` **永远不会被模板覆盖**，不会冲掉你的凭据和本地路径

装完**不能直接启动 pi**，还差两步：

1. 在 `~/.pi/agent/models.json` 和 `mcp.json` 填自己的 key（模板里是 `REPLACE_ME`）
2. 把 `settings.json` 的 `packages` 数组裁成你实际在用的插件

### B. 只装扩展（pi 原生包）

只想用 `prompt-architect`，不要我的配置模板：

```powershell
pi install git:github.com/rain-knows/pi-dotfiles
```

这条路**只装扩展**，不铺 `APPEND_SYSTEM.md`、不铺配置模板、不铺 workflows。
升级用 `pi update git:github.com/rain-knows/pi-dotfiles`，卸载用 `pi remove`。

装完启动 pi 跑 `/prompt-audit`，能看到四个策略块的字节数就说明生效了。

> 两条路不要同时用。B 装完后 `~/.pi/agent/extensions/` 里是 git 管理的克隆，再跑 `install.ps1` 会多出一份复制体，扩展加载两次。

---

## 让 agent 帮你装

把下面这段丢给 pi（或其他能执行命令的 agent），它自己会读仓库、确认路径再动手：

```text
帮我安装 pi-dotfiles。先做这几件事，不要直接执行：

1. 读 https://github.com/rain-knows/pi-dotfiles 的 README 和 install.ps1，确认它到底会写哪些路径。
2. 检查我现有的 ~/.pi/agent：列出已有的 settings.json、models.json、mcp.json、
   extensions/ 下已装的扩展，以及 ~/.pi/agent/settings.json 里的 packages 数组。
3. 告诉我两个安装方式的区别，以及按我现在的环境该选哪个、会覆盖什么、会跳过什么。
4. 等我确认后再执行。

硬性约束：
- 不要覆盖或清空 models.json / mcp.json / settings.json 里已有的凭据和本地路径。
- 不要删除任何已存在的扩展或配置文件。
- 不要读取、打印或提交我的 API key。
- 执行完把实际改动的路径列出来。
```

agent 容易犯的错是跳过第 2 步直接跑脚本。第 3 步的"等我确认"就是拦这个。

---

## 里面有什么

```
├── package.json                 pi package 清单（暴露 prompt-architect）
├── install.ps1                  完整配置安装脚本
├── PLUGINS.md                   我在用的扩展：13 个 npm 包 + 3 个本地扩展
├── agent/
│   ├── APPEND_SYSTEM.md         追加到系统提示词的工具约定
│   ├── *.example.json           配置模板（settings/models/mcp/subagents/web-search）
│   └── extensions/
│       └── prompt-architect/    ★ 能力门控的系统提示词分层
└── workflows/
    ├── model-tiers.json         动态工作流的模型档位
    └── settings.json            动态工作流开关
```

插件清单见 [`PLUGINS.md`](PLUGINS.md)。它和 `prompt-architect` 是耦合的：
扩展按激活工具门控规则，装了什么就渲染什么规则，删掉一个包对应规则立刻消失。

---

## prompt-architect

仓库里唯一有实质工程价值的东西。

### 解决什么问题

多数 agent 扩展往系统提示词塞规则是**一次性拼一大坨静态文本**。后果是提示词里经常出现模型当前根本调不到的工具——比如写了「用 `grep` 而不是 shell `grep`」，但这一轮 loadout 里压根没有 `grep`。模型读到规则，去找工具，找不到，浪费一轮推理。

prompt-architect 的做法：**每条规则只在它描述的工具处于激活状态时才渲染。**

```js
const SPECIALIZED_TOOL_POLICY = [
  { tool: "grep", text: "- Regex search → `{{name}}`, not shell `grep`." },
  { tool: "find", text: "- Locating files → `{{name}}`, not shell `find`." },
];
```

`grep` 不在 `selectedTools` 里，这行就不存在。检索/shell 分工那条更严格：必须 `grep`/`find` **和** `powershell`/`bash` 同时在场才渲染——只有一半时那条规则本身就是错的。

### 不做什么

比上面更重要：

- **不接管 pi 的原生 prompt。** 只用 `systemPromptOptions.sections` 追加 `engineering` / `tool_policy` / `workflow` / `delivery_contract` 四个具名段落。preamble、tools、rules、docs、context、skills、MCP、Code mode 全由 pi 自己渲染。
- **不覆盖 `customPrompt`。** 检测到 `SYSTEM.md`、`--system-prompt` 或 `forceSystemPrompt` 时直接 stand down，只做去重。
- **失败不阻塞会话。** 任何异常 fall through 到 pi 默认提示词，记一行 stderr。

结果是后续插件加的 guidelines、运行中途新激活的工具声明都不会被覆盖——pi 在每次 handler 之后重新渲染原生段落，这个扩展从不碰它们。

### 去重

`dedupe.mjs` 处理 context 文件重复。规则：**只有当更权威的文件已经把某个文件的段落作为连续块完整包含时，才丢弃后者。**

顺序决定权威性，不是路径算术。pi 的 loader 按「`~/.pi/agent/AGENTS.md` → 各级父目录 → 当前目录」发出 context 文件，所以只有排在**后面**的文件是超集时才丢弃前面的。

关键是**精确匹配，绝不模糊**。一段话只要被改写过（哪怕意思一样）就保留——丢弃措辞不同的规则等于静默删掉用户特意写的东西。fenced code block 不跨段落切分，避免「某条规则只出现在别处的示例代码里」被误判为重复。

### 命令

| 命令 | 作用 |
|---|---|
| `/prompt-audit` | 报告四个策略块的字节数/估算 token、激活的工具、去重掉了哪些 context 文件 |
| `/prompt-export <path>` | 导出上一轮实际生效的完整系统提示词（拒绝覆盖已有文件） |

### 验证

```powershell
cd agent/extensions/prompt-architect
node scripts/measure-prompt.mjs --selftest   # 34 条断言：确定性、门控、去重
node scripts/check-prompts.mjs               # fragments 格式检查（--fix 自动修）
```

`smoke-test.mjs` 需要一个装了 `jiti` 的 Node 项目来加载 TS hook：

```powershell
$env:PI_JITI_PROJECT_DIR = "C:\path\to\a\node\project\with\jiti"
node scripts/smoke-test.mjs
```

测试覆盖真实 hook 行为（用最小 API harness 模拟 pi 的 `ExtensionAPI`），不是实现细节。

---

## 关于 `APPEND_SYSTEM.md`

里面是 FFF（`@ff-labs/pi-fff`）的检索工具参数约定。这份文件由 pi 无条件加载，**不具备按 loadout 门控的能力**——所以开头写了一段前置说明：如果 FFF 没装或 `grep`/`find` 被摘掉，整节内容不成立。

不用 FFF 的话这份文件对你没用，删掉即可。这也正是 prompt-architect 想解决而原生 `APPEND_SYSTEM.md` 做不到的事。

---

## 设计取舍

**为什么是 dotfiles 而不是纯 npm 包？**
配置本身是给人改的，不是给 `npm install` 消费的。模板 + 复制比发布包更符合"这是我的配置"这个事实。`package.json` 只为了让 `pi install` 能装扩展，不打算发 npm。

**为什么 `settings.json` 也不直接覆盖？**
它必然含本地绝对路径（本地开发的扩展目录）和个人已装插件列表，直接覆盖会破坏别人已有的环境。所以只在你没有该文件时才落盘。

**为什么不收录第三方 skills？**
`~/.agents/skills` 下的内容来自 archify、herdr、vercel-labs 等上游仓库，复制进来既不合规也难维护。需要的话装上游。

## 许可

本仓库原创内容（`prompt-architect` 扩展、`APPEND_SYSTEM.md`、模板与文档）采用 MIT。

`prompt-architect` 通过 `import type` 引用 pi 的类型声明，不复制其运行时代码。
pi 本身也是 MIT，因此无需额外的许可安排。
