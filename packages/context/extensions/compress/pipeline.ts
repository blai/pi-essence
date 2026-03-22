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
import { compressPaths, type PathEntry } from "./stages/paths.js";
import { jsonToToon } from "./stages/toon.js";

export type { PathEntry };

export interface PipelineConfig {
	pathEntries: PathEntry[];
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

			let text = original;

			// Stage 1: consecutive line dedup
			const deduped = foldConsecutiveDuplicates(text);
			if (deduped !== text) text = deduped;

			// Stage 2: path compression
			if (config.pathEntries.length > 0) {
				const pathed = compressPaths(text, config.pathEntries);
				if (pathed !== text) text = pathed;
			}

			// Stage 3: JSON → TOON (only if text is entirely valid JSON)
			const tooned = jsonToToon(text);
			if (tooned !== text) text = tooned;

			if (text === original) return block;

			charsBefore += original.length;
			charsAfter += text.length;
			msgChanged = true;

			return { ...b, text } as unknown as ContentBlock;
		});

		if (!msgChanged) return msg;
		changed = true;
		return { ...msg, content: newContent };
	});

	return { messages: processed, charsBefore, charsAfter, changed };
}
