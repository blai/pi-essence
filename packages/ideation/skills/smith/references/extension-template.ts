/**
 * Extension Template for pi
 *
 * Usage:
 *   1. Copy to ~/.pi/agent/extensions/<name>.ts  (global)
 *          or  .pi/extensions/<name>.ts          (project-local)
 *   2. Rename, remove sections you don't need, fill in the rest
 *   3. Test: `pi -e ./path/to/<name>.ts`
 *   4. Hot-reload after edits: /reload  (works in auto-discovered locations)
 *
 * Imports:
 *   @mariozechner/pi-coding-agent — ExtensionAPI, event types, tool utilities
 *   @sinclair/typebox             — Type-safe parameter schemas
 *   @mariozechner/pi-ai           — StringEnum (Google-compatible enums)
 *   @mariozechner/pi-tui          — TUI components for custom rendering
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType, truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ItemDetails {
  action: "list" | "add" | "remove";
  items: string[];
  error?: string;
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── In-memory state ─────────────────────────────────────────────────────────
  // Store state in tool result `details` for branch-safe persistence.
  // Reconstruct from session on every branch-change event.
  let items: string[] = [];

  const reconstruct = (ctx: ExtensionContext) => {
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      if (entry.message.role !== "toolResult" || entry.message.toolName !== "my_tool") continue;
      items = (entry.message.details as ItemDetails | undefined)?.items ?? [];
    }
  };

  pi.on("session_start",  async (_ev, ctx) => reconstruct(ctx));
  pi.on("session_switch", async (_ev, ctx) => reconstruct(ctx));
  pi.on("session_fork",   async (_ev, ctx) => reconstruct(ctx));
  pi.on("session_tree",   async (_ev, ctx) => reconstruct(ctx));

  // ── Tool ─────────────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Manage items. Actions: list, add (text), remove (text).",
    // promptSnippet: "List or manage items",  // Uncomment to show in system prompt
    parameters: Type.Object({
      // Use StringEnum for enums — Type.Union/Literal breaks Google models
      action: StringEnum(["list", "add", "remove"] as const),
      text: Type.Optional(Type.String({ description: "Item text (for add/remove)" })),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // Check cancellation early in long operations
      if (signal?.aborted) throw new Error("Cancelled");

      // Throw to signal errors — never return { isError: true }
      if ((params.action === "add" || params.action === "remove") && !params.text) {
        throw new Error(`text is required for action '${params.action}'`);
      }

      switch (params.action) {
        case "list":
          return {
            content: [{ type: "text", text: items.length ? items.join("\n") : "(empty)" }],
            details: { action: "list", items: [...items] } as ItemDetails,
          };

        case "add":
          items.push(params.text!);
          return {
            content: [{ type: "text", text: `Added: ${params.text}` }],
            details: { action: "add", items: [...items] } as ItemDetails,
          };

        case "remove": {
          const idx = items.indexOf(params.text!);
          if (idx === -1) throw new Error(`Item not found: ${params.text}`);
          items.splice(idx, 1);
          return {
            content: [{ type: "text", text: `Removed: ${params.text}` }],
            details: { action: "remove", items: [...items] } as ItemDetails,
          };
        }
      }
    },

    // Optional: custom TUI rendering
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("my_tool ")) + theme.fg("muted", args.action);
      if (args.text) text += " " + theme.fg("dim", `"${args.text}"`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Working..."), 0, 0);
      const details = result.details as ItemDetails | undefined;
      if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

      if (details?.action === "list") {
        if (!details.items.length) return new Text(theme.fg("dim", "(empty)"), 0, 0);
        if (!expanded) return new Text(theme.fg("muted", `${details.items.length} item(s)`), 0, 0);
        return new Text(details.items.map(i => "• " + i).join("\n"), 0, 0);
      }

      const first = result.content[0];
      return new Text(theme.fg("success", "✓ ") + (first?.type === "text" ? theme.fg("muted", first.text) : ""), 0, 0);
    },
  });

  // ── Event: intercept tool calls ───────────────────────────────────────────────
  // Remove this block if you don't need to gate or log tool calls.
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command;
      if (/rm\s+(-rf?|--recursive)/.test(cmd)) {
        if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked (no UI)" };
        const ok = await ctx.ui.confirm("⚠️ Dangerous command", `Allow: ${cmd}?`);
        if (!ok) return { block: true, reason: "Blocked by user" };
      }
    }
    return undefined;  // allow all other tools
  });

  // ── Command ───────────────────────────────────────────────────────────────────
  pi.registerCommand("my-cmd", {
    description: "Show current items",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/my-cmd requires interactive mode", "error");
        return;
      }
      await ctx.waitForIdle();
      ctx.ui.notify(items.length ? `Items: ${items.join(", ")}` : "No items", "info");
    },
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  pi.on("session_shutdown", async () => {
    // Close connections, flush buffers, etc.
  });
}

// ── Truncation helper (use in tools that return large output) ─────────────────
//
// const raw = await runSomething();
// const t = truncateTail(raw, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
// let out = t.content;
// if (t.truncated) {
//   out += `\n[Truncated: ${t.outputLines}/${t.totalLines} lines shown]`;
// }
// return { content: [{ type: "text", text: out }], details: {} };
