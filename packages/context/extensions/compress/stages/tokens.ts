/**
 * Token counter using js-tiktoken (pure JS BPE, no WASM).
 *
 * Uses cl100k_base which is the tokenizer for Claude and GPT-4 — a good
 * approximation for all pi-supported models. Initialized lazily on first call
 * so the extension loads instantly even when the encoder has a cold-start cost.
 *
 * Benchmarks: ~0.1ms/1K chars, ~1.2ms/10K chars, ~13ms/100K chars.
 * Used in the tool_result hot path (single blocks, typically ≤30KB).
 * The context hook uses a fast ÷3.5 estimate instead (processes many messages).
 */

import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

let _enc: Tiktoken | null = null;

function getEnc(): Tiktoken {
	if (!_enc) _enc = new Tiktoken(cl100k_base);
	return _enc;
}

/**
 * Count tokens in a string using the cl100k_base BPE tokenizer.
 * Falls back to `chars ÷ 3.5` if the encoder throws.
 */
export function countTokens(text: string): number {
	try {
		return getEnc().encode(text).length;
	} catch {
		return Math.ceil(text.length / 3.5);
	}
}

/**
 * Fast token estimate for large contexts: chars ÷ 3.5.
 * Used in the context hook where running BPE on the full history would add
 * tens of milliseconds per LLM call.
 */
export function estimateTokens(charCount: number): number {
	return Math.ceil(charCount / 3.5);
}
