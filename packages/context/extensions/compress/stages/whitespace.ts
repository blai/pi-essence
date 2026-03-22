/**
 * Whitespace normalization stage.
 *
 * Lossless from a semantic perspective — removes formatting waste:
 *   - Trailing spaces/tabs on every line
 *   - Runs of 3+ blank lines collapsed to 2
 *   - Leading and trailing blank lines stripped from the entire block
 *
 * Applied first (after ANSI) so later stages work on clean lines.
 */

export function normalizeWhitespace(text: string): string {
	// Strip trailing whitespace per line
	let out = text.replace(/[ \t]+$/gm, "");

	// Collapse runs of 3+ blank lines to exactly 2
	out = out.replace(/\n{3,}/g, "\n\n");

	// Strip leading blank lines from the block
	out = out.replace(/^\n+/, "");

	// Strip trailing blank lines from the block
	out = out.replace(/\n+$/, "");

	return out;
}
