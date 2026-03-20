---
name: smith
description: >
  Use this skill when asked to create, write, scaffold, or improve a pi
  extension (TypeScript module that extends pi behavior); build a custom tool
  the LLM can call; add a slash command, keyboard shortcut, or event handler
  to pi; intercept or block bash/write/edit tool calls; add permission gates,
  path guards, git checkpoints, or interactive dialogs; or review and debug an
  existing extension. Covers file placement, tool registration, event
  interception, state management, UI interactions, output truncation, and
  testing. Does NOT cover skills (SKILL.md) — use coach for those.
---

# Smith — Pi Extension Creation Guide

## Workflow: Building an Extension (5 Steps)

### Step 1: Clarify the capability

Ask:
- What should the extension **do** (block commands, add a tool, inject context, show UI)?
- Does it need **state** across turns?
- Does it need **user interaction** (confirm dialogs, selections)?
- Is it **global** (every project) or **project-local**?

### Step 2: Choose placement

| Need | Location |
|------|----------|
| Use across all projects | `~/.pi/agent/extensions/<name>.ts` |
| Project-only | `.pi/extensions/<name>.ts` |
| Multi-file or npm deps | `<location>/<name>/index.ts` + optional `package.json` |
| Distribute via npm/git | pi package with `"pi": { "extensions": [...] }` in `package.json` |

Test any location with: `pi -e ./path/to/extension.ts`
Hot-reload after edits (auto-discovered locations only): `/reload`

### Step 3: Choose capabilities

Pick which APIs to implement:

| Capability | API |
|-----------|-----|
| Custom tool for LLM | `pi.registerTool({ name, description, parameters, execute })` |
| Slash command for user | `pi.registerCommand("name", { handler })` |
| Block/allow tool calls | `pi.on("tool_call", ...)` returning `{ block: true, reason }` or `undefined` |
| Patch tool results | `pi.on("tool_result", ...)` returning partial patch |
| Inject system prompt | `pi.on("before_agent_start", ...)` returning `{ systemPrompt }` |
| State across sessions | Store in tool result `details`; reconstruct on session events |
| Keyboard shortcut | `pi.registerShortcut("ctrl+shift+x", { handler })` |

### Step 4: Implement

Start from `references/extension-template.ts` and apply patterns from `references/extension-patterns.md`.

**Non-negotiable rules:**
1. **Enum params** — use `StringEnum` from `@mariozechner/pi-ai`, never `Type.Union`/`Type.Literal` (breaks Google models)
2. **Errors** — `throw new Error("reason")` to signal tool failure; never return `{ isError: true }`
3. **UI guard** — always check `ctx.hasUI` before calling any dialog (`select`, `confirm`, `input`)
4. **State** — store in tool result `details`; reconstruct in `session_start`, `session_switch`, `session_fork`, `session_tree`
5. **Truncation** — tools returning large output MUST use `truncateHead`/`truncateTail` (50KB / 2000 lines)
6. **Cancellation** — check `signal?.aborted` in loops inside `execute()`

### Step 5: Test

```bash
pi -e ./path/to/extension.ts
```

Trigger each tool, command, and event handler. For interactive features, verify `ctx.hasUI` path works. Run with `-p` flag to test non-interactive path.

After confirming it works, move to the auto-discovered location and use `/reload` for hot-reload during iteration.

---

## Gotchas

- **`StringEnum` is mandatory for enums.** `Type.Union([Type.Literal("a"), ...])` fails silently on Google Gemini — the tool gets called with undefined params. Always use `StringEnum(["a", "b"] as const)` from `@mariozechner/pi-ai`.

- **State without `details` breaks on fork.** In-memory state diverges from session state when the user branches. The only safe pattern: store state in tool result `details`, reconstruct from `ctx.sessionManager.getBranch()` on `session_start`, `session_switch`, `session_fork`, and `session_tree`.

- **`ctx.hasUI` is false in print mode (`-p`) and JSON mode.** Dialog methods return their default values silently. Always check before calling `select`, `confirm`, `input`. In non-interactive `tool_call` handlers, default to block.

- **`pi.exec` not `ctx.exec`.** Shell commands use `pi.exec("git", ["status"])` captured from the extension closure — it does not live on `ctx`.

- **`ctx.reload()` / `ctx.waitForIdle()` only in commands.** Calling either from an event handler can deadlock. Register a `/reload-runtime` command and have tools queue it via `pi.sendUserMessage`.

- **`tool_call` does not see sibling tool results.** In parallel execution mode, when two tools run in the same turn, a `tool_call` handler for tool B cannot read tool A's result from `ctx.sessionManager`.

- **Path arguments may have a leading `@`.** Some models prefix path arguments with `@`. Strip it: `const p = params.path.replace(/^@/, "")`.

- **Hot-reload requires auto-discovered location.** `/reload` only works for extensions in `~/.pi/agent/extensions/` or `.pi/extensions/`. Extensions loaded via `pi -e` require a full restart.

---

## References

- `references/extension-patterns.md` — load when implementing a specific pattern (tool registration, event interception, state management, UI, truncation)
- `references/extension-template.ts` — load as the starting template; adapt and remove unused sections
