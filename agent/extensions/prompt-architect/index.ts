/**
 * Prompt Architect
 *
 * Adds engineering / tool_policy / workflow / delivery_contract sections,
 * built from capability-gated parts, and deduplicates user prompt sources.
 *
 * Pi owns preamble, tools, rules, docs, context, skills, MCP and Code mode.
 * Keeping native dynamic sections preserves rules from later plugins and
 * tool declarations activated during a run.
 *
 * Stand-down rule: when an explicit prompt is already present (SYSTEM.md or
 * `--system-prompt`), the extension leaves `customPrompt` untouched and only
 * deduplicates.
 *
 * Failure rule: any error leaves pi's default prompt in place. This extension
 * must never be able to block a session.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import { buildPolicyParts } from "./composer.mjs";
import { dedupeAppendPrompt, dedupeContextFiles } from "./dedupe.mjs";

/** Rough token estimate: pi does not export a tokenizer, so count bytes/4. */
function estimateTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function composerInput(options: NormalizedBuildSystemPromptOptions, commandNames: string[]) {
	return {
		selectedTools: options.selectedTools,
		commandNames,
		skills: options.skills,
	};
}

/**
 * Slash commands the session actually registered, used to gate plugin-owned
 * command hints. The registry is optional in a minimal API harness, so a
 * missing or failing provider degrades to "no plugin commands" rather than a
 * prompt that names a command the session cannot run.
 */
function resolveCommandNames(pi: ExtensionAPI): string[] {
	try {
		if (typeof pi.getCommands !== "function") return [];
		return pi.getCommands().map((command) => command.name);
	} catch {
		return [];
	}
}

function formatReport(
	options: NormalizedBuildSystemPromptOptions,
	commandNames: string[],
	standDown: boolean,
	dropped: string[],
): string {
	const parts = buildPolicyParts(composerInput(options, commandNames));
	const lines = [
		standDown
			? "explicit prompt present (SYSTEM.md / --system-prompt / forceSystemPrompt): policy sections not applied"
			: "policy sections applied; Pi owns dynamic tools, rules, docs and context",
		"",
		"block                 bytes   ~tokens",
	];
	let total = 0;
	for (const part of parts) {
		const bytes = Buffer.byteLength(part.text, "utf8");
		total += estimateTokens(part.text);
		lines.push(`${part.name.padEnd(20)} ${String(bytes).padStart(6)} ${String(estimateTokens(part.text)).padStart(8)}`);
	}
	lines.push(`${"TOTAL".padEnd(20)} ${"".padStart(6)} ${String(total).padStart(8)}`);
	lines.push("", `active tools (${options.selectedTools.length}): ${options.selectedTools.join(", ")}`);
	lines.push(`plugin commands present: ${commandNames.length > 0 ? commandNames.join(", ") : "(none registered)"}`);
	lines.push(`skills: ${options.skills?.length ?? 0}   context files: ${options.contextFiles?.length ?? 0}`);
	if (dropped.length > 0) {
		lines.push("", "context files dropped as already contained in a more authoritative file:");
		for (const path of dropped) lines.push(`- ${path}`);
	}
	return lines.join("\n");
}

export default function promptArchitect(pi: ExtensionAPI) {
	let lastDropped: string[] = [];
	let lastStandDown = false;
	let lastEffectivePrompt: string | undefined;

	// Pi resets run-specific prompt options after a turn settles. Capture the
	// effective prompt while the run is active, not from a later command context.
	pi.on("agent_start", (_event, ctx) => {
		lastEffectivePrompt = ctx.getSystemPrompt();
	});

	pi.on("before_agent_start", (event) => {
		const options = event.systemPromptOptions;
		try {
			const standDown = options.forceSystemPrompt !== undefined || (options.customPrompt ?? "").trim().length > 0;
			// Pi 1.0 exact replacements are opaque (Chat-only and replace-mode
			// subagents). Leave every option intact; the owner supplies the full prompt.
			if (options.forceSystemPrompt !== undefined) {
				lastStandDown = true;
				lastDropped = [];
				return;
			}

			// Compute everything first: a half-applied mutation would leave a
			// partially rewritten prompt with no rollback path.
			const parts = standDown
				? null
				: buildPolicyParts(composerInput(options, resolveCommandNames(pi)));
			const composed = parts?.map((part) => part.text).join("\n\n") ?? "";
			const { files, dropped } = dedupeContextFiles(options.contextFiles);
			const append = standDown
				? (options.appendSystemPrompt ?? "")
				: dedupeAppendPrompt(options.appendSystemPrompt, composed, files);

			// Add named policies, never replace Pi's main block. Pi renders tools
			// and rules after every handler and refreshes them when the loadout
			// changes, preserving late plugin guidelines and newly activated tools.
			if (parts) {
				for (const part of parts) {
					options.sections[part.name] = part.text;
				}
			}
			options.contextFiles = files;
			options.appendSystemPrompt = append;
			lastStandDown = standDown;
			lastDropped = dropped;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`[prompt-architect] falling back to pi's default prompt: ${message}\n`);
		}
	});

	pi.registerCommand("prompt-export", {
		description: "Export the last agent run's full effective system prompt: /prompt-export <path>",
		handler: async (args, ctx) => {
			const target = args.trim();
			if (!target) {
				ctx.ui.notify("Usage: /prompt-export <path> (the file must not already exist)", "warning");
				return;
			}
			if (lastEffectivePrompt === undefined) {
				ctx.ui.notify("Send a normal message first, then export the effective prompt.", "warning");
				return;
			}
			try {
				const path = resolve(ctx.cwd, target);
				writeFileSync(path, lastEffectivePrompt, { encoding: "utf8", flag: "wx" });
				ctx.ui.notify(`Full system prompt exported to ${path}. Review before sharing: it may contain private context.`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`[prompt-architect] export failed: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("prompt-audit", {
		description: "Report the composed system-prompt blocks, active gates, and deduplicated context files",
		handler: async (_args, ctx) => {
			try {
				const report = formatReport(ctx.getSystemPromptOptions(), resolveCommandNames(pi), lastStandDown, lastDropped);
				ctx.ui.notify(report, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`[prompt-architect] audit failed: ${message}`, "error");
			}
		},
	});
}
