/**
 * Prompt Architect — paragraph-containment deduplication.
 *
 * Mirrors the discipline oh-my-pi applies to its prompt sources: a source is
 * dropped only when a more authoritative source already carries its paragraphs
 * as an exact contiguous run. Matching is exact after normalization, never
 * fuzzy — a paraphrased rule stays, because dropping it could silently remove
 * guidance the user wrote on purpose.
 *
 * Fenced code blocks are never split across paragraphs, so a rule that appears
 * only inside a fenced example elsewhere is not treated as containment.
 */

/**
 * Split normalized content into comparable paragraph blocks.
 * @param {string | null | undefined} content
 * @returns {string[]}
 */
export function splitComparableBlocks(content) {
	const text = String(content ?? "")
		.replace(/\r\n/g, "\n")
		.trim();
	if (!text) return [];

	const blocks = [];
	let current = [];
	let inFence = false;
	for (const line of text.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			current.push(line);
			continue;
		}
		if (!inFence && line.trim() === "" && current.length > 0 && current[current.length - 1].trim() !== "") {
			const block = current.join("\n").trim();
			if (block.length > 0) blocks.push(block);
			current = [];
			continue;
		}
		current.push(line);
	}
	const tail = current.join("\n").trim();
	if (tail.length > 0) blocks.push(tail);
	return blocks;
}

/**
 * True when `candidateBlocks` appears as a contiguous subsequence of
 * `sourceBlocks`.
 * @param {string[]} sourceBlocks
 * @param {string[]} candidateBlocks
 */
export function blocksContain(sourceBlocks, candidateBlocks) {
	if (sourceBlocks.length === 0 || candidateBlocks.length === 0) return false;
	if (candidateBlocks.length > sourceBlocks.length) return false;
	for (let start = 0; start <= sourceBlocks.length - candidateBlocks.length; start += 1) {
		let matched = true;
		for (let offset = 0; offset < candidateBlocks.length; offset += 1) {
			if (sourceBlocks[start + offset] !== candidateBlocks[offset]) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
}

/** True when `source` already contains every paragraph of `candidate`. */
export function sourceContains(source, candidate) {
	return blocksContain(splitComparableBlocks(source), splitComparableBlocks(candidate));
}

/**
 * Drop context files whose paragraphs a later (more authoritative) file already
 * carries in full.
 *
 * Order, not path arithmetic, decides authority: pi's loader emits context files
 * least-authoritative first (`~/.pi/agent/AGENTS.md`, then parents walking down,
 * then the current directory), so a file is dropped only when a file *after* it
 * is a superset.
 *
 * @param {Array<{path: string, content: string}> | undefined} files
 * @returns {{files: Array<{path: string, content: string}>, dropped: string[]}}
 */
export function dedupeContextFiles(files) {
	const list = [...(files ?? [])];
	const blocks = list.map((file) => splitComparableBlocks(file.content));
	const kept = [];
	const dropped = [];
	for (let index = 0; index < list.length; index += 1) {
		if (blocks[index].length === 0) {
			kept.push(list[index]);
			continue;
		}
		const containedLater = blocks.some(
			(other, otherIndex) => otherIndex > index && blocksContain(other, blocks[index]),
		);
		if (containedLater) dropped.push(list[index].path);
		else kept.push(list[index]);
	}
	return { files: kept, dropped };
}

/**
 * Drop the append prompt when it is already carried by the composed main block
 * or a surviving context file.
 * @param {string | undefined} append
 * @param {string} mainBlock
 * @param {Array<{path: string, content: string}>} contextFiles
 */
export function dedupeAppendPrompt(append, mainBlock, contextFiles) {
	const value = String(append ?? "");
	if (value.trim() === "") return value;
	const sources = [mainBlock, ...(contextFiles ?? []).map((file) => file.content)];
	if (sources.some((source) => sourceContains(source, value))) return "";
	return value;
}
