# Extension Patterns Reference

Load this file when: implementing a specific pattern (tools, events, state, UI, commands), debugging an extension, or reviewing whether a new extension follows best practices.

---

## Imports

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType, isBashToolResult } from "@mariozechner/pi-coding-agent";
import { truncateHead, truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";  // REQUIRED for enum params — NOT Type.Union/Literal
import { Text } from "@mariozechner/pi-tui";
```

---

## Pattern 1: Tool Registration

```typescript
pi.registerTool({
  name: "my_tool",               // snake_case; must be unique
  label: "My Tool",             // shown in TUI
  description: "What it does",  // shown to LLM
  promptSnippet: "One-line hint in 'Available tools' section",
  parameters: Type.Object({
    action: StringEnum(["list", "add", "delete"] as const),  // StringEnum, never Type.Union/Literal
    text: Type.Optional(Type.String({ description: "Item text (for add)" })),
  }),

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) throw new Error("Cancelled");

    // Stream progress (optional)
    onUpdate?.({ content: [{ type: "text", text: "Working..." }], details: { progress: 50 } });

    // Error: throw — never return { isError: true }
    if (!params.text) throw new Error("text is required for action 'add'");

    return {
      content: [{ type: "text", text: "Done" }],  // sent to LLM
      details: { result: "..." },                  // for rendering & state reconstruction
    };
  },

  // Optional: custom TUI rendering
  renderCall(args, theme) {
    return new Text(theme.fg("toolTitle", theme.bold("my_tool ")) + theme.fg("muted", args.action), 0, 0);
  },
  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) return new Text(theme.fg("warning", "Working..."), 0, 0);
    if (result.details?.error) return new Text(theme.fg("error", result.details.error), 0, 0);
    return new Text(theme.fg("success", "✓ Done"), 0, 0);
  },
});
```

**Rules:**
- Use `StringEnum` from `@mariozechner/pi-ai` for enum params — `Type.Union`/`Type.Literal` breaks Google models
- `throw new Error(...)` to signal failure — never return `{ isError: true }`
- Strip leading `@` from path params — some models emit it: `const p = params.path.replace(/^@/, "")`
- Set `promptSnippet` so the tool appears in the LLM system prompt's "Available tools" section

---

## Pattern 2: Tool Call Interception (blocking)

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    // event.input is typed as { command: string; timeout?: number }
    if (/rm\s+-rf/.test(event.input.command)) {
      if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked" };
      const ok = await ctx.ui.confirm("⚠️ Dangerous", `Allow: ${event.input.command}?`);
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  }

  if (isToolCallEventType("write", event)) {
    const path = event.input.path as string;
    if (path.includes(".env")) return { block: true, reason: "Protected path" };
  }

  return undefined;  // allow
});
```

---

## Pattern 3: Tool Result Modification

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  if (isBashToolResult(event)) {
    // Patch result — return only the fields you want to change
    return {
      content: [...event.content, { type: "text", text: "\n[logged by extension]" }],
    };
  }
  return undefined;  // leave unchanged
});
```

---

## Pattern 4: System Prompt Injection

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    systemPrompt: event.systemPrompt + "\n\nExtra instructions for this turn.",
    // Optional: inject a persistent message visible to LLM
    message: {
      customType: "my-context",
      content: "Additional context...",
      display: false,
    },
  };
});
```

---

## Pattern 5: State Management (session-safe)

Store state in tool result `details` — this automatically respects session branching. Reconstruct from session on every branch-change event.

```typescript
let items: string[] = [];

const reconstruct = (ctx: ExtensionContext) => {
  items = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "toolResult" || entry.message.toolName !== "my_tool") continue;
    items = (entry.message.details as any)?.items ?? [];
  }
};

// Reconstruct on all branch events
["session_start", "session_switch", "session_fork", "session_tree"].forEach((ev) => {
  pi.on(ev as any, async (_event: any, ctx: any) => reconstruct(ctx));
});
```

**Alternative — `pi.appendEntry` for non-LLM state:** Use only when state should NOT appear in the LLM context (e.g., UI preferences, counters). Not branch-aware; prefer tool result `details` for content the LLM needs to see.

---

## Pattern 6: Commands

```typescript
pi.registerCommand("my-cmd", {
  description: "Short description shown in /help",
  handler: async (args, ctx) => {
    // args = string after the command name (e.g., "prod" from "/my-cmd prod")
    if (!ctx.hasUI) {
      ctx.ui.notify("/my-cmd requires interactive mode", "error");
      return;
    }
    await ctx.waitForIdle();  // wait for agent to finish if streaming
    ctx.ui.notify(`Done: ${args}`, "success");
  },
});
```

---

## Pattern 7: UI Interactions

```typescript
// Non-blocking notifications
ctx.ui.notify("Message", "info");     // "info" | "warning" | "error" | "success"

// Blocking dialogs — always guard with ctx.hasUI first
if (ctx.hasUI) {
  const choice = await ctx.ui.select("Pick:", ["A", "B", "C"]);  // undefined if cancelled
  const ok = await ctx.ui.confirm("Title", "Are you sure?");      // false if cancelled
  const text = await ctx.ui.input("Label:", "placeholder");       // undefined if cancelled
}

// Status bar (persistent until cleared)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // clear

// Widget above editor (live lines display)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
ctx.ui.setWidget("my-widget", undefined);  // clear

// Working message during streaming
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage();  // restore default
```

---

## Pattern 8: Output Truncation (mandatory for large output tools)

```typescript
import { truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";

const truncation = truncateTail(output, {
  maxLines: DEFAULT_MAX_LINES,  // 2000
  maxBytes: DEFAULT_MAX_BYTES,  // 50KB
});

let result = truncation.content;
if (truncation.truncated) {
  result += `\n[Truncated: showed ${truncation.outputLines}/${truncation.totalLines} lines. Full output: ${tempFilePath}]`;
}
```

- `truncateHead` — keep the start (good for search results, file reads)
- `truncateTail` — keep the end (good for logs, command output)

---

## Pattern 9: Non-Interactive Guard

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (!ctx.hasUI) {
    // Default-deny in non-interactive mode
    return { block: true, reason: "Requires interactive mode" };
  }
  const ok = await ctx.ui.confirm("Confirm?", "Proceed?");
  if (!ok) return { block: true, reason: "Cancelled" };
});
```

---

## Pattern 10: Signal / Cancellation Handling

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  for (const item of items) {
    if (signal?.aborted) throw new Error("Cancelled");
    await processItem(item);
  }
  return { content: [{ type: "text", text: "Done" }], details: {} };
}
```

---

## Pattern 11: External Command Execution

```typescript
// pi.exec is available in the extension function closure (not on ctx)
const { stdout, stderr, code } = await pi.exec("git", ["status"], { signal, timeout: 5000 });
if (code !== 0) throw new Error(`git failed: ${stderr}`);
```

---

## Pattern 12: Multiple Tools with Shared State

```typescript
export default function (pi: ExtensionAPI) {
  let conn: Connection | null = null;

  pi.registerTool({ name: "db_connect", /* ... */ async execute(_, params) {
    conn = await connect(params.url);
    return { content: [{ type: "text", text: "Connected" }], details: {} };
  }});

  pi.registerTool({ name: "db_query", /* ... */ async execute(_, params, signal) {
    if (!conn) throw new Error("Not connected — call db_connect first");
    const rows = await conn.query(params.sql, { signal });
    return { content: [{ type: "text", text: JSON.stringify(rows) }], details: { rows } };
  }});

  pi.on("session_shutdown", async () => { conn?.close(); });
}
```

---

## Pattern 13: Extension Styles

**Single file** — smallest, no dependencies:
```
~/.pi/agent/extensions/my-ext.ts
```

**Directory** — multi-file, shared helpers:
```
~/.pi/agent/extensions/my-ext/
├── index.ts       # exports default function
├── tools.ts
└── utils.ts
```

**Package with npm dependencies:**
```
~/.pi/agent/extensions/my-ext/
├── package.json   # { "pi": { "extensions": ["./src/index.ts"] }, "dependencies": { ... } }
├── node_modules/  # after npm install
└── src/index.ts
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `Type.Union([Type.Literal("a"), ...])` for enums | `StringEnum(["a", ...] as const)` |
| `return { isError: true }` to signal failure | `throw new Error("reason")` |
| No `ctx.hasUI` check before dialog | Always guard: `if (!ctx.hasUI) { ...; return; }` |
| Mutating state in a tool without storing in `details` | Store state in `details`; reconstruct in session events |
| No cancellation check in long loops | `if (signal?.aborted) throw new Error("Cancelled")` |
| Tool output unbounded | Apply `truncateHead`/`truncateTail` at tool output boundary |
| Reading `.env` or secret files in tools | Block in `tool_call` handler; never log contents |
