/**
 * teller — session token cost intelligence for pi
 *
 * Tracks what your session actually costs: per-LLM-turn usage from the
 * session branch (exact, from the API), broken down by model, token type,
 * and attributed to the tool calls that drove them. Sub-agent costs
 * (spawned via the `subagent` tool) are aggregated from ToolResultMessage
 * details and reported separately alongside parent-session costs.
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
// Stats interfaces
// ---------------------------------------------------------------------------

/** Parent-session LLM turn stats (exact per-type cost from API). */
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

/**
 * Sub-agent usage rolled up from SubagentDetails inside ToolResultMessages.
 * Only total cost is available — no per-type cost split exists in SubagentDetails.
 */
interface SubagentModelStat {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

interface SubagentStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
  byModel: Map<string, SubagentModelStat>;
}

// ---------------------------------------------------------------------------
// Sub-agent rollup helper
// ---------------------------------------------------------------------------

/**
 * Recursively extract token/cost usage from a SubagentDetails object.
 *
 * Sub-agents run as `pi --mode json -p --no-session` (no session file is
 * ever written), so the only source of their usage is the `details` field
 * on the parent ToolResultMessage. This function walks that structure.
 *
 * Indirect (grandchild) sub-agent costs are handled by recursing into
 * SingleResult.messages looking for nested toolResult entries whose toolName
 * is "subagent". This requires that `pi --mode json` includes the `details`
 * field on `tool_result_end` events — if it does not, nested costs are
 * silently omitted (zero, not a crash).
 */
function rollupSubagentDetails(details: unknown): SubagentStats {
  const r: SubagentStats = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    cost: 0, turns: 0, byModel: new Map(),
  };

  const d = details as {
    results?: Array<{
      usage?: {
        input: number; output: number;
        cacheRead: number; cacheWrite: number;
        cost: number; turns: number;
      };
      model?: string;
      messages?: Array<{ role: string; toolName?: string; details?: unknown }>;
    }>;
  } | null | undefined;

  if (!d?.results) return r;

  for (const result of d.results) {
    const u = result.usage;
    if (!u) continue; // sub-agent failed before any LLM call

    r.input      += u.input      ?? 0;
    r.output     += u.output     ?? 0;
    r.cacheRead  += u.cacheRead  ?? 0;
    r.cacheWrite += u.cacheWrite ?? 0;
    r.cost       += u.cost       ?? 0;
    r.turns      += u.turns      ?? 0;

    const model = result.model ?? "unknown";
    const ms = r.byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
    ms.input      += u.input      ?? 0;
    ms.output     += u.output     ?? 0;
    ms.cacheRead  += u.cacheRead  ?? 0;
    ms.cacheWrite += u.cacheWrite ?? 0;
    ms.cost       += u.cost       ?? 0;
    ms.turns      += u.turns      ?? 0;
    r.byModel.set(model, ms);

    // Recurse into nested sub-agent tool calls within this sub-agent's messages.
    for (const msg of result.messages ?? []) {
      if (msg.role === "toolResult" && msg.toolName === "subagent" && msg.details) {
        const nested = rollupSubagentDetails(msg.details);
        r.input      += nested.input;
        r.output     += nested.output;
        r.cacheRead  += nested.cacheRead;
        r.cacheWrite += nested.cacheWrite;
        r.cost       += nested.cost;
        r.turns      += nested.turns;
        for (const [m, nms] of nested.byModel) {
          const ex = r.byModel.get(m) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
          ex.input      += nms.input;
          ex.output     += nms.output;
          ex.cacheRead  += nms.cacheRead;
          ex.cacheWrite += nms.cacheWrite;
          ex.cost       += nms.cost;
          ex.turns      += nms.turns;
          r.byModel.set(m, ex);
        }
      }
    }
  }

  return r;
}

// ---------------------------------------------------------------------------
// Session data readers
// ---------------------------------------------------------------------------

/**
 * Parent-session LLM turn stats only. Signature unchanged — no call-site churn.
 */
function getSessionStats(ctx: ExtensionContext): TurnStats {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  let costInput = 0, costOutput = 0, costCacheRead = 0, costCacheWrite = 0;
  let cost = 0, turns = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const m = entry.message as AssistantMessage;
      input      += m.usage.input;
      output     += m.usage.output;
      cacheRead  += m.usage.cacheRead;
      cacheWrite += m.usage.cacheWrite;
      costInput      += m.usage.cost.input;
      costOutput     += m.usage.cost.output;
      costCacheRead  += m.usage.cost.cacheRead;
      costCacheWrite += m.usage.cost.cacheWrite;
      cost  += m.usage.cost.total;
      turns++;
    }
  }
  return { input, output, cacheRead, cacheWrite, costInput, costOutput, costCacheRead, costCacheWrite, cost, turns };
}

/**
 * Aggregate sub-agent usage from all subagent ToolResultMessage entries
 * in the current branch. O(n) single pass.
 */
function getSubagentStats(ctx: ExtensionContext): SubagentStats {
  const combined: SubagentStats = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    cost: 0, turns: 0, byModel: new Map(),
  };
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message as { role: string; toolName?: string; details?: unknown };
    if (msg.role !== "toolResult" || msg.toolName !== "subagent" || !msg.details) continue;

    const sub = rollupSubagentDetails(msg.details);
    combined.input      += sub.input;
    combined.output     += sub.output;
    combined.cacheRead  += sub.cacheRead;
    combined.cacheWrite += sub.cacheWrite;
    combined.cost       += sub.cost;
    combined.turns      += sub.turns;
    for (const [model, ms] of sub.byModel) {
      const ex = combined.byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
      ex.input      += ms.input;
      ex.output     += ms.output;
      ex.cacheRead  += ms.cacheRead;
      ex.cacheWrite += ms.cacheWrite;
      ex.cost       += ms.cost;
      ex.turns      += ms.turns;
      combined.byModel.set(model, ex);
    }
  }
  return combined;
}

/**
 * Parent-session per-model stats. Signature unchanged.
 */
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
      s.input      += m.usage.input;
      s.output     += m.usage.output;
      s.cacheRead  += m.usage.cacheRead;
      s.cacheWrite += m.usage.cacheWrite;
      s.costInput      += m.usage.cost.input;
      s.costOutput     += m.usage.cost.output;
      s.costCacheRead  += m.usage.cost.cacheRead;
      s.costCacheWrite += m.usage.cost.cacheWrite;
      s.cost  += m.usage.cost.total;
      s.turns++;
      byModel.set(m.model, s);
    }
  }
  return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
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
// Display builders
// ---------------------------------------------------------------------------

function buildSummary(ctx: ExtensionContext): string {
  const s = getSessionStats(ctx);
  const sa = getSubagentStats(ctx);
  const hasSub = sa.cost > 0;

  const grandCost = s.cost + sa.cost;
  const parentTok = s.input + s.output + s.cacheRead + s.cacheWrite;
  const saTok     = sa.input + sa.output + sa.cacheRead + sa.cacheWrite;
  const grandTok  = parentTok + saTok;

  const elapsed = Date.now() - state.sessionStart;
  const elapsedMin = Math.max(elapsed / 60_000, 1 / 60);
  const tokRate  = Math.round(grandTok / elapsedMin);
  const costRate = grandCost / elapsedMin;

  const lines: string[] = [
    "## Teller — Session Cost",
    "",
    `⏱ ${fmtDuration(elapsed)}  ·  ~${fmtTokens(tokRate)} tok/min  ·  ~${fmtCost(costRate)}/min`,
    "",
    "### Tokens & Cost by Type",
    "",
    "| Type | Tokens | Cost | % cost |",
    "|------|-------:|-----:|-------:|",
    // % denominated against parent cost so these rows always sum to 100%
    `| Input | ${fmtTokens(s.input)} | ${fmtCost(s.costInput)} | ${pct(s.costInput, s.cost)} |`,
    `| Output | ${fmtTokens(s.output)} | ${fmtCost(s.costOutput)} | ${pct(s.costOutput, s.cost)} |`,
  ];

  if (s.cacheRead > 0 || s.cacheWrite > 0) {
    lines.push(
      `| Cache read | ${fmtTokens(s.cacheRead)} | ${fmtCost(s.costCacheRead)} | ${pct(s.costCacheRead, s.cost)} |`,
      `| Cache write | ${fmtTokens(s.cacheWrite)} | ${fmtCost(s.costCacheWrite)} | ${pct(s.costCacheWrite, s.cost)} |`,
    );
  }

  if (hasSub) {
    // With sub-agents: show parent sub-total, sub-agent row, then grand total
    lines.push(`| **Parent** | **${fmtTokens(parentTok)}** | **${fmtCost(s.cost)}** | ${s.cost > 0 ? "100%" : "—"} |`);
    lines.push(`| ↳ Sub-agents | ${fmtTokens(saTok)} | ${fmtCost(sa.cost)} | — |`);
    lines.push(`| **Grand Total** | **${fmtTokens(grandTok)}** | **${fmtCost(grandCost)}** | — |`);
  } else {
    // No sub-agents: original format unchanged
    lines.push(`| **Total** | **${fmtTokens(parentTok)}** | **${fmtCost(s.cost)}** | 100% |`);
  }

  lines.push(
    "",
    `LLM turns: ${s.turns}${sa.turns > 0 ? `  ·  sub-agent turns: ${sa.turns}` : ""}`,
  );

  if (state.budget !== null) {
    const usedPct  = state.budget > 0 ? Math.round((grandCost / state.budget) * 100) : 0;
    const remaining = Math.max(0, state.budget - grandCost);
    lines.push(`Budget: ${fmtCost(state.budget)} — ${usedPct}% used, ${fmtCost(remaining)} remaining`);
  }

  // --- Model section ---
  // Merge parent models (with full type breakdown) and sub-agent models (total-only).
  const parentModels = getModelStats(ctx);

  // Build a unified map: model → { parentCost, parentTurns, subCost, subTurns }
  const allModels = new Map<string, {
    parentCost: number; parentTurns: number;
    subCost: number; subTurns: number;
  }>();
  for (const m of parentModels) {
    const e = allModels.get(m.model) ?? { parentCost: 0, parentTurns: 0, subCost: 0, subTurns: 0 };
    e.parentCost  += m.cost;
    e.parentTurns += m.turns;
    allModels.set(m.model, e);
  }
  for (const [model, ms] of sa.byModel) {
    const e = allModels.get(model) ?? { parentCost: 0, parentTurns: 0, subCost: 0, subTurns: 0 };
    e.subCost  += ms.cost;
    e.subTurns += ms.turns;
    allModels.set(model, e);
  }

  if (allModels.size > 1 || (allModels.size === 1 && hasSub)) {
    const sorted = Array.from(allModels.entries())
      .sort((a, b) => (b[1].parentCost + b[1].subCost) - (a[1].parentCost + a[1].subCost));

    lines.push("", "### Cost by Model");
    if (hasSub) {
      lines.push("| Model | Cost | Turns | Source | % |");
      lines.push("|-------|-----:|------:|--------|--:|");
      for (const [model, e] of sorted) {
        const totalCost  = e.parentCost + e.subCost;
        const totalTurns = e.parentTurns + e.subTurns;
        const source = e.parentTurns > 0 && e.subTurns > 0 ? "parent+sub"
          : e.parentTurns > 0 ? "parent"
          : "sub-agent";
        lines.push(`| ${shortModel(model)} | ${fmtCost(totalCost)} | ${totalTurns} | ${source} | ${pct(totalCost, grandCost)} |`);
      }
    } else {
      lines.push("| Model | Cost | Turns | % |");
      lines.push("|-------|-----:|------:|--:|");
      for (const [model, e] of sorted) {
        lines.push(`| ${shortModel(model)} | ${fmtCost(e.parentCost)} | ${e.parentTurns} | ${pct(e.parentCost, s.cost)} |`);
      }
    }
  } else if (allModels.size === 1) {
    const [model] = [...allModels.keys()];
    lines.push("", `Model: ${shortModel(model)}`);
  }

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
  const parentModels = getModelStats(ctx);
  const sa = getSubagentStats(ctx);
  const hasSub = sa.cost > 0;

  if (parentModels.length === 0 && !hasSub) return "No LLM turns recorded yet.";

  const totals    = getSessionStats(ctx);
  const grandCost = totals.cost + sa.cost;
  const hasCaches = (totals.cacheRead > 0 || totals.cacheWrite > 0 || sa.cacheRead > 0 || sa.cacheWrite > 0);

  const rows: string[] = ["## Teller — Model Breakdown", ""];

  // --- Main model table ---
  if (hasCaches) {
    rows.push(hasSub
      ? "| Model | Input | Output | Cache↓ | Cache↑ | Cost | % | Turns | Source |"
      : "| Model | Input | Output | Cache↓ | Cache↑ | Cost | % | Turns |");
    rows.push(hasSub
      ? "|-------|------:|-------:|-------:|-------:|-----:|--:|------:|--------|"
      : "|-------|------:|-------:|-------:|-------:|-----:|--:|------:|");
  } else {
    rows.push(hasSub
      ? "| Model | Input | Output | Cost | % | Turns | Source |"
      : "| Model | Input | Output | Cost | % | Turns |");
    rows.push(hasSub
      ? "|-------|------:|-------:|-----:|--:|------:|--------|"
      : "|-------|------:|-------:|-----:|--:|------:|");
  }

  for (const m of parentModels) {
    const subEntry = sa.byModel.get(m.model);
    // Combine parent+sub tokens so token columns are consistent with the combined cost column
    const totalCost     = m.cost + (subEntry?.cost ?? 0);
    const totalInput    = m.input + (subEntry?.input ?? 0);
    const totalOutput   = m.output + (subEntry?.output ?? 0);
    const totalCacheRead  = m.cacheRead + (subEntry?.cacheRead ?? 0);
    const totalCacheWrite = m.cacheWrite + (subEntry?.cacheWrite ?? 0);
    const totalTurns    = m.turns + (subEntry?.turns ?? 0);
    const source = subEntry ? "parent+sub" : "parent";
    if (hasCaches) {
      rows.push(hasSub
        ? `| ${shortModel(m.model)} | ${fmtTokens(totalInput)} | ${fmtTokens(totalOutput)} | ${fmtTokens(totalCacheRead)} | ${fmtTokens(totalCacheWrite)} | ${fmtCost(totalCost)} | ${pct(totalCost, grandCost)} | ${totalTurns} | ${source} |`
        : `| ${shortModel(m.model)} | ${fmtTokens(m.input)} | ${fmtTokens(m.output)} | ${fmtTokens(m.cacheRead)} | ${fmtTokens(m.cacheWrite)} | ${fmtCost(m.cost)} | ${pct(m.cost, grandCost)} | ${m.turns} |`);
    } else {
      rows.push(hasSub
        ? `| ${shortModel(m.model)} | ${fmtTokens(totalInput)} | ${fmtTokens(totalOutput)} | ${fmtCost(totalCost)} | ${pct(totalCost, grandCost)} | ${totalTurns} | ${source} |`
        : `| ${shortModel(m.model)} | ${fmtTokens(m.input)} | ${fmtTokens(m.output)} | ${fmtCost(m.cost)} | ${pct(m.cost, grandCost)} | ${m.turns} |`);
    }
  }

  // Sub-agent-only models (not seen in parent turns)
  for (const [model, ms] of sa.byModel) {
    if (parentModels.some(m => m.model === model)) continue; // already shown above
    if (hasCaches) {
      rows.push(`| ${shortModel(model)} | ${fmtTokens(ms.input)} | ${fmtTokens(ms.output)} | ${fmtTokens(ms.cacheRead)} | ${fmtTokens(ms.cacheWrite)} | ${fmtCost(ms.cost)} | ${pct(ms.cost, grandCost)} | ${ms.turns} | sub-agent |`);
    } else {
      rows.push(`| ${shortModel(model)} | ${fmtTokens(ms.input)} | ${fmtTokens(ms.output)} | ${fmtCost(ms.cost)} | ${pct(ms.cost, grandCost)} | ${ms.turns} | sub-agent |`);
    }
  }

  // Grand total row
  const grandTurns = totals.turns + sa.turns;
  if (hasCaches) {
    rows.push(hasSub
      ? `| **Total** | **${fmtTokens(totals.input + sa.input)}** | **${fmtTokens(totals.output + sa.output)}** | **${fmtTokens(totals.cacheRead + sa.cacheRead)}** | **${fmtTokens(totals.cacheWrite + sa.cacheWrite)}** | **${fmtCost(grandCost)}** | 100% | **${grandTurns}** | — |`
      : `| **Total** | **${fmtTokens(totals.input)}** | **${fmtTokens(totals.output)}** | **${fmtTokens(totals.cacheRead)}** | **${fmtTokens(totals.cacheWrite)}** | **${fmtCost(grandCost)}** | 100% | **${grandTurns}** |`);
  } else {
    rows.push(hasSub
      ? `| **Total** | **${fmtTokens(totals.input + sa.input)}** | **${fmtTokens(totals.output + sa.output)}** | **${fmtCost(grandCost)}** | 100% | **${grandTurns}** | — |`
      : `| **Total** | **${fmtTokens(totals.input)}** | **${fmtTokens(totals.output)}** | **${fmtCost(grandCost)}** | 100% | **${grandTurns}** |`);
  }

  // --- Cost by Type (parent turns only — sub-agents have no type split) ---
  if (totals.cost === 0 && hasSub) {
    rows.push("", "_No parent LLM turns — all cost from sub-agents above._");
  } else {
  rows.push(
    "",
    hasSub
      ? "### Cost by Type (parent turns — sub-agent totals below)"
      : "### Cost by Type",
    "",
    "| Type | Tokens | Cost | % |",
    "|------|-------:|-----:|--:|",
    `| Input | ${fmtTokens(totals.input)} | ${fmtCost(totals.costInput)} | ${pct(totals.costInput, totals.cost)} |`,
    `| Output | ${fmtTokens(totals.output)} | ${fmtCost(totals.costOutput)} | ${pct(totals.costOutput, totals.cost)} |`,
  );

  if (hasCaches && (totals.cacheRead > 0 || totals.cacheWrite > 0)) {
    rows.push(
      `| Cache read | ${fmtTokens(totals.cacheRead)} | ${fmtCost(totals.costCacheRead)} | ${pct(totals.costCacheRead, totals.cost)} |`,
      `| Cache write | ${fmtTokens(totals.cacheWrite)} | ${fmtCost(totals.costCacheWrite)} | ${pct(totals.costCacheWrite, totals.cost)} |`,
    );
  }

  rows.push(`| **Total** | **${fmtTokens(totals.input + totals.output + totals.cacheRead + totals.cacheWrite)}** | **${fmtCost(totals.cost)}** | 100% |`);
  } // end else (totals.cost > 0 || !hasSub)

  if (hasSub) {
    const saTok = sa.input + sa.output + sa.cacheRead + sa.cacheWrite;
    rows.push(
      "",
      "### Sub-agent Summary",
      "",
      "| Tokens | Cost | Turns | Note |",
      "|-------:|-----:|------:|------|",
      `| ${fmtTokens(saTok)} | ${fmtCost(sa.cost)} | ${sa.turns} | total cost only — no per-type split |`,
    );
  }

  // --- Per-Model Cost by Type (parent turns only) ---
  if (parentModels.length > 1) {
    rows.push("", "### Per-Model Cost by Type (parent turns)", "");
    for (const m of parentModels) {
      const subEntry = sa.byModel.get(m.model);
      const subNote = subEntry ? ` + ${subEntry.turns} sub-agent turns (${fmtCost(subEntry.cost)} total only)` : "";
      rows.push(
        `**${shortModel(m.model)}** (${m.turns} parent turn${m.turns !== 1 ? "s" : ""}${subNote}, parent cost ${fmtCost(m.cost)})`,
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

/**
 * Message history, reading the branch directly so sub-agent tool result
 * rows can be interleaved with parent assistant turns.
 */
function buildMessagesHistory(ctx: ExtensionContext): string {
  type HistoryRow =
    | {
        kind: "assistant";
        model: string;
        input: number; output: number; cacheRead: number; cost: number;
        tools: string[];
      }
    | {
        kind: "subagent";
        agentNames: string[];
        input: number; output: number; cacheRead: number; cost: number;
        turns: number;
      };

  const rows: HistoryRow[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message as {
      role: string;
      toolName?: string;
      details?: unknown;
      model?: string;
      usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
      content?: Array<{ type: string; name?: string }>;
    };

    if (msg.role === "assistant" && msg.model && msg.usage) {
      const tools = (msg.content ?? [])
        .filter((c) => c.type === "toolCall")
        .map((c) => c.name ?? "?");
      rows.push({
        kind: "assistant",
        model: msg.model,
        input: msg.usage.input,
        output: msg.usage.output,
        cacheRead: msg.usage.cacheRead,
        cost: msg.usage.cost.total,
        tools,
      });
    } else if (msg.role === "toolResult" && msg.toolName === "subagent" && msg.details) {
      const sub = rollupSubagentDetails(msg.details);
      const d = msg.details as { results?: Array<{ agent?: string }> };
      const agentNames = [...new Set((d.results ?? []).map(r => r.agent ?? "?"))];
      rows.push({
        kind: "subagent",
        agentNames,
        input: sub.input, output: sub.output, cacheRead: sub.cacheRead,
        cost: sub.cost, turns: sub.turns,
      });
    }
  }

  if (rows.length === 0) return "No LLM turns recorded yet.";

  const recent = rows.slice(-20);
  const offset = rows.length - recent.length;

  const tableRows: string[] = [
    `## Teller — Message History (last ${recent.length} of ${rows.length} entries)`,
    "",
    "| # | Model | Input | Output | Cache↓ | Cost | Tools |",
    "|---|-------|------:|-------:|-------:|-----:|-------|",
  ];

  for (let i = 0; i < recent.length; i++) {
    const row = recent[i];
    const num = offset + i + 1;

    if (row.kind === "assistant") {
      const toolStr = row.tools.length === 0
        ? "—"
        : row.tools.slice(0, 3).join(", ") + (row.tools.length > 3 ? ` +${row.tools.length - 3}` : "");
      tableRows.push(`| ${num} | ${shortModel(row.model)} | ${fmtTokens(row.input)} | ${fmtTokens(row.output)} | ${fmtTokens(row.cacheRead)} | ${fmtCost(row.cost)} | ${toolStr} |`);
    } else {
      const agents = row.agentNames.slice(0, 2).join(", ")
        + (row.agentNames.length > 2 ? ` +${row.agentNames.length - 2}` : "");
      tableRows.push(`| ${num} | ↳ sub-agent | ${fmtTokens(row.input)} | ${fmtTokens(row.output)} | ${fmtTokens(row.cacheRead)} | ${fmtCost(row.cost)} | ${agents} (${row.turns} turns) |`);
    }
  }

  return tableRows.join("\n");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function teller(pi: ExtensionAPI) {
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const m = event.message as AssistantMessage;

    for (const content of m.content as Array<{ type: string; id?: string }>) {
      if (content.type === "toolCall" && content.id) {
        state.pendingToolCalls.set(content.id, m.model);
      }
    }

    const s  = getSessionStats(ctx);
    const sa = getSubagentStats(ctx);
    const grandCost = s.cost + sa.cost;
    const grandTok  = s.input + s.output + s.cacheRead + s.cacheWrite
                    + sa.input + sa.output + sa.cacheRead + sa.cacheWrite;
    const elapsedMin = Math.max((Date.now() - state.sessionStart) / 60_000, 1 / 60);
    const tokRate = Math.round(grandTok / elapsedMin);

    const subLabel = sa.cost > 0 ? ` (↳ ${fmtCost(sa.cost)} sub)` : "";
    ctx.ui.setStatus("teller", `${fmtTokens(grandTok)} tok | ${fmtCost(grandCost)}${subLabel} | ~${fmtTokens(tokRate)}/min`);

    if (state.budget !== null && !state.budgetWarned && grandCost >= state.budget * 0.9) {
      state.budgetWarned = true;
      pi.sendMessage(
        {
          customType: "teller",
          content: `⚠️ **Teller budget alert:** ${fmtCost(grandCost)} of ${fmtCost(state.budget)} used (${Math.round((grandCost / state.budget) * 100)}%). Set a new budget with \`/teller budget <$N>\`.`,
          display: true,
        },
        { triggerTurn: false },
      );
    }
  });

  pi.on("tool_result", async (event) => {
    const name  = event.toolName ?? "unknown";
    const model = state.pendingToolCalls.get(event.toolCallId) ?? "unknown";
    state.pendingToolCalls.delete(event.toolCallId);

    const inputStr  = JSON.stringify(event.input ?? "");
    const outputStr = Array.isArray(event.content)
      ? event.content.map((c: { text?: string }) => c.text ?? "").join("")
      : String(event.content ?? "");

    const stat = state.tools.get(name) ?? { calls: 0, inputChars: 0, outputChars: 0, byModel: new Map() };
    stat.calls++;
    stat.inputChars  += inputStr.length;
    stat.outputChars += outputStr.length;

    const ms = stat.byModel.get(model) ?? { calls: 0, inputChars: 0, outputChars: 0 };
    ms.calls++;
    ms.inputChars  += inputStr.length;
    ms.outputChars += outputStr.length;
    stat.byModel.set(model, ms);

    state.tools.set(name, stat);
  });

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
