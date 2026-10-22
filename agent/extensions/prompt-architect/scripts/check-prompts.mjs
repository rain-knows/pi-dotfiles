#!/usr/bin/env node
/**
 * Prompt Architect — fragment formatter / checker.
 *
 * Normalizes `fragments/*.md`:
 *  - LF line endings
 *  - no trailing whitespace
 *  - at most one consecutive blank line, no leading/trailing blank lines
 *  - exactly one trailing newline
 *  - RFC 2119 keywords bolded (outside fenced code and inline code)
 *
 * Usage: node check-prompts.mjs [--fix]
 *   default (--check): report files that need changes, exit 1 when any exists
 *   --fix:             rewrite the files in place
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRAGMENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fragments");

const KEYWORDS = [
	"MUST NOT",
	"SHOULD NOT",
	"REQUIRED",
	"RECOMMENDED",
	"OPTIONAL",
	"MUST",
	"SHOULD",
	"NEVER",
	"AVOID",
	"MAY",
];
const RFC2119 = new RegExp(`(?<!\\*)\\b(${KEYWORDS.join("|")})\\b(?!\\*)`, "g");

const FENCE = /^\s*(```|~~~)/;

/** Bold RFC 2119 keywords outside inline code spans. */
function boldRfc2119(line) {
	const parts = line.split("`");
	for (let index = 0; index < parts.length; index += 2) {
		parts[index] = parts[index].replace(RFC2119, "**$1**");
	}
	return parts.join("`");
}

function normalize(raw) {
	const issues = [];
	if (raw.includes("\r\n")) issues.push("file: CRLF line endings");

	const lines = raw.replace(/\r\n/g, "\n").split("\n");
	const staged = [];
	let inFence = false;
	for (let index = 0; index < lines.length; index += 1) {
		const original = lines[index];
		const isFence = FENCE.test(original);
		if (isFence) inFence = !inFence;

		let line = original.replace(/[ \t]+$/, "");
		if (line !== original) issues.push(`line ${index + 1}: trailing whitespace`);

		if (!isFence && !inFence) {
			const bolded = boldRfc2119(line);
			if (bolded !== line) {
				issues.push(`line ${index + 1}: unbolded RFC 2119 keyword`);
				line = bolded;
			}
		}
		staged.push(line);
	}

	const collapsed = [];
	for (const line of staged) {
		if (line.trim() === "") {
			if (collapsed.length === 0) {
				issues.push("file: leading blank line");
				continue;
			}
			if (collapsed[collapsed.length - 1].trim() === "") {
				issues.push("file: consecutive blank lines");
				continue;
			}
		}
		collapsed.push(line);
	}
	while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") {
		collapsed.pop();
		issues.push("file: trailing blank line");
	}

	const text = collapsed.length > 0 ? `${collapsed.join("\n")}\n` : "";
	return { text, issues: [...new Set(issues)] };
}

function main() {
	const fix = process.argv.includes("--fix");
	const files = readdirSync(FRAGMENTS_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort();

	let changed = 0;
	for (const name of files) {
		const path = join(FRAGMENTS_DIR, name);
		const raw = readFileSync(path, "utf8");
		const { text, issues } = normalize(raw);
		if (text === raw) continue;
		changed += 1;
		if (fix) {
			writeFileSync(path, text);
			console.log(`formatted fragments/${name}`);
			continue;
		}
		console.log(`fragments/${name}`);
		for (const issue of issues) console.log(`  - ${issue}`);
	}

	if (fix) {
		console.log(changed === 0 ? "all fragments already formatted" : `formatted ${changed} file(s)`);
		return;
	}
	if (changed > 0) {
		console.log(`\n${changed} file(s) need formatting. Run with --fix.`);
		process.exit(1);
	}
	console.log(`all ${files.length} fragments are formatted`);
}

main();
