/**
 * Prompt Architect — pure prompt composer.
 *
 * No pi imports live here on purpose: this module runs identically inside the
 * pi extension runtime (via jiti) and under plain `node` from
 * `scripts/measure-prompt.mjs`. Every input arrives as a parameter.
 *
 * Determinism contract: the same input object MUST produce byte-identical
 * output. No Date, no Math.random, no unsorted Set/Map iteration — a
 * non-deterministic composer would emit a fresh system-prompt patch every turn.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAGMENTS_DIR = join(HERE, "fragments");

/** Only these tools can start delegated work. The supervisor tool replies to children. */
const DELEGATION_TOOLS = ["subagents_enable", "subagent"];

/** Tools that let the agent ask the user before something destructive. */
const ASK_TOOLS = ["ask", "ask_user_question"];

/**
 * One policy line per specialized tool. Rendered only while that tool is
 * active, so the prompt never describes a tool the model cannot call.
 * `{{name}}` is replaced with the tool's real name.
 */
const SPECIALIZED_TOOL_POLICY = [
	{ tool: "read", text: "- File reads → `{{name}}`; use the active listing or shell tool for directories." },
	{ tool: "edit", text: "- Surgical edits → `{{name}}`." },
	{ tool: "write", text: "- Creating or overwriting files → `{{name}}`." },
	{ tool: "grep", text: "- Regex search and target location → `{{name}}`, not shell `grep`, `rg`, or `awk`." },
	{ tool: "find", text: "- Locating files by pattern → `{{name}}`, not shell `find` or `fd`." },
	{ tool: "ls", text: "- Listing a directory → `{{name}}`, not shell `ls`." },
	{
		tool: "lsp",
		text: "- Language-server intelligence (definitions, references, types) → prefer `{{name}}` when available; inspect source when it gives a fuller answer.",
	},
	{ tool: "ast_grep", text: "- Structural code search → `{{name}}` before text-based hacks." },
	{
		tool: "bash",
		text: "- Use `{{name}}` for commands and short fact pipelines; prefer a suitable specialized tool when one is available.",
	},
	{
		tool: "powershell",
		text: "- Use `{{name}}` for commands and short fact pipelines; prefer a suitable specialized tool when one is available.",
	},
];

const fragmentCache = new Map();

/** Read a fragment from disk once. Throws when the file is missing or unreadable. */
function fragmentFile(name) {
	const cached = fragmentCache.get(name);
	if (cached !== undefined) return cached;
	const text = readFileSync(join(FRAGMENTS_DIR, name), "utf8");
	fragmentCache.set(name, text);
	return text;
}

function collapseBlankLines(text) {
	return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Substitute `%TOKEN%` placeholders.
 *
 * A line made up exclusively of placeholders is dropped when every one of them
 * resolves to empty, and expands to a multi-line block when they do not. Inline
 * placeholders substitute in place.
 */
export function renderFragment(text, vars = {}) {
	const out = [];
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		if (/^\s*(?:%[A-Z0-9_]+%\s*)+$/u.test(line)) {
			const values = [...line.matchAll(/%([A-Z0-9_]+)%/g)]
				.map((match) => String(vars[match[1]] ?? "").trim())
				.filter((value) => value.length > 0);
			if (values.length === 0) continue;
			out.push(values.join("\n\n"));
			continue;
		}
		out.push(line.replace(/%([A-Z0-9_]+)%/g, (_all, key) => String(vars[key] ?? "").trim()));
	}
	return collapseBlankLines(out.join("\n"));
}

function renderSpecialized(toolNames) {
	const lines = [];
	for (const entry of SPECIALIZED_TOOL_POLICY) {
		if (!toolNames.includes(entry.tool)) continue;
		lines.push(entry.text.replace(/\{\{name\}\}/g, entry.tool));
	}
	if (lines.length === 0) return "";
	return ["# Specialized Tools", ...lines].join("\n");
}

/**
 * Retrieval vs. shell split. Rendered only when both sides are present: a rule
 * that names `grep`/`find` must never appear in a loadout that cannot call them.
 */
function renderRetrievalRouting(toolNames) {
	const retrieval = ["grep", "find"].filter((name) => toolNames.includes(name));
	const shells = ["powershell", "bash"].filter((name) => toolNames.includes(name));
	if (retrieval.length === 0 || shells.length === 0) return "";
	const retrievalText = retrieval.map((name) => `\`${name}\``).join(" / ");
	const shellText = shells.map((name) => `\`${name}\``).join(" / ");
	return [
		"# Retrieval vs. Shell",
		`- Finding files, symbols, or strings, and mapping a directory: ${retrievalText}. Do not hand that work to ${shellText} — no \`Get-ChildItem\`, \`Select-String\`, \`findstr\`, \`rg\`, shell \`grep\`, or \`git grep\` doing the searching.`,
		`- ${shellText} is reserved for work that must actually execute: scripts, builds, tests, CLI calls, process / environment / git state, and content the search index cannot see because \`.gitignore\` hides it.`,
		"- Decision rule: reading content is retrieval; producing an execution result or changing state is shell.",
	].join("\n");
}

function renderDelegation(toolNames) {
	const canDelegate = DELEGATION_TOOLS.some((name) => toolNames.includes(name));
	const lines = [];
	if (canDelegate) {
		lines.push(
			"# Delegation",
			"- These global instructions authorize subagents. Prefer a bounded child for substantial independent research, implementation, or review when specialization or parallel progress justifies the overhead; handle trivial or tightly coupled steps directly.",
		);
		if (toolNames.includes("subagents_enable") && !toolNames.includes("subagent")) {
			lines.push("- Call `subagents_enable({})` first; `subagent` becomes available on the next model request.");
		}
		if (toolNames.includes("subagent")) {
			lines.push("- Call `subagent({action:\"list\",capabilities:true})` before selecting an executable agent, then `subagent({agent,task})` for one bounded assignment. Read its tool guide for multi-child workflows.");
		}
		lines.push(
			"- Give each child its goal, scope, constraints, file ownership, and expected report. Isolate concurrent writers; the parent integrates results, verifies the deliverable, and owns the final answer.",
		);
	}
	if (toolNames.includes("subagent_supervisor")) {
		lines.push("- `subagent_supervisor` handles pending requests from running children; it does not launch exploration or implementation.");
	}
	return lines.join("\n");
}

function renderMcpRouting(toolNames) {
	const lines = [];
	if (toolNames.includes("codemode")) {
		lines.push("# Code mode and MCP",
			"- Use `codemode` for bounded scripts and related calls. Discover MCP tools with `searchTools()` and read the namespace's instructions with `describeNamespace()` before calling its tools; follow the active codemode declaration for argument shapes.",
			"- Only call tools that the current loadout permits. Check availability with `\"name\" in tools`; do not probe missing members with `typeof tools.name`. Use the script's `image()` helper to show image results when needed.",
			"- Keep state-changing calls sequential. Parallelize only independent reads. Desktop observation and input tools are model-only and require direct model calls.");
	}
	if (toolNames.includes("tool_search")) {
		if (lines.length === 0) lines.push("# MCP discovery");
		lines.push("- Use `tool_search` to discover and activate deferred tools for a following request; inspect the returned live schema before calling a discovered tool.");
	}
	if (toolNames.some((name) => name.startsWith("mcp__"))) {
		if (lines.length === 0) lines.push("# MCP");
		lines.push("- Call declared MCP tools using their actual schema and namespace instructions. Server names or entries in configuration do not prove that a connection or a tool is available.");
	}
	return lines.join("\n");
}

function renderWebRouting(toolNames) {
	const lines = [];
	if (toolNames.includes("web_enable")) {
		lines.push("# Web Research", "- For a web research task, call `web_enable({})` to activate the configured search, fetch, stored-content, and source-check tools on the next model request.");
	}
	if (toolNames.includes("web_search")) {
		if (lines.length === 0) lines.push("# Web Research");
		lines.push("- Use `web_search` for current web facts; use focused queries and inspect the returned source links.");
	}
	if (toolNames.includes("fetch_content")) {
		lines.push("- Use `fetch_content` to inspect original pages for important or disputed claims instead of relying on search summaries.");
	}
	if (toolNames.includes("get_search_content")) {
		lines.push("- Use `get_search_content` to retrieve bounded parts of stored search or fetched content when needed.");
	}
	if (toolNames.includes("source_check")) {
		lines.push("- Use `source_check` for decision-critical or disputed claims; treat its output as evidence to examine, not as a substitute for reading the source.");
	}
	return lines.join("\n");
}

/**
 * Slash commands owned by optional plugins. The prompt may only mention one
 * that the session actually registered, so this list is matched against the
 * live command registry rather than assumed from settings.json.
 */
const PLUGIN_COMMANDS = [
	{ name: "usage", purpose: "provider limits" },
	{ name: "rewind", purpose: "interactive restoration" },
	{ name: "open-tui", purpose: "terminal UI settings" },
];

function joinWithAnd(items) {
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function renderPluginRouting(toolNames, commandNames = []) {
	const lines = [];
	if (toolNames.includes("advisor")) {
		lines.push("- `advisor({})` sends the current conversation to the configured reviewer for material decisions, recurring failures, and substantive final review; weigh its advice against observed evidence.");
	}
	if (toolNames.includes("ask_user_question")) {
		lines.push("- Use `ask_user_question` for a decision that materially changes the work after repository and tool inspection cannot resolve it; follow its schema for meaningful choices.");
	}
	if (toolNames.includes("create_goal")) {
		lines.push("- Use `create_goal` only when the user explicitly requests a persistent goal; ordinary tasks do not become goals automatically.");
	}
	if (toolNames.includes("get_goal")) {
		lines.push("- Use `get_goal` to inspect an existing goal or recover its requirements before continuing goal work.");
	}
	if (toolNames.includes("plan_mode_question") || toolNames.includes("plan_mode_complete")) {
		lines.push("- `/plan` is user-activated. Use `plan_mode_question` and `plan_mode_complete` only while its plan contract is active; tool visibility alone does not activate Plan mode.");
	}
	const present = PLUGIN_COMMANDS.filter((entry) => commandNames.includes(entry.name));
	if (present.length > 0) {
		const names = joinWithAnd(present.map((entry) => `\`/${entry.name}\``));
		const purposes = joinWithAnd(present.map((entry) => entry.purpose));
		const plural = present.length > 1;
		lines.push(
			`- ${names} ${plural ? "are user commands" : "is a user command"} for ${purposes}. Do not present ${plural ? "them" : "it"} as model-callable ${plural ? "tools" : "a tool"}.`,
		);
	}
	if (lines.length === 0) return "";
	return ["# Installed Plugins", ...lines].join("\n");
}

function renderScopeRules(input) {
	if ((input.skills?.length ?? 0) === 0) return "";
	return "- Read the relevant skills first.";
}

function renderDecompose(toolNames) {
	if (!toolNames.includes("todo")) {
		return "- Break multi-file work into ordered steps before editing the first file.";
	}
	return [
		"- Update todos; skip trivial requests.",
		"- Never make a todo call alone: batch it with the turn's real calls.",
	].join("\n");
}

function renderDestructiveRule(toolNames) {
	const canAsk = ASK_TOOLS.some((name) => toolNames.includes(name));
	if (canAsk) {
		return "- Ask before destructive commands, or before deleting unrelated code you did not write. Code the cutover obsoletes is in scope.";
	}
	return "- **NEVER** run destructive git commands or delete unrelated code you did not write. Code the cutover obsoletes is in scope.";
}

function renderVerifyRules(toolNames) {
	const lines = [];
	if (toolNames.includes("bash") || toolNames.includes("powershell")) {
		lines.push("- For terminal or CLI behavior, exercise the changed path when the runtime is available.");
	}
	lines.push(
		"- For a bug fix, confirm the reported failure no longer occurs; add a regression test when it protects a plausible future failure.",
	);
	lines.push(
		"- For a feature or API change, update relevant contract tests and verify the user-facing behavior.",
	);
	lines.push(
		"- When direct runtime verification is unavailable, use the strongest feasible check and state the limit accurately.",
	);
	return lines.join("\n");
}

/**
 * Build additive policy sections. Pi owns all dynamic prompt sections. Returned separately so
 * `/prompt-audit` and `measure-prompt.mjs` can report per-block sizes.
 *
 * @returns {Array<{name: string, text: string}>}
 */
export function buildPolicyParts(input = {}) {
	const toolNames = [...(input.selectedTools ?? [])];
	const commandNames = [...(input.commandNames ?? [])];

	const parts = [
		{ name: "engineering", text: renderFragment(fragmentFile("engineering.md")) },
		{
			name: "tool_policy",
			text: renderFragment(fragmentFile("tool-policy.md"), {
				MCP_ROUTING: renderMcpRouting(toolNames),
				WEB_ROUTING: renderWebRouting(toolNames),
				DELEGATION: renderDelegation(toolNames),
				PLUGIN_ROUTING: renderPluginRouting(toolNames, commandNames),
				RETRIEVAL: renderRetrievalRouting(toolNames),
				SPECIALIZED: renderSpecialized(toolNames),
				READ_WINDOW: toolNames.includes("read") ? "- Use `read` with offset/limit for large files." : "",
			}),
		},
		{
			name: "workflow",
			text: renderFragment(fragmentFile("workflow.md"), {
				SCOPE_RULES: renderScopeRules(input),
				REFS_RULE: toolNames.includes("lsp")
					? "- Check `lsp` references before changing a widely used exported symbol when available."
					: "",
				TODO_RULES: renderDecompose(toolNames),
				DESTRUCTIVE_RULE: renderDestructiveRule(toolNames),
				VERIFY_RULES: renderVerifyRules(toolNames),
			}),
		},
		{ name: "delivery_contract", text: renderFragment(fragmentFile("delivery-contract.md")) },
	];

	return parts.filter((part) => part.text.trim().length > 0);
}
