/**
 * teller — session token cost intelligence for pi
 *
 * Tracks what your session actually costs: per-LLM-turn usage from the
 * session branch (exact, from the API), broken down by model, token type,
 * and attributed to the tool calls that drove them.
 *
 * Commands:
 *   /teller               — summary: uptime, rate, cost-by-type, top tools
 *   /teller models        — per-model × type breakdown (input/output/cache/cost)
 *   /teller tools         — per-tool breakdown with per-model attribution
 *   /teller messages      — last 20 turns (model, tokens, cost, tools used)
 *   /teller budget <$N>   — set a dollar budget; warns at 90%
 *   /teller reset         — clear live stats and budget
 *
 * LLM tool:
 *   teller_summary        — agent-callable session cost report
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ToolModelStat {
  calls: number;
  inputChars: number;
  outputChars: number;
}

interface ToolStat {
  calls: number;
  inputChars: number;
  outputChars: number;
  /** Per-model breakdown for this tool. */
  byModel: Map<string, ToolModelStat>;
}

interface TellerState {
  tools: Map<string, ToolStat>;
  /** toolCallId → model id — populated from assistant message content, consumed on tool_result. */
  pendingToolCalls: Map<string, string>;
  budget: number | null;
  budgetWarned: boolean;
  sessionStart: number;
}

const state: TellerState = {
  tools: new Map(),
  pendingToolCalls: new Map(),
  budget: null,
  budgetWarned: false,
  sessionStart: Date.now(),
};

// ---------------------------------------------------------------------------
// Session-branch derived stats
// ---------------------------------------------------------------------------

interface TurnStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  cost: number;
  turns: number;
}

interface ModelStats extends TurnStats {
  model: string;
}

interface MessageEntry {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Tool names called in this turn (from ToolCall content entries). */
  tools: string[];
  timestamp: number;
}

function getSessionStats(ctx: ExtensionContext): TurnStats {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  let costInput = 0, costOutput = 0, costCacheRead = 0, costCacheWrite = 0;
  let cost = 0, turns = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const m = entry.message as AssistantMessage;
      input += m.usage.input;
      output += m.usage.output;
      cacheRead += m.usage.cacheRead;
      cacheWrite += m.usage.cacheWrite;
      costInput += m.usage.cost.input;
      costOutput += m.usage.cost.output;
      costCacheRead += m.usage.cost.cacheRead;
      costCacheWrite += m.usage.cost.cacheWrite;
      cost += m.usage.cost.total;
      turns++;
    }
  }
  return { input, output, cacheRead, cacheWrite, costInput, costOutput, costCacheRead, costCacheWrite, cost, turns };
}

function getModelStats(ctx: ExtensionContext): ModelStats[] {
  const byModel = new Map<string, ModelStats>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const m = entry.message as AssistantMessage;
      const s = byModel.get(m.model) ?? {
        model: m.model,
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0,
        cost: 0, turns: 0,
      };
      s.input += m.usage.input;
      s.output += m.usage.output;
      s.cacheRead += m.usage.cacheRead;
      s.cacheWrite += m.usage.cacheWrite;
      s.costInput += m.usage.cost.input;
      s.costOutput += m.usage.cost.output;
      s.costCacheRead += m.usage.cost.cacheRead;
      s.costCacheWrite += m.usage.cost.cacheWrite;
      s.cost += m.usage.cost.total;
      s.turns++;
      byModel.set(m.model, s);
    }
  }
  return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
}

function getMessageHistory(ctx: ExtensionContext): MessageEntry[] {
  const history: MessageEntry[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const m = entry.message as AssistantMessage;
      const tools = (m.content as Array<{ type: string; name?: string }>)
        .filter((c) => c.type === "toolCall")
        .map((c) => c.name ?? "?");
      history.push({
        model: m.model,
        input: m.usage.input,
        output: m.usage.output,
        cacheRead: m.usage.cacheRead,
        cacheWrite: m.usage.cacheWrite,
        cost: m.usage.cost.total,
        tools,
        timestamp: m.timestamp,
      });
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(c: number): string {
  if (c === 0) return "$0.000";
  if (c < 0.001) return "<$0.001";
  if (c < 0.01) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(2)}`;
}

function fmtChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Abbreviate model ids to their most recognisable segment. */
function shortModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("gpt-4o")) return "gpt-4o";
  if (lower.includes("gpt-4")) return "gpt-4";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("deepseek")) return "deepseek";
  const parts = model.split("-");
  return parts.length > 2 ? parts.slice(-2).join("-") : model.slice(0, 16);
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// View builders
// ---------------------------------------------------------------------------

function buildSummary(ctx: ExtensionContext): string {
  const s = getSessionStats(ctx);
  const totalTok = s.input + s.output + s.cacheRead + s.cacheWrite;
  const elapsed = Date.now() - state.sessionStart;
  const elapsedMin = Math.max(elapsed / 60_000, 1 / 60);
  const tokRate = Math.round(totalTok / elapsedMin);
  const costRate = s.cost / elapsedMin;

  const lines: string[] = [
    "## Teller — Session Cost",
    "",
    `⏱ ${fmtDuration(elapsed)}  ·  ~${fmtTokens(tokRate)} tok/min  ·  ~${fmtCost(costRate)}/min`,
    "",
    "### Tokens & Cost by Type",
    "",
    "| Type | Tokens | Cost | % cost |",
    "|------|-------:|-----:|-------:|",
    `| Input | ${fmtTokens(s.input)} | ${fmtCost(s.costInput)} | ${pct(s.costInput, s.cost)} |`,
    `| Output | ${fmtTokens(s.output)} | ${fmtCost(s.costOutput)} | ${pct(s.costOutput, s.cost)} |`,
  ];

  if (s.cacheRead > 0 || s.cacheWrite > 0) {
    lines.push(
      `| Cache read | ${fmtTokens(s.cacheRead)} | ${fmtCost(s.costCacheRead)} | ${pct(s.costCacheRead, s.cost)} |`,
      `| Cache write | ${fmtTokens(s.cacheWrite)} | ${fmtCost(s.costCacheWrite)} | ${pct(s.costCacheWrite, s.cost)} |`,
    );
  }

  lines.push(`| **Total** | **${fmtTokens(totalTok)}** | **${fmtCost(s.cost)}** | 100% |`);
  lines.push(``, `LLM turns: ${s.turns}`);

  if (state.budget !== null) {
    const usedPct = state.budget > 0 ? Math.round((s.cost / state.budget) * 100) : 0;
    const remaining = Math.max(0, state.budget - s.cost);
    lines.push(`Budget: ${fmtCost(state.budget)} — ${usedPct}% used, ${fmtCost(remaining)} remaining`);
  }

  // Per-model summary inline (if >1 model)
  const models = getModelStats(ctx);
  if (models.length > 1) {
    lines.push("", "### Cost by Model");
    lines.push("| Model | Cost | Turns | % |");
    lines.push("|-------|-----:|------:|--:|");
    for (const m of models) {
      lines.push(`| ${shortModel(m.model)} | ${fmtCost(m.cost)} | ${m.turns} | ${pct(m.cost, s.cost)} |`);
    }
  } else if (models.length === 1) {
    lines.push(``, `Model: ${shortModel(models[0].model)}`);
  }

  // Top tools by calls
  if (state.tools.size > 0) {
    const sorted = Array.from(state.tools.entries()).sort((a, b) => b[1].calls - a[1].calls);
    lines.push("", "### Top Tools (by calls)");
    for (const [name, stat] of sorted.slice(0, 6)) {
      lines.push(`- \`${name}\`: ${stat.calls} call${stat.calls !== 1 ? "s" : ""}`);
    }
    if (sorted.length > 6) lines.push(`- … and ${sorted.length - 6} more`);
  }

  return lines.join("\n");
}

function buildModelBreakdown(ctx: ExtensionContext): string {
  const models = getModelStats(ctx);
  if (models.length === 0) return "No LLM turns recorded yet.";

  const totals = getSessionStats(ctx);
  const hasCaches = totals.cacheRead > 0 || totals.cacheWrite > 0;

  // --- Per-model × type table ---
  const rows: string[] = [
    "## Teller — Model Breakdown",
    "",
    hasCaches
      ? "| Model | Input | Output | Cache↓ | Cache↑ | Cost | % | Turns |"
      : "| Model | Input | Output | Cost | % | Turns |",
    hasCaches
      ? "|-------|------:|-------:|-------:|-------:|-----:|--:|------:|"
      : "|-------|------:|-------:|-----:|--:|------:|",
  ];

  for (const m of models) {
    rows.push(
      hasCaches
        ? `| ${shortModel(m.model)} | ${fmtTokens(m.input)} | ${fmtTokens(m.output)} | ${fmtTokens(m.cacheRead)} | ${fmtTokens(m.cacheWrite)} | ${fmtCost(m.cost)} | ${pct(m.cost, totals.cost)} | ${m.turns} |`
        : `| ${shortModel(m.model)} | ${fmtTokens(m.input)} | ${fmtTokens(m.output)} | ${fmtCost(m.cost)} | ${pct(m.cost, totals.cost)} | ${m.turns} |`,
    );
  }

  if (models.length > 1) {
    rows.push(
      hasCaches
        ? `| **Total** | **${fmtTokens(totals.input)}** | **${fmtTokens(totals.output)}** | **${fmtTokens(totals.cacheRead)}** | **${fmtTokens(totals.cacheWrite)}** | **${fmtCost(totals.cost)}** | 100% | **${totals.turns}** |`
        : `| **Total** | **${fmtTokens(totals.input)}** | **${fmtTokens(totals.output)}** | **${fmtCost(totals.cost)}** | 100% | **${totals.turns}** |`,
    );
  }

  // --- Cost by type ---
  rows.push(
    "",
    "### Cost by Type",
    "",
    "| Type | Tokens | Cost | % |",
    "|------|-------:|-----:|--:|",
    `| Input | ${fmtTokens(totals.input)} | ${fmtCost(totals.costInput)} | ${pct(totals.costInput, totals.cost)} |`,
    `| Output | ${fmtTokens(totals.output)} | ${fmtCost(totals.costOutput)} | ${pct(totals.costOutput, totals.cost)} |`,
  );

  if (hasCaches) {
    rows.push(
      `| Cache read | ${fmtTokens(totals.cacheRead)} | ${fmtCost(totals.costCacheRead)} | ${pct(totals.costCacheRead, totals.cost)} |`,
      `| Cache write | ${fmtTokens(totals.cacheWrite)} | ${fmtCost(totals.costCacheWrite)} | ${pct(totals.costCacheWrite, totals.cost)} |`,
    );
  }

  rows.push(`| **Total** | **${fmtTokens(totals.input + totals.output + totals.cacheRead + totals.cacheWrite)}** | **${fmtCost(totals.cost)}** | 100% |`);

  // --- Per-model × type detail (if >1 model) ---
  if (models.length > 1) {
    rows.push("", "### Per-Model Cost by Type", "");
    for (const m of models) {
      rows.push(
        `**${shortModel(m.model)}** (${m.turns} turn${m.turns !== 1 ? "s" : ""}, total ${fmtCost(m.cost)})`,
        "",
        "| Type | Tokens | Cost | % of model |",
        "|------|-------:|-----:|----------:|",
        `| Input | ${fmtTokens(m.input)} | ${fmtCost(m.costInput)} | ${pct(m.costInput, m.cost)} |`,
        `| Output | ${fmtTokens(m.output)} | ${fmtCost(m.costOutput)} | ${pct(m.costOutput, m.cost)} |`,
      );
      if (m.cacheRead > 0 || m.cacheWrite > 0) {
        rows.push(
          `| Cache read | ${fmtTokens(m.cacheRead)} | ${fmtCost(m.costCacheRead)} | ${pct(m.costCacheRead, m.cost)} |`,
          `| Cache write | ${fmtTokens(m.cacheWrite)} | ${fmtCost(m.costCacheWrite)} | ${pct(m.costCacheWrite, m.cost)} |`,
        );
      }
      rows.push(`| **Total** | — | **${fmtCost(m.cost)}** | 100% |`, "");
    }
  }

  return rows.join("\n");
}

function buildToolBreakdown(): string {
  if (state.tools.size === 0) return "No tool calls tracked yet — tool stats are collected live.";

  const sorted = Array.from(state.tools.entries()).sort((a, b) => b[1].calls - a[1].calls);
  const totalCalls = sorted.reduce((s, [, t]) => s + t.calls, 0);

  const rows: string[] = [
    "## Teller — Tool Breakdown",
    "",
    `${totalCalls} total calls across ${sorted.length} tool${sorted.length !== 1 ? "s" : ""}`,
    "",
    "| Tool | Calls | % | In chars | Out chars |",
    "|------|------:|--:|---------:|----------:|",
  ];

  for (const [name, stat] of sorted) {
    const callPct = totalCalls > 0 ? Math.round((stat.calls / totalCalls) * 100) : 0;
    rows.push(`| \`${name}\` | ${stat.calls} | ${callPct}% | ${fmtChars(stat.inputChars)} | ${fmtChars(stat.outputChars)} |`);

    // Per-model sub-rows when >1 model used this tool
    if (stat.byModel.size > 1) {
      const modelsSorted = Array.from(stat.byModel.entries()).sort((a, b) => b[1].calls - a[1].calls);
      for (const [model, ms] of modelsSorted) {
        const mPct = stat.calls > 0 ? Math.round((ms.calls / stat.calls) * 100) : 0;
        rows.push(`| ↳ ${shortModel(model)} | ${ms.calls} | ${mPct}% | ${fmtChars(ms.inputChars)} | ${fmtChars(ms.outputChars)} |`);
      }
    }
  }

  return rows.join("\n");
}

function buildMessagesHistory(ctx: ExtensionContext): string {
  const history = getMessageHistory(ctx);
  if (history.length === 0) return "No LLM turns recorded yet.";

  const recent = history.slice(-20);
  const offset = history.length - recent.length;

  const rows: string[] = [
    `## Teller — Message History (last ${recent.length} of ${history.length} turns)`,
    "",
    "| # | Model | Input | Output | Cache↓ | Cost | Tools |",
    "|---|-------|------:|-------:|-------:|-----:|-------|",
  ];

  for (let i = 0; i < recent.length; i++) {
    const m = recent[i];
    const turn = offset + i + 1;
    const toolStr =
      m.tools.length === 0
        ? "—"
        : m.tools.slice(0, 3).join(", ") + (m.tools.length > 3 ? ` +${m.tools.length - 3}` : "");
    rows.push(
      `| ${turn} | ${shortModel(m.model)} | ${fmtTokens(m.input)} | ${fmtTokens(m.output)} | ${fmtTokens(m.cacheRead)} | ${fmtCost(m.cost)} | ${toolStr} |`,
    );
  }

  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function teller(pi: ExtensionAPI) {
  // ── 1. Build toolCallId → model map from each assistant message ──────────
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const m = event.message as AssistantMessage;

    for (const content of m.content as Array<{ type: string; id?: string }>) {
      if (content.type === "toolCall" && content.id) {
        state.pendingToolCalls.set(content.id, m.model);
      }
    }

    // Update status bar with live totals + rate
    const s = getSessionStats(ctx);
    const total = s.input + s.output + s.cacheRead + s.cacheWrite;
    const elapsedMin = Math.max((Date.now() - state.sessionStart) / 60_000, 1 / 60);
    const tokRate = Math.round(total / elapsedMin);
    ctx.ui.setStatus("teller", `${fmtTokens(total)} tok | ${fmtCost(s.cost)} | ~${fmtTokens(tokRate)}/min`);

    // Budget alert at 90%
    if (state.budget !== null && !state.budgetWarned && s.cost >= state.budget * 0.9) {
      state.budgetWarned = true;
      pi.sendMessage(
        {
          customType: "teller",
          content: `⚠️ **Teller budget alert:** ${fmtCost(s.cost)} of ${fmtCost(state.budget)} used (${Math.round((s.cost / state.budget) * 100)}%). Set a new budget with \`/teller budget <$N>\`.`,
          display: true,
        },
        { triggerTurn: false },
      );
    }
  });

  // ── 2. Track per-tool stats with model attribution ───────────────────────
  pi.on("tool_result", async (event) => {
    const name = event.toolName ?? "unknown";
    const model = state.pendingToolCalls.get(event.toolCallId) ?? "unknown";
    state.pendingToolCalls.delete(event.toolCallId);

    const inputStr = JSON.stringify(event.input ?? "");
    const outputStr = Array.isArray(event.content)
      ? event.content.map((c: { text?: string }) => c.text ?? "").join("")
      : String(event.content ?? "");

    const stat = state.tools.get(name) ?? { calls: 0, inputChars: 0, outputChars: 0, byModel: new Map() };
    stat.calls++;
    stat.inputChars += inputStr.length;
    stat.outputChars += outputStr.length;

    const ms = stat.byModel.get(model) ?? { calls: 0, inputChars: 0, outputChars: 0 };
    ms.calls++;
    ms.inputChars += inputStr.length;
    ms.outputChars += outputStr.length;
    stat.byModel.set(model, ms);

    state.tools.set(name, stat);
  });

  // ── 3. Commands ──────────────────────────────────────────────────────────
  pi.registerCommand("teller", {
    description: "Session cost — /teller [models | tools | messages | budget <$N> | reset]",
    getArgumentCompletions: (prefix) => {
      const subs = ["models", "tools", "messages", "budget", "reset"];
      const matches = subs.filter((s) => s.startsWith(prefix));
      return matches.length > 0 ? matches.map((v) => ({ value: v, label: v })) : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() ?? "";

      if (sub === "models") {
        pi.sendMessage({ customType: "teller", content: buildModelBreakdown(ctx), display: true }, { triggerTurn: false });
        return;
      }

      if (sub === "tools") {
        pi.sendMessage({ customType: "teller", content: buildToolBreakdown(), display: true }, { triggerTurn: false });
        return;
      }

      if (sub === "messages") {
        pi.sendMessage({ customType: "teller", content: buildMessagesHistory(ctx), display: true }, { triggerTurn: false });
        return;
      }

      if (sub === "budget") {
        const amount = parseFloat(parts[1] ?? "");
        if (isNaN(amount) || amount <= 0) {
          ctx.ui.notify("Usage: /teller budget <dollars>  e.g. /teller budget 0.50", "error");
          return;
        }
        state.budget = amount;
        state.budgetWarned = false;
        ctx.ui.notify(`Budget set to ${fmtCost(amount)}. You'll be warned at 90%.`, "success");
        return;
      }

      if (sub === "reset") {
        state.tools.clear();
        state.pendingToolCalls.clear();
        state.budget = null;
        state.budgetWarned = false;
        state.sessionStart = Date.now();
        ctx.ui.setStatus("teller", "");
        ctx.ui.notify("Teller stats reset. (Session token history lives in the session file.)", "info");
        return;
      }

      pi.sendMessage({ customType: "teller", content: buildSummary(ctx), display: true }, { triggerTurn: false });
    },
  });

  // ── 4. LLM-callable tool ─────────────────────────────────────────────────
  pi.registerTool({
    name: "teller_summary",
    label: "Teller Summary",
    description:
      "Return the current session cost summary: uptime, token rate, cost by type, per-model breakdown, and top tools. Use to check how much the session has cost or whether a budget limit is near.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
      const text = buildSummary(ctx);
      return { content: [{ type: "text" as const, text }], details: undefined };
    },
  });
}
