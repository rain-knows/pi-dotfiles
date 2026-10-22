#!/usr/bin/env node
// Measures only our additive policies. Pi renders all native sections itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPolicyParts } from "../composer.mjs";
import { dedupeContextFiles, dedupeAppendPrompt } from "../dedupe.mjs";

const fixture = JSON.parse(readFileSync(new URL("fixtures.json", import.meta.url), "utf8"));
const argument = process.argv.find(arg => arg.startsWith("--tools="));
const partsFor = selectedTools => buildPolicyParts({ selectedTools, skills: fixture.skills });
const render = tools => partsFor(tools).map(part => part.text).join("\n\n");
const renderCommands = commandNames => buildPolicyParts({ selectedTools: [], commandNames, skills: [] })
  .map(part => part.text).join("\n\n");
const tools = argument ? argument.slice(8).split(",").filter(Boolean) : fixture.toolSet;
const blocks = partsFor(tools).map(part => ({ name: part.name, bytes: Buffer.byteLength(part.text), estimatedTokens: Math.ceil(Buffer.byteLength(part.text) / 4) }));
const report = { method: "UTF-8 bytes / 4 estimate; additive policies only, no native prompt duplication", activeTools: tools, blocks,
  estimatedTokens: blocks.reduce((sum, block) => sum + block.estimatedTokens, 0) };
if (process.argv.includes("--selftest")) {
  assert.equal(render(tools), render(tools));
  assert.deepEqual(blocks.map(block => block.name), ["engineering", "tool_policy", "workflow", "delivery_contract"]);
  assert.ok(!render([]).includes("searchTools()"));
  assert.ok(render(["codemode"]).includes("searchTools()"));
  assert.ok(render(["tool_search"]).includes("deferred tools"));
  assert.ok(!render([]).includes("Call `subagent({"));
  assert.ok(render(["subagents_enable"]).includes("subagents_enable({})"));
  assert.ok(render(["subagent"]).includes("Call `subagent({"));
  assert.ok(!render([]).includes("web_enable({})"));
  assert.ok(render(["web_enable"]).includes("web_enable({})"));
  assert.ok(!render(tools).includes("mcp({"));
  assert.ok(!render(tools).includes("mcpScript"));
  assert.ok(!render(tools).includes("<tools>"));
  assert.ok(!render(tools).includes("<rules>"));
  assert.ok(!render(tools).includes("<docs>"));
  assert.ok(!render(tools).includes("%MCP_ROUTING%"));
  assert.ok(report.estimatedTokens < 2500);
  assert.ok(!renderCommands([]).includes("/usage"));
  assert.ok(!renderCommands([]).includes("# Installed Plugins"));
  assert.ok(renderCommands(["usage"]).includes("`/usage` is a user command for provider limits"));
  assert.ok(!renderCommands(["usage"]).includes("/rewind"));
  assert.ok(renderCommands(["rewind", "open-tui"]).includes("`/rewind`, and `/open-tui` are user commands"));
  assert.ok(render(tools).includes("# 3. Decompose"));
  assert.ok(render(["grep", "find", "powershell"]).includes("# Retrieval vs. Shell"));
  assert.ok(render(["grep", "find", "powershell"]).includes("Get-ChildItem"));
  assert.ok(!render(["grep", "find"]).includes("# Retrieval vs. Shell"));
  assert.ok(!render(["powershell"]).includes("# Retrieval vs. Shell"));
  assert.ok(!render(["read", "edit"]).includes("Retrieval vs. Shell"));
  assert.ok(!render(tools).includes("<engineering>"));
  assert.ok(!render(tools).includes("<tool_policy>"));
  assert.ok(!render(tools).includes("<workflow>"));
  assert.ok(!render(tools).includes("<delivery_contract>"));
  const first = { path: "global", content: "Rule A\n\nRule B" };
  const second = { path: "project", content: "Rule A\n\nRule B\n\nRule C" };
  assert.deepEqual(dedupeContextFiles([first, second]), { files: [second], dropped: ["global"] });
  assert.equal(dedupeContextFiles([first, { path: "partial", content: "Rule B\n\nRule C" }]).files.length, 2);
  assert.equal(dedupeAppendPrompt(first.content, "", [second]), "");
  assert.equal(dedupeAppendPrompt("Different wording", "", [second]), "Different wording");
  report.selftest = "34 assertions passed";
}
console.log(JSON.stringify(report, null, 2));
