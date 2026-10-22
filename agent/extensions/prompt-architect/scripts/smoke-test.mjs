// This checks the actual hook, with a minimal API harness. The provider audit
// in pi-orb separately proves Pi's native runtime ordering and declarations.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
// Any Node project that has `jiti` installed provides the loader this hook
// needs. Point PI_JITI_PROJECT_DIR at such a project (pi itself, or any local
// Node package that depends on jiti).
const jitiProject = process.env.PI_JITI_PROJECT_DIR;
if (!jitiProject) {
  console.error("Set PI_JITI_PROJECT_DIR to a Node project directory that has `jiti` installed.");
  process.exit(1);
}
const require = createRequire(join(jitiProject, "package.json"));
const { createJiti } = require("jiti");
const architect = await createJiti(import.meta.url).import(new URL("../index.ts", import.meta.url).pathname.replace(/^\/(?:([A-Z]:))/, "$1"), { default: true });
const hooks = new Map(), commands = new Map();
let registry = [];
architect({
	on: (name, handler) => hooks.set(name, handler),
	registerCommand: (name, command) => commands.set(name, command),
	getCommands: () => registry.map(name => ({ name, source: "extension" })),
});
const options = () => ({ selectedTools: ["read", "codemode"], skills: [], contextFiles: [], sections: { mcp_servers: "existing native servers" }, toolGuidelines: {}, promptGuidelines: [], appendSystemPrompt: "user addendum" });
const invoke = value => hooks.get("before_agent_start")({ systemPromptOptions: value });
const normal = options(); invoke(normal);
assert.equal(normal.customPrompt, undefined);
assert.equal(normal.sections.mcp_servers, "existing native servers");
assert.equal(normal.appendSystemPrompt, "user addendum");
assert.ok(normal.sections.engineering);
assert.ok(normal.sections.tool_policy.includes("searchTools()"));
assert.ok(!normal.sections.engineering.startsWith("<engineering>"));
for (const forceSystemPrompt of ["replacement", ""]) {
  const opaque = { ...options(), forceSystemPrompt }, before = JSON.stringify(opaque); invoke(opaque);
  assert.equal(JSON.stringify(opaque), before);
}
const custom = { ...options(), customPrompt: "SYSTEM.md contents" }; invoke(custom);
assert.equal(custom.customPrompt, "SYSTEM.md contents");
assert.equal(custom.sections.engineering, undefined);
assert.ok(commands.has("prompt-audit") && commands.has("prompt-export"));

// Plugin command hints must track the live registry, never settings.json.
const policyOf = value => { const options = { ...value }; invoke(options); return options.sections.tool_policy; };
registry = [];
const none = policyOf(options());
assert.ok(!none.includes("/usage") && !none.includes("/rewind") && !none.includes("/open-tui"));
registry = ["usage"];
const one = policyOf(options());
assert.ok(one.includes("`/usage` is a user command"));
assert.ok(!one.includes("/rewind") && !one.includes("/open-tui"));
registry = ["usage", "rewind", "open-tui"];
const all = policyOf(options());
assert.ok(all.includes("`/usage`, `/rewind`, and `/open-tui` are user commands"));
assert.ok(all.includes("Do not present them as model-callable tools"));

// A harness without getCommands must degrade to "no plugin commands", not throw.
const bareHooks = new Map();
architect({ on: (name, handler) => bareHooks.set(name, handler), registerCommand: () => {} });
const bare = options();
bareHooks.get("before_agent_start")({ systemPromptOptions: bare });
assert.ok(!bare.sections.tool_policy.includes("/usage"));
console.log("Prompt Architect hook smoke: 21 assertions passed");
