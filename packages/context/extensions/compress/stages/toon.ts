/**
 * JSON → TOON compression stage.
 *
 * TOON (Token-Oriented Object Notation) is a lossless, LLM-readable encoding
 * of JSON that collapses uniform arrays of objects into a CSV-style tabular
 * layout, achieving 30–68% token reduction on structured data.
 *
 * This stage only applies when:
 *   1. The entire text block is valid JSON (not JSON embedded in prose)
 *   2. The TOON-encoded result is actually shorter
 *   3. The input passes a cheap structural pre-check (starts with { or [)
 *
 * SWEET SPOT: uniform arrays of objects with 5+ rows (e.g. `gh api` responses,
 * search results, jq output, test results in JSON). Falls back to original for
 * deeply nested configs where TOON is comparable to or larger than compact JSON.
 *
 * Applied in the `context` hook (not `tool_result`) so the UI still shows the
 * original pretty-printed JSON; only the LLM payload is TOON-encoded.
 */

import { encode } from "@toon-format/toon";

/** Minimum text length worth attempting TOON encoding. */
const MIN_SIZE = 200;

/**
 * Attempts to encode a JSON text block as TOON.
 * Returns the TOON string if it's shorter, otherwise returns the original.
 */
export function jsonToToon(text: string): string {
	if (text.length < MIN_SIZE) return text;

	// Cheap pre-check: JSON must start with { or [
	const first = text.trimStart()[0];
	if (first !== "{" && first !== "[") return text;

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return text; // Not valid JSON
	}

	let toon: string;
	try {
		toon = encode(parsed);
	} catch {
		return text; // TOON encode failed (shouldn't happen for valid JSON)
	}

	// Only use TOON if it's meaningfully shorter (save at least 10%)
	return toon.length < text.length * 0.9 ? toon : text;
}
