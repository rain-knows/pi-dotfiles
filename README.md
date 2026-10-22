# pi-dotfiles

我自己的 [pi coding agent](https://github.com/earendil-works/pi-coding-agent) 配置与实践沉淀。
一方面当作云端备份，另一方面把踩过的坑整理成别人能直接用的东西。

**这个仓库不含任何密钥、会话记录或私有项目路径。** 模型凭据只以 `.example` 模板形式存在。

## 里面有什么

```
├── install.ps1                  部署脚本：把仓库内容铺到 ~/.pi/agent
├── agent/
│   ├── APPEND_SYSTEM.md         追加到系统提示词的工具约定（检索/shell 分工）
│   ├── settings.example.json    主配置模板
│   ├── models.example.json      模型 provider 模板（价格/上下文/兼容性字段）
│   ├── mcp.example.json         MCP server 模板
│   ├── subagents.example.json   子 agent 工具授权模板
│   ├── web-search.example.json  web 搜索 SSRF / 代理策略
│   └── extensions/
│       └── prompt-architect/    ★ 自研扩展：能力门控的系统提示词分层
└── workflows/
    ├── model-tiers.json         动态工作流的模型档位
    └── settings.json            动态工作流开关
```

## 快速开始

```powershell
git clone https://github.com/rain-knows/pi-dotfiles.git
cd pi-dotfiles
.\install.ps1
```

脚本行为：

- **可移植内容**（`APPEND_SYSTEM.md`、`prompt-architect` 扩展、`workflows/`）——复制到 `~/.pi/agent`，已存在的文件默认跳过，`-Force` 才覆盖。
- **模板文件**（`*.example.json`）——仅在目标真实文件**不存在**时才落盘。`models.json` / `mcp.json` 永远不会被模板覆盖，避免冲掉你已有的凭据。
- `settings.json` 如果已存在也会跳过，因为里面通常有你的本地绝对路径和已装包列表。

部署后需要手工做两件事：

1. 在 `~/.pi/agent/models.json` 和 `mcp.json` 里填入自己的 key（模板里是 `REPLACE_ME`）。
2. 把 `settings.json` 的 `packages` 数组裁成你真正在用的插件。

启动 pi 后跑 `/prompt-audit`，能看到四个策略块的大小就说明扩展生效了。

---

## prompt-architect：能力门控的提示词分层

这是仓库里唯一有实质工程价值的东西，值得单独说。

### 它解决什么问题

大多数 agent 扩展往系统提示词里塞规则的写法是：**一次性拼一大坨静态文本**。后果是提示词里经常出现模型当前根本调不到的工具——比如写了「用 `grep` 而不是 shell `grep`」，但这一轮 loadout 里压根没有 `grep`。模型读到规则，去找工具，找不到，浪费一轮推理。

prompt-architect 的做法是：**每条规则只在它描述的工具处于激活状态时才渲染。**

```js
// composer.mjs
const SPECIALIZED_TOOL_POLICY = [
  { tool: "grep", text: "- Regex search → `{{name}}`, not shell `grep`." },
  { tool: "find", text: "- Locating files → `{{name}}`, not shell `find`." },
  // ...
];
```

`grep` 不在 `selectedTools` 里，这行就不存在。检索/shell 分工那条规则更严格：必须 `grep`/`find` **和** `powershell`/`bash` 同时在场才渲染——只有一半时那条规则本身就是错的。

### 它不做什么

这一点比上面更重要：

- **不接管 pi 的原生 prompt。** 它只用 `systemPromptOptions.sections` 追加 `engineering` / `tool_policy` / `workflow` / `delivery_contract` 四个具名段落。preamble、tools、rules、docs、context、skills、MCP、Code mode 全由 pi 自己渲染。
- **不覆盖 `customPrompt`。** 检测到 `SYSTEM.md`、`--system-prompt` 或 `forceSystemPrompt` 时直接 stand down，只做去重。
- **失败不阻塞会话。** 任何异常都 fall through 到 pi 的默认提示词，记一行 stderr 了事。

结果是后续插件加的 guidelines、运行中途新激活的工具声明，都不会被覆盖——因为 pi 在每次 handler 之后重新渲染原生段落，这个扩展从不碰它们。

### 去重：精确包含，不做模糊

`dedupe.mjs` 处理 context 文件重复的问题。规则是：**只有当更权威的文件已经把某个文件的段落作为连续块完整包含时，才丢弃后者。**

顺序决定权威性，不是路径算术。pi 的 loader 按「`~/.pi/agent/AGENTS.md` → 各级父目录 → 当前目录」发出 context 文件，所以只有排在**后面**的文件是超集时才丢弃前面的。

关键是**精确匹配，绝不模糊**。一段话只要被改写过（哪怕意思一样），就保留——因为丢弃措辞不同的规则，等于静默删掉用户特意写的东西。fenced code block 也不跨段落切分，避免「某条规则只出现在别处的示例代码里」被误判为重复。

### 命令

| 命令 | 作用 |
|---|---|
| `/prompt-audit` | 报告四个策略块的字节数/估算 token、当前激活的工具、去重掉了哪些 context 文件 |
| `/prompt-export <path>` | 导出上一轮实际生效的完整系统提示词（拒绝覆盖已有文件） |

### 验证

```powershell
node scripts/measure-prompt.mjs --selftest   # 34 条断言：确定性、门控、去重
node scripts/check-prompts.mjs               # fragments 格式检查（--fix 自动修）
```

`smoke-test.mjs` 需要一个装了 `jiti` 的 Node 项目来加载 TS hook：

```powershell
$env:PI_JITI_PROJECT_DIR = "C:\path\to\a\node\project\with\jiti"
node scripts/smoke-test.mjs
```

测试覆盖的是真实 hook 行为（用一个最小 API harness 模拟 pi 的 `ExtensionAPI`），不是实现细节。

---

## 关于 `APPEND_SYSTEM.md`

里面是 FFF（`@ff-labs/pi-fff`）的检索工具参数约定。这份文件由 pi 无条件加载，**不具备按 loadout 门控的能力**——所以开头写了一段前置说明：如果 FFF 没装或 `grep`/`find` 被摘掉，整节内容不成立。

如果你不用 FFF，这份文件对你没用，删掉即可。这也正是 prompt-architect 想解决但原生 `APPEND_SYSTEM.md` 做不到的事。

---

## 设计取舍

**为什么是 dotfiles 而不是打包成 npm 包？**
配置本身是给人改的，不是给 `npm install` 消费的。模板 + 复制比发布包更符合"这是我的配置"这个事实。

**为什么 `settings.json` 也不直接覆盖？**
因为它必然含本地绝对路径（本地开发的扩展目录）和个人已装插件列表。直接覆盖会破坏别人已有的环境。所以它只在你没有该文件时才落盘。

**为什么不收录第三方 skills？**
`~/.agents/skills` 下的内容来自 archify、herdr、vercel-labs 等上游仓库，复制进来既不合规也难维护。需要的话装上游。

## 许可

本仓库的原创内容（`prompt-architect` 扩展、`APPEND_SYSTEM.md`、各模板与文档）采用 MIT。
`prompt-architect` 引用 pi 的 `@earendil-works/pi-coding-agent` 类型，遵循其上游许可。
