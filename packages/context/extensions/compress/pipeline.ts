/**
 * Two-pipeline architecture:
 *
 * IMMEDIATE pipeline  (runs in `tool_result` — modifies stored session entry)
 *   Stages: ansi → whitespace
 *   Safe to persist: ANSI codes and trailing whitespace are noise for both
 *   humans (TUI, session file) and the LLM. Stripping them improves
 *   readability across the board.
 *
 * DEFERRED pipeline  (runs in `context` — deep copy, only LLM sees result)
 *   Stages applied per toolResult message: dedup → paths → toon
 *   NOT persisted: dedup markers ([N×]) and path sigils ($WS) would be
 *   confusing in the TUI and session files. TOON replaces JSON with a
 *   different syntax. All three must remain invisible to the user.
 */

import { stripAnsi } from "./stages/ansi.js";
import { normalizeWhitespace } from "./stages/whitespace.js";
import { foldConsecutiveDuplicates } from "./stages/dedup.js";
import { normalizeSeparators } from "./stages/separator.js";
import { compressPaths, compilePathEntries, type PathEntry, type CompiledPathEntry } from "./stages/paths.js";
import { jsonToToon } from "./stages/toon.js";
import { compressDynamicTokens } from "./stages/tokens_dyn.js";

export type { PathEntry, CompiledPathEntry };

/** Cached compression result for a single text block. */
export interface BlockCacheEntry {
	block: ContentBlock;
	charsBefore: number;
	charsAfter: number;
}

/** Pre-compiled path entry for fast replacement (avoids per-call RegExp construction). */
export interface CompiledPathEntry extends PathEntry {
	re: RegExp;
	minOccurrences: number;
}

export interface PipelineConfig {
	pathEntries: PathEntry[];
	/**
	 * Pre-compiled regex entries — built once from pathEntries and reused
	 * across all compressPaths calls. Avoids `new RegExp(...)` overhead per call.
	 */
	compiledPaths?: CompiledPathEntry[];
	/**
	 * Optional WeakMap cache for deferred pipeline results.
	 * Key: original ContentBlock object (reference-stable across context calls).
	 * Value: previously-compressed block + char counts.
	 *
	 * Reset this by assigning a new WeakMap at session_start so stale cache
	 * entries don't outlive their session config (pathEntries, etc.).
	 */
	blockCache?: WeakMap<object, BlockCacheEntry>;
}

// ── Immediate pipeline ──────────────────────────────────────────────────────

export interface ImmediateResult {
	text: string;
	stagesApplied: string[];
}

/**
 * Run the immediate pipeline on a single text block (tool_result hook).
 * Returns the original text if nothing changed.
 */
export function runImmediatePipeline(text: string, _config: PipelineConfig): ImmediateResult {
	const stagesApplied: string[] = [];

	function apply(name: string, fn: (t: string) => string): string {
		const out = fn(text);
		if (out !== text) stagesApplied.push(name);
		return out;
	}

	text = apply("ansi", stripAnsi);
	text = apply("whitespace", normalizeWhitespace);

	return { text, stagesApplied };
}

// ── Deferred pipeline ───────────────────────────────────────────────────────

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ContentBlock {
	type: string;
	[key: string]: unknown;
}

export interface Message {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

export interface DeferredResult {
	messages: Message[];
	charsBefore: number;
	charsAfter: number;
	changed: boolean;
}

const MIN_DEFERRED_SIZE = 150;

/**
 * Run the deferred pipeline across all messages (context hook).
 * Only compresses text blocks in toolResult messages (role === "toolResult").
 * Returns the original messages array reference if nothing changed.
 */
export function runDeferredPipeline(messages: Message[], config: PipelineConfig): DeferredResult {
	let changed = false;
	let charsBefore = 0;
	let charsAfter = 0;

	const processed = messages.map((msg): Message => {
		// Only aggressively compress tool result messages
		if (msg.role !== "toolResult") return msg;
		if (!Array.isArray(msg.content)) return msg;

		let msgChanged = false;
		const newContent = (msg.content as unknown[]).map((block): unknown => {
			if (typeof block !== "object" || block === null) return block;
			const b = block as ContentBlock;
			if (b.type !== "text" || typeof (b as unknown as TextBlock).text !== "string") return block;

			const original = (b as unknown as TextBlock).text;
			if (original.length < MIN_DEFERRED_SIZE) return block;

			// Cache hit: block object seen before → reuse previous result
			if (config.blockCache) {
				const hit = config.blockCache.get(b);
				if (hit) {
					charsBefore += hit.charsBefore;
					charsAfter += hit.charsAfter;
					msgChanged = true;
					return hit.block;
				}
			}

			let text = original;

			// Stage 1: separator line normalization (before dedup so normalized
			// separators are identical and fold cleanly)
			const sepNorm = normalizeSeparators(text);
			if (sepNorm !== text) text = sepNorm;

			// Stage 2: consecutive line dedup
			const deduped = foldConsecutiveDuplicates(text);
			if (deduped !== text) text = deduped;

			// Stage 3: path compression (use pre-compiled regexes when available)
			if (config.pathEntries.length > 0) {
				const pathed = compressPaths(text, config.pathEntries, config.compiledPaths);
				if (pathed !== text) text = pathed;
			}

			// Stage 4: JSON → TOON (only if text is entirely valid JSON)
			// Must run before dynamic tokens so JSON structure is intact.
			const tooned = jsonToToon(text);
			if (tooned !== text) text = tooned;

			// Stage 5: dynamic repeated-token compression
			// Runs after TOON so JSON is handled by the better codec first;
			// dynamic tokens then catches any repeated patterns in TOON output
			// or in non-JSON text (stack traces, log lines, etc.).
			const dynCompressed = compressDynamicTokens(text);
			if (dynCompressed !== text) text = dynCompressed;

			if (text === original) return block;

			charsBefore += original.length;
			charsAfter += text.length;
			msgChanged = true;

			const compressed = { ...b, text } as unknown as ContentBlock;

			// Store result in cache keyed by the original block reference
			config.blockCache?.set(b, { block: compressed, charsBefore: original.length, charsAfter: text.length });

			return compressed;
		});

		if (!msgChanged) return msg;
		changed = true;
		return { ...msg, content: newContent };
	});

	return { messages: processed, charsBefore, charsAfter, changed };
}
