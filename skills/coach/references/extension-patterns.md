# Extension Patterns Reference

Load this file when: creating or debugging a pi extension. Covers state management,
event hooks, tool registration, custom UI, and common patterns.

## Anatomy

Extensions export a default function receiving `pi: ExtensionAPI` (loaded by jiti — no `tsc`). Call `pi.on(event, handler)` for lifecycle hooks, `pi.registerTool({...})` for LLM-callable tools, `pi.registerCommand(name, {handler})` for slash commands.

## Critical import rules

| Package | Use for | Note |
|---------|---------|------|
| `@mariozechner/pi-coding-agent` | `ExtensionAPI`, `ExtensionContext`, event types, type guards, truncation utils | Always |
| `@sinclair/typebox` | `Type.Object(...)` for tool schemas | Always |
| `@mariozechner/pi-ai` | `StringEnum` for enums — **NEVER `Type.Union`/`Type.Literal`** (breaks Google) | Always for enums |
| `node:fs`, `node:path` | File system operations | Built-in |

## State management pattern

State stored in tool result `details` survives forks, branch navigation, and restarts.

```typescript
interface MyState { items: string[] }
interface MyDetails { action: string; state: MyState }
let state: MyState = { items: [] };

function reconstruct(ctx: ExtensionContext) {
  state = { items: [] };
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role === "toolResult" && msg.toolName === "my_tool")
      state = (msg.details as MyDetails).state ?? state;
  }
}

// All 4 events that change the active branch:
pi.on("session_start",  async (_e, ctx) => reconstruct(ctx));
pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
pi.on("session_fork",   async (_e, ctx) => reconstruct(ctx));
pi.on("session_tree",   async (_e, ctx) => reconstruct(ctx));

// Always return state in details:
// return { content: [...], details: { action: params.action, state: { ...state } } as MyDetails };
```



## Tool registration patterns

### Basic tool
```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",                // shown in TUI
  description: "What it does",     // shown to LLM in system prompt
  promptSnippet: "One-line entry for the Available tools section",
  parameters: Type.Object({
    action: StringEnum(["list", "add", "delete"] as const),
    text: Type.Optional(Type.String({ description: "Item text (for add)" })),
  }),

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }], details: {} };
    onUpdate?.({ content: [{ type: "text", text: "Working..." }], details: {} }); // stream progress
    if (!params.text && params.action === "add") throw new Error("text is required for add");
    return {
      content: [{ type: "text", text: "Done" }],
      details: { result: "..." },
    };
  },
});
```

### Output truncation (required for any tool that returns large output)
```typescript
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";

async execute(...) {
  const t = truncateHead(await runSomething(), { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  let text = t.content;
  if (t.truncated) text += `\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines. Full: ${formatSize(t.totalBytes)}]`;
  return { content: [{ type: "text", text }], details: {} };
}
```

**`truncateHead`** — start matters (search results, reads). **`truncateTail`** — end matters (logs, output).

## Event hook patterns

### Block tool calls
```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

const PROTECTED = [".env", ".pem", ".key", "id_rsa", "credentials"];
pi.on("tool_call", async (event, ctx) => {
  // Block dangerous bash:
  if (isToolCallEventType("bash", event)) {
    const cmd = event.input.command ?? "";
    if (/rm\s+-rf\s+\//.test(cmd) || cmd.includes("sudo")) {
      const ok = await ctx.ui.confirm("⚠ Dangerous", `Allow: ${cmd}?`);
      if (!ok) return { block: true, reason: "Blocked" };
    }
  }
  // Protect sensitive files:
  if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
    const fp = (event.input as { path?: string }).path ?? "";
    if (PROTECTED.some((p) => fp.includes(p))) return { block: true, reason: `Protected: ${fp}` };
  }
});
```

### Inject context into every LLM call
```typescript
pi.on("before_agent_start", async (event, _ctx) => ({
  systemPrompt: event.systemPrompt + "\n\n## Extra Context\n...",
}));
```

### Footer status bar
```typescript
pi.on("turn_end", async (_event, ctx) => {
  ctx.ui.setStatus("my-ext", `turns: ${ctx.sessionManager.getBranch().length}`);
});
```

## Command patterns

### Simple command
```typescript
pi.registerCommand("my-cmd", {
  description: "What this command does",
  handler: async (args, ctx) => {
    ctx.ui.notify(`Hello ${args || "world"}!`, "info");
  },
});
```

### Command with argument autocomplete
```typescript
pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix) =>
    ["dev", "staging", "prod"].filter((e) => e.startsWith(prefix)).map((e) => ({ value: e, label: e })),
  handler: async (args, ctx) => { ctx.ui.notify(`Deploying to ${args}`, "info"); },
});
```

### Command that needs the session to be idle first
```typescript
pi.registerCommand("safe-reset", {
  description: "Reset after agent finishes",
  handler: async (args, ctx) => {
    await ctx.waitForIdle(); // ExtensionCommandContext method — not available in event handlers
    ctx.ui.notify("Agent is idle, safe to reset", "info");
  },
});
```

## UI patterns

```typescript
// Notify (levels: "info" | "success" | "error" | "warning")
ctx.ui.notify("Saved!", "success");

// Confirm / input / select
const ok     = await ctx.ui.confirm("Title", "Are you sure?");
const apiKey = await ctx.ui.input("Enter API key", "sk-...");
const env    = await ctx.ui.select("Choose env", [
  { label: "Dev", value: "dev" }, { label: "Prod", value: "prod" },
]);
```

## Testing

```bash
pi -e ./extensions/my-ext/index.ts  # load for this run
pi -e ./ext-a/index.ts -e ./ext-b/index.ts  # multiple extensions
pi --no-tools -e ./extensions/my-ext/index.ts  # extension tools only
```

Hot-reload: `/reload` (must be in `.pi/extensions/` or `~/.pi/agent/extensions/`).
