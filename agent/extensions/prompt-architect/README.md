# Prompt Architect — Pi 1.0

Adds four independent policy sections using `systemPromptOptions.sections`:
`engineering`, `tool_policy`, `workflow`, `delivery_contract`.
Pi owns its native preamble, tools, rules, docs, addendum, context, skills,
cwd, MCP server instructions and Code mode. This extension never copies the
native prompt renderer or assigns `customPrompt`.

Policies are capability-gated on the active tools at run start. Pi's native
renderer remains responsible for declarations and guidelines when tools are
activated later. Subsequent plugins can add guidelines or their own sections
without losing them. Code mode instructions use native `searchTools()` and
`describeNamespace()`; obsolete `mcp` / `mcpScript` gateway instructions are removed.
Desktop observation/input tools are model-only, preserving their image context.

An explicit `forceSystemPrompt` (including an empty value) is opaque: no options
are changed. An existing `customPrompt` from SYSTEM.md / CLI keeps ownership;
no engineering policies are added. Complete duplicate context sources are
deduplicated using exact paragraph containment; partial overlaps and paraphrases
stay intact. A fragment load failure logs an error without blocking the session.

## Organization

- `index.ts`: Pi hooks and `/prompt-audit`, `/prompt-export <new-file>` commands.
- `composer.mjs`: pure deterministic policy composition, no runtime SDK import.
- `fragments/`: engineering discipline, active-tool routing, workflow, delivery.
- `dedupe.mjs`: exact complete-source deduplication, fenced examples preserved.
- `scripts/measure-prompt.mjs`: additive size estimate and capability self-test.
- `scripts/smoke-test.mjs`: extension-hook ownership checks.

```powershell
node scripts/measure-prompt.mjs --selftest
node scripts/smoke-test.mjs
```

Token counts are UTF-8 bytes / 4 estimates, not model tokenizer results. `/prompt-export`
exports the last active run's effective prompt and refuses to overwrite a file.
Full prompt exports can contain private project context; review before sharing.
The provider-facing SDK audit lives in pi-orb `evidence/upgrade-0.10/run-prompt-audit.mjs`.
