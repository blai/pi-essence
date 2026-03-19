// [ExtensionName]: replace tool/command names and state shape throughout.
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
// import { isToolCallEventType, truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";

// State stored in tool result details — survives forks, branch navigation, restarts.
interface MyState { items: string[] }
interface MyDetails { action: string; state: MyState }

export default function (pi: ExtensionAPI) {
  // Reconstructed from session on load — never rely on module-level vars as source of truth.
  let state: MyState = { items: [] };

  function reconstruct(ctx: ExtensionContext): void {
    state = { items: [] };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role === "toolResult" && msg.toolName === "my_tool") {
        const details = msg.details as MyDetails | undefined;
        if (details?.state) state = details.state;
      }
    }
  }

  // Must handle all 4 session events that change the active branch.
  pi.on("session_start",  async (_e, ctx) => reconstruct(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
  pi.on("session_fork",   async (_e, ctx) => reconstruct(ctx));
  pi.on("session_tree",   async (_e, ctx) => reconstruct(ctx));

  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "[What this tool does — shown to the LLM in the system prompt]",
    promptSnippet: "[One-line entry for the system prompt Available tools section]",
    parameters: Type.Object({
      action: StringEnum(["list", "add", "clear"] as const), // StringEnum only — Type.Union/Type.Literal breaks Google
      text: Type.Optional(Type.String({ description: "[When to provide this]" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: { action: params.action, state } };
      }
      // onUpdate?.({ content: [{ type: "text", text: "Working..." }], details: {} }); // stream progress

      switch (params.action) {
        case "list":
          return {
            content: [{ type: "text", text: state.items.join("\n") || "(empty)" }],
            details: { action: "list", state: { ...state } } as MyDetails,
          };

        case "add": {
          if (!params.text) throw new Error("text is required for add"); // throw to signal errors — never return isError
          state.items.push(params.text);
          return {
            content: [{ type: "text", text: `Added: ${params.text}` }],
            details: { action: "add", state: { ...state } } as MyDetails,
          };
        }

        case "clear":
          state = { items: [] };
          return {
            content: [{ type: "text", text: "Cleared" }],
            details: { action: "clear", state: { ...state } } as MyDetails,
          };

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  pi.registerCommand("my-ext", {
    description: "[What this command does]",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });

  // ── Event hooks (uncomment what you need) ────────────────────────────────

  // Block dangerous tool calls:
  // pi.on("tool_call", async (event, ctx) => {
  //   if (isToolCallEventType("bash", event)) {
  //     const cmd = event.input.command ?? "";
  //     if (cmd.includes("rm -rf")) {
  //       const ok = await ctx.ui.confirm("Dangerous", `Allow: ${cmd}?`);
  //       if (!ok) return { block: true, reason: "Blocked" };
  //     }
  //   }
  // });

  // Inject context before LLM calls:
  // pi.on("before_agent_start", async (event, _ctx) => {
  //   return { systemPrompt: event.systemPrompt + "\n\n## My Context\n..." };
  // });

  // Footer status bar:
  // pi.on("turn_end", async (_event, ctx) => {
  //   ctx.ui.setStatus("my-ext", `items: ${state.items.length}`);
  // });
}
