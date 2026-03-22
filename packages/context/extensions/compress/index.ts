/**
 * Context Compressor — pi extension
 *
 * Two-pipeline architecture:
 *
 * IMMEDIATE (tool_result hook — persisted to session):
 *   • ANSI stripping  — via node:util.stripVTControlCharacters
 *   • Whitespace normalization — collapse 3+ blank lines, trailing spaces
 *   Safe to persist: improves TUI readability and session file cleanliness.
 *   Token savings tracked with ÷3.5 estimate (same as deferred pipeline).
 *
 * DEFERRED (context hook — deep copy, LLM only):
 *   • Consecutive line dedup  — [N×] markers (confusing in UI)
 *   • Path compression        — $WS/$HOME sigils (confusing in UI)
 *   • JSON → TOON             — different syntax (confusing in UI)
 *   Applied only to toolResult messages. Token savings tracked via ÷3.5.
 *
 * Footer: 🗜 ~1,234 tok saved (28%)
 * Command: /compress-stats — full per-session breakdown
 *
 * Hooks:
 *   session_start   — reset stats, build path entries from process.cwd()
 *   tool_result     — immediate pipeline
 *   context         — deferred pipeline
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runImmediatePipeline, runDeferredPipeline, type PipelineConfig, type PathEntry } from "./pipeline.js";
import { compilePathEntries } from "./stages/paths.js";
import { estimateTokens } from "./stages/tokens.js";

const MIN_IMMEDIATE_SIZE = 150;

interface Stats {
	// tool_result (immediate) — exact tiktoken counts
	immediateTokensBefore: number;
	immediateTokensAfter: number;
	immediateCalls: number;
	// context (deferred) — ÷3.5 estimates from char counts
	deferredCharsBefore: number;
	deferredCharsAfter: number;
	deferredPasses: number;
}

function freshStats(): Stats {
	return {
		immediateTokensBefore: 0,
		immediateTokensAfter: 0,
		immediateCalls: 0,
		deferredCharsBefore: 0,
		deferredCharsAfter: 0,
		deferredPasses: 0,
	};
}

export default function (pi: ExtensionAPI) {
	// ── Session state ───────────────────────────────────────────────────────

	let stats = freshStats();
	let config: PipelineConfig = { pathEntries: [] };

	function buildPathEntries(): PathEntry[] {
		const entries: PathEntry[] = [];
		const cwd = process.cwd();
		const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
		// $WS first (typically longer) so it shadows $HOME for CWD-under-HOME paths
		if (cwd && cwd.length >= 8) entries.push({ path: cwd, sigil: "$WS" });
		if (home && home.length >= 4 && home !== cwd) entries.push({ path: home, sigil: "$HOME" });
		return entries;
	}

	// ── Status widget ───────────────────────────────────────────────────────

	type AnyCtx = Parameters<Parameters<typeof pi.on>[1]>[1];

	function refreshStatus(ctx: AnyCtx): void {
		if (!ctx.hasUI) return;
		const immSaved = stats.immediateTokensBefore - stats.immediateTokensAfter;
		const defSaved = estimateTokens(stats.deferredCharsBefore - stats.deferredCharsAfter);
		const totalSaved = immSaved + defSaved;
		if (totalSaved <= 0) return;

		const totalBefore =
			stats.immediateTokensBefore + estimateTokens(stats.deferredCharsBefore);
		const pct = totalBefore > 0 ? Math.round((totalSaved / totalBefore) * 100) : 0;
		ctx.ui.setStatus("ctx-compress", `🗜 ~${totalSaved.toLocaleString()} tok saved (${pct}%)`);
	}

	// ── session_start ───────────────────────────────────────────────────────

	pi.on("session_start", async () => {
		stats = freshStats();
		const pathEntries = buildPathEntries();
		// Fresh blockCache ensures stale entries from the previous session
		// (different pathEntries) never bleed through.
		config = {
			pathEntries,
			compiledPaths: compilePathEntries(pathEntries),
			blockCache: new WeakMap(),
		};
	});

	// ── tool_result hook — immediate pipeline ───────────────────────────────
	//
	// Runs ANSI stripping + whitespace normalization.
	// Result is stored in the session (persisted), so only stages that improve
	// human readability are included here.

	pi.on("tool_result", async (event, ctx) => {
		const textBlocks = event.content.filter(
			(c): c is { type: "text"; text: string } => c.type === "text",
		);
		if (textBlocks.length === 0) return undefined;

		const original = textBlocks.map((b) => b.text).join("\n");
		if (original.length < MIN_IMMEDIATE_SIZE) return undefined;

		const { text: compressed, stagesApplied } = runImmediatePipeline(original, config);
		if (stagesApplied.length === 0 || compressed.length >= original.length) return undefined;

		// Fast ÷3.5 estimates (same method as deferred pipeline) — avoids
		// 2 × ~5ms tiktoken BPE calls on every compressed tool result.
		const toksBefore = estimateTokens(original.length);
		const toksAfter = estimateTokens(compressed.length);

		stats.immediateCalls++;
		stats.immediateTokensBefore += toksBefore;
		stats.immediateTokensAfter += toksAfter;
		refreshStatus(ctx);

		const nonText = event.content.filter((c) => c.type !== "text");
		return {
			content: [{ type: "text" as const, text: compressed }, ...nonText],
		};
	});

	// ── context hook — deferred pipeline ────────────────────────────────────
	//
	// Runs dedup, path compression, and JSON→TOON on toolResult messages.
	// Deep copy only — never persisted. The LLM gets the compressed version;
	// the TUI and session files retain the originals.

	pi.on("context", async (event, ctx) => {
		const { messages, charsBefore, charsAfter, changed } = runDeferredPipeline(
			event.messages as Parameters<typeof runDeferredPipeline>[0],
			config,
		);
		if (!changed) return undefined;

		stats.deferredPasses++;
		stats.deferredCharsBefore += charsBefore;
		stats.deferredCharsAfter += charsAfter;
		refreshStatus(ctx);

		return { messages };
	});

	// ── /compress-stats command ─────────────────────────────────────────────

	pi.registerCommand("compress-stats", {
		description: "Show context compression statistics for this session",
		handler: async (_, ctx) => {
			const immSaved = stats.immediateTokensBefore - stats.immediateTokensAfter;
			const defSaved = estimateTokens(stats.deferredCharsBefore - stats.deferredCharsAfter);
			const totalSaved = immSaved + defSaved;
			const immPct =
				stats.immediateTokensBefore > 0
					? ((immSaved / stats.immediateTokensBefore) * 100).toFixed(1)
					: "0.0";
			const defPct =
				stats.deferredCharsBefore > 0
					? (((stats.deferredCharsBefore - stats.deferredCharsAfter) / stats.deferredCharsBefore) *
							100).toFixed(1)
					: "0.0";

			const lines = [
				"── Context Compressor ──────────────────────────────────",
				`Immediate (tool_result) — ${stats.immediateCalls} results, ÷3.5 estimate`,
				`  ${stats.immediateTokensBefore.toLocaleString()} → ${stats.immediateTokensAfter.toLocaleString()} tokens  (${immPct}% reduction)`,
				`  Stages: ansi, whitespace`,
				`Deferred (context) — ${stats.deferredPasses} passes, ÷3.5 estimate`,
				`  ${(stats.deferredCharsBefore / 1024).toFixed(1)} KB → ${(stats.deferredCharsAfter / 1024).toFixed(1)} KB  (${defPct}% reduction)`,
				`  Stages: sep-norm, dedup, paths, json→toon`,
				"────────────────────────────────────────────────────────",
				`Total saved: ~${totalSaved.toLocaleString()} tokens`,
			];

			const msg = lines.join("\n");
			if (ctx.hasUI) ctx.ui.notify(msg, "info");
			else console.log(msg);
		},
	});
}
