# 检索工具约定（grep / find 由 FFF 提供）

> **前置条件**：本节仅当 `grep`、`find` 由 `@ff-labs/pi-fff`（FFF）提供时适用。
> 本文件由 pi 原生无条件加载，不具备按 loadout 门控的能力 —— 若 FFF 未加载或 `grep`/`find` 被摘出工具集，以下参数语义不成立，忽略本节。

本机 `grep`、`find` 由 `@ff-labs/pi-fff`（FFF，Rust 预索引，无子进程）注册，**参数语义与 pi 内置 grep/find 不同**。

## grep

- `pattern`：纯文本或正则，自动判定。优先裸标识符，literal 最快。
- `path`：目录前缀 `src/`、带扩展名文件名 `main.py`、glob `*.ts` / `src/**/*.cc`。支持绝对路径、`~/`、`../`（路由到独立 aux 索引）。
- `exclude`：`test/,*.min.js` 或字符串数组，语义同 `path`。
- `caseSensitive`：默认 smart-case（全小写则不区分大小写）。需严格区分时传 `true`。
- `context`：0–20。
- `limit`：**默认仅 20**。探索型搜索显式给 `limit: 50`（引擎单页上限 50）。
- `cursor`：分页游标。

**不支持** `glob`、`ignoreCase`、`literal`、`-i` 等内置/ripgrep 参数，传了会被静默忽略。
单行超 500 字符会截断（搜压缩 JSON、ndjson 时注意）。

## find

- `pattern`：模糊路径匹配，多词 = 更窄（AND），词序无关。
- `path` / `exclude`：同 grep。
- `limit`：默认 30。
- 首次探索概念、符号时优先用它，而不是 `ls` 或 `read`。

## 盲区：gitignore

FFF 索引尊重 `.gitignore`，被忽略的 `outputs/`、`.pi/`、`*.log`、`*.db`、`node_modules/` 搜不到。

**这是「检索走 grep/find、shell 只做必须执行」规则的显式例外** —— 索引看不到的内容，检索工具本身无法可达，才轮到 shell。优先级：

1. **首选**：传**绝对路径**触发 aux 索引（如 `path: "D:/work/myproject/outputs"`，独立 root，最多 3 个，5 分钟 TTL）。
2. **兜底**：aux 索引不覆盖时（超过 root 数量、索引过期、非文本或需要复杂管道），才用 PowerShell `Select-String` / `Get-Content`。

兜底之所以是兜底：`Select-String` 无索引、无排序、无 frecency，大目录下慢且结果噪音高。不要用「图省事」倒置这个优先级。

## 已知不生效，勿依赖

- **frecency 学习 / combo boost**：扩展从不调用 `trackQuery`，排序实际只靠 mtime + git 状态。
- **`multi_grep` / `fff-multi-grep`**：需 `PI_FFF_MULTIGREP=1` 才注册，作者源码注释称其 "only harmful"。多模式搜索改用 `pattern: "a|b"` 正则。
